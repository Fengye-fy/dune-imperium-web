'use strict';
const crypto = require('node:crypto');
const { fail, object } = require('./errors');

const copy = value => JSON.parse(JSON.stringify(value));
const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}
function fingerprint(type, body) {
  const { requestId, ...payload } = body;
  return crypto.createHash('sha256').update(canonical({ type, payload })).digest('hex');
}
function requestId(body) {
  if (typeof body.requestId !== 'string' || !/^[\w-]{8,80}$/.test(body.requestId)) {
    fail('INVALID_REQUEST_ID', 'requestId 必须是 8–80 位字母、数字、下划线或连字符');
  }
  return body.requestId;
}
function text(value, fallback, max = 60) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f]/.test(value)) {
    fail('INVALID_INPUT', `文本长度须在 1–${max} 之间且不能有控制字符`);
  }
  return value.trim();
}

class RoomService {
  constructor(store, plugins) { this.store = store; this.plugins = plugins; }

  plugin(id) {
    if (!this.plugins.has(id)) fail('GAME_NOT_FOUND', '桌游不存在', 404);
    return this.plugins.get(id);
  }

  find(id) {
    if (!/^[A-F0-9]{12}$/.test(id) || !has(this.store.state.rooms, id)) {
      fail('ROOM_NOT_FOUND', '房间不存在', 404);
    }
    return this.store.state.rooms[id];
  }

  member(room, user) {
    const player = room.players.find(item => item.accountId === user.key);
    if (!player) fail('NOT_A_MEMBER', '请先加入房间', 403);
    return player;
  }

  summary(room) {
    return {
      id: room.id, gameId: room.gameId, name: room.name, status: room.status,
      visibility: room.visibility, capacity: room.capacity, version: room.version,
      options: copy(room.options || {}),
      hostPlayerId: room.hostPlayerId, createdAt: room.createdAt, updatedAt: room.updatedAt,
      players: room.players.map(({ id, name, ready }) => ({ id, name, ready }))
    };
  }

  view(room, user) {
    const player = this.member(room, user);
    const plugin = this.plugin(room.gameId);
    return {
      ...this.summary(room), viewerPlayerId: player.id, ruleset: room.game?.ruleset ||
        (plugin.rulesetForOptions ? plugin.rulesetForOptions(room.options || {}) : plugin.manifest.ruleset),
      game: room.game ? plugin.getView(room.game, player.id) : null,
      legalActions: room.status === 'playing' ? plugin.getLegalActions(room.game, player.id) : [],
      events: room.events.slice(-50)
    };
  }

