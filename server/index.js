/**
 * Zoom 雙邊同步翻譯字幕 — 中繼站
 * 職責：房間同步、翻譯佇列、健康檢查、靜態前端託管
 */
require('dotenv').config();

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { translate, providerChain } = require('./translate');
const { RoomManager } = require('./rooms');
const { envGet, envHas } = require('./env');
const { configuredSecret, createInvite, verifyInvite, verifyHostToken } = require('./access');

const PORT = Number(process.env.PORT) || 3100;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const startedAt = Date.now();
const HOST_LOBBY_TOKEN = configuredSecret('HOST_LOBBY_TOKEN');
const HOST_LOBBY_PATH = HOST_LOBBY_TOKEN ? `/r/${HOST_LOBBY_TOKEN}` : null;
const MAX_TRANSLATIONS_PER_MINUTE = Math.min(60, Math.max(5, Number(process.env.MAX_TRANSLATIONS_PER_MINUTE) || 24));

const app = express();
const server = http.createServer(app);

if (Number(process.env.TRUST_PROXY) > 0) {
  app.set('trust proxy', Number(process.env.TRUST_PROXY));
}

const io = new Server(server, {
  cors: {
    origin: CORS_ORIGIN === '*' ? '*' : CORS_ORIGIN.split(',').map((s) => s.trim()),
    methods: ['GET', 'POST'],
  },
  // 長會議穩定性：心跳與重連緩衝
  pingInterval: 15000,
  pingTimeout: 20000,
  maxHttpBufferSize: 1e5,
});

const rooms = new RoomManager();

// 簡單記憶體佇列：避免同一房間瞬間暴衝打爆翻譯 API
const translateQueues = new Map();

function enqueueTranslate(roomId, task) {
  const prev = translateQueues.get(roomId) || Promise.resolve();
  const next = prev
    .then(task)
    .catch(() => {})
    .finally(() => {
      if (translateQueues.get(roomId) === next) translateQueues.delete(roomId);
    });
  translateQueues.set(roomId, next);
  return next;
}

