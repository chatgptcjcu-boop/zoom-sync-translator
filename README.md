# SyncSub Meeting — Zoom 雙邊同步翻譯字幕

專為「台灣 ↔ 日本」線上工作會議設計的雙邊同步翻譯字幕工具。  
雙方用 **Chrome** 開啟同一個會議室，各自用麥克風收音，中繼站負責翻譯並即時推播字幕。

> 承接 Gemini 討論原型：前端 Web Speech + Socket.io、後端 Node 中繼 + 翻譯 API。本專案補齊可實際開會的雙邊會議室與穩定服務機制。

---

## 架構

```
台灣端 Chrome                    中繼站 (Node)                   日本端 Chrome
┌──────────────┐               ┌─────────────────┐            ┌──────────────┐
│ 麥克風收音    │──中文文字────▶│ Socket.io 房間   │──原文─────▶│ 顯示中文原文  │
│ Web Speech   │               │ 翻譯佇列         │            │ 顯示中文譯文  │
│ 顯示日文譯文  │◀──日文譯文────│ DeepL/OpenAI/MM │◀─日文文字──│ 麥克風收音    │
└──────────────┘               └─────────────────┘            └──────────────┘
        ▲                              ▲                              ▲
        └────────── Zoom 傳聲音（聽對方）／本工具傳字幕（讀譯文）────────┘
```

**重點：** 本工具抓的是「各自本機麥克風」，不是 Zoom 系統音。  
Zoom 負責聽對方說話；SyncSub 負責看對方說的話的翻譯。

---

## 快速開始（本機雙開測試）

```bash
cd /Users/apple/Documents/zoom-sync-translator
cp .env.example .env
npm install
npm start
```

瀏覽器開兩個視窗：

1. http://localhost:3100  → 選「台灣端」→ 房號 `meeting-001` → 進入 → 開始收音  
2. 無痕視窗同一網址 → 選「日本端」→ 同一房號 → 進入 → 開始收音  

對一邊說話，另一邊應先出現原文，再出現譯文。

健康檢查：http://localhost:3100/health

> 預設埠為 **3100**（避免與本機其他專案的 3000 衝突）。可在 `.env` 改 `PORT`。

---

## 正式會議建議流程

1. 部署中繼站到有 **HTTPS** 的雲端（**首選 Railway**／Fly.io／VPS + Nginx）。  
2. 在 `.env` 設定 `TRANSLATE_PROVIDER=deepl` 或 `openai`，並填入 API Key。  
3. 把網址傳給教授，例如：  
   - 你：`https://你的網域/?room=mtg-0320&role=tw&name=張老師`  
   - 對方：`https://你的網域/?room=mtg-0320&role=jp&name=田中`  
4. 雙方開 Zoom；再各開一個 Chrome 視窗放在旁邊（或第二螢幕）開始收音。  
5. 開會中可按「⌃」隱藏控制列，只留字幕；結束後按「↓」匯出逐字稿。

### Railway 運作規格書與里程碑

| 文件 | 說明 |
|------|------|
| [docs/MILESTONES.md](./docs/MILESTONES.md) | **M1→M4 進度總表** |
| [docs/RAILWAY-運作規格書.md](./docs/RAILWAY-運作規格書.md) | 整體運作規格 |
| [docs/M1-Railway部署指南.md](./docs/M1-Railway部署指南.md) | 部署 |
| [docs/M2-DeepL接線.md](./docs/M2-DeepL接線.md) | DeepL |
| [docs/M3-彩排SOP.md](./docs/M3-彩排SOP.md) | 彩排 |
| [docs/M4-實戰Runbook.md](./docs/M4-實戰Runbook.md) | 實戰 |

```bash
npm run smoke                              # 本機雙端煙測
npm run smoke -- https://xxx.up.railway.app  # 對正式網址煙測
```

---

## 環境變數

見 `.env.example`。重點：

| 變數 | 說明 |
|------|------|
| `TRANSLATE_PROVIDER` | `mymemory`（免費測試）/ `deepl` / `openai` |
| `DEEPL_API_KEY` | 日⇄中會議首選 |
| `OPENAI_API_KEY` | 語境較好的備援 |
| `CORS_ORIGIN` | 正式環境改成你的網域，不要用 `*` |
| `TRUST_PROXY` | 放在反向代理後設 `1` |

翻譯會依「主引擎 → 備援引擎」自動降級；單房間有佇列，避免瞬間打爆 API。

---

## 如何讓服務穩定（開會不掉線）

### 1. 一定要用 HTTPS + Chrome
- 麥克風與 Web Speech 在非安全來源會失敗或靜默無聲。  
- 本機用 `localhost`；遠端必須 HTTPS。

### 2. 中繼站不要用「會休眠」的免費方案開會
- Render 免費實例閒置會睡，開會前要先打 `/health` 喚醒，或改付費常駐。  
- 建議：小 VPS + `pm2`，或 Railway / Fly 常駐。

```bash
npm i -g pm2
pm2 start server/index.js --name syncsub
pm2 save
```

### 3. 語音辨識會自動結束 — 前端已做 watchdog
Chrome 的 `SpeechRecognition` 約 30–60 秒無聲或內部 timeout 會 `onend`。  
前端在「仍要收音」時會自動 `start()` 重啟，維持整場會議。

### 4. Socket 斷線自動重連 + 重新進房
客戶端 `reconnection: Infinity`；連上後重新 `join_room`。  
伺服器 `pingInterval/pingTimeout` 已調成適合長會議。

### 5. 翻譯穩定度
- **MyMemory**：免費但有日配額，只適合測試。  
- **DeepL**：日文會議品質與延遲較穩。  
- **OpenAI**：語境佳；注意費用與延遲。  
- 伺服器有重試 + 引擎降級 + 每房翻譯佇列。

### 6. 開會操作習慣
- 盡量用外接或筆電「實際在講話」的麥克風；音量條要會跳。  
- Zoom 與字幕分兩個視窗，避免搶焦點。  
- 雙方「我的語言」設對（台灣端 zh-TW、日本端 ja-JP）。  
- 網路不穩時看左上狀態與 debug；RTT > 1.5s 會提示。

### 7. 部署檢查清單
- [ ] `/health` 回 `ok: true`  
- [ ] 兩個裝置同房號可互看字幕  
- [ ] 麥克風權限允許、音量條跳動  
- [ ] 翻譯引擎非 MyMemory（正式會議）  
- [ ] HTTPS 憑證有效  
- [ ] 進程用 pm2 / systemd 守護，開機自啟  

---

## 目錄

```
zoom-sync-translator/
├── server/
│   ├── index.js       # 中繼站入口
│   ├── rooms.js       # 房間成員與歷史
│   └── translate.js   # 翻譯引擎與降級
├── public/
│   ├── index.html     # 大廳 + 會議室
│   ├── css/app.css
│   └── js/app.js
├── .env.example
└── package.json
```

---

## 已知限制

- Web Speech API 依賴 Google 雲端辨識，需外網；辨識品質受口音／噪音影響。  
- 不擷取 Zoom 對方聲音；對方必須也開本工具並說話。  
- 免費 MyMemory 不適合正式商務會議。

若之後要升級：可改 Whisper 串流 STT、或做 Chrome 擴充把字幕浮在 Zoom 網頁上。
