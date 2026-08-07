# SyncSub Meeting — Railway 中繼站整體運作規格書

| 項目 | 內容 |
|------|------|
| 文件版本 | v1.0 |
| 專案代號 | SyncSub / zoom-sync-translator |
| 適用場景 | 台灣 ↔ 日本 Zoom 工作會議（雙邊同步翻譯字幕） |
| 中繼主機 | Railway（常駐 Node.js Web Service） |
| 關聯程式 | `server/`（中繼）+ `public/`（會議室前端） |
| 狀態 | M0 規格完成；執行中 M1→M4（見 docs/MILESTONES.md） |

---

## 1. 文件目的

定義以 **Railway 作為唯一公開中繼站** 時的：

1. 系統邊界與角色分工  
2. 端到端資料流與延遲目標  
3. Railway 服務規格、環境變數、部署流程  
4. 開會前／中／後操作標準  
5. 穩定度、資安、監控與故障處理  

本規格對齊現有程式架構，不另引入 Vercel / AI Studio 作為中繼。

> **URL 更新（2026-08）：** 對外為 `/` 說明 + `/try` 測試（BYOK）；站長自用為 `/r/<HOST_LOBBY_TOKEN>`。  
> 現行地圖與操作以 [整體程序與過程.md](./整體程序與過程.md) 為準；下文若仍寫「單一大廳 `/`」，視為歷史敘述。

---

## 2. 系統總覽

### 2.1 一句話

雙方用 Chrome 開啟同一 Railway HTTPS 網址與相同房號；各自麥克風經 Web Speech 轉成文字，由 Railway 上的 Node 中繼翻譯並透過 Socket.io 雙向推播字幕。Zoom 只負責傳聲音，SyncSub 只負責字幕。

### 2.2 角色

| 角色 | 位置 | 職責 |
|------|------|------|
| 台灣端使用者 | Chrome（本機） | 選「台灣端」、收音（zh-TW）、閱讀日文譯文 |
| 日本端使用者 | Chrome（本機／對方） | 選「日本端」、收音（ja-JP）、閱讀中文譯文 |
| Zoom | 雙方各自 App | 雙向語音／視訊（與字幕系統解耦） |
| SyncSub 前端 | Railway 靜態託管（同源） | UI、語音辨識、Socket 客戶端、字幕顯示 |
| SyncSub 中繼 | Railway 常駐 Node | 房間、廣播、翻譯佇列、健康檢查 |
| 翻譯 API | DeepL / OpenAI / MyMemory | 文字翻譯（中繼站代呼叫） |

### 2.3 架構圖

```
┌─────────────────────┐         HTTPS + WSS          ┌─────────────────────┐
│ 台灣端 Chrome        │◄───────────────────────────►│                     │
│ Zoom（聽日語）        │                               │   Railway Service   │
│ SyncSub（看日文譯文）  │                               │   ┌───────────────┐ │
└─────────────────────┘                               │   │ Express       │ │
                                                      │   │ + static UI   │ │
┌─────────────────────┐         HTTPS + WSS          │   │ + Socket.io   │ │
│ 日本端 Chrome        │◄───────────────────────────►│   │ + 翻譯佇列     │ │
│ Zoom（聽中文）        │                               │   └───────┬───────┘ │
│ SyncSub（看中文譯文）  │                               │           │         │
└─────────────────────┘                               └───────────┼─────────┘
                                                                  │
                                                                  ▼
                                                         DeepL / OpenAI
                                                         （正式會議）
```

### 2.4 明確不做的事（範圍外）

- 不擷取 Zoom 系統音／對方喇叭聲音  
- 不以 Vercel / Google AI Studio 分享網址作為中繼  
- 不在瀏覽器端暴露翻譯 API Key  
- 第一版不做帳號登入、錄影存檔雲端、多語同時三人以上正式 SLA（技術上可多人進房，規格以 1v1 會議為主）

---

## 3. 功能規格

### 3.1 大廳（Lobby）

| 項目 | 規格 |
|------|------|
| 顯示名稱 | 必填建議；空白則依身分帶預設（台灣端／日本端） |
| 會議房號 | 雙方必須相同；建議格式 `mtg-YYYYMMDD-主題簡碼` |
| 身分 | `tw`：zh-TW→ja-JP；`jp`：ja-JP→zh-TW |
| 分享連結 | `https://{RAILWAY_DOMAIN}/?room={id}&role={tw\|jp}&name={urlencoded}` |

### 3.2 會議室（Room）

