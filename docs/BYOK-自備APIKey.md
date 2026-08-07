# BYOK（Bring Your Own Key）— 自備 API Key

測試者（或站長臨時選擇）在瀏覽器貼上**自己的** Gemini API Key，翻譯請求用該 Key 呼叫 Google，**不消耗**伺服器環境變數裡的 `GEMINI_API_KEY`。

申請 Key：[Google AI Studio](https://aistudio.google.com/apikey)。

---

## 與網址的對應

| 入口 | 是否強制 BYOK | 說明 |
|------|----------------|------|
| `/` | — | 僅說明頁，無進房 |
| `/try`（及舊 `/guest`） | **是** | 前端 `guestLane` + 後端拒絕無 Key |
| `/r/<HOST_LOBBY_TOKEN>` | 否 | 預設伺服器額度；頁上仍可選自備 Key |

可公開轉傳的步驟說明：[給測試者的說明.md](./給測試者的說明.md)。  
自用 URL 只寫在：[站長自用說明.md](./站長自用說明.md)。

---

## 伺服器行為（`join_room`）

1. 讀取 `payload.guestLane` 與 `payload.apiKey`。
2. `forceByok = guestLane || REQUIRE_CLIENT_API_KEY=true`。
3. 若 `forceByok` 且沒有 Key → `ack` 失敗，不進房。
4. 若 `guestLane` → 即使之後邏輯有空 Key，也強制 `translator.mode = 'byok'`，**不准**退回 `server`。
5. `send_speech` 翻譯時：`mode === 'byok'` 才把客戶端 Key 傳入 `translate()`；否則用伺服器引擎鏈。

前端：`public/js/app.js` 以 `__SYNCSUB_GUEST__` 或路徑 `/try`、`/guest` 判定 `guestLane`，進房時一併送出。

---

## 環境變數

| 變數 | 說明 |
|------|------|
| `GEMINI_API_KEY` | 站長／伺服器額度（自用通道） |
| `REQUIRE_CLIENT_API_KEY` | `true` 時**所有**進房都強制自備 Key（含自用頁）。日常建議 `false`，公開測試交給 `/try` |
| `HOST_LOBBY_TOKEN` | 自用路徑密鑰（與 BYOK 獨立，但決定誰走伺服器額度入口） |

`/api/config` 會回傳 `requireClientApiKey`、`byokEnabled`、`publicTryPath`，**不會**回傳自用路徑。

---

## 安全與隱私注意

- Key 經 WSS 送到中繼，僅存在該 socket 的記憶體（`socket.data.translator`），用於代打 Gemini；重開分頁需重貼。
- 仍建議測試者使用可撤銷的 Key、測完可刪除。
- 正式商務會議優先用自用通道 + 伺服器 Key，較好控管費用與模型設定。

---

## 相關文件

- [整體程序與過程.md](./整體程序與過程.md)
- [站長自用說明.md](./站長自用說明.md)
- [給測試者的說明.md](./給測試者的說明.md)
