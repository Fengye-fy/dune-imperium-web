'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { createBoardGamesHandler } = require('../server');

async function setup(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-games-http-'));
  const getUser = async req => req.headers['x-test-user'] ? { key: req.headers['x-test-user'], name: req.headers['x-test-user'] } : null;
  let handler = createBoardGamesHandler({ dataDir, getUser });
  const server = http.createServer(async (req, res) => {
    if (!await handler(req, res)) { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(path.resolve(dataDir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dataDir).startsWith('board-games-http-'));
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });
  const base = 'http://127.0.0.1:' + server.address().port + '/api/board-games';
  async function request(route, user, body, extra = {}) {
    const response = await fetch(base + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'Content-Type': 'application/json', 'X-Board-Games-Request': '1',
        ...(user ? { 'X-Test-User': user } : {}), ...extra
      },
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) })
    });
    return { status: response.status, body: await response.json(), headers: response.headers };
  }
  return { base, request, reload: () => { handler = createBoardGamesHandler({ dataDir, getUser }); } };
}

test('HTTP rejects unauthenticated, cross-site, malformed and oversized requests; versions serialize competing writes', async t => {
  const { request } = await setup(t);
  const create = { gameId: 'dune-imperium', capacity: 3, requestId: 'http-create-0001' };
  const games = await request('/games');
  assert.equal(games.status, 200);
  assert.equal(games.body.games[0].status, 'experimental');
  assert.equal((await request('/games/__proto__')).status, 401);
  assert.equal((await request('/games/no-such-game')).status, 404);
  assert.equal((await request('/rooms', undefined, create)).status, 401);
  assert.equal((await request('/rooms', 'alice', create, { Origin: 'https://another.example' })).status, 403);
  assert.equal((await request('/rooms', 'alice', create, { 'X-Board-Games-Request': '' })).status, 403);
  assert.equal((await request('/rooms', 'alice', create, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await request('/rooms', 'alice', '{bad')).status, 400);
  assert.equal((await request('/rooms', 'alice', 'x'.repeat(17000))).status, 413);
  assert.equal((await request('/rooms', 'alice', { ...create, gameId: '__proto__' })).status, 404);
  const created = await request('/rooms', 'alice', create);
  assert.equal(created.status, 201);
  const room = created.body.room;
  assert.match(created.headers.get('cache-control'), /no-store/);
  assert.equal((await request('/rooms/' + room.id, 'outsider')).status, 403);
  assert.deepEqual((await request('/rooms', 'outsider')).body.rooms, []);
  const results = await Promise.all([
    request('/rooms/' + room.id + '/ready', 'alice', { ready: true, expectedVersion: 1, requestId: 'ready-concurrent-a' }),
    request('/rooms/' + room.id + '/ready', 'alice', { ready: false, expectedVersion: 1, requestId: 'ready-concurrent-b' })
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  assert.equal((await request('/rooms/' + room.id, 'alice')).body.room.version, 2);
});

test('browser SDK runs a three-player game through the real API and restores a private finished view', { timeout: 30000 }, async t => {
  const { base, request, reload } = await setup(t);
  const { createBoardGamesClient } = await import(pathToFileURL(path.resolve(__dirname, '../client/board-games.mjs')).href);
  const names = ['alice', 'bob', 'carol'];
  const clients = names.map(name => createBoardGamesClient({
    baseUrl: base,
    fetchImpl: (url, options) => fetch(url, { ...options, headers: { ...options.headers, 'X-Test-User': name } })
  }));
  let { room } = await clients[0].create({ gameId: 'dune-imperium', capacity: 3 });
  const roomId = room.id;
  for (const client of clients.slice(1)) ({ room } = await client.join(roomId));
  for (const client of clients) ({ room } = await client.ready(room, true));
  ({ room } = await clients[0].start(room));
  const seatToClient = new Map();
  for (const client of clients) {
    const snapshot = (await client.room(roomId)).room;
    seatToClient.set(snapshot.viewerPlayerId, client);
  }
  // v3 finishes public leader selection and the private Baron setup before round 1.
  for (let step = 0; room.game.round === 0 && step < 10; step++) {
    const client = seatToClient.get(room.game.currentPlayerId);
    ({ room } = await client.room(roomId));
    ({ room } = await client.act(room, room.legalActions[0]));
  }
  assert.equal(room.game.round, 1);
  for (const client of clients) {
    const snapshot = (await client.room(roomId)).room;
    seatToClient.set(snapshot.viewerPlayerId, client);
    for (const player of snapshot.game.players) {
      if (player.id === snapshot.viewerPlayerId) assert.equal(player.hand.length, 5);
      else { assert.equal(player.hand, undefined); assert.equal(player.intrigues, undefined); }
      assert.equal(player.deck, undefined);
    }
    assert.equal(snapshot.game.marketDeck, undefined);
    assert.equal(snapshot.game.intrigueDeck, undefined);
    assert.equal(snapshot.game.conflictDeck, undefined);
  }
  const outsider = await request('/rooms/' + roomId + '/actions', 'outsider', {
    requestId: 'illegal-actor-001', expectedVersion: room.version,
    action: { type: 'reveal', playerId: room.game.currentPlayerId }
  });
  assert.equal(outsider.status, 403);
  const actionCounts = new Map();
  for (let step = 0; step < 1200 && room.status === 'playing'; step++) {
    const client = seatToClient.get(room.game.currentPlayerId);
    assert.ok(client, 'every active seat has a client');
    if (room.viewerPlayerId !== room.game.currentPlayerId) ({ room } = await client.room(roomId));
    const actions = room.legalActions;
    assert.ok(actions.length, 'every phase offers a legal way to continue');
    // Exercise agent turns in round 1, then use fast reveal turns so the real
    // HTTP test remains below production per-user rate limits. Full card/leader
    // exploration is covered by the pure engine suites.
    const firstReveal = room.game.round === 1 && room.game.currentPlayerId === room.game.firstPlayerId;
    let action = room.game.round === 1 && !firstReveal ? actions.find(item => item.type === 'agent') : null;
    action ||= actions.find(item => item.type === 'reveal') || actions.find(item => item.type === 'resolveReveal') ||
      actions.find(item => item.type === 'chooseEffect') || actions.filter(item => item.type === 'deploy').at(-1) ||
      actions.find(item => item.type === 'endAgent') ||
      (room.game.round === 1 ? actions.find(item => item.type === 'buy') : null) ||
      actions.find(item => item.type === 'endReveal') || actions[0];
    actionCounts.set(action.type, (actionCounts.get(action.type) || 0) + 1);
    ({ room } = await client.act(room, action));
  }
  assert.equal(room.status, 'finished');
  assert.ok(room.game.result.winnerIds.length > 0);
  assert.ok(actionCounts.get('agent') > 0);
  assert.ok(actionCounts.get('buy') > 0);
  assert.ok(actionCounts.get('endReveal') > 0);
  assert.deepEqual(room.legalActions, []);
  reload();
  const restored = (await clients[0].room(roomId)).room;
  assert.equal(restored.version, room.version);
  assert.deepEqual(restored.game.result, room.game.result);
  assert.equal(JSON.stringify(restored).includes('accountId'), false);
});
