# M2 — 用 Gemini API 當翻譯引擎

## 可以嗎？

可以。SyncSub 已支援 `TRANSLATE_PROVIDER=gemini`，透過 Google AI Studio 的 API Key 呼叫 Gemini 做會議翻譯。

## 申請 Key

1. 開啟 https://aistudio.google.com/apikey  
2. 登入 Google 帳號 → **Create API key**  
3. 複製金鑰（不要貼到公開聊天）

## 本機測試

編輯 `.env`：

```
TRANSLATE_PROVIDER=gemini
GEMINI_API_KEY=你的金鑰
GEMINI_MODEL=gemini-2.5-flash
```

```bash
npm start
npm run smoke -- http://localhost:3100
# 期望 provider: gemini
```

單句測試：

```bash
node -e "
require('dotenv').config();
const { translate } = require('./server/translate');
translate('大家好，歡迎參加會議','zh-TW','ja-JP').then(console.log).catch(e=>console.error(e.message));
"
```

## Railway Variables

```
TRANSLATE_PROVIDER=gemini
GEMINI_API_KEY=你的金鑰
GEMINI_MODEL=gemini-2.5-flash
TRUST_PROXY=1
```

記得在畫布用 **Staged changes → Deploy**（不要只按 Redeploy）。

驗收：

```bash
curl -s https://zoom-sync-translator-production.up.railway.app/health
# hasGeminiKey: true
# preferredProvider: gemini

npm run smoke -- https://zoom-sync-translator-production.up.railway.app
# provider: gemini
```

## 備註

- 也接受別名 `GOOGLE_API_KEY`  
- 模型可改 `gemini-2.0-flash` / `gemini-2.5-flash` 等（依 AI Studio 可用清單）  
- 失敗時會自動降級到已設定的 OpenAI / DeepL / MyMemory  
