# 為何 `/health` 一直 `hasGeminiKey: false`？

## 結論

公開網址上的行程 **沒有收到** `GEMINI_API_KEY`。

畫面上 Variables 有 `GEMINI_API_KEY`，但 `relatedEnvNames` 裡長期只有：

- `PORT`（平台注入）
- `TRUST_PROXY`（舊版 **Dockerfile 寫死** `ENV TRUST_PROXY=1`，容易誤以為 Railway 變數有生效）

因此：

| 你看到的 | 實際意義 |
|----------|----------|
| Variables 有 GEMINI | UI 有設定／暫存 |
| log 曾出現 `hasGeminiKey=true` | 某一瞬間有部署成功帶入 Key |
| 公開 `/health` 仍 false | **流量打到的 Active 實例沒有 Key** |

常見原因：

1. **變數未從 Staged → Deploy**（只 Redeploy／只靠 GitHub push 不夠）  
2. **曾用 Dockerfile 建置**：GitHub 推程式會重建映像，但不保證套用你剛改的 Variables  
3. 有 Key 的 replica 起來後又被換成沒 Key 的 Active 部署  

## 已做的修正（程式端）

- 移除會搶建置的 `Dockerfile`（改存 `Dockerfile.backup`）  
- 改走 **Nixpacks**（`railway.toml` + `nixpacks.toml`），讓 Runtime 更乾淨地吃 Railway Variables  

## 你現在要做

1. 等這次 GitHub 部署变成 **Active**（建置應是 Nixpacks，不是 Docker export）  
2. Variables 確認四筆後，畫布 **紫色橫幅 → Deploy**（若有）  
3. 開 `/health`，成功條件：

```json
"hasGeminiKey": true,
"preferredProvider": "gemini",
"relatedEnvNames": [ "...", "GEMINI_API_KEY", "GEMINI_MODEL", "TRANSLATE_PROVIDER", "TRUST_PROXY", ... ]
```

若 `relatedEnvNames` 仍沒有 `GEMINI_API_KEY`，就是 Variables 仍未套用到 Active 部署，與程式無關。
