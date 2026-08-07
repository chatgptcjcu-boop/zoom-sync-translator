# SyncSub 里程碑進度：M1 → M4

| 里程碑 | 目標 | 狀態 |
|--------|------|------|
| **M0** 規格 | Railway 運作規格書 | ✅ 完成 |
| **M1** 部署 | GitHub + Railway 公開 HTTPS 中繼 | ✅ 驗收通過（2026-08-03） |
| **M2** Gemini | Production 使用 Gemini 翻譯 | ✅ 已修復（變數寫入正確專案 peaceful-blessing） |
| **M3** 彩排 | 雙端＋Zoom 模擬開會驗收 | ⏳ 見 M3 SOP |
| **M4** 實戰 | 對日本教授正式會議 | ⏳ 見 M4 Runbook |

**GitHub：** https://github.com/chatgptcjcu-boop/zoom-sync-translator  

**正式網址：** https://zoom-sync-translator-production.up.railway.app  

> 注意：`https://zoom-sync-translator.up.railway.app` 回 404，請用上面帶 `-production` 的網址。

詳細操作：

- [整體程序與過程.md](./整體程序與過程.md)（**現行 URL／BYOK／流程總覽**）
- [給測試者的說明.md](./給測試者的說明.md)（可公開轉傳）
- [站長自用說明.md](./站長自用說明.md)（含自用路徑，勿外傳）
- [M1-Railway部署指南.md](./M1-Railway部署指南.md)
- [M2-DeepL接線.md](./M2-DeepL接線.md)
- [M3-彩排SOP.md](./M3-彩排SOP.md)
- [M4-實戰Runbook.md](./M4-實戰Runbook.md)
- [RAILWAY-運作規格書.md](./RAILWAY-運作規格書.md)

## 快速指令

```bash
npm run smoke
npm run smoke -- https://你的服務.up.railway.app
```

## 卡住時你需要提供的資訊

| 卡點 | 請提供 |
|------|--------|
| M1 | 完成 `npx railway login` 或 Dashboard 部署後的**公開網址** |
| M2 | DeepL API Key（Free/Pro）— 請設在 Railway Variables，或告訴我已設好以便代跑 smoke |
| M3／M4 | 彩排／實戰日期；需要我陪同檢查 health 時再说 |
