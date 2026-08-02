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

const PORT = Number(process.env.PORT) || 3100;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const startedAt = Date.now();

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
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', (_req, res) => {
  const stats = rooms.stats();
  const openaiKey = String(process.env.OPENAI_API_KEY || '').trim();
  const deeplKey = String(process.env.DEEPL_API_KEY || '').trim();
  res.json({
    ok: true,
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    rooms: stats.rooms,
    sockets: stats.sockets,
    translateProviders: providerChain().map((p) => p.name),
    // 診斷用：只回傳「有沒有設到」，絕不回傳金鑰內容
    env: {
      TRANSLATE_PROVIDER: process.env.TRANSLATE_PROVIDER || '(unset)',
      hasOpenAIKey: openaiKey.length > 0,
      hasDeepLKey: deeplKey.length > 0,
      TRUST_PROXY: process.env.TRUST_PROXY || '(unset)',
    },
  });
});

app.get('/api/config', (_req, res) => {
  res.json({
    defaultProvider: process.env.TRANSLATE_PROVIDER || 'mymemory',
    providers: providerChain().map((p) => p.name),
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

      const snapshot = rooms.join(roomId, socket.id, socket.data.profile);
      io.to(roomId).emit('room_update', snapshot);

      console.log(`[房間] ${socket.data.profile.displayName} → ${roomId}`);
      if (typeof ack === 'function') {
        ack({ ok: true, roomId, snapshot, selfId: socket.id });
      }
    } catch (err) {
      console.error('[join_room]', err);
      if (typeof ack === 'function') ack({ ok: false, error: err.message });
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

    // 2) 佇列翻譯後廣播結果
    enqueueTranslate(roomId, async () => {
      try {
        const result = await translate(text, sourceLang, targetLang);
        const translatedText = escapePlain(result.text);
        rooms.updateTranslation(roomId, msgId, translatedText, result.provider);

        io.to(roomId).emit('receive_translation', {
          msgId,
          translatedText,
          provider: result.provider,
        });
        console.log(`[翻譯][${result.provider}] ${roomId}: ${text.slice(0, 40)} → ${result.text.slice(0, 40)}`);
      } catch (error) {
        console.error(`[翻譯失敗] ${roomId}`, error.message);
        const fallback = `[翻譯失敗] ${escapePlain(text)}`;
        rooms.updateTranslation(roomId, msgId, fallback, 'error');
        io.to(roomId).emit('receive_translation', {
          msgId,
          translatedText: fallback,
          provider: 'error',
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
