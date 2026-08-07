#!/usr/bin/env node
/**
 * 雙端煙測：驗證中繼房間 + 翻譯推播
 * 用法: node scripts/smoke-dual.js [BASE_URL]
 * 例:   node scripts/smoke-dual.js https://xxx.up.railway.app
 */
const { io } = require('socket.io-client');

const BASE = process.argv[2] || process.env.SMOKE_URL || 'http://localhost:3100';
const ROOM = `smoke-${Date.now()}`;

async function health() {
  const res = await fetch(`${BASE}/health`);
  if (!res.ok) throw new Error(`health HTTP ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error('health.ok !== true');
  console.log('[health]', JSON.stringify(data));
  return data;
}

function once(socket, event, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting ${event}`)), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(t);
      resolve(payload);
    });
  });
}

async function main() {
  console.log('[smoke] target:', BASE, 'room:', ROOM);
  const h = await health();

  const a = io(BASE, { transports: ['websocket', 'polling'] });
  const b = io(BASE, { transports: ['websocket', 'polling'] });

  await Promise.all([
    new Promise((r, j) => { a.once('connect', r); a.once('connect_error', j); }),
    new Promise((r, j) => { b.once('connect', r); b.once('connect_error', j); }),
  ]);

  await Promise.all([
    new Promise((resolve, reject) => {
      a.emit('join_room', { roomId: ROOM, displayName: 'TW-Smoke', role: 'tw' }, (res) => {
        if (!res?.ok) reject(new Error(res?.error || 'A join fail'));
        else resolve(res);
      });
    }),
    new Promise((resolve, reject) => {
      b.emit('join_room', { roomId: ROOM, displayName: 'JP-Smoke', role: 'jp' }, (res) => {
        if (!res?.ok) reject(new Error(res?.error || 'B join fail'));
        else resolve(res);
      });
    }),
  ]);
  console.log('[smoke] both joined');

  const originalP = once(b, 'receive_original');
  const translateBP = once(b, 'receive_translation');
  const translateAP = once(a, 'receive_translation');

  a.emit('send_speech', {
    roomId: ROOM,
    msgId: `m-${Date.now()}`,
    text: '大家好，歡迎參加會議',
    sourceLang: 'zh-TW',
    targetLang: 'ja-JP',
  });

  const original = await originalP;
  const [ta, tb] = await Promise.all([translateAP, translateBP]);
  console.log('[smoke] B original:', original.text);
  console.log('[smoke] translation:', tb.translatedText, '| provider:', tb.provider);

  a.close();
  b.close();

  const providers = h.translateProviders || [];
  const formal = providers.some((p) => p === 'deepl' || p === 'openai' || p === 'gemini');
  console.log('[smoke] formal engine ready:', formal ? 'YES' : 'NO (still mymemory-only)');
  console.log('[smoke] OK');
  process.exit(0);
}

main().catch((err) => {
  console.error('[smoke] FAIL', err.message);
  process.exit(1);
});
