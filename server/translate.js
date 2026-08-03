/**
 * 翻譯提供者：MyMemory（免費測試）/ DeepL / OpenAI
 * 失敗時自動降級到下一個可用引擎。
 */
const axios = require('axios');
const { envGet, envHas } = require('./env');

const LANG_MAP = {
  'zh-TW': { mymemory: 'zh-TW', deepl: 'ZH', openai: 'Traditional Chinese (Taiwan)' },
  'zh-CN': { mymemory: 'zh-CN', deepl: 'ZH', openai: 'Simplified Chinese' },
  'ja-JP': { mymemory: 'ja', deepl: 'JA', openai: 'Japanese' },
  'en-US': { mymemory: 'en', deepl: 'EN', openai: 'English' },
  'en-GB': { mymemory: 'en', deepl: 'EN-GB', openai: 'British English' },
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function mapLang(code, provider) {
  const entry = LANG_MAP[code];
  if (!entry) return code;
  return entry[provider] || code;
}

async function translateWithMyMemory(text, src, tgt) {
  const srcLang = mapLang(src, 'mymemory');
  const tgtLang = mapLang(tgt, 'mymemory');
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${srcLang}|${tgtLang}`;
  const { data } = await axios.get(url, { timeout: 8000 });

  if (!data?.responseData?.translatedText) {
    throw new Error('MyMemory: unexpected response');
  }

  let result = data.responseData.translatedText;
  // MyMemory 配額用盡時會回傳提示字串
  if (/MYMEMORY WARNING/i.test(result)) {
    throw new Error('MyMemory: daily quota exceeded');
  }
  if (result === text && srcLang !== tgtLang) {
    result = `[查無譯文] ${result}`;
  }
  return result;
}

async function translateWithDeepL(text, src, tgt) {
  const key = envGet('DEEPL_API_KEY', 'SYNC_DEEPL_API_KEY');
  if (!key) throw new Error('DeepL: missing DEEPL_API_KEY');

  const base = (process.env.DEEPL_API_URL || 'https://api-free.deepl.com').replace(/\/$/, '');
  const { data } = await axios.post(
    `${base}/v2/translate`,
    new URLSearchParams({
      text,
      source_lang: mapLang(src, 'deepl'),
      target_lang: mapLang(tgt, 'deepl'),
    }),
    {
      headers: {
        Authorization: `DeepL-Auth-Key ${key}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 10000,
    }
  );

  const translated = data?.translations?.[0]?.text;
  if (!translated) throw new Error('DeepL: empty translation');
  return translated;
}

async function translateWithOpenAI(text, src, tgt) {
  const key = envGet('OPENAI_API_KEY', 'SYNC_OPENAI_API_KEY');
  if (!key) throw new Error('OpenAI: missing OPENAI_API_KEY');

  const model = envGet('OPENAI_MODEL', 'SYNC_OPENAI_MODEL') || 'gpt-4o-mini';
  const srcLabel = mapLang(src, 'openai');
  const tgtLabel = mapLang(tgt, 'openai');

  const { data } = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            `You are a professional meeting interpreter. Translate from ${srcLabel} to ${tgtLabel}. ` +
            'Return only the translation. Keep names, numbers, and technical terms accurate. No quotes or commentary.',
        },
        { role: 'user', content: text },
      ],
    },
    {
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    }
  );

  const translated = data?.choices?.[0]?.message?.content?.trim();
  if (!translated) throw new Error('OpenAI: empty translation');
  return translated;
}

function providerChain() {
  // 有正式引擎 Key 卻未設 PROVIDER 時，自動優先用正式引擎（避免卡在 mymemory）
  let preferred = (envGet('TRANSLATE_PROVIDER', 'SYNC_TRANSLATE_PROVIDER') || '').toLowerCase();
  if (!preferred) {
    if (envHas('OPENAI_API_KEY', 'SYNC_OPENAI_API_KEY')) preferred = 'openai';
    else if (envHas('DEEPL_API_KEY', 'SYNC_DEEPL_API_KEY')) preferred = 'deepl';
    else preferred = 'mymemory';
  }
  const chain = [];

  const push = (name, fn, available) => {
    if (available) chain.push({ name, fn });
  };

  // 優先使用設定的引擎，其餘作備援
  const catalog = {
    deepl: { fn: translateWithDeepL, available: envHas('DEEPL_API_KEY', 'SYNC_DEEPL_API_KEY') },
    openai: { fn: translateWithOpenAI, available: envHas('OPENAI_API_KEY', 'SYNC_OPENAI_API_KEY') },
    mymemory: { fn: translateWithMyMemory, available: true },
  };

  if (catalog[preferred]) {
    push(preferred, catalog[preferred].fn, catalog[preferred].available);
  }
  for (const [name, item] of Object.entries(catalog)) {
    if (name === preferred) continue;
    push(name, item.fn, item.available);
  }

  return chain.length ? chain : [{ name: 'mymemory', fn: translateWithMyMemory }];
}

/**
 * 帶重試與自動降級的翻譯入口
 */
async function translate(text, sourceLang, targetLang) {
  const clean = String(text || '').trim();
  if (!clean) return '';

  if (sourceLang === targetLang) return clean;

  const retries = Math.max(0, Number(process.env.TRANSLATE_RETRIES || 2));
  const chain = providerChain();
  const errors = [];

  for (const provider of chain) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const result = await provider.fn(clean, sourceLang, targetLang);
        return { text: result, provider: provider.name };
      } catch (err) {
        errors.push(`${provider.name}#${attempt}: ${err.message}`);
        if (attempt < retries) await sleep(300 * (attempt + 1));
      }
    }
  }

  throw new Error(`All translators failed: ${errors.join(' | ')}`);
}

module.exports = { translate, providerChain };