| 功能 | 規格 |
|------|------|
| 開始／停止收音 | Web Speech API（Chrome / Edge） |
| 即時草稿 | interim 結果顯示於底部灰字 |
| 己方氣泡 | 右對齊；送出後顯示「翻譯中」再更新譯文 |
| 對方氣泡 | 左對齊；先原文、後譯文 |
| 房間人數 | 顯示目前在線成員名稱 |
| 連線狀態 | 連線／斷線／延遲偏高提示 |
| 字級 | A+／A− |
| 匯出 | 本機下載 `.txt` 逐字稿 |
| 隱藏面板 | 僅留字幕區，利於第二螢幕 |

### 3.3 中繼站 Socket 事件

| 事件 | 方向 | 說明 |
|------|------|------|
| `join_room` | C→S | 進房；ack 回傳 `selfId`、成員、近期歷史 |
| `room_update` | S→C | 成員進出廣播 |
| `send_speech` | C→S | 最終辨識句（含 msgId、語系） |
| `receive_original` | S→C | 廣播原文給同房其他人 |
| `receive_translation` | S→C | 廣播譯文給同房所有人（含自己） |
| `client_ping` | C→S | RTT 量測 |
| `server_error` | S→C | 未進房等錯誤 |

### 3.4 翻譯策略

| 環境 | Provider | 備註 |
|------|----------|------|
| 本機／Railway | **`gemini`（首選）** | Google AI Studio API |
| 緊急備援 | `mymemory` | 僅 Gemini 失敗時 |
| 選用 | `deepl` / `openai` | 需把 `TRANSLATE_PROVIDER` 改成對應值 |
| 失敗處理 | 重試 N 次 → 降級下一引擎 → 回傳「翻譯失敗」標記 | 不中斷會議室連線 |

每房維持**序列翻譯佇列**，避免瞬間打爆 API。

---

## 4. Railway 服務規格

### 4.1 服務型態

| 項目 | 規格 |
|------|------|
| 產品 | Railway **Web Service**（常駐） |
| Runtime | Node.js **≥ 18** |
| Start Command | `npm start` → `node server/index.js` |
| 建置 | Nixpacks 預設即可（偵測 `package.json`） |
| 複本數 | **1 instance**（第一版；多實例需 sticky session／Redis，暫不做） |
| 重啟策略 | 平台自動重啟崩潰行程 |
| 公開通訊埠 | 使用 Railway 注入之 `PORT`；對外 **HTTPS + WSS** |
| 自訂網域 | 可選（建議正式長期使用） |

> 單實例限制：重開／重新部署當下，記憶體內房間與歷史會清空。開會中避免部署。

### 4.2 資源建議（1v1～小會議）

| 項目 | 建議起始值 | 說明 |
|------|------------|------|
| RAM | 512 MB | Socket + 輕量佇列足夠 |
| CPU | 共享／0.5–1 vCPU | 翻譯在外部 API，CPU 負擔低 |
| 區域 | 優先 **Asia**（若帳號可選）或預設 US 亦可 | 台日使用者；翻譯 API 另計 RTT |
| 休眠 | **關閉**（保持常駐） | 免費／節省方案若會睡，開會勿用 |

### 4.3 網路與協定

| 項目 | 規格 |
|------|------|
| HTTP | `GET /` 前端、`GET /health`、`GET /api/config` |
| WebSocket | Socket.io（優先 websocket，fallback polling） |
| TLS | Railway 終止 TLS；應用設 `TRUST_PROXY=1` |
| CORS | 正式環境設為自家 Railway 網域（同源時可收斂） |

### 4.4 環境變數（Production）

| 變數 | 必填 | 正式建議值 |
|------|------|------------|
| `PORT` | 自動 | Railway 注入，勿寫死 |
| `TRUST_PROXY` | 是 | `1` |
| `TRANSLATE_PROVIDER` | 是 | `gemini` |
| `GEMINI_API_KEY` | 正式是 | AI Studio 金鑰 |
| `GEMINI_MODEL` | 建議 | `gemini-2.5-flash` |
| `DEEPL_API_KEY` | 正式是 | DeepL 金鑰 |
| `DEEPL_API_URL` | 視方案 | Free: `https://api-free.deepl.com`；Pro: `https://api.deepl.com` |
| `OPENAI_API_KEY` | 選用 | 作備援引擎 |
| `OPENAI_MODEL` | 選用 | `gpt-4o-mini` |
| `TRANSLATE_RETRIES` | 選用 | `2` |
| `CORS_ORIGIN` | 建議 | `https://你的專案.up.railway.app` 或自訂網域 |

金鑰僅存在 Railway Variables，不進 Git。

### 4.5 健康檢查

| 項目 | 規格 |
|------|------|
| Path | `GET /health` |
| 期望 | HTTP 200，`{ "ok": true, ... }` |
| Railway | 設定 Healthcheck Path = `/health` |
| 開會前人工 | 瀏覽器或 `curl` 確認 `ok: true` |