  list(user) {
    return Object.values(this.store.state.rooms)
      .filter(room => room.players.some(player => player.accountId === user.key) ||
        (room.visibility === 'public' && room.status === 'waiting'))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 100)
      .map(room => this.summary(room));
  }

  create(user, body) {
    object(body);
    const idempotencyKey = requestId(body);
    const hash = fingerprint('create', body);
    const previous = this.store.state.createRequests.find(item => item.accountId === user.key && item.requestId === idempotencyKey);
    if (previous) {
      if (previous.hash !== hash) fail('REQUEST_ID_REUSED', '同一 requestId 不能用于不同请求', 409);
      const room = this.find(previous.roomId);
      const stillMember = room.players.some(player => player.accountId === user.key);
      return { room: stillMember ? this.view(room, user) : null, roomId: room.id, replayed: true, appliedVersion: 1 };
    }
    const plugin = this.plugin(body.gameId);
    const capacity = body.capacity === undefined ? plugin.manifest.maxPlayers : body.capacity;
    if (!Number.isInteger(capacity) || capacity < plugin.manifest.minPlayers || capacity > plugin.manifest.maxPlayers) {
      fail('INVALID_CAPACITY', `人数应为 ${plugin.manifest.minPlayers}–${plugin.manifest.maxPlayers}`);
    }
    const suppliedOptions = body.options === undefined ? {} : object(body.options, 'options');
    if (!plugin.validateOptions && Object.keys(suppliedOptions).length) {
      fail('UNSUPPORTED_OPTIONS', '当前版本尚无可配置的游戏选项');
    }
    const options = plugin.validateOptions ? plugin.validateOptions(suppliedOptions) : {};
    const visibility = body.visibility === undefined ? 'private' : body.visibility;
    if (!['public', 'private'].includes(visibility)) fail('INVALID_INPUT', 'visibility 必须是 public 或 private');
    const rooms = Object.values(this.store.state.rooms);
    if (rooms.length >= 5000) fail('ROOM_LIMIT', '存档数量已达上限，请联系站长归档', 409);
    if (rooms.filter(room => ['waiting', 'playing'].includes(room.status) && room.players.some(player => player.accountId === user.key)).length >= 10) {
      fail('ROOM_LIMIT', '最多同时参加 10 个未结束房间', 409);
    }
    let id;
    do { id = crypto.randomBytes(6).toString('hex').toUpperCase(); } while (has(this.store.state.rooms, id));
    const player = { id: crypto.randomUUID(), accountId: user.key, name: text(user.name, '玩家'), ready: false };
    const now = new Date().toISOString();
    const room = {
      id, gameId: body.gameId, name: text(body.name, plugin.manifest.name + '的房间'), capacity,
      visibility, options: copy(options), status: 'waiting', version: 1, hostPlayerId: player.id,
      players: [player], game: null, createdAt: now, updatedAt: now, requests: [],
      events: [{ version: 1, type: 'created', actorPlayerId: player.id, at: now }]
    };
    const next = {
      ...this.store.state, rooms: { ...this.store.state.rooms, [id]: room },
      createRequests: [...this.store.state.createRequests, { accountId: user.key, requestId: idempotencyKey, hash, roomId: id }].slice(-5000)
    };
    this.store.commit(next);
    return { room: this.view(room, user), replayed: false, appliedVersion: 1 };
  }

  mutate(id, user, type, body) {
    object(body);
    const key = requestId(body);
    const current = this.find(id);
    const hash = fingerprint(type, body);
    const previous = current.requests.find(item => item.accountId === user.key && item.requestId === key);
    if (previous) {
      if (previous.hash !== hash) fail('REQUEST_ID_REUSED', '同一 requestId 不能用于不同请求', 409);
      const stillMember = current.players.some(player => player.accountId === user.key);
      return {
        room: stillMember ? this.view(current, user) : null, roomId: id,
        replayed: true, appliedVersion: previous.version
      };
    }
    const room = copy(current);
    let player;
    if (type === 'join') {
      if (room.status !== 'waiting') fail('ROOM_NOT_WAITING', '对局已开始或关闭', 409);
      player = room.players.find(item => item.accountId === user.key);
      if (player) fail('ALREADY_JOINED', '已在房间中，请读取房间继续', 409);
      if (room.players.length >= room.capacity) fail('ROOM_FULL', '房间已满', 409);
      const active = Object.values(this.store.state.rooms).filter(item => ['waiting', 'playing'].includes(item.status) && item.players.some(member => member.accountId === user.key));
      if (active.length >= 10) fail('ROOM_LIMIT', '最多同时参加 10 个未结束房间', 409);
      player = { id: crypto.randomUUID(), accountId: user.key, name: text(user.name, '玩家'), ready: false };
      room.players.push(player);
    } else {
      player = this.member(room, user);
      if (!Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 1) fail('VERSION_REQUIRED', '请提交当前 expectedVersion');
      if (body.expectedVersion !== room.version) fail('VERSION_CONFLICT', '房间已更新，请刷新后重新操作', 409, { currentVersion: room.version });
      if (type === 'ready') {
        if (room.status !== 'waiting') fail('ROOM_NOT_WAITING', '对局已开始或关闭', 409);
        if (typeof body.ready !== 'boolean') fail('INVALID_INPUT', 'ready 必须是布尔值');
        player.ready = body.ready;
      } else if (type === 'leave') {
        if (room.status !== 'waiting') fail('ROOM_NOT_WAITING', '对局中不能退出座位；重新连接会恢复原座位', 409);
        room.players = room.players.filter(item => item.id !== player.id);
        if (!room.players.length) room.status = 'closed';
        else if (room.hostPlayerId === player.id) room.hostPlayerId = room.players[0].id;
      } else if (type === 'start') {
        if (room.hostPlayerId !== player.id) fail('HOST_ONLY', '仅房主可开始', 403);
        if (room.status !== 'waiting') fail('ROOM_NOT_WAITING', '对局已开始或关闭', 409);
        const plugin = this.plugin(room.gameId);
        if (room.players.length < plugin.manifest.minPlayers) fail('NOT_ENOUGH_PLAYERS', `至少需要 ${plugin.manifest.minPlayers} 人`, 409);
        if (room.players.some(item => !item.ready)) fail('PLAYERS_NOT_READY', '所有玩家准备后才能开始', 409);
        room.game = plugin.createGame({ players: room.players.map(({ id, name }) => ({ id, name })), options: copy(room.options || {}) });
        room.status = 'playing';
      } else if (type === 'close') {
        if (room.hostPlayerId !== player.id) fail('HOST_ONLY', '仅房主可关闭房间', 403);
        if (!['waiting', 'playing'].includes(room.status)) fail('ROOM_CLOSED', '房间已经结束', 409);
        room.status = 'closed';
      } else if (type === 'actions') {
        if (room.status !== 'playing') fail('GAME_NOT_RUNNING', '当前没有进行中的对局', 409);
        const action = object(body.action, 'action');
        if (typeof action.type !== 'string') fail('INVALID_ACTION', 'action.type 必填');
        room.game = this.plugin(room.gameId).applyAction(room.game, player.id, action);
        if (room.game.phase === 'finished' || room.game.status === 'finished') room.status = 'finished';
      } else fail('NOT_FOUND', '接口不存在', 404);
    }
    room.version += 1;
    room.updatedAt = new Date().toISOString();
    room.events.push({ version: room.version, type: type === 'actions' ? body.action.type : type, actorPlayerId: player.id, at: room.updatedAt });
    room.events = room.events.slice(-100);
    room.requests.push({ accountId: user.key, requestId: key, hash, version: room.version });
    room.requests = room.requests.slice(-256);
    this.store.commit({ ...this.store.state, rooms: { ...this.store.state.rooms, [id]: room } });
    return {
      room: type === 'leave' ? null : this.view(room, user), roomId: id,
      replayed: false, appliedVersion: room.version
    };
  }
}

module.exports = { RoomService };
