# 公開測試 vs 自用入口

| 對象 | 路徑 | 說明 |
|------|------|------|
| **給別人** | `/` 說明頁、`/try` 會議室 | 強制自備 Gemini Key；可公開轉傳 |
| **你自己** | `/r/<HOST_LOBBY_TOKEN>` | 用伺服器額度；**勿外傳** |

自用密鑰環境變數：`HOST_LOBBY_TOKEN`（預設見伺服器啟動 log）。  
可在 Railway Variables 改成自己的亂數，改完後自用網址會變。

給測試者請只傳：[給測試者的說明.md](./給測試者的說明.md)  
API 技術細節：[BYOK-自備APIKey.md](./BYOK-自備APIKey.md)
