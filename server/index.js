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

const PORT = Number(process.env.PORT) || 3100;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const startedAt = Date.now();
// 自用會議室路徑密鑰（別人猜不到）；可在 Railway Variables 改掉
const HOST_LOBBY_TOKEN = String(
  process.env.HOST_LOBBY_TOKEN || envGet('SYNC_HOST_LOBBY_TOKEN') || 'ss-73c8b2b0'
).replace(/[^a-zA-Z0-9_-]/g, '');
const HOST_LOBBY_PATH = `/r/${HOST_LOBBY_TOKEN || 'ss-73c8b2b0'}`;

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

app.use(express.json({ limit: '32kb' }));

const publicDir = path.join(__dirname, '..', 'public');
const pagesDir = path.join(__dirname, 'pages');

// 公開：說明頁 / 、測試會議室 /try（強制自備 API）
// 私密：自用會議室 HOST_LOBBY_PATH（伺服器額度；勿外傳）
app.get('/', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.get(['/try', '/try/', '/guest', '/guest/'], (_req, res) => {
  res.sendFile(path.join(pagesDir, 'try.html'));
});

app.get([HOST_LOBBY_PATH, `${HOST_LOBBY_PATH}/`], (_req, res) => {
  res.sendFile(path.join(pagesDir, 'host.html'));
});

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

  const requireClientApiKey =
    String(process.env.REQUIRE_CLIENT_API_KEY || '').toLowerCase() === 'true';

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
      requireClientApiKey,
      TRUST_PROXY: envGet('TRUST_PROXY') || '(unset)',
      relatedEnvNames,
      railwayDeploymentId: process.env.RAILWAY_DEPLOYMENT_ID || '(unset)',
      railwayReplicaId: process.env.RAILWAY_REPLICA_ID || '(unset)',
      railwayServiceName: process.env.RAILWAY_SERVICE_NAME || '(unset)',
      hint: requireClientApiKey
        ? 'Guests must enter their own Gemini API Key on the lobby (BYOK).'
        : geminiKey
          ? 'ok — Gemini primary; guests can choose BYOK on lobby to avoid using host quota'
          : 'Set GEMINI_API_KEY for host quota, or REQUIRE_CLIENT_API_KEY=true so everyone brings their own key.',
    },
  });
});

app.get('/api/config', (_req, res) => {
  res.json({
    defaultProvider: envGet('TRANSLATE_PROVIDER', 'SYNC_TRANSLATE_PROVIDER') || 'gemini',
    providers: providerChain().map((p) => p.name),
    requireClientApiKey: String(process.env.REQUIRE_CLIENT_API_KEY || '').toLowerCase() === 'true',
    byokEnabled: true,
    // 只公開測試入口；自用路徑不回傳給前端
    publicGuidePath: '/',
    publicTryPath: '/try',
  });
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

      // 離開其他房間
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
        role: String(payload.role || 'guest').slice(0, 20),
        myLang: payload.myLang || 'zh-TW',
        targetLang: payload.targetLang || 'ja-JP',
      };

      // 訪客通道 /guest：強制自備 Key，永不使用主辦方伺服器額度
      const guestLane = payload.guestLane === true || payload.guestLane === 'true';
      const clientKey = String(payload.apiKey || '').trim();
      const forceByok =
        guestLane || String(process.env.REQUIRE_CLIENT_API_KEY || '').toLowerCase() === 'true';

      socket.data.translator = {
        mode: clientKey ? 'byok' : 'server',
        apiKey: clientKey ? clientKey.slice(0, 200) : '',
        model: String(payload.apiModel || 'gemini-2.5-flash').trim().slice(0, 80),
        provider: 'gemini',
        guestLane: !!guestLane,
      };

      if (forceByok && !clientKey) {
        if (typeof ack === 'function') {
          ack({
            ok: false,
            error: guestLane
              ? '訪客測試通道需輸入自己的 Gemini API Key'
              : '此站需自行輸入 Gemini API Key 才能進入',
          });
        }
        return;
      }

      // 訪客通道即使誤帶空 key 也不准退回 server mode
      if (guestLane) {
        socket.data.translator.mode = 'byok';
      }

      const snapshot = rooms.join(roomId, socket.id, socket.data.profile);
      io.to(roomId).emit('room_update', snapshot);

      console.log(
        `[房間] ${socket.data.profile.displayName} → ${roomId} (translate=${socket.data.translator.mode}${guestLane ? ',guest' : ''})`
      );
      if (typeof ack === 'function') {
        ack({
          ok: true,
          roomId,
          snapshot,
          selfId: socket.id,
          translateMode: socket.data.translator.mode,
          guestLane: !!guestLane,
        });
      }
    } catch (err) {
      console.error('[join_room]', err);
      if (typeof ack === 'function') ack({ ok: false, error: err.message });
    }
  });

  socket.on('update_translator', (payload = {}, ack) => {
    const clientKey = String(payload.apiKey || '').trim();
    socket.data.translator = {
      mode: clientKey ? 'byok' : 'server',
      apiKey: clientKey ? clientKey.slice(0, 200) : '',
      model: String(payload.apiModel || socket.data.translator?.model || 'gemini-2.5-flash')
        .trim()
        .slice(0, 80),
      provider: 'gemini',
    };
    if (typeof ack === 'function') {
      ack({ ok: true, translateMode: socket.data.translator.mode });
    }
  });

  socket.on('send_speech', (data = {}) => {
    const roomId = String(data.roomId || socket.data.roomId || '').trim();
    const msgId = String(data.msgId || '').trim();
    const text = String(data.text || '').trim().slice(0, 2000);
    const sourceLang = data.sourceLang || socket.data.profile?.myLang || 'zh-TW';
    const targetLang = data.targetLang || socket.data.profile?.targetLang || 'ja-JP';

    if (!roomId || !msgId || !text) return;
    if (!socket.rooms.has(roomId)) {
      socket.emit('server_error', { message: '尚未加入房間，請重新連線' });
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

    // 1) 立刻廣播原文給房間其他人
    socket.to(roomId).emit('receive_original', originalPayload);

    rooms.pushHistory(roomId, {
      msgId,
      senderId: socket.id,
      senderName,
      text: originalPayload.text,
      sourceLang,
      targetLang,
      translatedText: null,
    });

    // 2) 佇列翻譯後廣播結果（優先使用該使用者自帶的 API Key）
    const speechSentAt = originalPayload.at;
    enqueueTranslate(roomId, async () => {
      const translateStarted = Date.now();
      try {
        const t = socket.data.translator || {};
        const result = await translate(text, sourceLang, targetLang, {
          apiKey: t.mode === 'byok' ? t.apiKey : '',
          model: t.model,
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
        console.log(
          `[翻譯][${result.provider}] ${roomId} ${translateMs}ms: ${text.slice(0, 40)} → ${result.text.slice(0, 40)}`
        );
      } catch (error) {
        const translateMs = Date.now() - translateStarted;
        console.error(`[翻譯失敗] ${roomId}`, error.message);
        const fallback = `[翻譯失敗] ${escapePlain(text)}`;
        rooms.updateTranslation(roomId, msgId, fallback, 'error');
        io.to(roomId).emit('receive_translation', {
          msgId,
          translatedText: fallback,
          provider: 'error',
          translateMs,
          sentAt: speechSentAt,
          error: true,
        });
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
  console.log(`自用入口 http://localhost:${PORT}${HOST_LOBBY_PATH} （勿外傳）`);
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
