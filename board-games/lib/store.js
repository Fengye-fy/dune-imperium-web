'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// One site process owns this store. Never publish a mutation before rename succeeds.
class JsonStore {
  constructor(directory) {
    fs.mkdirSync(directory, { recursive: true });
    this.file = path.join(directory, 'rooms.json');
    this.state = { schemaVersion: 1, rooms: {}, createRequests: [] };
    if (fs.existsSync(this.file)) {
      const state = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (state.schemaVersion !== 1 || !state.rooms || Array.isArray(state.rooms) ||
          typeof state.rooms !== 'object' || !Array.isArray(state.createRequests)) {
        throw new Error('桌游存档版本或结构无效，拒绝覆盖，请恢复备份或执行迁移');
      }
      for (const [id, room] of Object.entries(state.rooms)) {
        if (!/^[A-F0-9]{12}$/.test(id) || room.id !== id || !Array.isArray(room.players) ||
            !Array.isArray(room.requests) || !Array.isArray(room.events) ||
            !Number.isSafeInteger(room.version) || room.version < 1) {
          throw new Error('桌游房间存档结构无效，拒绝覆盖');
        }
      }
      this.state = state;
    }
  }

  commit(next) {
    const temporary = this.file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
    let descriptor;
    try {
      descriptor = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(descriptor, JSON.stringify(next));
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      fs.renameSync(temporary, this.file);
      this.state = next;
    } catch (cause) {
      if (descriptor !== undefined) { try { fs.closeSync(descriptor); } catch (_) {} }
      try { fs.unlinkSync(temporary); } catch (_) {}
      const error = new Error('存档失败，本次操作未生效', { cause });
      Object.assign(error, { code: 'PERSIST_FAILED', status: 503 });
      throw error;
    }
  }
}

module.exports = { JsonStore };