回應欄位用途：`uptimeSec`、`rooms`、`sockets`、`translateProviders`。

---

## 5. 端到端運作流程

### 5.1 部署流程（一次設定）

```
本機開發驗證
    → GitHub 私有／公開 Repo
    → Railway New Project → Deploy from GitHub
    → 設定 Environment Variables
    → 設定 Healthcheck `/health`
    → 取得公開網址 https://{service}.up.railway.app
    →（可選）綁定自訂網域
    → 雙瀏覽器煙測（台灣端＋日本端）
```

### 5.2 單次會議運作流程（標準作業）

**T−30 分（籌備）**

1. 確認 Railway 服務 Running、`/health` 正常  
2. 確認翻譯 Provider 非 MyMemory（正式）  
3. 約定房號，例如 `mtg-20260802-research`  
4. 產生兩個連結傳給自己與教授  

**T−5 分（進房）**

1. 雙方用 **Chrome／Edge** 開啟連結  
2. 允許麥克風；確認音量條會跳動  
3. 確認房間人數 = 2  
4. Zoom 會議另開；SyncSub 視窗置於側邊或第二螢幕  

**會議中**

1. 說話端保持「開始收音」  
2. 聽方以 Zoom 聽語音、以 SyncSub 看譯文  
3. 連線燈變黃／debug 出現延遲 → 暫緩發言、等重連  
4. **禁止**會議中 Push 部署或重啟 Railway  

**會議後**

1. 雙方停止收音、可匯出逐字稿  
2. 離開房間  
3. 若無需常開，可保留服務 Running（下次免冷啟動）  

### 5.3 資料流（一句話級）

```
麥克風 → Web Speech(Final) → send_speech
  → Railway：廣播 receive_original
  → 翻譯佇列 → DeepL/OpenAI
  → 廣播 receive_translation → 雙方 UI 更新譯文
```

目標體感：定稿句出現後 **約 0.5–2 秒** 看到譯文（視翻譯 API 與網路；Web Speech 本身另有句末延遲）。

---

## 6. 非功能需求（穩定／效能／資安）

### 6.1 穩定度目標（1v1 工作會議）

| 指標 | 目標 |
|------|------|
| 中繼可用性（開會時段） | ≥ 99%（依賴 Railway + 事前 health） |
| Socket 斷線自動重連 | 支援；重連後自動 `join_room` |
| 語音辨識中斷 | 前端 watchdog 自動重啟 |
| 翻譯失敗 | UI 標示失敗，不導致整房斷線 |
| 同時房間數（第一版） | 建議 ≤ 5 活躍房／單實例 |
| 單房人數 | 建議 ≤ 4（主場景 2 人） |

### 6.2 已知風險與對策

| 風險 | 影響 | 對策 |
|------|------|------|
| Railway 重新部署 | 房間清空、連線中斷 | 開會時段凍結部署 |
| 單實例重啟 | 同上 | 開會前確認 uptime；必要時改 VPS |
| DeepL 配額用盡 | 譯文失敗 | 備援 OpenAI；開會前查用量 |
| Chrome Speech 需外網 | 無字幕 | 確認雙方可連 Google 語音服務 |
| 對方未開 SyncSub | 只有 Zoom 聲音無字幕 | SOP 強調雙方都要開 |
| MyMemory 當正式引擎 | 譯文差／被限流 | Production 禁止 |

### 6.3 資安

| 項目 | 規格 |
|------|------|
| 傳輸 | 全程 HTTPS／WSS |
| 機密 | API Key 僅 Railway Variables |
| 房號 | 視為弱共享密鑰；勿用 `room-777` 這類公開預設於正式會 |
| 內容 | 會議內容經第三方翻譯 API；機密會議需評估 DeepL／OpenAI 條款 |
| XSS | 伺服器與前端對字幕文字做跳脫 |
| 存取控制 | 第一版無登入；依賴「難猜房號」；進階可加 room token |

### 6.4 隱私與合規提示

會議語音在**使用者瀏覽器**轉成文字後才上傳中繼；原始音訊不經 Railway。  
文字會送至翻譯供應商。對外／產學會議前應口頭或書面告知對方使用即時翻譯工具。

---

## 7. 監控與維運

### 7.1 日常監控

| 項目 | 方式 |
|------|------|
| 行程狀態 | Railway Dashboard → Running |
| 健康 | `/health` |
| 日誌 | Railway Logs（連線、進房、翻譯成功／失敗） |
| 用量 | Railway 用量＋ DeepL／OpenAI 控制台 |

### 7.2 告警（建議人工／後期自動化）

