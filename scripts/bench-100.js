#!/usr/bin/env node
/**
 * 100 句中日會議用語批次翻譯驗證
 * 用法: node scripts/bench-100.js [local|railway]
 */
require('dotenv').config();
const { translate, providerChain } = require('../server/translate');

const MODE = (process.argv[2] || 'local').toLowerCase();

// 50 句繁中（會議情境）→ 期望譯成日文
const ZH_SENTENCES = [
  '大家好，歡迎參加今天的會議。',
  '請先做個簡單的自我介紹。',
  '今天主要想討論合作時程。',
  '請問貴公司目前的優先項目是什麼？',
  '我們希望下個月可以開始試作。',
  '預算方面還需要再確認。',
  '技術規格書我已經寄到信箱了。',
  '請幫我確認附件是否有收到。',
  '這個方案還有哪些風險？',
  '我們可以分三個階段執行。',
  '第一階段預計兩週完成。',
  '第二階段需要雙方工程師一起測試。',
  '第三階段是上線與維運。',
  '日文介面需要在地化嗎？',
  '使用者回饋目前大致正面。',
  '請把簡報翻到下一頁。',
  '這張圖說明了系統架構。',
  '中繼伺服器負責翻譯與同步。',
  '前端會議室支援雙語字幕。',
  '語音辨識會自動重啟以維持連線。',
  '請允許瀏覽器使用麥克風。',
  '雙方必須輸入相同的房號。',
  '翻譯延遲大約一到兩秒。',
  '若網路不穩請稍候重連。',
  '會議結束後可以匯出逐字稿。',
  '我們建議使用 Chrome 瀏覽器。',
  '正式環境必須使用 HTTPS。',
  'API 金鑰請不要放在前端。',
  '今天先確認需求範圍。',
  '細節文件下週再補齊。',
  '請問日本端的窗口是哪一位？',
  '合約條款需要法務再看一次。',
  '付款條件可以再商量。',
  '我們可以提供教育訓練。',
  '維護費用是按年計算。',
  '緊急問題會在四小時內回應。',
  '請提供測試帳號給對方。',
  '資料隱私要符合法規。',
  '伺服器部署在亞洲節點較佳。',
  '目前同時支援三位與會者足夠。',
  '未來可擴充到多人會議。',
  '字幕字級可以手動調整。',
  '控制面板可以隱藏以便專注。',
  '請用慢一點的語速發言。',
  '專有名詞建議同時打在聊天室。',
  '我重複一次重點結論。',
  '下次會議暫定下週三下午。',
  '請回覆可否參加。',
  '感謝各位今天的時間。',
  '那我們就先到這裡，謝謝。',
];

// 50 句日文（會議情境）→ 期望譯成繁中
const JA_SENTENCES = [
  '本日はお忙しい中、ご参加いただきありがとうございます。',
  'まず簡単に自己紹介をお願いします。',
  '本日の議題は協力スケジュールです。',
  '御社の優先事項を教えてください。',
  '来月から試作を始めたいです。',
  '予算については再確認が必要です。',
  '仕様書はメールで送りました。',
  '添付ファイルは届いていますか。',
  'この案にはどんなリスクがありますか。',
  '三つの段階で進めましょう。',
  '第一段階は二週間で完了予定です。',
  '第二段階は共同テストです。',
  '第三段階は本番公開と運用です。',
  '日本語UIのローカライズは必要ですか。',
  'ユーザーの反応は概ね良好です。',
  '次のスライドをお願いします。',
  'この図はシステム構成を示しています。',
  '中継サーバーが翻訳と同期を担当します。',
  'フロントは二言語字幕に対応しています。',
  '音声認識は自動で再起動します。',
  'マイクの権限を許可してください。',
  '同じ部屋番号を入力してください。',
  '翻訳の遅延は約一〜二秒です。',
  '通信が不安定な場合は再接続してください。',
  '会議後に議事録を書き出せます。',
  'Chromeの使用を推奨します。',
  '本番環境ではHTTPSが必須です。',
  'APIキーをフロントに置かないでください。',
  'まずは要件範囲を確定しましょう。',
  '詳細資料は来週補足します。',
  '日本側の窓口はどなたですか。',
  '契約条項は法務確認が必要です。',
  '支払条件は相談可能です。',
  'トレーニングも提供できます。',
  '保守費用は年額です。',
  '緊急時は四時間以内に対応します。',
  'テスト用アカウントをご用意ください。',
  '個人情報保護に準拠します。',
  'アジア拠点への配備が望ましいです。',
  '現状は三者会議で十分です。',
  '将来は多人数会議にも拡張できます。',
  '字幕の文字サイズは変更可能です。',
  '操作パネルは非表示にできます。',
  '少しゆっくり話してください。',
  '専門用語はチャットにも書いてください。',
  '重要ポイントをもう一度繰り返します。',
  '次回は来週水曜の午後を候補にします。',
  'ご出席可否をご返信ください。',
  '本日はありがとうございました。',
  'それでは本日はここまでにします。',
];

