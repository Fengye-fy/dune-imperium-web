'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { JsonStore } = require('./lib/store');
const { RoomService } = require('./lib/rooms');
const { fail, object } = require('./lib/errors');
const { plugins } = require('./registry');

const PREFIX = '/api/board-games';

function json(res, status, value) {
  const data = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data), 'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff', 'Vary': 'Cookie'
  });
  res.end(data);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0, done = false;
    const chunks = [];
    req.on('data', chunk => {
      if (done) return;
      size += chunk.length;
      if (size > 16384) {
        done = true;
        chunks.length = 0;
        reject(Object.assign(new Error('请求体不能超过 16 KiB'), { code: 'BODY_TOO_LARGE', status: 413 }));
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      try { resolve(object(JSON.parse(Buffer.concat(chunks).toString('utf8')))); }
      catch (_) { reject(Object.assign(new Error('请求体必须是 JSON 对象'), { code: 'INVALID_JSON', status: 400 })); }
    });
    req.on('error', reject);
    req.on('aborted', () => reject(Object.assign(new Error('请求已中断'), { code: 'ABORTED', status: 400 })));
  });
}

function checkMutation(req, publicOrigin) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
    fail('JSON_REQUIRED', '请使用 application/json', 415);
  }
  if (req.headers['x-board-games-request'] !== '1') fail('CSRF_REJECTED', '缺少 X-Board-Games-Request 请求头', 403);
  if (req.headers['sec-fetch-site'] === 'cross-site') fail('CSRF_REJECTED', '不接受跨站操作', 403);
  if (req.headers.origin) {
    let origin;
    try { origin = new URL(req.headers.origin); } catch (_) { fail('CSRF_REJECTED', '来源无效', 403); }
    if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== req.headers.origin ||
        (publicOrigin ? origin.origin !== publicOrigin : origin.host !== req.headers.host)) {
      fail('CSRF_REJECTED', '不接受跨站操作', 403);
    }
  }
}

function createBoardGamesHandler({ dataDir, getUser = async () => null, publicOrigin, registry = plugins, store } = {}) {
  const service = new RoomService(store || new JsonStore(dataDir || path.join(__dirname, 'data')), registry);
  const limits = new Map();
  function rate(key, maximum, duration) {
    const now = Date.now();
    if (limits.size > 1000) for (const [id, entry] of limits) if (entry.until < now) limits.delete(id);
    let entry = limits.get(key);
    if (!entry || entry.until < now) { entry = { count: 0, until: now + duration }; limits.set(key, entry); }
    if (++entry.count > maximum) fail('RATE_LIMITED', '操作过于频繁，请稍后再试', 429);
  }

  const handler = async (req, res) => {
    const pathname = String(req.url || '').split('?')[0];
    if (pathname !== PREFIX && !pathname.startsWith(PREFIX + '/')) return false;
    try {
      const route = pathname.slice(PREFIX.length).replace(/\/$/, '') || '/';
      if (req.method === 'GET' && route === '/health') {
        json(res, 200, { ok: true, apiVersion: 1, storageSchema: 1 }); return true;
      }
      if (req.method === 'GET' && route === '/client.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
        res.end(fs.readFileSync(path.join(__dirname, 'client', 'board-games.mjs'))); return true;
      }
      if (req.method === 'GET' && route === '/games') {
        json(res, 200, { games: [...registry.values()].map(plugin => plugin.manifest) }); return true;
      }
      const catalog = /^\/games\/([a-z0-9-]+)$/.exec(route);
      if (req.method === 'GET' && catalog) {
        const plugin = service.plugin(catalog[1]);
        json(res, 200, { game: plugin.manifest, catalog: plugin.getCatalog() }); return true;
      }
      const user = await getUser(req);
      if (!user || typeof user.key !== 'string' || !user.key || user.key.length > 256) fail('UNAUTHENTICATED', '请先登录网站', 401);
      rate('user:' + user.key, 300, 60000);
      if (req.method === 'GET' && route === '/rooms') {
        json(res, 200, { rooms: service.list(user) }); return true;
      }
      const roomRoute = /^\/rooms\/([A-Fa-f0-9]{12})(?:\/(join|ready|leave|start|close|actions))?$/.exec(route);
      if (req.method === 'GET' && roomRoute && !roomRoute[2]) {
        json(res, 200, { room: service.view(service.find(roomRoute[1].toUpperCase()), user) }); return true;
      }
      if (req.method !== 'POST') fail('NOT_FOUND', '接口不存在或方法不支持', 404);
      checkMutation(req, publicOrigin);
      if (route !== '/rooms' && (!roomRoute || !roomRoute[2])) fail('NOT_FOUND', '接口不存在', 404);
      const body = await readJson(req);
      if (route === '/rooms') {
        rate('create:' + user.key, 20, 600000);
        const result = service.create(user, body);
        json(res, result.replayed ? 200 : 201, result);
      } else {
        const result = service.mutate(roomRoute[1].toUpperCase(), user, roomRoute[2], body);
        json(res, 200, result);
      }
    } catch (error) {
      if (res.destroyed || res.writableEnded) return true;
      const status = error.status || error.statusCode || 500;
      if (status >= 500) console.error('[board-games]', error.code || error.name, error.message);
      json(res, status, {
        error: { code: error.code || 'INTERNAL_ERROR', message: status === 500 ? '桌游服务暂时不可用' : error.message, ...(error.details ? { details: error.details } : {}) }
      });
    }
    return true;
  };
  return handler;
}

if (require.main === module) {
  const devAuth = process.env.BOARD_GAMES_DEV_AUTH === '1';
  const handler = createBoardGamesHandler({
    dataDir: process.env.BOARD_GAMES_DATA_DIR || path.join(__dirname, 'data'),
    publicOrigin: process.env.BOARD_GAMES_ORIGIN,
    getUser: async req => {
      const name = req.headers['x-dev-user'];
      return devAuth && typeof name === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(name) ? { key: name, name } : null;
    }
  });
  const port = Number(process.env.BOARD_GAMES_PORT || 8767);
  http.createServer(async (req, res) => {
    if (!await handler(req, res)) json(res, 404, { error: { code: 'NOT_FOUND', message: '请访问 /api/board-games/games' } });
  }).listen(port, '127.0.0.1', () => console.log(`桌游开发服务 http://127.0.0.1:${port}/api/board-games/games；本地测试身份 ${devAuth ? '开启' : '关闭'}`));
}

module.exports = { createBoardGamesHandler };
