/**
 * 輕量房間狀態：成員清單、最近字幕（供晚進房者補齊）
 */
const MAX_HISTORY = 120;
const MAX_MEMBERS = 4;

class RoomManager {
  constructor() {
    /** @type {Map<string, { members: Map<string, object>, history: object[] }>} */
    this.rooms = new Map();
  }

  ensure(roomId) {
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, { members: new Map(), history: [], messageIds: new Set(), sequence: 0, requestTimes: [] });
    }
    return this.rooms.get(roomId);
  }

  join(roomId, socketId, profile) {
    const room = this.ensure(roomId);
    if (!room.members.has(socketId) && room.members.size >= MAX_MEMBERS) throw new Error('This meeting room is full');
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
    if (room.messageIds.has(entry.msgId)) return null;
    room.messageIds.add(entry.msgId);
    const item = { ...entry, at: Date.now(), sequence: ++room.sequence };
    room.history.push(item);
    if (room.history.length > MAX_HISTORY) {
      const removed = room.history.splice(0, room.history.length - MAX_HISTORY);
      removed.forEach((message) => room.messageIds.delete(message.msgId));
    }
    return item;
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

  allowRequest(roomId, maxPerMinute) {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    const now = Date.now();
    room.requestTimes = room.requestTimes.filter((at) => now - at < 60_000);
    if (room.requestTimes.length >= maxPerMinute) return false;
    room.requestTimes.push(now);
    return true;
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
