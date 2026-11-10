'use strict';
/* 独立启动：一个进程同时提供页面、图片和桌游接口，只监听本机。
 *
 *   node start.js
 *
 * 然后打开 http://alice.localhost:8770/board-games/index.html
 * 子域名就是登录名：再开 bob.localhost、carol.localhost 就是另外两个玩家，三个地址互不串号。
 * 这是给本地试玩和开发用的身份方式，没有密码，所以不要把它直接暴露到公网；
 * 要正式部署，请把 getUser 换成你自己的登录校验（见 board-games/README.md）。 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createBoardGamesHandler } = require('./board-games/server');

const PORT = Number(process.env.PORT || 8770);
const PUBLIC = path.join(__dirname, 'apps', 'site', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.png': 'image/png',
};
const userOf = req => {
  const match = /^([a-z0-9-]{1,32})\.localhost(?::\d+)?$/i.exec(req.headers.host || '');
  return match ? match[1].toLowerCase() : null;
};
const boardGames = createBoardGamesHandler({
  dataDir: process.env.BOARD_GAMES_DATA_DIR || path.join(__dirname, 'board-games', 'data'),
  getUser: async req => { const name = userOf(req); return name ? { key: name, name } : null; },
});

http.createServer(async (req, res) => {
  const pathname = decodeURIComponent(String(req.url).split('?')[0]);
  if (await boardGames(req, res)) return;
  if (pathname === '/api/me') {
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ name: userOf(req) }));
  }
  if (pathname === '/') { res.writeHead(302, { Location: '/board-games/index.html' }); return res.end(); }
  const file = path.normalize(path.join(PUBLIC, pathname));
  const relative = path.relative(PUBLIC, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (error, buffer) => {
    if (error) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Not Found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buffer);
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log('沙丘：帝国 联机版已启动');
  for (const name of ['alice', 'bob', 'carol']) console.log('  ' + name + '：http://' + name + '.localhost:' + PORT + '/board-games/index.html');
});
