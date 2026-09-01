# 本機 + Cloudflare Tunnel（$0 對外）

用你這台 Mac 跑 SyncSub，經 Cloudflare 免費 Tunnel 取得 **HTTPS／WSS** 網址給遠端測試。  
**開會期間電腦要開著、勿睡眠**；關機或斷網，對外網址就掛。

---

## 你會得到什麼

| 項目 | 說明 |
|------|------|
| 本機服務 | `http://localhost:3100`（`npm start`） |
| 對外網址 | `https://….trycloudflare.com` 或你綁的網域 |
| 公開頁 | `https://你的網址/`、`/try` |
| 自用頁 | `https://你的網址/r/<HOST_LOBBY_TOKEN>`（勿外傳） |

Gemini／BYOK 邏輯與 Railway 相同，只是主機改成你家電腦。

---

## 事前準備

1. 專案可本機啟動：

```bash
cd /Users/apple/Documents/zoom-sync-translator
cp -n .env.example .env   # 若尚無 .env
# 編輯 .env：至少 GEMINI_API_KEY（自用額度）；HOST_LOBBY_TOKEN 可維持
# 走 Tunnel 時建議：
TRUST_PROXY=1
```

2. 安裝 `cloudflared`（擇一）：

```bash
# Homebrew（建議）
brew install cloudflared

# 或官方：https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/
cloudflared --version
```

3. 開會前關閉睡眠（系統設定 → 電池／鎖屏：接電源時勿自動睡眠），或暫時執行：

```bash
caffeinate -dims &
```

---

## 方式 A：快速 Tunnel（今天就能測，網址每次可能不同）

適合：臨時給人測、不在乎網址會變。

### 終端機 1 — 啟動 SyncSub

```bash
cd /Users/apple/Documents/zoom-sync-translator
npm start
```

看到類似：

```
同步翻譯中繼站已啟動  http://localhost:3100
公開測試 http://localhost:3100/try
自用入口 http://localhost:3100/r/... （勿外傳）
```

### 終端機 2 — 開 Tunnel

```bash
cloudflared tunnel --url http://localhost:3100
```

成功後會印出一行，例如：

```
https://random-words-xxxx.trycloudflare.com
```

把這個網址當「正式網域」用：

- 說明：`https://random-words-xxxx.trycloudflare.com/`
- 測試：`https://random-words-xxxx.trycloudflare.com/try`
- 自用：`https://random-words-xxxx.trycloudflare.com/r/ss-73c8b2b0`

驗證：

```bash
curl -s https://你的trycloudflare網域/health
```

應見 `"ok":true`。

> 關掉 `cloudflared` 或重開，**網址通常會變**，要重新傳給測試者。

專案捷徑（等價）：

```bash
npm run tunnel
```

（需已 `npm start` 在跑，或另開終端機先起服務。）

---

## 方式 B：具名 Tunnel（網址較固定，仍 $0）

適合：常給同一批人測、想固定子網域。

1. 註冊／登入 [Cloudflare Zero Trust / Dashboard](https://dash.cloudflare.com)（免費帳號即可）。
2. 本機登入：

```bash
cloudflared tunnel login
```

瀏覽器授權後會寫入憑證。

3. 建立 Tunnel：

```bash
cloudflared tunnel create syncsub
cloudflared tunnel list
# 記下 Tunnel UUID
```

4. 設定設定檔（路徑可自訂），例如 `~/.cloudflared/config.yml`：

```yaml
tunnel: <你的-UUID>
credentials-file: /Users/apple/.cloudflared/<UUID>.json

ingress:
  - hostname: syncsub-你的名字.trycloudflare.com
    service: http://localhost:3100
  - service: http_status:404
```

> 免費 `*.trycloudflare.com` 的具名綁定方式以 Cloudflare 當下文件為準；若介面改為 Dashboard「Public Hostname」，在網頁把 hostname 指到此 Tunnel、服務 `http://localhost:3100` 即可。  
> 若你已有自己的網域在 Cloudflare：可綁 `syncsub.你的網域.com`（DNS CNAME 到 Tunnel）。

5. 執行：

```bash
# 終端機 1
cd /Users/apple/Documents/zoom-sync-translator && npm start

# 終端機 2
cloudflared tunnel run syncsub
```

之後對外固定用該 hostname。

---

## 開會當天 SOP

1. Mac 接電源、關睡眠。  
2. `npm start`  
3. `cloudflared tunnel --url http://localhost:3100`（或 `tunnel run syncsub`）  
4. 開 `/health` 確認綠燈。  
5. **只傳** `/` 或 `/try` 給別人；自用 `/r/...` 自己收藏。  
6. 結束：Ctrl+C 停掉 tunnel 與 node；可恢復睡眠設定。

---

## 與 Railway 的差異

| | Railway | 本機 + Tunnel |
|--|---------|----------------|
| 費用 | 試用後要付費 | Tunnel／本機皆可 $0 |
| 電腦 | 不需開著 | **必須開著** |
| 網址 | 固定 `*.up.railway.app` | 快速 Tunnel 常變；具名較穩 |
| 穩定性 | 機房 | 依你家寬頻／Wi‑Fi |
| 變數 | Railway Variables | 本機 `.env` |

路徑規則不變：`/`、`/try`、`/guest`、`/r/<token>`。

---

## 常見問題

**對方打不開？**  
確認本機 `npm start` 與 `cloudflared` 都還在跑；你自己先開同一 HTTPS 網址。

**麥克風／語音辨識失敗？**  
必須是 `https://`（Tunnel 已提供）。勿給人 `http://你的區網IP`。

**翻譯失敗（自用頁）？**  
檢查本機 `.env` 的 `GEMINI_API_KEY`。公開 `/try` 則看對方自己的 Key。

**連線一直斷？**  
Wi‑Fi 不穩、筆電睡眠、或重開了 tunnel（快速模式網址變了）。

**要不要開路由器埠？**  
不必。Tunnel 是你的 Mac **主動連出** Cloudflare，不用做埠轉發。

**安全性**  
自用路徑仍靠難猜 token；勿把 `/r/...` 貼公開群。不用時關掉 tunnel，外人就連不進本機服務。

---

## 文件更新提醒

換成 Tunnel 常駐網址後，請改：

- `docs/公開版與自用版-網址與參數.md`
- `docs/給測試者的說明.md`
- `docs/站長自用說明.md`

只改「正式網域」前綴；路徑與參數不變。