- `/health` 連續失敗  
- 日誌大量 `翻譯失敗`  
- 開會前 30 分鐘 health 抽檢失敗 → 改用備援方案（見 8.2）

### 7.3 變更管理

| 變更類型 | 規則 |
|----------|------|
| 程式更新 | 非會議時段合併 main 並部署 |
| 環境變數 | 變更後確認服務重啟完成與 health |
| Provider 切換 | 先改 Staging／預覽服務驗證，再改 Production |

---

## 8. 部署與環境切分

### 8.1 建議環境

| 環境 | Railway Service | 用途 |
|------|-----------------|------|
| `syncsub-prod` | 正式 | 給教授的網址 |
| `syncsub-dev`（可選） | 開發／自測 | 連 MyMemory 或測試 Key |

兩者各自獨立 Variables，避免測試打爆正式配額。

### 8.2 備援方案（Railway 異常時）

| 順位 | 方案 |
|------|------|
| 1 | 重啟 Railway service、確認 health |
| 2 | 暫時改連備援服務（第二個 Railway 專案或本機 ngrok／Cloudflare Tunnel）— 需事先演練 |
| 3 | 會議降級為人工口譯／Zoom 內建翻譯字幕（若可用） |

---

## 9. 驗收標準（上線門檻）

以下全部通過才可將 Railway 網址交給外部與會者：

- [ ] `GET /health` → `ok: true`，且 `translateProviders` 含 `gemini`、`hasGeminiKey: true`  
- [ ] 兩台裝置（或一般＋無痕）同房號可互見原文與譯文  
- [ ] 台灣端說話 → 日本端見中文原文＋日文譯文  
- [ ] 日本端說話 → 台灣端見日文原文＋中文譯文  
- [ ] 斷網 10 秒後恢復，Socket 可重連並繼續進房  
- [ ] 停止收音後不再送出新訊息；匯出逐字稿內容正確  
- [ ] 麥克風拒絕權限時有明確提示  
- [ ] Production 未使用預設房號 `room-777`／未暴露 API Key 於前端  

---

## 10. 成本粗估（規劃用，非報價）

| 項目 | 說明 |
|------|------|
| Railway | 常駐小服務通常為每月數美元級（依用量）；以官方計費為準 |
| DeepL API | 依字元數計費；1～2 小時雙語會議通常可控 |
| OpenAI | 備援時按 token；建議設用量上限 |
| 人力 | 每次會議 5～10 分鐘籌備檢查 |

正式對外前建議先開一場 **內部彩排** 計算實際字元／費用。

---

## 11. 里程碑規劃

| 階段 | 產出 | 完成定義 |
|------|------|----------|
| M0 規格 | 本文件 | 利害關係人同意範圍與 Railway 方案 |
| M1 部署 | GitHub ↔ Railway 串好、health 綠燈 | 本機雙開改連 Railway 網址成功 |
| M2 正式引擎 | DeepL／OpenAI Variables | 驗收清單全過 |
| M3 彩排 | 與內部／同事模擬 Zoom＋字幕 | SOP 時間表可執行 |
| M4 實戰 | 首次對日本教授會議 | 會後匯出逐字稿、記錄問題列入改版 |

---

## 12. 與現有 Repo 對照

| 規格元件 | 程式位置 |
|----------|----------|
| 中繼入口 | `server/index.js` |
| 房間狀態 | `server/rooms.js` |
| 翻譯與降級 | `server/translate.js` |
| 前端大廳＋會議室 | `public/index.html`, `public/js/app.js` |
| 環境範本 | `.env.example` |
| 本機說明 | `README.md` |

Railway 部署時 **Root Directory = 專案根目錄**，Start = `npm start`，無需拆前後端兩個服務。

---

## 13. 決議摘要

1. **中繼唯一入口**：Railway 常駐 Node（含前端同源）。  
2. **不採用** Vercel／AI Studio 網址作為中繼。  
3. **正式翻譯**：DeepL 為主、OpenAI 備援；禁用 MyMemory。  
4. **會議模型**：Zoom 傳聲 + SyncSub 傳字幕；雙方皆須開啟 Chrome 工具。  
5. **單實例**：第一版 1 replica；開會中禁止部署。  

---

## 14. 後續待辦（規格執行項）

1. 建立 GitHub repo 並連線 Railway  
2. 寫入 Production Variables（含 `TRUST_PROXY=1`）  
3. 設定 Healthcheck `/health`  
4. 完成第 9 節驗收清單  
5.（可選）新增 `railway.toml`／自訂網域／第二個 `syncsub-dev` 服務  

---

**文件結束。** 若需進入 M1，可依本規格直接執行 Railway 部署設定檔與操作檢查清單落地。
