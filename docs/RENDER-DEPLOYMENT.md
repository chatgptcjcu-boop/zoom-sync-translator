# KirokuFlow Meet：Render 部署

1. 在 Render 建立 **Blueprint**，選擇此 repository，Render 會讀取 `render.yaml`。
2. 在服務的 Environment 補上 `GEMINI_API_KEY`。不要把它放入 Git、網址或瀏覽器。
3. 將 `CORS_ORIGIN` 設為正式官網（例如 `https://www.kirokuflow.jp`）。
4. 等待 `/health` 回傳 `ok: true` 且 `secureMeetingReady: true`。複製 Render 的 `https://<service>.onrender.com` URL 做雙端測試。
5. 通過 HTTPS、真實麥克風、30 分鐘會議測試後，才在 Gandi 建立 `meet` 的 CNAME，指向 Render 自訂網域精靈指定的目標。不要猜測 CNAME 目標，也不要先啟用網站入口。

## 主持與邀請

主持人入口為 `https://meet.kirokuflow.jp/r/<HOST_LOBBY_TOKEN>`。由環境變數取得的 `HOST_LOBBY_TOKEN` 是主持人憑證，不能轉傳。

主持人輸入房號後可選擇台灣端或日本端，建立 30–60 分鐘的邀請連結。連結的角色、房號和期限由伺服器簽章驗證；受邀者不需要 API Key。

## 驗收提醒

模擬文字測試僅驗證授權、房間與字幕事件。正式交付前，兩位使用者仍必須以 Chrome／Edge、HTTPS、各自真實麥克風完成一場 30 分鐘 Zoom 會議。
