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

function createInvite({ roomId, role, expiresInMinutes = 45 }) {
  const secret = configuredSecret('INVITE_SECRET');
  if (!secret) throw new Error('INVITE_SECRET must be at least 32 characters');
  const cleanRoomId = String(roomId || '').trim();
  if (!/^[a-zA-Z0-9_-]{3,64}$/.test(cleanRoomId)) throw new Error('Invalid room ID');
  if (!['tw', 'jp'].includes(role)) throw new Error('Invalid invite role');
  const minutes = Math.min(120, Math.max(5, Number(expiresInMinutes) || 45));
  const body = encode({ v: 1, roomId: cleanRoomId, role, exp: Date.now() + minutes * 60_000, nonce: crypto.randomBytes(12).toString('base64url') });
  return `${body}.${sign(body, secret)}`;
}

function verifyInvite(token, roomId) {
  const secret = configuredSecret('INVITE_SECRET');
  const [body, signature, ...extra] = String(token || '').split('.');
  if (!secret || !body || !signature || extra.length || !safeEqual(sign(body, secret), signature)) return null;
  try {
    const invite = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (invite.v !== 1 || invite.exp < Date.now() || invite.roomId !== roomId || !['tw', 'jp'].includes(invite.role)) return null;
    return invite;
  } catch (_) { return null; }
}

function verifyHostToken(token) {
  const secret = configuredSecret('HOST_LOBBY_TOKEN');
  return !!secret && safeEqual(token, secret);
}

module.exports = { configuredSecret, createInvite, verifyInvite, verifyHostToken };
