# M2 — 接 DeepL（正式翻譯引擎）

## 目標

Production 翻譯主引擎改為 **DeepL**；MyMemory 僅作本機開發或自動降級備援。

## 你需要準備

1. DeepL API 帳號：https://www.deepl.com/pro-api  
2. 取得 Auth Key  
3. 確認是 **Free** 或 **Pro**（URL 不同）

| 方案 | `DEEPL_API_URL` |
|------|-----------------|
| Free | `https://api-free.deepl.com` |
| Pro | `https://api.deepl.com` |

## Railway Variables（正式）

在 Railway → Service → Variables **覆蓋／新增**：

```
TRUST_PROXY=1
TRANSLATE_PROVIDER=deepl
DEEPL_API_KEY=你的金鑰
DEEPL_API_URL=https://api-free.deepl.com
TRANSLATE_RETRIES=2
```

（可選備援）

```
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
```

儲存後等服務自動重啟。

## 驗證

```bash
curl -s https://你的網域/health
# translateProviders 應含 "deepl"

npm run smoke -- https://你的網域
# 應看到 provider: deepl
```

本機若要測 DeepL（可選）：

```bash
# 編輯 .env
TRANSLATE_PROVIDER=deepl
DEEPL_API_KEY=...
DEEPL_API_URL=https://api-free.deepl.com
npm start
npm run smoke
```

## M2 完成定義

- [ ] `/health` 的 `translateProviders` 含 `deepl`  
- [ ] smoke 翻譯 `provider` 為 `deepl`  
- [ ] 中→日、日→中各測一句語意合理  
- [ ] API Key **未**出現在 Git／前端原始碼  

## 安全

- Key 只放 Railway Variables 或本機 `.env`（已在 `.gitignore`）  
- 勿把 Key 貼到聊天室／截圖給外人  
