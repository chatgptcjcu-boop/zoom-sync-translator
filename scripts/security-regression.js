#!/usr/bin/env node
const { spawn } = require('child_process');
const { io } = require('socket.io-client');
const { RoomManager } = require('../server/rooms');

const port = 3199;
const base = `http://127.0.0.1:${port}`;
const hostToken = 'host-token-for-regression-tests-0123456789';
const inviteSecret = 'invite-secret-for-regression-tests-0123456789';
let server;

function assert(condition, message) { if (!condition) throw new Error(message); }
function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function connect() {
  const socket = io(base, { transports: ['websocket'], forceNew: true });
  return new Promise((resolve, reject) => { socket.once('connect', () => resolve(socket)); socket.once('connect_error', reject); });
}
function join(socket, payload) { return new Promise((resolve) => socket.emit('join_room', payload, resolve)); }

async function main() {
  server = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, PORT: String(port), HOST_LOBBY_TOKEN: hostToken, INVITE_SECRET: inviteSecret, TRANSLATE_PROVIDER: 'mymemory', TRANSLATE_RETRIES: '0' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 30; i++) {
    try { if ((await fetch(`${base}/health`)).ok) break; } catch (_) {}
    await wait(150);
  }
  assert((await fetch(`${base}/health`)).ok, 'server did not start');
  const stranger = await connect();
  assert(!(await join(stranger, { roomId: 'private-room', role: 'jp' })).ok, 'unauthenticated socket joined');
  const host = await connect();
  assert((await join(host, { roomId: 'private-room', role: 'tw', hostToken })).ok, 'host could not join');
  const deniedInvite = await fetch(`${base}/api/invites`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomId: 'private-room', role: 'jp' }) });
  assert(deniedInvite.status === 401, 'invite endpoint accepted unauthenticated request');
  const inviteResponse = await fetch(`${base}/api/invites`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${hostToken}` }, body: JSON.stringify({ roomId: 'private-room', role: 'jp', expiresInMinutes: 30 }) });
  const inviteData = await inviteResponse.json();
  assert(inviteData.ok && inviteData.invite, 'host could not create invite');
  assert(inviteData.joinUrl.includes('/j/') && inviteData.invite.length < 70, 'invite was not shortened');
  assert((await fetch(inviteData.joinUrl)).ok, 'short invite page unavailable');
  const resolveInvite = async (invite) => {
    const response = await fetch(`${base}/api/invites/resolve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invite }) });
    return response.json();
  };
  const resolved = await resolveInvite(inviteData.invite);
  assert(resolved.ok && resolved.claim.roomId === 'private-room' && resolved.claim.role === 'jp', 'invite defaults not verified');
  const tampered = inviteData.invite.slice(0, 20) + (inviteData.invite[20] === 'A' ? 'B' : 'A') + inviteData.invite.slice(21);
  assert(!(await resolveInvite(tampered)).ok, 'tampered short invite accepted');
  process.env.INVITE_SECRET = inviteSecret;
  const access = require('../server/access');
  assert(access.verifyInvite(inviteData.invite, 'private-room'), 'invite cannot be verified by a separate process/module');
  const clockNow = Date.now;
  Date.now = () => resolved.claim.exp + 1;
  assert(!access.verifyInvite(inviteData.invite, 'private-room'), 'expired invitation accepted');
  Date.now = clockNow;
  Date.now = () => Date.parse('2026-09-09T10:00:00+08:00');
  const scheduled = access.createInvite({ roomId: 'practice-meeting', role: 'jp', expiresAt: '2026-09-16T12:00:00+08:00' });
  assert(access.verifyInvite(scheduled, 'practice-meeting'), 'scheduled invitation not available for practice');
  Date.now = () => Date.parse('2026-09-16T11:00:00+09:00');
  assert(access.verifyInvite(scheduled, 'practice-meeting'), 'scheduled invitation expired before meeting');
  Date.now = () => Date.parse('2026-09-16T13:00:00+09:00');
  assert(!access.verifyInvite(scheduled, 'practice-meeting'), 'scheduled invitation valid after deadline');
  assert(require('assert').throws(() => access.createInvite({ roomId: 'practice-meeting', role: 'jp', expiresAt: 'invalid' })) === undefined, 'invalid expiry accepted');
  require('assert').throws(() => access.createInvite({ roomId: 'practice-meeting', role: 'jp', expiresAt: '2027-09-16T12:00:00+08:00' }));
  Date.now = clockNow;
  const crypto = require('crypto');
  const legacyBody = Buffer.from(JSON.stringify({ v: 1, roomId: 'private-room', role: 'jp', exp: Date.now() + 60000 })).toString('base64url');
  const legacy = legacyBody + '.' + crypto.createHmac('sha256', inviteSecret).update(legacyBody).digest('base64url');
  assert((await resolveInvite(legacy)).ok, 'valid legacy link no longer works');
  const guest = await connect();
  const guestJoin = await join(guest, { roomId: 'private-room', role: 'tw', invite: inviteData.invite });
  assert(guestJoin.ok && guestJoin.snapshot.members.find((member) => member.socketId === guest.id).role === 'jp', 'server trusted guest role');
  const wrongRoom = await connect();
  assert(!(await join(wrongRoom, { roomId: 'another-room', invite: inviteData.invite })).ok, 'invite could cross room boundary');
  let originals = 0;
  guest.on('receive_original', () => { originals += 1; });
  host.emit('send_speech', { roomId: 'another-room', msgId: 'dedup-1', text: '測試重複字幕', sourceLang: 'ja-JP' });
  host.emit('send_speech', { roomId: 'another-room', msgId: 'dedup-1', text: '測試重複字幕', sourceLang: 'ja-JP' });
  await wait(500);
  assert(originals === 1, `expected one original, received ${originals}`);
  const rooms = new RoomManager();
  rooms.join('recover', 'a', { displayName: 'A' });
  rooms.pushHistory('recover', { msgId: 'm1', text: '原文' });
  rooms.updateTranslation('recover', 'm1', '訳文', 'test');
  assert(rooms.snapshot('recover').history[0].translatedText === '訳文', 'reconnect snapshot lost translation update');
  [stranger, host, guest, wrongRoom].forEach((socket) => socket.close());
  console.log('security regression tests passed');
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => { if (server) server.kill('SIGTERM'); });
