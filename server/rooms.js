/**
 * 輕量房間狀態：成員清單、最近字幕（供晚進房者補齊）
 */
const MAX_HISTORY = 40;

class RoomManager {
  constructor() {
    /** @type {Map<string, { members: Map<string, object>, history: object[] }>} */
    this.rooms = new Map();
  }

  ensure(roomId) {
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, { members: new Map(), history: [] });
    }
    return this.rooms.get(roomId);
  }

  join(roomId, socketId, profile) {
    const room = this.ensure(roomId);
    room.members.set(socketId, {
      socketId,
      displayName: profile.displayName || 'Guest',
      role: profile.role || 'guest',
      myLang: profile.myLang || 'zh-TW',
      targetLang: profile.targetLang || 'ja-JP',
      joinedAt: Date.now(),
    });
    return this.snapshot(roomId);
  }

  leave(roomId, socketId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    room.members.delete(socketId);
    if (room.members.size === 0) {
      this.rooms.delete(roomId);
      return { members: [], history: [], empty: true };
    }
    return this.snapshot(roomId);
  }

  leaveAll(socketId) {
    const affected = [];
    for (const [roomId, room] of this.rooms.entries()) {
      if (room.members.has(socketId)) {
        affected.push({ roomId, snapshot: this.leave(roomId, socketId) });
      }
    }
    return affected;
  }

  pushHistory(roomId, entry) {
    const room = this.ensure(roomId);
    room.history.push({ ...entry, at: Date.now() });
    if (room.history.length > MAX_HISTORY) {
      room.history.splice(0, room.history.length - MAX_HISTORY);
    }
  }

  updateTranslation(roomId, msgId, translatedText, provider) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const item = room.history.find((h) => h.msgId === msgId);
    if (item) {
      item.translatedText = translatedText;
      item.provider = provider;
    }
  }

  snapshot(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return { members: [], history: [] };
    return {
      members: Array.from(room.members.values()),
      history: room.history.slice(-20),
      empty: false,
    };
  }

  stats() {
    let sockets = 0;
    for (const room of this.rooms.values()) sockets += room.members.size;
    return { rooms: this.rooms.size, sockets };
  }
}

module.exports = { RoomManager };
