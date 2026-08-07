# M1 — Railway 部署指南

## 目標

讓 SyncSub 以常駐 Node 服務跑在 Railway，取得公開 HTTPS 網址（含 WSS）。

## 已替你準備好的檔案

| 檔案 | 用途 |
|------|------|
| `railway.toml` | startCommand、`/health` 健康檢查、重啟策略 |
| `Dockerfile` | Nixpacks 失敗時的備援建置 |
| `.env.production.example` | 正式環境變數清單 |
| `scripts/smoke-dual.js` | 部署後雙端煙測 |

## 步驟 A：GitHub（若尚未完成）

本機已可用 `gh` 建立 repo。預期 repo 名稱：`zoom-sync-translator`。

```bash
cd /Users/apple/Documents/zoom-sync-translator
git add .
git commit -m "feat: SyncSub relay ready for Railway deploy"
gh repo create zoom-sync-translator --private --source=. --remote=origin --push
```

## 步驟 B：Railway（需你登入一次）

### 方式 1：Dashboard（最穩）

1. 開啟 https://railway.app → Login（建議用 GitHub 登入）  
2. **New Project** → **Deploy from GitHub repo** → 選 `zoom-sync-translator`  
3. 進入 Service → **Variables** 新增：

```
TRUST_PROXY=1
TRANSLATE_PROVIDER=gemini
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
TRUST_PROXY=1
```

（M2 再改成 DeepL 並填 Key）

4. **Settings → Networking → Generate Domain** 取得 `https://xxxx.up.railway.app`  
5. 確認 Healthcheck Path 為 `/health`（`railway.toml` 已寫）  
6. 等部署變為 **Success**，瀏覽器開網址應看到 SyncSub 大廳  

### 方式 2：CLI

```bash
cd /Users/apple/Documents/zoom-sync-translator
npx railway login
npx railway init
npx railway up
npx railway variables set TRUST_PROXY=1 TRANSLATE_PROVIDER=gemini GEMINI_MODEL=gemini-2.5-flash
npx railway domain
```

## 步驟 C：M1 完成定義

在專案目錄執行（把網址換成你的）：

```bash
npm run smoke -- https://xxxx.up.railway.app
curl -s https://xxxx.up.railway.app/health
```

通過條件：

- [ ] `/health` 回 `ok: true`  
- [ ] smoke 印出 `OK`，雙方收到譯文  
- [ ] 瀏覽器可進大廳、進會議室  

完成後把公開網址填進 [`MILESTONES.md`](./MILESTONES.md) 的「正式網址」欄位（若有）。

## 注意

- 開會中**不要**重新 Deploy  
- Railway 會注入 `PORT`，不必手動設 3100  
- 免費額度／試用方案請確認**不會休眠**；若會睡，開會前先開啟網址喚醒  
