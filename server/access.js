const crypto = require('crypto');

function configuredSecret(name) {
  const value = String(process.env[name] || '').trim();
  return value.length >= 32 ? value : '';
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function sign(encoded, secret) {
  return crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
}

function createInvite({ roomId, role, expiresInMinutes = 45, expiresAt }) {
  const secret = configuredSecret('INVITE_SECRET');
  if (!secret) throw new Error('INVITE_SECRET must be at least 32 characters');
  const cleanRoomId = String(roomId || '').trim();
  if (!/^[a-zA-Z0-9_-]{3,64}$/.test(cleanRoomId)) throw new Error('Invalid room ID');
  if (!['tw', 'jp'].includes(role)) throw new Error('Invalid invite role');
  const minutes = Math.min(120, Math.max(5, Number(expiresInMinutes) || 45));
  const expiry = expiresAt === undefined ? Date.now() + minutes * 60000 : Date.parse(expiresAt);
  if (!Number.isFinite(expiry) || expiry <= Date.now() || expiry > Date.now() + 14 * 86400000) {
    throw new Error('邀請截止時間必須在未來 14 天內／有効期限は今から14日以内に設定してください。');
  }
  // Self-contained compact invitation; survives Render restarts without a DB.
  const header = Buffer.alloc(6);
  header[0] = 2;
  header[1] = role === 'jp' ? 1 : 0;
  header.writeUInt32BE(Math.floor(expiry / 1000), 2);
  const body = Buffer.concat([header, crypto.randomBytes(8), Buffer.from(cleanRoomId)]);
  const mac = crypto.createHmac('sha256', secret).update(body).digest().subarray(0, 16);
  return Buffer.concat([body, mac]).toString('base64url');
}

function verifyInvite(token, roomId) {
  const secret = configuredSecret('INVITE_SECRET');
  if (!secret) return null;
  if (/^[A-Za-z0-9_-]{44,126}$/.test(String(token || ''))) {
    const bytes = Buffer.from(token, 'base64url');
    if (bytes.toString('base64url') !== token || bytes.length < 33 || bytes[0] !== 2 || bytes[1] > 1) return null;
    const body = bytes.subarray(0, -16);
    const expected = crypto.createHmac('sha256', secret).update(body).digest().subarray(0, 16);
    if (!crypto.timingSafeEqual(expected, bytes.subarray(-16))) return null;
    const claim = { v: 2, role: bytes[1] === 1 ? 'jp' : 'tw', exp: bytes.readUInt32BE(2) * 1000, roomId: body.subarray(14).toString() };
    return claim.exp > Date.now() && /^[a-zA-Z0-9_-]{3,64}$/.test(claim.roomId) && (roomId === undefined || claim.roomId === roomId) ? claim : null;
  }
  const [body, signature, ...extra] = String(token || '').split('.');
  if (!secret || !body || !signature || extra.length || !safeEqual(sign(body, secret), signature)) return null;
  try {
    const invite = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (invite.v !== 1 || !Number.isFinite(invite.exp) || invite.exp <= Date.now() || (roomId !== undefined && invite.roomId !== roomId) || !['tw', 'jp'].includes(invite.role)) return null;
    return invite;
  } catch (_) { return null; }
}

function verifyHostToken(token) {
  const secret = configuredSecret('HOST_LOBBY_TOKEN');
  return !!secret && safeEqual(token, secret);
}

module.exports = { configuredSecret, createInvite, verifyInvite, verifyHostToken };