function escapePlain(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function safeTranslationFailureReason(error) {
  const message = String(error?.message || '');
  if (message.includes('credentials_or_api_access')) {
    return 'Gemini API 金鑰無效，或尚未取得 Gemini API 存取權。請檢查 Render 的 GEMINI_API_KEY。';
  }
  if (message.includes('model_not_available')) {
    return 'Gemini 模型無法使用。請檢查 Render 的 GEMINI_MODEL 是否為此 API 金鑰可用的模型。';
  }
  if (message.includes('quota_or_rate_limit')) {
    return 'Gemini 額度或速率已達上限。請檢查 Google AI Studio 專案的配額與帳務設定。';
  }
  if (message.includes('request_timeout') || message.includes('provider_unavailable')) {
    return '翻譯服務暫時沒有回應，請稍後再試。';
  }
  if (message.includes('request_rejected')) {
    return 'Gemini 拒絕了翻譯請求。請檢查 API 金鑰的限制與模型設定。';
  }
  return '翻譯服務暫時無法使用，請檢查 Render 的翻譯設定。';
}

app.use(express.json({ limit: '32kb' }));

const publicDir = path.join(__dirname, '..', 'public');
const pagesDir = path.join(__dirname, 'pages');

// 公開：說明頁 / 、測試會議室 /try（強制自備 API）
// 私密：自用會議室 HOST_LOBBY_PATH（伺服器額度；勿外傳）
app.get('/', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.get(['/try', '/try/', '/guest', '/guest/'], (_req, res) => res.redirect(302, '/'));

app.get('/join', (_req, res) => res.sendFile(path.join(pagesDir, 'host.html')));
if (HOST_LOBBY_PATH) {
  app.get([HOST_LOBBY_PATH, `${HOST_LOBBY_PATH}/`], (_req, res) => res.sendFile(path.join(pagesDir, 'host.html')));
}

// 避免直接猜到靜態檔名
app.get(['/host.html', '/try.html', '/guest.html'], (_req, res) => {
  res.redirect(302, '/');
});

app.use(express.static(publicDir, { index: false }));

app.get('/health', (_req, res) => {
  const stats = rooms.stats();
  const openaiKey = envGet('OPENAI_API_KEY', 'SYNC_OPENAI_API_KEY');
  const deeplKey = envGet('DEEPL_API_KEY', 'SYNC_DEEPL_API_KEY');
  const geminiKey = envGet('GEMINI_API_KEY', 'GOOGLE_API_KEY', 'SYNC_GEMINI_API_KEY');
  const configuredProvider = envGet('TRANSLATE_PROVIDER', 'SYNC_TRANSLATE_PROVIDER') || 'gemini';
  const activeProviders = providerChain().map((p) => p.name);

  // 列出相關變數「名稱」（不含值），方便查出拼錯字／設錯服務／未 Deploy staged
  const relatedEnvNames = Object.keys(process.env)
    .filter((k) =>
      /^(OPENAI|DEEPL|GEMINI|GOOGLE_API|TRANSLATE|REQUIRE_|HOST_|SYNC_|TRUST_PROXY|CORS|PORT|RAILWAY)/i.test(k)
    )
    .sort();

  res.json({
    ok: true,
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    rooms: stats.rooms,
    sockets: stats.sockets,
    translateProviders: activeProviders,
    preferredProvider: activeProviders[0] || 'gemini',
    env: {
      TRANSLATE_PROVIDER: configuredProvider,
      hasGeminiKey: geminiKey.length > 0,
      hasOpenAIKey: openaiKey.length > 0,
      hasDeepLKey: deeplKey.length > 0,
      secureMeetingReady: Boolean(HOST_LOBBY_TOKEN && configuredSecret('INVITE_SECRET')),
      maxTranslationsPerMinute: MAX_TRANSLATIONS_PER_MINUTE,
      TRUST_PROXY: envGet('TRUST_PROXY') || '(unset)',
      relatedEnvNames,
      railwayDeploymentId: process.env.RAILWAY_DEPLOYMENT_ID || '(unset)',
      railwayReplicaId: process.env.RAILWAY_REPLICA_ID || '(unset)',
      railwayServiceName: process.env.RAILWAY_SERVICE_NAME || '(unset)',
      hint: HOST_LOBBY_TOKEN && configuredSecret('INVITE_SECRET')
        ? (geminiKey ? 'ok — signed invitations and server-side translation are ready.' : 'Set GEMINI_API_KEY before real meetings.')
        : 'Set distinct HOST_LOBBY_TOKEN and INVITE_SECRET values of at least 32 characters.',
    },
  });
});

app.get('/api/config', (_req, res) => {
  res.json({
    defaultProvider: envGet('TRANSLATE_PROVIDER', 'SYNC_TRANSLATE_PROVIDER') || 'gemini',
    providers: providerChain().map((p) => p.name),
    secureMeetingReady: Boolean(HOST_LOBBY_TOKEN && configuredSecret('INVITE_SECRET')),
    maxTranslationsPerMinute: MAX_TRANSLATIONS_PER_MINUTE,
  });
});

app.post('/api/invites', (req, res) => {
  const token = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!verifyHostToken(token)) return res.status(401).json({ ok: false, error: 'Host authorization required' });
  try {
    const invite = createInvite(req.body || {});
    const origin = `${req.protocol}://${req.get('host')}`;
    res.status(201).json({ ok: true, invite, joinUrl: `${origin}/join?invite=${encodeURIComponent(invite)}` });
  } catch (error) { res.status(400).json({ ok: false, error: error.message }); }
});

io.on('connection', (socket) => {
  console.log(`[連線] ${socket.id}`);

  socket.on('join_room', (payload = {}, ack) => {
    try {
      const roomId = String(payload.roomId || '').trim().slice(0, 64);
      if (!roomId) {
        if (typeof ack === 'function') ack({ ok: false, error: '房號不可空白' });
        return;
      }

      const hostToken = String(payload.hostToken || '');
      const invite = verifyInvite(payload.invite, roomId);
      const isHost = verifyHostToken(hostToken);
      if (!isHost && !invite) {
        if (typeof ack === 'function') ack({ ok: false, error: '邀請連結無效、已過期，或無權加入此會議室' });
        return;
      }
      const role = isHost ? (payload.role === 'jp' ? 'jp' : 'tw') : invite.role;
      const languages = role === 'jp'
        ? { myLang: 'ja-JP', targetLang: 'zh-TW' }
        : { myLang: 'zh-TW', targetLang: 'ja-JP' };

      // Only authenticated sockets are allowed to join a Socket.IO room.
      for (const room of socket.rooms) {
        if (room !== socket.id) {
          socket.leave(room);
          const snap = rooms.leave(room, socket.id);
          if (snap && !snap.empty) {
            io.to(room).emit('room_update', snap);
          }
        }
      }

      socket.join(roomId);
      socket.data.roomId = roomId;
      socket.data.profile = {
        displayName: String(payload.displayName || 'Guest').slice(0, 40),
        role,
        ...languages,
      };
      socket.data.isHost = isHost;
      socket.data.translator = { mode: 'server' };

      const snapshot = rooms.join(roomId, socket.id, socket.data.profile);
      io.to(roomId).emit('room_update', snapshot);

      console.log(
        `[房間] ${socket.data.profile.displayName} → ${roomId} (${isHost ? 'host' : 'invite'})`
      );
      if (typeof ack === 'function') {
        ack({
          ok: true,
          roomId,
          snapshot,
          selfId: socket.id,
          translateMode: 'server',
          access: isHost ? 'host' : 'invite',
        });
      }
    } catch (err) {
      console.error('[join_room]', err);
      if (typeof ack === 'function') ack({ ok: false, error: err.message });
    }
  });

  // The host may switch their own speaking lane during a live test. Invitees
  // are deliberately fixed to the role encoded in their signed invitation.
  socket.on('set_role', (payload = {}, ack) => {
    const roomId = String(socket.data.roomId || '').trim();
    if (!roomId || !socket.rooms.has(roomId)) {
      if (typeof ack === 'function') ack({ ok: false, error: '尚未加入房間，請重新連線' });
      return;
    }
    if (!socket.data.isHost) {
      if (typeof ack === 'function') ack({ ok: false, error: '受邀者的語言由邀請連結決定，請向主持人索取正確連結。' });
      return;
    }

    const role = payload.role === 'jp' ? 'jp' : 'tw';
    const languages = role === 'jp'
      ? { myLang: 'ja-JP', targetLang: 'zh-TW' }
      : { myLang: 'zh-TW', targetLang: 'ja-JP' };
    socket.data.profile = { ...socket.data.profile, role, ...languages };
    const snapshot = rooms.join(roomId, socket.id, socket.data.profile);
    io.to(roomId).emit('room_update', snapshot);
    if (typeof ack === 'function') ack({ ok: true, role, languages });
  });

  socket.on('send_speech', (data = {}) => {
    const roomId = String(socket.data.roomId || '').trim();
    const msgId = String(data.msgId || '').trim();
    const text = String(data.text || '').trim().slice(0, 2000);
    const sourceLang = socket.data.profile?.myLang || 'zh-TW';
    const targetLang = socket.data.profile?.targetLang || 'ja-JP';

    if (!roomId || !msgId || !text) return;
    if (!socket.rooms.has(roomId)) {
      socket.emit('server_error', { message: '尚未加入房間，請重新連線' });
      return;
    }
    if (!rooms.allowRequest(roomId, MAX_TRANSLATIONS_PER_MINUTE)) {
      socket.emit('server_error', { message: '此會議室的翻譯速率已達上限，請稍候再說。' });
      return;
    }

    const senderName = socket.data.profile?.displayName || 'Guest';
    const originalPayload = {
      msgId,
      senderId: socket.id,
      senderName,
      text: escapePlain(text),
      sourceLang,
      targetLang,
      at: Date.now(),
    };

    const historyItem = rooms.pushHistory(roomId, {
      msgId,
      senderId: socket.id,
      senderName,
      text: originalPayload.text,
      sourceLang,
      targetLang,
      translatedText: null,
    });
    if (!historyItem) return;

    // Persist and de-duplicate before broadcasting the original.
    socket.to(roomId).emit('receive_original', { ...originalPayload, sequence: historyItem.sequence });

    // 2) 佇列翻譯後廣播結果（優先使用該使用者自帶的 API Key）
    const speechSentAt = originalPayload.at;
    enqueueTranslate(roomId, async () => {
      const translateStarted = Date.now();
      try {
        const t = socket.data.translator || {};
        const result = await translate(text, sourceLang, targetLang, {
          apiKey: '',
        });
        const translateMs = Date.now() - translateStarted;
        const translatedText = escapePlain(result.text);
        rooms.updateTranslation(roomId, msgId, translatedText, result.provider);

        io.to(roomId).emit('receive_translation', {
          msgId,
          translatedText,
          provider: result.provider,
          translateMs,
          sentAt: speechSentAt,
        });
        io.to(roomId).emit('room_update', rooms.snapshot(roomId));
        console.log(
          `[翻譯][${result.provider}] ${roomId} ${translateMs}ms: ${text.slice(0, 40)} → ${result.text.slice(0, 40)}`
        );
      } catch (error) {
        const translateMs = Date.now() - translateStarted;
        const reason = safeTranslationFailureReason(error);
        console.error(`[翻譯失敗] ${roomId}`, reason, error.message);
        const fallback = `[翻譯失敗] ${escapePlain(text)}`;
        rooms.updateTranslation(roomId, msgId, fallback, 'error');
        io.to(roomId).emit('receive_translation', {
          msgId,
          translatedText: fallback,
          provider: 'error',
          translateMs,
          sentAt: speechSentAt,
          error: true,
          reason,
        });
        io.to(roomId).emit('room_update', rooms.snapshot(roomId));
      }
    });
  });

  // 客戶端心跳（可選，用於 UI 延遲顯示）
  socket.on('client_ping', (ts, ack) => {
    if (typeof ack === 'function') ack({ serverTs: Date.now(), clientTs: ts });
  });

  socket.on('disconnect', (reason) => {
    console.log(`[斷線] ${socket.id} (${reason})`);
    const affected = rooms.leaveAll(socket.id);
    for (const { roomId, snapshot } of affected) {
      if (snapshot && !snapshot.empty) {
        io.to(roomId).emit('room_update', snapshot);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log('=========================================');
  console.log(`同步翻譯中繼站已啟動  http://localhost:${PORT}`);
  console.log(`翻譯引擎鏈: ${providerChain().map((p) => p.name).join(' → ')}`);
  console.log(`公開說明 http://localhost:${PORT}/`);
  console.log(`公開測試 http://localhost:${PORT}/try`);
  console.log(HOST_LOBBY_PATH ? `主持人入口 http://localhost:${PORT}${HOST_LOBBY_PATH}` : '主持人入口未啟用：請設定 32 字元以上的 HOST_LOBBY_TOKEN');
  console.log(
    `[env] TRANSLATE_PROVIDER=${envGet('TRANSLATE_PROVIDER', 'SYNC_TRANSLATE_PROVIDER') || '(unset)'} ` +
      `hasGeminiKey=${envHas('GEMINI_API_KEY', 'GOOGLE_API_KEY', 'SYNC_GEMINI_API_KEY')} ` +
      `hasOpenAIKey=${envHas('OPENAI_API_KEY', 'SYNC_OPENAI_API_KEY')} ` +
      `hasDeepLKey=${envHas('DEEPL_API_KEY', 'SYNC_DEEPL_API_KEY')} ` +
      `TRUST_PROXY=${envGet('TRUST_PROXY') || '(unset)'}`
  );
  console.log('=========================================');
});

// 優雅關閉，避免部署重啟時連線殘留
function shutdown(signal) {
  console.log(`[關閉] 收到 ${signal}`);
  io.close(() => {
    server.close(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 8000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