async function runLocal() {
  const chain = providerChain().map((p) => p.name);
  console.log('[bench] mode=local chain=', chain.join(' -> '));
  const rows = [];
  let ok = 0;
  let fail = 0;
  const t0 = Date.now();

  const jobs = [
    ...ZH_SENTENCES.map((text, i) => ({ id: i + 1, dir: 'ZH→JA', text, src: 'zh-TW', tgt: 'ja-JP' })),
    ...JA_SENTENCES.map((text, i) => ({ id: 50 + i + 1, dir: 'JA→ZH', text, src: 'ja-JP', tgt: 'zh-TW' })),
  ];

  // 適度並行，避免打爆 API
  const concurrency = 3;
  let idx = 0;

  async function worker() {
    while (idx < jobs.length) {
      const job = jobs[idx++];
      const started = Date.now();
      try {
        const r = await translate(job.text, job.src, job.tgt);
        const ms = Date.now() - started;
        const good = r && r.text && r.provider === 'gemini' && r.text.trim() && r.text !== job.text;
        if (good) ok++;
        else fail++;
        rows.push({
          id: job.id,
          dir: job.dir,
          provider: r.provider,
          ms,
          ok: !!good,
          src: job.text,
          out: r.text,
        });
        process.stdout.write(good ? '.' : 'x');
      } catch (e) {
        fail++;
        rows.push({
          id: job.id,
          dir: job.dir,
          provider: 'error',
          ms: Date.now() - started,
          ok: false,
          src: job.text,
          out: e.message,
        });
        process.stdout.write('E');
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  console.log('');

  const totalMs = Date.now() - t0;
  const geminiRows = rows.filter((r) => r.provider === 'gemini' && r.ok);
  const avgMs = geminiRows.length
    ? Math.round(geminiRows.reduce((s, r) => s + r.ms, 0) / geminiRows.length)
    : 0;

  const sample = rows.filter((r) => r.ok).slice(0, 5).concat(rows.filter((r) => r.ok).slice(50, 55));

  return {
    mode: 'local',
    total: jobs.length,
    ok,
    fail,
    successRate: `${((ok / jobs.length) * 100).toFixed(1)}%`,
    avgLatencyMs: avgMs,
    totalMs,
    chain,
    sample,
    failures: rows.filter((r) => !r.ok).slice(0, 10),
  };
}

async function runRailwayHealth() {
  const url = 'https://zoom-sync-translator-production.up.railway.app/health';
  const res = await fetch(url);
  const data = await res.json();
  return {
    mode: 'railway-health',
    url,
    ok: data.ok === true,
    preferredProvider: data.preferredProvider,
    translateProviders: data.translateProviders,
    hasGeminiKey: data.env?.hasGeminiKey,
    TRANSLATE_PROVIDER: data.env?.TRANSLATE_PROVIDER,
    hint: data.env?.hint,
    geminiReady: data.env?.hasGeminiKey === true && (data.translateProviders || []).includes('gemini'),
  };
}

(async () => {
  if (MODE === 'railway') {
    const h = await runRailwayHealth();
    console.log(JSON.stringify(h, null, 2));
    process.exit(h.geminiReady ? 0 : 2);
  }

  const report = await runLocal();
  const railway = await runRailwayHealth();
  const out = { localBench: report, railway };
  console.log('\n===== SUMMARY =====');
  console.log(JSON.stringify({
    local: {
      successRate: report.successRate,
      ok: report.ok,
      fail: report.fail,
      avgLatencyMs: report.avgLatencyMs,
      chain: report.chain,
    },
    railway: {
      online: railway.ok,
      geminiReady: railway.geminiReady,
      preferredProvider: railway.preferredProvider,
      hasGeminiKey: railway.hasGeminiKey,
    },
    samples: report.sample.map((s) => ({
      id: s.id,
      dir: s.dir,
      src: s.src,
      out: s.out,
      ms: s.ms,
    })),
  }, null, 2));

  const fs = require('fs');
  const path = require('path');
  const reportPath = path.join(__dirname, '..', 'docs', 'bench-100-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(out, null, 2));
  console.log('report written:', reportPath);
  process.exit(report.fail > 10 ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
