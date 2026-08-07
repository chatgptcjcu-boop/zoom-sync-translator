# 兩組網址：主辦自用 vs 訪客測試

同一套 Railway 服務，兩個入口：

| 對象 | 網址 | API 誰付費 |
|------|------|------------|
| **你自己開會** | `https://zoom-sync-translator-production.up.railway.app/` | 主辦方伺服器 `GEMINI_API_KEY` |
| **給別人測試** | `https://zoom-sync-translator-production.up.railway.app/guest` | 測試者自己貼的 Gemini Key |

## 規則

- 首頁 `/`：行為與以前相同，用你的額度。
- `/guest`：沒填自己的 Key 進不了房；翻譯**不會**打主辦方 Key。
- 請把 **`/guest`** 傳給外部測試者，不要傳首頁。
- 測試雙方都要用 `/guest`，並各自輸入自己的 Key、同一房號。

## 本機

- 主辦：`http://localhost:3100/`
- 訪客：`http://localhost:3100/guest`
