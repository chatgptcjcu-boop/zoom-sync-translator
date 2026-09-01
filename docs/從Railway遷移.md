# 從 Railway 試用到期 — 如何接替／移植

> 適用情況：Dashboard 出現 *Your trial expires tomorrow*／30-day trial ends。  
> 正式網域（試用期間）：`https://zoom-sync-translator-production.up.railway.app`

本專案是 **常駐 Node（Express + Socket.io）**，需要：

- 長連線 **WSS**（開會中不能睡死）
- **HTTPS**（麥克風／Web Speech）
- 環境變數（尤其自用額度的 `GEMINI_API_KEY`、`HOST_LOBBY_TOKEN`）

程式碼已在 GitHub：`zoom-sync-translator`。移植＝**同一 repo 換一台會跑 `npm start` 的主機**，再重設 Variables。

---

## 先選路：續留 Railway，還是搬走？

| 方案 | 何時選 | 網址會怎樣 | 預估動作 |
|------|--------|------------|----------|
| **A. Railway 升級付費** | 想最少改動、明天還要開會 | **可沿用同一 `*.up.railway.app`** | 綁信用卡／Hobby 方案 |
| **B. 搬到 Fly.io / Render 等** | 不想續 Railway、仍要雲端 | **會換成新網址**（要重發測試說明） | 新專案 + 貼 Variables |
| **C. 小 VPS（推薦長期）** | 要可控、可固定網域 | 用自己的網域或 IP+HTTPS | 裝 Node / pm2 / Caddy 或 Nginx |
| **D. 只本機** | 僅自己兩台電腦測 | `localhost` 無法給遠端教授 | 不適合正式遠端會議 |

**開會明天就要用 → 先做 A**，之後再慢慢搬到 C。

---

## 方案 A：Railway 升級（接替最快）

1. 開啟 [railway.app](https://railway.app) → 登入同一帳號（先前用的 Google／GitHub）。
2. 看試用提示 → **Add payment method** / 升級 **Hobby**（或當時方案名稱）。
3. 確認專案 **peaceful-blessing**（或實際擁有 `zoom-sync-translator-production` 網域的那個）仍在、服務未刪。
4. 開一次：
   - `https://zoom-sync-translator-production.up.railway.app/health`
   - 應見 `ok: true`、`hasGeminiKey: true`
5. 公開 `/`、`/try`、自用 `/r/<token>` **路徑不變**，測試者連結不用改。

費用概念：Hobby 通常是低月費 + 用量；SyncSub 閒置時流量很小，開會時才明顯。細節以 Railway 當下價目為準。

若試用結束**服務被停／刪**：升級後可能要 **Redeploy**；Variables 若還在就直接部署，沒了就從下方清單重貼。

---

## 方案 B / C：移植出去（通用檢查清單）

### 1. 從 Railway 匯出「要帶走的」

在舊服務 **Variables** 複製（不要截圖外流）：

```
TRUST_PROXY=1
TRANSLATE_PROVIDER=gemini
GEMINI_API_KEY=（你的）
GEMINI_MODEL=gemini-2.5-flash
HOST_LOBBY_TOKEN=ss-73c8b2b0
REQUIRE_CLIENT_API_KEY=false
CORS_ORIGIN=*
```

（若你改過 `HOST_LOBBY_TOKEN`，以 Railway 上實際值為準。）

程式不用特別「匯出」：`git pull` 最新 `main` 即可。

### 2. 新環境最低需求

- Node **≥ 18**
- 啟動指令：`npm start`（讀 `PORT`；平台會注入）
- 對外 **HTTPS + WSS**
- Health：`GET /health`
- **不要用會自動休眠的免費 Web 服務開會**（冷啟動會斷 Socket）

### 3. 部署後必測

```bash
curl -s https://你的新網域/health
npm run smoke -- https://你的新網域
```

瀏覽器：

- 公開說明 `/`
- 測試會議室 `/try`（要貼自己的 Gemini Key）
- 自用 `/r/<HOST_LOBBY_TOKEN>`

### 4. 改文件與對外連結

新網址上線後，更新：

- `docs/公開版與自用版-網址與參數.md`
- `docs/給測試者的說明.md`
- `docs/站長自用說明.md`
- `README.md`／`docs/MILESTONES.md` 的正式網址

並重新傳給測試者：**只有新的 `/` 與 `/try`**（自用路徑仍勿外傳）。

---

## 方案 B1：Render（Web Service）

1. [render.com](https://render.com) → New → **Web Service** → 接 GitHub `zoom-sync-translator`
2. Runtime：Node；Build：`npm install`；Start：`npm start`
3. Instance：**不要選會睡的 Free**（開會用至少常駐方案）
4. Environment 貼上節變數；`TRUST_PROXY=1`
5. 取得 `https://xxxx.onrender.com` → 跑 smoke／health

注意：Render 免費層常休眠，**不適合正式會議**。

---

## 方案 B2：Fly.io

```bash
# 需本機已安裝 flyctl 並登入
cd /Users/apple/Documents/zoom-sync-translator
fly launch          # 依提示；不要亂開 DB
fly secrets set TRUST_PROXY=1 TRANSLATE_PROVIDER=gemini GEMINI_API_KEY=你的 GEMINI_MODEL=gemini-2.5-flash HOST_LOBBY_TOKEN=ss-73c8b2b0
fly deploy
fly apps open
```

確認 `fly.toml` 的內部 port 與健康檢查指向 `/health`（依精靈產生檔調整）。

---

## 方案 C：VPS + 網域（長期最穩）

以 Ubuntu 為例（DigitalOcean／Linode／GCP 等任一）：

```bash
# 伺服器上
git clone https://github.com/chatgptcjcu-boop/zoom-sync-translator.git
cd zoom-sync-translator
cp .env.example .env   # 填 GEMINI_API_KEY、HOST_LOBBY_TOKEN、TRUST_PROXY=1
npm install
# 用 pm2 常駐
npx pm2 start server/index.js --name syncsub
npx pm2 save
```

前面加 **Caddy** 或 **Nginx** 做 HTTPS 反代到 `127.0.0.1:3100`（或你在 `.env` 設的 `PORT`），並支援 WebSocket 升級。

自訂網域範例：`https://syncsub.你的網域.com` → 之後文件與對外連結全部改這顆。

---

## 今天建議順序（試用明天到期）

1. **今天**：Railway 綁卡升級（方案 A）→ 確認 `/health` 仍綠。  
2. **有空時**：選 VPS 或 Fly 當備援，照清單搬 Variables，smoke 通過後再改 MD 網址。  
3. **舊 Railway 刪除前**：確認新環境穩定至少開過一次雙端會議。

---

## 常見問題

**Q：不升級也不搬會怎樣？**  
試用結束後服務通常會停；公開 `/`、`/try` 與自用 `/r/...` 都會掛。

**Q：程式要改才能搬家嗎？**  
一般不用。已用 `PORT`、`TRUST_PROXY`、Nixpacks/`npm start`。換主機主要是環境變數與網址。

**Q：Gemini Key 要重申請嗎？**  
不必；同一 Key 貼到新主機即可。懷疑外洩再去 AI Studio 輪換。

**Q：自用路徑會變嗎？**  
路徑規則仍是 `/r/<HOST_LOBBY_TOKEN>`。token 沒改，只換網域前綴。

**Q：公開測試者還要自備 Key 嗎？**  
要。`/try` 的 BYOK 邏輯與主機無關，搬哪都一樣。
