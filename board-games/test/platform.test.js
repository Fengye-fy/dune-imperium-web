'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonStore } = require('../lib/store');
const { RoomService } = require('../lib/rooms');

const users = ['alice', 'bob', 'carol', 'outsider'].map(key => ({ key, name: key }));
const fakePlugin = {
  manifest: { id: 'fixture', name: '测试插件', minPlayers: 3, maxPlayers: 4, ruleset: 'test' },
  createGame: ({ players }) => ({ phase: 'turns', players, count: 0 }),
  applyAction: state => ({ ...state, count: state.count + 1 }),
  getView: state => ({ phase: state.phase, count: state.count }),
  getLegalActions: () => [{ type: 'count' }]
};

test('plugin options are normalized, persisted, isolated from views and passed to game start', t => {
  const { service } = setup(t);
  service.plugins.set('fixture', { ...fakePlugin,
    validateOptions: options => {
      assert.deepEqual(options, { expansions: [] });
      return { expansions: [], format: 'canonical' };
    },
    createGame: ({ players, options }) => ({ phase: 'turns', players, count: 0, receivedOptions: options }),
  });
  const input = { expansions: [] };
  let room = service.create(users[0], { gameId: 'fixture', options: input, capacity: 3, requestId: 'options-create-1' }).room;
  input.expansions.push('not-persisted'); room.options.expansions.push('view-only');
  assert.deepEqual(service.find(room.id).options, { expansions: [], format: 'canonical' });
  for (const user of users.slice(1, 3)) room = command(service, room, user, 'join').room;
  for (const user of users.slice(0, 3)) room = command(service, room, user, 'ready', { ready: true }).room;
  room = command(service, room, users[0], 'start').room;
  assert.deepEqual(service.find(room.id).game.receivedOptions, { expansions: [], format: 'canonical' });
});
function setup(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'board-games-test-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('board-games-test-'));
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });
  const store = new JsonStore(directory);
  return { directory, store, service: new RoomService(store, new Map([['fixture', fakePlugin]])) };
}
function create(service) {
  return service.create(users[0], { gameId: 'fixture', capacity: 3, requestId: 'create-0001' }).room;
}
function command(service, room, user, type, body = {}) {
  return service.mutate(room.id, user, type, { requestId: `${type}-${room.version}-request`, expectedVersion: room.version, ...body });
}

test('rooms are persisted; account identifiers and private room names are not listed to outsiders', t => {
  const { directory, service } = setup(t);
  const room = create(service);
  assert.equal(room.players.length, 1);
  assert.equal(JSON.stringify(room).includes('accountId'), false);
  assert.equal(service.list(users[3]).length, 0);
  assert.throws(() => service.view(service.find(room.id), users[3]), { code: 'NOT_A_MEMBER' });
  const restored = new RoomService(new JsonStore(directory), new Map([['fixture', fakePlugin]]));
  assert.deepEqual(restored.view(restored.find(room.id), users[0]), room);
});

test('create retry and mutation retry are idempotent; changed payload and stale version fail', t => {
  const { service, store, directory } = setup(t);
  const room = create(service);
  assert.equal(service.create(users[0], { gameId: 'fixture', capacity: 3, requestId: 'create-0001' }).replayed, true);
  assert.equal(Object.keys(store.state.rooms).length, 1);
  assert.throws(() => service.create(users[0], { gameId: 'fixture', capacity: 4, requestId: 'create-0001' }), { code: 'REQUEST_ID_REUSED' });
  const body = { requestId: 'ready-0001', expectedVersion: 1, ready: true };
  const first = service.mutate(room.id, users[0], 'ready', body);
  const retry = service.mutate(room.id, users[0], 'ready', body);
  assert.equal(first.appliedVersion, 2);
  assert.equal(retry.replayed, true);
  assert.equal(retry.room.version, 2);
  assert.throws(() => service.mutate(room.id, users[0], 'ready', { ...body, ready: false }), { code: 'REQUEST_ID_REUSED' });
  assert.throws(() => service.mutate(room.id, users[0], 'ready', { ...body, requestId: 'ready-0002' }), { code: 'VERSION_CONFLICT' });
  const restored = new RoomService(new JsonStore(directory), new Map([['fixture', fakePlugin]]));
  assert.equal(restored.mutate(room.id, users[0], 'ready', body).replayed, true);
});

test('lobby enforces capacity, readiness, host control, and membership before starting', t => {
  const { service } = setup(t);
  let room = create(service);
  assert.throws(() => command(service, room, users[0], 'start'), { code: 'NOT_ENOUGH_PLAYERS' });
  room = command(service, room, users[1], 'join').room;
  room = command(service, room, users[2], 'join').room;
  assert.throws(() => command(service, room, users[3], 'join'), { code: 'ROOM_FULL' });
  assert.throws(() => command(service, room, users[1], 'start'), { code: 'HOST_ONLY' });
  assert.throws(() => command(service, room, users[0], 'start'), { code: 'PLAYERS_NOT_READY' });
  for (const user of users.slice(0, 3)) room = command(service, room, user, 'ready', { ready: true }).room;
  room = command(service, room, users[0], 'start').room;
  assert.equal(room.status, 'playing');
  assert.equal(room.game.count, 0);
  assert.throws(() => command(service, room, users[3], 'actions', { action: { type: 'count' } }), { code: 'NOT_A_MEMBER' });
  assert.throws(() => command(service, room, users[1], 'leave'), { code: 'ROOM_NOT_WAITING' });
  room = command(service, room, users[1], 'actions', { action: { type: 'count' } }).room;
  assert.equal(room.game.count, 1);
});

test('failed writes leave in-memory and on-disk state unchanged and remain retryable', t => {
  const { service, store } = setup(t);
  const room = create(service);
  const before = JSON.stringify(store.state);
  const original = store.commit;
  store.commit = () => { throw Object.assign(new Error('disk unavailable'), { code: 'PERSIST_FAILED' }); };
  assert.throws(() => command(service, room, users[0], 'ready', { ready: true }), { code: 'PERSIST_FAILED' });
  assert.equal(JSON.stringify(store.state), before);
  assert.equal(fs.readFileSync(store.file, 'utf8'), before);
  store.commit = original;
  assert.equal(command(service, room, users[0], 'ready', { ready: true }).room.version, 2);
});

test('invalid or unsupported save files are never silently replaced', t => {
  const { directory, store } = setup(t);
  fs.writeFileSync(store.file, '{broken');
  assert.throws(() => new JsonStore(directory));
  assert.equal(fs.readFileSync(store.file, 'utf8'), '{broken');
  fs.writeFileSync(store.file, JSON.stringify({ schemaVersion: 9, rooms: {}, createRequests: [] }));
  assert.throws(() => new JsonStore(directory), /存档版本/);
});

test('host leaving transfers ownership; repeated leave does not expose the room', t => {
  const { service } = setup(t);
  let room = create(service);
  room = command(service, room, users[1], 'join').room;
  const body = { requestId: 'leave-0001', expectedVersion: room.version };
  const result = service.mutate(room.id, users[0], 'leave', body);
  assert.equal(result.room, null);
  const next = service.view(service.find(room.id), users[1]);
  assert.equal(next.hostPlayerId, next.viewerPlayerId);
  assert.equal(service.mutate(room.id, users[0], 'leave', body).replayed, true);
  const creationRetry = service.create(users[0], { gameId: 'fixture', capacity: 3, requestId: 'create-0001' });
  assert.equal(creationRetry.replayed, true);
  assert.equal(creationRetry.room, null);
  assert.equal(creationRetry.roomId, room.id);
});
