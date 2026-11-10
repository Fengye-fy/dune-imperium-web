/* 桌游栏目前端：大厅、等待室、《沙丘：帝国》游戏桌。
 * 这里只负责画和提交命令；抽牌、扣资源、计分、回合推进全部由服务器裁决，
 * 每次成功后用服务器返回的整份 room 替换本地状态。 */

const $app = document.getElementById('app');
const $toast = document.getElementById('toast');
const Auth = window.Auth;

/* ---------- 小工具 ---------- */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const P = d => '<path d="' + d + '"/>';
const ICONS = {
  spice: P('M12 3l6 9-6 9-6-9z') + P('M12 8.5l2.3 3.5-2.3 3.5L9.7 12z'),
  solari: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/>',
  water: P('M12 3c3.5 4.5 6 7.6 6 11a6 6 0 01-12 0c0-3.4 2.5-6.5 6-11z'),
  troops: P('M12 3l8 4.5v9L12 21l-8-4.5v-9z') + P('M4 7.5l8 4.5 8-4.5M12 12v9'),
  swords: P('M5 4l11 11M19 4L8 15M14 17l3-3M10 17l-3-3M16.5 16.5L20 20M7.5 16.5L4 20'),
  persuasion: P('M4 5h16v11H10l-4 4v-4H4z'),
  vp: P('M12 3l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 16.9 6.6 19.8l1.1-6.1L3.2 9.4l6.1-.8z'),
  draw: '<rect x="6" y="3" width="12" height="18" rx="2"/>' + P('M9.5 8h5M9.5 12h5'),
  intrigue: P('M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z') + '<circle cx="12" cy="12" r="2.6"/>',
  agent: '<circle cx="12" cy="7" r="3.2"/>' + P('M6.5 20.5c0-4.6 2.2-7.5 5.5-7.5s5.5 2.9 5.5 7.5z'),
  flag: P('M6 21V4M6 5h11l-2.5 3.5L17 12H6'),
  emperor: P('M4 19h16M4.5 19L3 8l5.5 4.5L12 5l3.5 7.5L21 8l-1.5 11'),
  'spacing-guild': '<circle cx="12" cy="12" r="3"/><ellipse cx="12" cy="12" rx="9.5" ry="4" transform="rotate(-28 12 12)"/>',
  'bene-gesserit': P('M15.5 3.5a8.5 8.5 0 100 17 7 7 0 010-17z'),
  fremen: P('M3 16.5c3-4 6-4 9 0s6 4 9 0M3 10.5c3-4 6-4 9 0s6 4 9 0'),
  landsraad: P('M4 9l8-5 8 5zM6.5 9v8M10.5 9v8M13.5 9v8M17.5 9v8M4 20h16'),
  city: P('M4 20V11l5-3v12M9 20V4l6 3v13M15 20v-8l5 2v6M3 20h18'),
  'spice-trade': P('M3 19l9-14 9 14zM8.5 19l3.5-5.5 3.5 5.5'),
  back: P('M15 5l-7 7 7 7'),
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/>' + P('M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2'),
  crown: P('M4 18h16M4.5 18L3 8l5.5 4.5L12 5l3.5 7.5L21 8l-1.5 10'),
};
function icon(name, cls) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('class', 'i i-' + name + (cls ? ' ' + cls : ''));
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = ICONS[name] || '';   // 只放上面写死的常量
  return el;
}
const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join(''));
let toastTimer;
function toast(text, kind) {
  $toast.textContent = text;
  $toast.className = 'on' + (kind ? ' ' + kind : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $toast.className = ''; }, 3600);
}

/* ---------- 文案 ---------- */
const ICON_NAME = { emperor: '皇帝', 'spacing-guild': '宇航公会', 'bene-gesserit': '贝尼·杰瑟里特', fremen: '弗雷曼',
  landsraad: '兰兹拉德', city: '城镇', 'spice-trade': '香料贸易' };
const RES_NAME = { spice: '香料', solari: '索拉里', water: '水', troops: '部队', draw: '抽牌', intrigue: '阴谋牌',
  vp: '胜利点', swords: '剑', persuasion: '说服力' };
const PHASE = { 'leader-selection': '选择领袖', 'leader-setup': '领袖准备', 'agent-end': '特工回合收尾', 'effect-choice': '效果选择', 'combat-rewards': '战斗奖励', 'combat-win': '胜者阴谋', 'combat-end': '战后窗口', 'round-start': '轮初 · 防守', 'player-turns': '特工回合', 'agent-choice': '结算选择', reveal: '揭示与购买',
  combat: '战斗', endgame: '终局阴谋', finished: '对局结束' };
const TIMING = { plot: '谋划', combat: '战斗', 'combat-win': '获胜时', endgame: '终局' };
const STATUS = { waiting: '等待中', playing: '进行中', finished: '已结束', closed: '已关闭' };
const SEATS = ['#f2d37c', '#6fe0d0', '#ff8e7a', '#b79cff'];
const GROUPS = ['emperor', 'spacing-guild', 'bene-gesserit', 'fremen', 'landsraad', 'city', 'spice-trade'];

/* ---------- 状态 ---------- */
const S = {
  api: null, me: null, games: [], catalogs: {}, assets: {}, rooms: [], room: null, route: { name: 'lobby' },
  sel: { card: null, space: null, pick: {}, intrigue: null }, arm: null, busy: false, retry: null, offline: false,
  joinPrompt: null, missing: null, tab: 'board', cardSet: 'base', planIndex: 0, timer: 0, ctl: null, creating: null, showLimits: false,
};
const cat = () => S.catalogs[(S.room && S.room.gameId) || S.route.gameId];
const seatColor = id => {
  const list = (S.room.game ? S.room.game.players : S.room.players);
  return SEATS[Math.max(0, list.findIndex(p => p.id === id)) % SEATS.length];
};
const pname = id => {
  const p = S.room.players.find(x => x.id === id) || (S.room.game && S.room.game.players.find(x => x.id === id));
  return p ? p.name : '？';
};
const spaceDef = id => ((S.room && S.room.game && S.room.game.spaces) || cat().spaces).find(s => s.id === id);

/* ---------- 图片 ----------
   卡面走 ASSETS.md 的本地静态清单：每个游戏只读一次，不跟着轮询重读；清单里没有的退回文字卡牌。
   封面和棋盘分区背景是界面插画，放在 /board-games/img/，分区背景由 CSS 引用。 */
const COVER = { 'dune-imperium': '/board-games/img/cover.v1.webp' };
const failedFaces = new Set();
let faceRender = 0;
const gameIdNow = () => (S.room && S.room.gameId) || S.route.gameId;
function faceInfo(key, hidden) {
  const assets = S.assets[gameIdNow()];
  const info = assets ? assets.imageFor(key, { hidden: !!hidden }) : null;
  return info && !info.placeholder && !failedFaces.has(info.src) ? info : null;
}
function faceImg(key, cls) {
  const info = faceInfo(key);
  if (!info) return null;
  const el = h('img', { class: cls || 'c-face', src: info.src, width: info.width, height: info.height, alt: info.alt || '', loading: 'lazy', decoding: 'async' });
  el.addEventListener('error', () => {
    failedFaces.add(info.src);
    // 同一帧的多张缺图只重画一次；后续轮询也继续使用文字卡牌。
    if (!faceRender) faceRender = requestAnimationFrame(() => { faceRender = 0; render(); });
  }, { once: true });
  return el;
}
/* 悬停预览（有鼠标的设备）和点开放大（触屏也能用） */
const $peek = document.body.appendChild(document.createElement('img'));
$peek.id = 'peek'; $peek.alt = '';
function hidePeek() { $peek.className = ''; }
function showPeek(el) {
  const info = faceInfo(el.dataset.peek);
  if (!info || !matchMedia('(hover:hover)').matches) return hidePeek();
  const ratio = info.width / info.height, box = el.getBoundingClientRect();
  let hh = Math.min(470, innerHeight - 24), ww = hh * ratio;
  if (ww > 560) { ww = 560; hh = ww / ratio; }
  let left = box.right + 12;
  if (left + ww > innerWidth - 8) left = box.left - ww - 12;
  if (left < 8) left = Math.max(8, Math.min(innerWidth - ww - 8, box.left + box.width / 2 - ww / 2));
  let top = box.top + box.height / 2 - hh / 2;
  if (left < box.right && left + ww > box.left) top = box.top - hh - 10;   // 两侧都放不下：放到上方
  top = Math.max(8, Math.min(innerHeight - hh - 8, top));
  if ($peek.getAttribute('src') !== info.src) $peek.src = info.src;
  $peek.style.cssText = 'left:' + left + 'px;top:' + top + 'px;width:' + ww + 'px;height:' + hh + 'px';
  $peek.className = 'on';
}
$app.addEventListener('mouseover', e => { const el = e.target.closest('[data-peek]'); if (el) showPeek(el); else hidePeek(); });
$app.addEventListener('mouseleave', hidePeek);
const $zoom = document.body.appendChild(h('div', { id: 'zoom', role: 'dialog', 'aria-label': '查看卡牌', onclick: () => closeZoom() }));
function closeZoom() { $zoom.className = ''; $zoom.replaceChildren(); }
function openZoom(key, title, sub) {
  const info = faceInfo(key);
  if (!info) return;
  hidePeek();
  $zoom.replaceChildren(h('img', { src: info.src, width: info.width, height: info.height, alt: info.alt || title || '' }),
    h('p', null, title || '', sub ? h('span', null, sub) : null), h('button', { class: 'btn ghost sm', type: 'button' }, '关闭'));
  $zoom.className = 'on';
  $zoom.querySelector('button').focus();
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeZoom(); });

/* ---------- 请求 ---------- */
let navigation = 0;
function navigationGuard() {
  const version = navigation, hash = location.hash;
  return () => version === navigation && hash === location.hash;
}
function accept(room) {
  if (S.route.name !== 'room' || S.route.id !== room.id ||
      location.hash.toUpperCase() !== ('#/room/' + room.id).toUpperCase()) return false;
  if (S.room && room.id === S.room.id && room.version < S.room.version) return false;   // 倒序到达的旧快照不要
  const changed = !S.room || room.id !== S.room.id || room.version !== S.room.version;
  S.room = room;
  if (changed && room.game?.pending?.options?.some(o => ['research', 'shipping', 'shipping-reward', 'tech'].includes(o.ui?.kind))) S.tab = 'lab';
  if (changed) { S.sel = { card: null, space: null, pick: {}, intrigue: null }; S.arm = null; }
  return changed;
}
async function ensureCatalog(gameId) {
  if (!S.catalogs[gameId]) S.catalogs[gameId] = (await S.api.catalog(gameId)).catalog;
}
/* op(room, requestId)：超时重试要用同一个 room 和 requestId，所以两样都留在 S.retry 里 */
async function run(op, saved, onSuccess) {
  if (S.busy) return;
  const current = navigationGuard();
  const job = saved || { op, room: S.room, rid: uuid(), onSuccess };
  S.busy = true; S.retry = null; S.arm = null; render();
  try {
    const r = await job.op(job.room, job.rid);
    if (!current()) return;
    if (r && r.room) {
      await ensureCatalog(r.room.gameId);
      if (!current()) return;
      if (job.onSuccess) job.onSuccess(r);
      if (!current()) return;
      accept(r.room);
      S.sel = { card: null, space: null, pick: {}, intrigue: null };
    }
    else if (r && r.room === null) { S.room = null; location.hash = '#/'; }
  } catch (e) {
    if (!current()) return;
    if (e && e.code) {
      if (e.code === 'VERSION_CONFLICT') { toast('局面已经更新，请重新选择', 'warn'); await refresh(); }
      else if (e.status === 401) { S.me = { name: null }; toast('登录已失效，请重新登录', 'warn'); }
      else toast(e.message, 'bad');
    } else { S.retry = job; toast('网络不稳，这一步还没确认，可以点「重试」', 'warn'); }
  } finally { S.busy = false; render(); schedule(); }
}
async function refresh() {
  if (!S.room) return;
  const current = navigationGuard(), id = S.room.id;
  try { const { room } = await S.api.room(id); if (current()) accept(room); } catch (e) { /* 下一次轮询再试 */ }
}
function schedule() {
  clearTimeout(S.timer);
  if (document.hidden) return;
  if (S.route.name === 'room' && S.room && ['waiting', 'playing'].includes(S.room.status)) S.timer = setTimeout(poll, 2000);
  else if (S.route.name === 'lobby' && S.me && S.me.name) S.timer = setTimeout(pollLobby, 5000);
}
async function poll() {
  if (S.busy || !S.room) return schedule();
  const current = navigationGuard();
  const ctl = S.ctl = new AbortController();
  try {
    const { room } = await S.api.room(S.room.id, { signal: ctl.signal });
    if (!current() || ctl.signal.aborted || !S.room || room.id !== S.room.id) return;
    const was = S.offline; S.offline = false;
    if (accept(room) || was) render();
  } catch (e) {
    if (!current() || ctl.signal.aborted || e.name === 'AbortError') return;
    if (e.status === 403 || e.status === 404) { toast('你已不在这个房间', 'warn'); location.hash = '#/'; return; }
    if (!S.offline) { S.offline = true; render(); }
  }
  schedule();
}
async function pollLobby() {
  const current = navigationGuard();
  try { const { rooms } = await S.api.rooms(); if (!current()) return; S.rooms = rooms; paintRoomList(); } catch (e) { /* 忽略 */ }
  if (!current()) return;
  schedule();
}
function stopPolling() { clearTimeout(S.timer); if (S.ctl) S.ctl.abort(); }

/* ---------- 路由 ---------- */
async function go() {
  navigation++;
  const current = navigationGuard();
  stopPolling();
  closeZoom();
  const m = /^#\/room\/([A-Fa-f0-9]{12})$/.exec(location.hash);
  S.sel = { card: null, space: null, pick: {}, intrigue: null }; S.retry = null; S.joinPrompt = null; S.missing = null; S.offline = false;
  if (m) {
    S.route = { name: 'room', id: m[1].toUpperCase() };
    if (!S.room || S.room.id !== S.route.id) S.room = null;
    render();
    if (!S.me || !S.me.name) return;
    try {
      const { room } = await S.api.room(S.route.id);
      if (!current()) return;
      await ensureCatalog(room.gameId);
      if (!current()) return;
      accept(room);
    } catch (e) {
      if (!current()) return;
      if (e.code === 'NOT_A_MEMBER') S.joinPrompt = S.route.id;
      else if (e.status === 401) S.me = { name: null };
      else S.missing = e.message || '房间打不开';
    }
  } else if (location.hash.startsWith('#/cards/')) {
    S.route = { name: 'cards', gameId: location.hash.slice(8) }; S.room = null;
    render();
    try { await ensureCatalog(S.route.gameId); } catch (e) { if (current()) S.missing = '没有这款游戏的图鉴'; }
  } else {
    S.route = { name: 'lobby' }; S.room = null;
    if (S.me && S.me.name) { try { const { rooms } = await S.api.rooms(); if (current()) S.rooms = rooms; } catch (e) { if (current()) S.rooms = []; } }
  }
  if (!current()) return;
  render(); schedule();
}

/* ---------- 通用部件 ---------- */
function armBtn(key, label, sure, fn, cls) {
  const armed = S.arm === key;
  return h('button', { class: 'btn ' + (armed ? 'danger' : cls || 'ghost'), disabled: S.busy, onclick: () => {
    if (armed) return fn();
    S.arm = key; render();
    setTimeout(() => { if (S.arm === key) { S.arm = null; render(); } }, 4000);
  } }, armed ? sure : label);
}
function token(id, big) {
  const name = pname(id);
  return h('span', { class: 'tok' + (big ? ' big' : ''), style: '--seat:' + seatColor(id), title: name }, [...name][0] || '?');
}
function chip(name, n, title) {
  return h('span', { class: 'chip r-' + name, title: (title || RES_NAME[name] || '') + (n != null ? ' ' + n : '') }, icon(name), n != null ? h('b', null, n) : null);
}
function note(text) { return h('span', { class: 'fx-note' }, text); }
/* 服务器文案里的势力是英文 ID，显示时换成中文名 */
function zh(text) {
  let out = String(text);
  for (const id of ['spacing-guild', 'bene-gesserit', 'emperor', 'fremen']) out = out.split(id).join(ICON_NAME[id]);
  return out;
}
/* 把服务器的效果对象画成图标。只认简单字段；复杂效果只提示「详见卡面」，不替它编含义 */
const SIMPLE = ['vp', 'solari', 'spice', 'water', 'troops', 'draw', 'intrigue', 'persuasion', 'swords'];
const NOTES = {
  stealIntrigue: '对手有 4 张以上阴谋牌时偷 1 张', selectiveBreeding: '可销毁 1 张牌，然后抽 2 张',
  sellMelange: '卖 2–5 香料，得 香料×2+2 索拉里', highCouncil: '议会席位：之后每次揭示 +2 说服力',
  swordmaster: '永久多 1 名特工', mentat: '本轮多 1 名特工', trashSelf: '销毁此牌',
};
/* 扩展目录里的效果字段：只用于设置预览的文字说明 */
const COUNTED = { research: n => '研究 +' + n, specimens: n => '标本 +' + n, tleilaxu: n => '特莱拉轨 +' + n, shipping: n => '运输轨推进 ' + n, negotiators: n => '派 ' + n + ' 名谈判员', commissionDreadnought: n => '建造 ' + n + ' 艘无畏舰',
  acquireTech: v => '获取科技' + (v && v.discount ? '（少付 ' + v.discount + ' 香料）' : '') };
function effectChips(e, sign) {
  const out = [], s = sign === undefined ? '+' : sign;
  let other = false;
  const walk = x => {
    for (const [k, v] of Object.entries(x || {})) {
      if (SIMPLE.includes(k)) { if (v) out.push(chip(k, s + v)); }
      else if (k === 'cost') out.push(h('span', { class: 'fx-cost' }, h('i', null, '付'), SIMPLE.filter(r => v[r]).map(r => chip(r, v[r]))));
      else if (k === 'steps') v.forEach(walk);
      else if (k === 'choice') v.forEach(o => out.push(note(zh(o.label))));
      else if (k === 'influence') for (const [f, n] of Object.entries(v)) out.push(note(ICON_NAME[f] + ' 影响力 ' + (n > 0 ? '+' : '') + n));
      else if (k === 'chooseInfluence') out.push(note('任选势力影响力 +' + v.amount));
      else if (k === 'control') out.push(h('span', { class: 'chip r-flag', title: '控制权' }, icon('flag'), h('b', null, spaceDef(v) ? spaceDef(v).name : v)));
      else if (k === 'reserve') out.push(note('获得「' + (cat().cards[v] ? cat().cards[v].name : v) + '」'));
      else if (NOTES[k]) { if (v) out.push(note(NOTES[k])); }
      else if (COUNTED[k]) out.push(note(COUNTED[k](v)));
      else if (k !== 'optional') other = true;
    }
  };
  walk(e);
  if (other) out.push(note('效果详见卡面'));
  return out;
}
function devTag() { return h('span', { class: 'dev', title: '开发版自定义测试内容，不是原版卡牌' }, '测试牌'); }
const timingText = t => (Array.isArray(t) ? t : [t]).map(x => TIMING[x] || x).join(' / ');

/* 一张牌：清单里有卡面就整张显示（悬停预览、可点开放大），没有就用 catalog 的文字画 */
function cardEl(def, o = {}) {
  const face = faceImg(def.id), lead = (def.icons && def.icons[0]) || 'none';
  let inner;
  if (face) inner = [face, h('span', { class: 'c-cap' }, def.name)];
  else if (o.kind === 'intrigue') inner = [
    h('div', { class: 'c-head' }, h('span', { class: 'c-name' }, def.name)),
    h('div', { class: 'c-row' }, h('i', null, timingText(def.timing)), effectChips(def.effect))];
  else inner = [
    h('div', { class: 'c-art' }, icon(def.icons[0] || 'draw')),
    h('div', { class: 'c-head' }, h('span', { class: 'c-name' }, def.name), def.cost != null ? h('span', { class: 'c-cost', title: '购买需要的说服力' }, def.cost) : null),
    h('div', { class: 'c-icons' }, def.icons.length ? def.icons.map(i => h('span', { class: 'ic g-' + i, title: '可派往：' + ICON_NAME[i] }, icon(i))) : h('span', { class: 'c-none' }, '不能派遣')),
    Object.keys(def.agent).length ? h('div', { class: 'c-row' }, h('i', null, '特工'), effectChips(def.agent)) : null,
    Object.keys(def.reveal).length ? h('div', { class: 'c-row' }, h('i', null, '揭示'), effectChips(def.reveal)) : null,
    def.acquire ? h('div', { class: 'c-row' }, h('i', null, '购得'), effectChips(def.acquire)) : null];
  const main = o.onclick ? h('button', { class: 'c-main', type: 'button', disabled: o.disabled, 'aria-pressed': o.sel ? 'true' : null, onclick: o.onclick }, inner)
    : h('div', { class: 'c-main' }, inner);
  return h('div', { class: 'card g-' + lead + (face ? ' pic' : '') + (o.kind === 'intrigue' ? ' intr' : '') + (o.sel ? ' sel' : '') + (o.can ? ' can' : '') + (o.dim ? ' dim' : '') + (o.cls ? ' ' + o.cls : ''),
    'data-peek': face ? def.id : null }, main,
    face ? h('button', { class: 'c-zoom', type: 'button', 'aria-label': '放大查看 ' + def.name, title: '放大', onclick: () => openZoom(def.id, def.name) }, '⤢') : null,
    def.developmentOnly ? devTag() : null, o.foot || null);
}
const rulesetLabel = id => (id === 'expansions-dev-v4' ? '扩展开发版' : id === 'base-dev-v3' ? '基础版开发版' : id === 'base-subset-v2' ? '基础版子集' : '核心开发版');
function limitsBox(game, open, ruleset) {
  return h('details', { class: 'limits', open: open || null },
    h('summary', null, h('span', { class: 'badge warn' }, rulesetLabel(ruleset || game.ruleset)), ' ' + (ruleset || game.ruleset) + ' · 开发中、尚未验收，点开看限制'),
    h('ul', null, game.limitations.map(t => h('li', null, t))),
    h('p', { class: 'src' }, '规则来源：', (game.sources || []).map(s => h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, s.title))));
}
function topbar(...right) {
  return h('header', { class: 'top' },
    h('a', { class: 'top-back', href: S.route.name === 'lobby' ? '/#/games' : '#/' }, icon('back'), S.route.name === 'lobby' ? 'fengye' : '桌游大厅'),
    h('div', { class: 'top-right' }, right,
      S.me && S.me.name ? h('span', { class: 'who' }, S.me.name) : h('button', { class: 'btn sm', onclick: () => Auth.login() }, '登录')));
}
function loginCard(text) {
  return h('div', { class: 'panel center' }, h('p', null, text), h('button', { class: 'btn', onclick: () => Auth.login() }, '去登录'),
    h('button', { class: 'btn ghost', onclick: () => Auth.register() }, '注册'));
}

/* ---------- 大厅 ---------- */
function roomRow(r) {
  const game = S.games.find(g => g.id === r.gameId);
  return h('a', { class: 'room-row', href: '#/room/' + r.id },
    h('span', { class: 'rr-name' }, r.name || '未命名房间'),
    h('span', { class: 'rr-game' }, game ? game.name : r.gameId),
    h('span', { class: 'rr-who' }, r.players.map(p => p.name).join('、')),
    h('span', { class: 'rr-n' }, r.players.length + ' / ' + r.capacity),
    h('span', { class: 'badge s-' + r.status }, STATUS[r.status] || r.status),
    h('span', { class: 'rr-go' }, '进入 →'));
}
function paintRoomList() {
  const box = document.getElementById('roomList');
  if (!box) return;
  const live = S.rooms.filter(r => r.status === 'waiting' || r.status === 'playing');
  const past = S.rooms.filter(r => r.status !== 'waiting' && r.status !== 'playing').slice(0, 8);
  box.replaceChildren(
    live.length ? h('div', { class: 'rooms' }, live.map(roomRow)) : h('p', { class: 'empty' }, '还没有房间。开一间，把邀请链接发给朋友。'),
    past.length ? h('details', { class: 'past', 'data-d': 'past' }, h('summary', null, '已结束的房间（' + past.length + '）'), h('div', { class: 'rooms' }, past.map(roomRow))) : null);
}
function createForm(game) {
  const c = S.creating;
  const name = h('input', { type: 'text', maxlength: '40', placeholder: '比如：周末沙丘', value: c.name, 'aria-label': '房间名' });
  name.addEventListener('input', () => { c.name = name.value; });
  /* 扩展只按后端 supportedExpansions 开放；目录里有但没开放的，列出来说明状态，不能选 */
  const offered = game.expansionCatalog || [], supported = game.supportedExpansions || [];
  const pick = (key, value, label) => h('button', { type: 'button', class: 'seg' + (c[key] === value ? ' on' : ''), 'aria-pressed': String(c[key] === value),
    onclick: () => { c[key] = value; render(); } }, label);
  return h('form', { class: 'create', onsubmit: ev => {
    ev.preventDefault();
    if (S.busy || S.retry) return;
    const settings = { gameId: game.id, capacity: c.capacity, visibility: c.visibility, ...(c.name.trim() ? { name: c.name.trim() } : {}),
      ...(c.expansions.length ? { options: { expansions: offered.map(x => x.id).filter(id => c.expansions.includes(id)) } } : {}) };
    run((room, rid) => S.api.create(settings, { requestId: rid }), null,
      r => { S.creating = null; location.hash = '#/room/' + r.room.id; });
  } },
    h('label', null, '房间名', name),
    h('div', { class: 'field' }, h('span', null, '人数'), h('div', { class: 'segs' },
      Array.from({ length: game.maxPlayers - game.minPlayers + 1 }, (_, i) => pick('capacity', game.minPlayers + i, (game.minPlayers + i) + ' 人')))),
    h('div', { class: 'field' }, h('span', null, '可见'), h('div', { class: 'segs' }, pick('visibility', 'private', '私密 · 凭链接'), pick('visibility', 'public', '公开 · 大厅可见'))),
    offered.length ? h('div', { class: 'field' }, h('span', null, '扩展'), h('div', { class: 'segs' }, offered.map(x => {
      const ok = supported.includes(x.id), on = c.expansions.includes(x.id);
      return h('button', { type: 'button', class: 'seg' + (on ? ' on' : '') + (ok ? '' : ' off'), 'aria-pressed': String(on), 'aria-disabled': String(!ok), title: ok ? null : '后端还没开放这款扩展',
        onclick: () => {
          if (!ok) return toast(x.name + ' 还没开放：后端只完成了牌库和机制库', 'warn');
          c.expansions = on ? c.expansions.filter(id => id !== x.id) : [...c.expansions, x.id]; render();
        } }, x.name + (ok ? '' : ' · 未开放')); }))) : null,
    h('div', { class: 'acts' }, h('button', { class: 'btn', type: 'submit', disabled: S.busy || !!S.retry }, '创建房间'),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => { S.creating = null; render(); } }, '取消')));
}
function viewLobby() {
  const signed = S.me && S.me.name;
  const join = h('input', { type: 'text', maxlength: '12', placeholder: '12 位房间号', 'aria-label': '房间号', autocomplete: 'off', spellcheck: 'false' });
  return [
    topbar(),
    h('section', { class: 'hero' },
      h('p', { class: 'eyebrow' }, 'Board Games'), h('h1', null, '桌游'),
      h('p', { class: 'lead' }, '开一间房，把链接发给朋友。规则由服务器裁决，刷新不掉线。')),
    h('section', { class: 'wrap' },
      retryBar(),
      h('h2', null, '游戏'),
      h('div', { class: 'games' }, S.games.map(g => h('article', { class: 'game' },
        h('div', { class: 'game-art' }, COVER[g.id] ? h('img', { src: COVER[g.id], alt: '', width: 1600, height: 1067 }) : icon('spice-trade')),
        h('div', { class: 'game-body' },
          h('p', { class: 'eyebrow' }, g.englishName || ''),
          h('h3', null, g.name, g.status === 'experimental' ? h('span', { class: 'badge warn' }, rulesetLabel(g.ruleset)) : null),
          h('p', { class: 'meta' }, g.minPlayers + '–' + g.maxPlayers + ' 人 · 真人联机'),
          h('p', null, g.description),
          limitsBox(g),
          S.creating && S.creating.gameId === g.id ? createForm(g)
            : h('div', { class: 'acts' }, signed
              ? h('button', { class: 'btn', onclick: () => { S.creating = { gameId: g.id, name: '', capacity: g.maxPlayers, visibility: 'private', expansions: [] }; render(); } }, '开一间房')
              : h('button', { class: 'btn', onclick: () => Auth.login() }, '登录后开房'),
              h('a', { class: 'btn ghost', href: '#/cards/' + g.id }, '图鉴与扩展预览')))))),
      signed ? [
        h('div', { class: 'h2row' }, h('h2', null, '房间'),
          h('form', { class: 'joinbox', onsubmit: ev => {
            ev.preventDefault();
            const id = join.value.trim().toUpperCase();
            if (!/^[A-F0-9]{12}$/.test(id)) return toast('房间号是 12 位字母数字', 'warn');
            location.hash = '#/room/' + id;
          } }, join, h('button', { class: 'btn ghost sm', type: 'submit' }, '凭房间号进入'))),
        h('div', { id: 'roomList' }),
      ] : loginCard('登录后可以开房间、加入朋友的房间。')),
  ];
}

/* ---------- 等待室 ---------- */
function inviteUrl() { return location.origin + location.pathname + '#/room/' + S.room.id; }
function copyInvite() {
  const url = inviteUrl();
  (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(url) : Promise.reject())
    .then(() => toast('邀请链接已复制'), () => { window.prompt('复制这条邀请链接', url); });
}
function viewWaiting() {
  const r = S.room, game = cat().manifest, me = r.players.find(p => p.id === r.viewerPlayerId), host = r.hostPlayerId === r.viewerPlayerId;
  const allReady = r.players.every(p => p.ready), enough = r.players.length >= game.minPlayers;
  const why = !enough ? '至少 ' + game.minPlayers + ' 人才能开始，还差 ' + (game.minPlayers - r.players.length) + ' 人' : !allReady ? '还有人没准备（房主也要准备）' : '人齐了，可以开始';
  return [
    topbar(),
    h('section', { class: 'wrap narrow' },
      h('p', { class: 'eyebrow' }, game.name + ' · 等待室'),
      h('h1', { class: 'room-title' }, r.name || '未命名房间'),
      h('div', { class: 'invite' },
        h('span', { class: 'mono' }, r.id), h('span', { class: 'badge' }, r.visibility === 'public' ? '公开' : '私密'),
        h('button', { class: 'btn ghost sm', onclick: copyInvite }, icon('copy'), '复制邀请链接')),
      h('p', { class: 'hint' }, '拿到链接的登录用户都能加入，只发给同桌的人。配置：' + configLabel(cat(), r.options) + '。'),
      limitsBox(game, true, r.ruleset),
      h('div', { class: 'seats' }, Array.from({ length: r.capacity }, (_, i) => {
        const p = r.players[i];
        return p ? h('div', { class: 'seat' + (p.ready ? ' ready' : '') }, token(p.id, true),
          h('span', { class: 'seat-name' }, p.name, p.id === r.viewerPlayerId ? h('em', null, '（我）') : null),
          p.id === r.hostPlayerId ? h('span', { class: 'badge' }, '房主') : null,
          h('span', { class: 'seat-st' }, p.ready ? '已准备' : '未准备'))
          : h('div', { class: 'seat empty' }, h('span', { class: 'tok big ghost' }, '+'), h('span', { class: 'seat-name' }, i < game.minPlayers ? '等待加入' : '空位（可不坐满）'));
      })),
      h('p', { class: 'status-line' }, r.players.length + ' / ' + r.capacity + ' 人 · ' + why),
      h('div', { class: 'acts' },
        h('button', { class: 'btn' + (me.ready ? ' ghost' : ''), disabled: S.busy, onclick: () => run((room, rid) => S.api.ready(room, !me.ready, { requestId: rid })) }, me.ready ? '取消准备' : '准备'),
        host ? h('button', { class: 'btn', disabled: S.busy || !enough || !allReady, onclick: () => run((room, rid) => S.api.start(room, { requestId: rid })) }, '开始游戏') : null,
        armBtn('leave', '离开房间', '确定离开？', () => run((room, rid) => S.api.leave(room, { requestId: rid }))),
        host ? armBtn('close', '关闭房间', '关闭后所有人都进不来，确定？', () => run((room, rid) => S.api.close(room, { requestId: rid }))) : null),
      retryBar()),
  ];
}
function retryBar() {
  return [
    S.retry ? h('div', { class: 'retry' }, '上一步没收到服务器回应。', h('button', { class: 'btn sm', onclick: () => run(null, S.retry) }, '重试'),
      h('button', { class: 'btn ghost sm', disabled: S.busy, onclick: () => {
        S.retry = null;
        (S.route.name === 'lobby' ? pollLobby() : refresh()).then(render);
      } }, '放弃并刷新')) : null,
    S.offline ? h('div', { class: 'retry' }, '连接不稳，正在重连…') : null,
  ];
}

/* ---------- 游戏桌 ---------- */
const act = action => run((room, rid) => S.api.act(room, action, { requestId: rid }));
const legal = type => S.room.legalActions.filter(a => a.type === type);
const cardName = x => { const c = cat(); const d = x && (c.cards[x.cardId] || c.intrigues[x.cardId]); return d ? d.name : '一张牌'; };
const ORDER_WORD = { card: '卡牌', space: '行动格', influence: '影响力' };
const orderText = o => (o === 'space-first' ? '先行动格，再卡牌' : o.split('-').map(w => ORDER_WORD[w] || w).join(' → '));

// These controls only submit current server-issued option indices.
function boardChoices(kind) {
  if (!S.room || S.room.status !== 'playing') return [];
  const allowed = new Set(legal('chooseEffect').map(a => a.option));
  return (S.room.game.pending?.options || []).filter(o => o.ui?.kind === kind && allowed.has(o.option));
}
function chooseBoardOption(o) {
  if (S.busy || !boardChoices(o.ui.kind).some(now => now === o)) return;
  act({ type: 'chooseEffect', option: o.option });
}
function shippingTrack(ix, players, interactive = true) {
  const moves = interactive ? boardChoices('shipping') : [], rewards = interactive ? boardChoices('shipping-reward') : [];
  const mine = ix?.players.find(p => p.playerId === S.room?.viewerPlayerId);
  return h('div', { class: 'shipping-track', 'aria-label': '运输轨' },
    [3, 2, 1, 0].map(level => {
      const move = moves.find(o => o.ui.movement === (level === 0 ? 'recall' : 'advance') && (level === 0 || level === mine?.shipping + 1));
      return h('div', { class: 'shipping-level' },
        h('button', { type: 'button', class: 'shipping-stop' + (move ? ' available' : ''), disabled: !move || S.busy,
          onclick: () => chooseBoardOption(move) },
          h('b', null, level === 0 ? '召回 / 起点' : '第 ' + level + ' 级'),
          h('span', null, ['召回领取累计奖励', '5 索拉里（对手各 1）或 2 香料', '招募部队并提升影响力', '获取科技，折扣 2 香料'][level]),
          (ix?.players || []).filter(p => p.shipping === level).map(p => h('span', { class: 'badge' }, players.find(x => x.id === p.playerId)?.name || '玩家'))),
        rewards.filter(o => o.ui.level === level).map(o => h('button', { class: 'btn sm', disabled: S.busy, onclick: () => chooseBoardOption(o) }, zh(o.label))));
    }));
}
function ixBoardLayout(spaces, tile, track) {
  const row = ids => h('div', { class: 'ix-spaces' }, ids.map(id => spaces.find(sp => sp.id === id)).filter(Boolean).map(tile));
  return h('div', { class: 'ix-layout' },
    h('div', { class: 'ix-council' }, h('h3', null, '兰兹拉德议会'), row(['high-council']), row(['mentat', 'swordmaster'])),
    h('div', { class: 'ix-shipping' }, h('h3', null, '宇联运输'), row(['interstellar-shipping', 'smuggling']), track),
    h('div', { class: 'ix-sideboard' }, h('h3', null, '伊克斯'), row(['tech-negotiation', 'dreadnought'])));
}
function viewGame() {
  const r = S.room, g = r.game, c = cat(), meId = r.viewerPlayerId, me = g.players.find(p => p.id === meId);
  const myTurn = r.status === 'playing' && g.currentPlayerId === meId;
  const agentActs = legal('agent');
  const inHand = uid => (uid && me.hand && me.hand.some(x => x.uid === uid) ? uid : null);
  const selCard = inHand(S.sel.card), selCard2 = selCard ? inHand(S.sel.card2) : null;
  /* 单张派遣对 cardUid；嫁接是服务器给的 cardUids 两张一组 */
  const fits = a => (selCard2 ? !!a.cardUids && a.cardUids.includes(selCard) && a.cardUids.includes(selCard2) : a.cardUid === selCard && !a.cardUids);
  const selActs = selCard ? agentActs.filter(fits) : [];
  const reach = new Set(selActs.map(a => a.spaceId));
  const partners = new Set(selCard && !selCard2 ? agentActs.filter(a => a.cardUids && a.cardUids.includes(selCard)).flatMap(a => a.cardUids).filter(u => u !== selCard) : []);
  const xs = g.expansionState || {}, ix = xs.ix, imm = xs.immortality;
  const ixOf = id => ix && ix.players.find(p => p.playerId === id), immOf = id => imm && imm.players.find(p => p.playerId === id);
  const spaces = g.spaces || c.spaces;
  /* 服务器给的候选组：每张（或每对）手牌对每个行动格是否合法、原因和实际费用。只有当前玩家自己的手牌才有 */
  const group = selCard && g.agentPlacements ? g.agentPlacements.find(x => (selCard2 ? !!x.cardUids && x.cardUids.includes(selCard) && x.cardUids.includes(selCard2)
    : x.cardUid === selCard && !x.cardUids && !x.graftMarketUid)) : null;
  const placement = id => (group ? group.spaces.filter(x => x.spaceId === id) : []);
  const host = r.hostPlayerId === meId, label = rulesetLabel(r.ruleset);
  const leaders = c.leaders || {};
  const canPlaceNow = myTurn && g.phase === 'player-turns';

  /* 棋盘：v3 用 agentPositions（一格可以有多名特工），旧规则集只有 occupied */
  const occupants = id => (g.agentPositions ? g.agentPositions.filter(a => a.spaceId === id) : g.occupied[id] ? [{ playerId: g.occupied[id] }] : []);
  const costOf = sp => { const hit = placement(sp.id)[0]; return (hit && hit.costs) || (g.effectiveSpaceCosts && g.effectiveSpaceCosts[sp.id]) || sp.cost; };
  /* 选了牌却去不了某格时给个说明。这只是照公开局面做的提示，能不能去始终以服务器的 legalActions 为准 */
  const whyNot = sp => {
    if (g.agentPlacements) { const hit = placement(sp.id).find(x => !x.legal && x.reason); return hit ? hit.reason : '当前无法派遣，请刷新合法动作'; }
    const def = c.cards[me.hand.find(x => x.uid === selCard).cardId], occ = occupants(sp.id);
    if (!def.icons.includes(sp.icon)) return '「' + def.name + '」没有' + (ICON_NAME[sp.icon] || sp.icon) + '图标';
    if ((g.voiceBlocks || []).some(b => b.spaceId === sp.id && b.playerId !== meId)) return '这一格被对手的魅音封锁了';
    if (occ.length) return '已经有 ' + [...new Set(occ.map(a => pname(a.playerId)))].join('、') + ' 的特工';
    if (sp.requirement && me.influence[sp.requirement.faction] < sp.requirement.influence) return '需要' + ICON_NAME[sp.requirement.faction] + '影响力 ' + sp.requirement.influence + '，你只有 ' + me.influence[sp.requirement.faction];
    const lack = Object.entries(costOf(sp)).find(([k, n]) => (me.resources[k] || 0) < n);
    if (lack) return (RES_NAME[lack[0]] || lack[0]) + '不够：要 ' + lack[1] + '，你有 ' + (me.resources[lack[0]] || 0);
    if (sp.id === 'sell-melange' && me.resources.spice < 2) return '至少要有 2 份香料才能出售';
    if (sp.oncePerGame && me[sp.oncePerGame]) return '这项升级你已经拿过了';
    if (me.agentsAvailable <= 0) return '你没有可用的特工了';
    return '服务器没有把它列为这张牌的合法目的地';
  };
  const spaceEl = sp => {
    const occ = occupants(sp.id), can = reach.has(sp.id), ctrl = g.controls[sp.id], bonus = g.bonusSpice[sp.id], cost = costOf(sp);
    const voice = (g.voiceBlocks || []).filter(b => b.spaceId === sp.id);
    const blocked = selCard && canPlaceNow && !can ? whyNot(sp) : null;
    const costs = Object.values(cost).some(Boolean) ? h('div', { class: 'sp-cost' }, h('i', null, '付'), effectChips(cost, '')) : sp.id === 'sell-melange' ? h('div', { class: 'sp-cost' }, h('i', null, '付'), chip('spice', '2–5')) : null;
    return h('button', { type: 'button', class: 'sp' + (can ? ' can' : '') + (blocked ? ' no' : '') + (occ.length ? ' occ' : '') + (S.sel.space === sp.id ? ' sel' : '') + (sp.combat ? ' cb' : ''),
      'aria-disabled': String(!can), style: occ.length ? '--seat:' + seatColor(occ[0].playerId) : null, title: blocked ? '去不了：' + blocked : null,
      'aria-label': sp.name + (occ.length ? '，已有 ' + occ.map(a => pname(a.playerId)).join('、') + ' 的特工' : '') + (blocked ? '，去不了：' + blocked : ''),
      onclick: () => {
        if (S.busy) return;
        if (can) { S.sel.space = sp.id; S.sel.pick = {}; render(); }
        else if (blocked) toast(sp.name + '去不了：' + blocked, 'warn');
        else if (canPlaceNow) toast('先在下面选一张手牌，能去的行动格会亮起来');
      } },
      h('span', { class: 'sp-name' }, sp.name, sp.combat ? h('span', { class: 'sp-cb', title: '战斗格：可部署部队' }, icon('swords')) : null),
      costs,
      sp.requirement ? h('div', { class: 'sp-req' }, '需 ' + ICON_NAME[sp.requirement.faction] + ' 影响力 ' + sp.requirement.influence) : null,
      h('div', { class: 'sp-fx' }, effectChips(sp.effect)),
      sp.revealPersuasion ? h('div', { class: 'sp-req' }, '揭示时 +' + sp.revealPersuasion + ' 说服力') : null,
      sp.oncePerGame ? h('div', { class: 'sp-req' }, '每人每局一次') : null,
      bonus > 0 ? h('div', { class: 'sp-bonus', title: '没人来采时累积的香料' }, chip('spice', '+' + bonus), '累积') : null,
      sp.controlBonus ? h('div', { class: 'sp-ctrl', style: ctrl ? '--seat:' + seatColor(ctrl) : null }, icon('flag'), ctrl ? pname(ctrl) : '无人控制', effectChips(sp.controlBonus)) : null,
      sp.board && sp.board !== 'base' ? h('span', { class: 'sp-new', title: '扩展覆盖板上的行动格' }, sp.overlay === 'immortality' || sp.board === 'research-station-overlay' ? '永生' : '伊克斯') : null,
      voice.length ? h('div', { class: 'sp-voice' }, '魅音封锁 · ' + voice.map(b => pname(b.playerId)).join('、')) : null,
      occ.length ? h('span', { class: 'sp-occ' }, occ.map(a => h('span', { style: '--seat:' + seatColor(a.playerId) }, token(a.playerId), pname(a.playerId), a.kind === 'mentat' ? '（门泰特）' : ''))) : null);
  };
  const track = f => h('div', { class: 'track', title: '影响力：到 2 得 1 胜利点；到 4 得奖励并可争夺同盟' },
    Array.from({ length: 7 }, (_, lv) => h('span', { class: 'tk' + (lv === 2 ? ' m2' : lv === 4 ? ' m4' : '') },
      h('i', null, lv), g.players.filter(p => p.influence[f] === lv && lv > 0).map(p => token(p.id)))));
  const tiles = list => h('div', { class: 'tiles', style: '--n:' + Math.max(1, list.length) }, list.map(spaceEl));
  const head = (ic, text, more) => h('div', { class: 'rg-h g-' + ic }, h('span', { class: 'ic' }, icon(ic)), h('h3', null, text), more || null);
  /* 一张连续的棋盘，照实体棋盘的方位排：左边四个势力，右上议会与宇联公司，中间厄拉科斯，下面冲突和驻军。
     行动格集合取自 catalog：认不出图标的（以后扩展加的格子）单独放一块，不会被漏掉 */
  const spacesBy = f => spaces.filter(f);
  const strangers = spacesBy(sp => !GROUPS.includes(sp.icon));
  const cf = g.conflict ? { ...g.conflict, name: (c.conflicts || []).find(x => x.id === g.conflict.id)?.name || g.conflict.name } : null, maxVp = Math.max(12, ...g.players.map(p => p.vp));
  const rewardLine = (rw, i) => h('li', null, h('i', null, ['第一', '第二', '第三'][i]), effectChips(rw), i === 2 && g.players.length < 4 ? note('（仅 4 人局）') : null);
  const board = h('section', { class: 'board sec sec-board', 'aria-label': '棋盘' },
    h('div', { class: 'region factions' }, c.factions.map(f => h('div', { class: 'frow g-' + f },
      head(f, ICON_NAME[f] || f, [track(f), h('span', { class: 'ally', title: g.alliances[f] ? pname(g.alliances[f]) + ' 持有同盟' : '同盟空缺：影响力到 4 且领先即可取得' }, icon('flag'), g.alliances[f] ? token(g.alliances[f]) : '—',
        h('span', { class: 'ally-b', title: '影响力到 4 的奖励' }, '④', effectChips(c.influenceBonuses[f] || {})))]),
      tiles(spacesBy(sp => sp.icon === f))))),
    h('div', { class: 'region council' }, ix ? ixBoardLayout(spaces, spaceEl, shippingTrack(ix, g.players)) : [
      h('div', { class: 'blk' }, head('landsraad', '兰兹拉德议会'), tiles(spacesBy(sp => sp.icon === 'landsraad'))),
      h('div', { class: 'blk' }, head('spice-trade', '宇联公司'), tiles(spacesBy(sp => sp.icon === 'spice-trade' && !sp.maker)))]),
    h('div', { class: 'region arrakis' },
      h('div', { class: 'blk' }, head('city', '厄拉科斯 · 城镇'), tiles(spacesBy(sp => sp.icon === 'city'))),
      h('div', { class: 'blk' }, head('spice-trade', '沙漠 · 采香料'), tiles(spacesBy(sp => sp.icon === 'spice-trade' && sp.maker)))),
    strangers.length ? h('div', { class: 'region others' }, h('div', { class: 'blk' }, head('agent', '其他行动格'), tiles(strangers))) : null,
    h('div', { class: 'region combat' },
      h('div', { class: 'blk cf-blk' }, head('swords', '冲突', h('span', { class: 'mut' }, '牌堆还剩 ' + g.conflictsRemaining)),
        cf ? h('div', { class: 'cf' },
          faceInfo(cf.id) ? h('button', { class: 'cf-face', type: 'button', 'data-peek': cf.id, 'aria-label': '放大查看 ' + cf.name, onclick: () => openZoom(cf.id, cf.name) }, faceImg(cf.id)) : null,
          h('div', null, h('div', { class: 'cf-name' }, cf.name, h('span', { class: 'badge' }, '等级 ' + 'ⅠⅡⅢ'[cf.level - 1]), cf.developmentOnly ? devTag() : null),
            h('ol', { class: 'rewards' }, cf.rewards.map(rewardLine)))) : h('p', { class: 'mut' }, '第一轮开始后翻出冲突牌。')),
      h('div', { class: 'blk' }, head('troops', '战场与驻军'),
        h('table', { class: 'ftable' }, h('thead', null, h('tr', null, h('th', null, '玩家'), h('th', { title: '可部署到冲突的部队' }, '驻军'), h('th', null, '参战'), ix ? h('th', { title: '无畏舰：驻军 / 参战' }, '舰') : null, h('th', null, '剑'), h('th', { title: '战力 = 参战部队×2 + 剑；没有部队参战则为 0' }, '战力'))),
          h('tbody', null, [...g.players].sort((a, b) => b.strength - a.strength).map(p => h('tr', { class: p.troops.conflict ? 'in' : null },
            h('td', null, token(p.id), ' ' + p.name), h('td', null, p.troops.garrison), h('td', null, p.troops.conflict), ix ? h('td', null, ((ixOf(p.id) || {}).dreadnoughts || {}).garrison + ' / ' + ((ixOf(p.id) || {}).dreadnoughts || {}).conflict) : null, h('td', null, p.swords), h('td', { class: 'f-s' }, p.strength))))),
        g.lastCombat ? h('details', { class: 'last', 'data-d': 'last' }, h('summary', null, '第 ' + g.lastCombat.round + ' 轮战果'),
          g.lastCombat.results.length ? h('ul', { class: 'fight' }, g.lastCombat.results.map(x => h('li', null, token(x.playerId), h('span', { class: 'f-n' }, pname(x.playerId)),
            h('span', { class: 'mut' }, '第 ' + x.place + ' 名' + (x.tied ? '（平）' : '') + ' · 战力 ' + x.strength), x.reward ? effectChips(x.reward) : note('无奖励'))))
            : h('p', { class: 'mut' }, '无人参战。')) : null),
      h('div', { class: 'vp-track', title: '胜利点：有人到 10 分，或冲突牌打完，这一轮结束后进入终局' }, h('span', { class: 'vp-h' }, icon('vp'), '胜利点'),
        Array.from({ length: maxVp + 1 }, (_, n) => h('span', { class: 'vp' + (n === 10 ? ' goal' : '') }, h('i', null, n), g.players.filter(p => p.vp === n).map(p => token(p.id)))))));

  /* 领袖选择（v3 开局） */
  const pickActs = legal('chooseLeader');
  const leaderPick = g.phase === 'leader-selection' ? h('section', { class: 'panel leaders' },
    h('div', { class: 'p-h' }, h('h3', null, icon('crown'), '选择领袖'), h('span', { class: 'mut' }, myTurn ? '轮到你选' : '等待 ' + pname(g.currentPlayerId) + ' 选择')),
    h('div', { class: 'leader-grid' }, Object.values(leaders).filter(ld => !ld.expansion || ((g.options || {}).expansions || []).includes(ld.expansion)).map(ld => {
      const owner = g.players.find(p => p.leaderId === ld.id), a = pickActs.find(x => x.leaderId === ld.id);
      return h('article', { class: 'leader' + (owner ? ' taken' : '') + (a ? ' can' : ''), 'data-peek': faceInfo(ld.id) ? ld.id : null },
        faceImg(ld.id, 'ld-face'),
        h('div', { class: 'ld-body' },
          h('h4', null, ld.name, h('span', { class: 'mut' }, '复杂度 ' + '●'.repeat(ld.complexity))),
          h('p', null, h('i', null, '被动'), ld.passive), h('p', null, h('i', null, '戒指'), ld.signet),
          h('div', { class: 'acts' },
            owner ? h('span', { class: 'ld-owner', style: '--seat:' + seatColor(owner.id) }, token(owner.id), owner.name + ' 已选') : null,
            a ? armBtn('ld:' + ld.id, '选这位', '确定选 ' + ld.name + '？', () => act(a), '') : null,
            faceInfo(ld.id) ? h('button', { class: 'btn ghost sm', type: 'button', onclick: () => openZoom(ld.id, ld.name) }, '看原卡') : null)));
    }))) : null;

  /* 玩家 */
  const names = (list, lookup) => list.map(x => h('span', { 'data-peek': faceInfo(x.cardId) ? x.cardId : null }, (lookup[x.cardId] || {}).name || x.cardId));
  const players = h('section', { class: 'players sec sec-players', 'aria-label': '玩家' }, g.players.map(p => {
    const ld = leaders[p.leaderId], ls = p.leaderState || {}, live = [...(p.activeIntrigues || []), ...(p.resolvingIntrigues || [])];
    return h('div', { class: 'pl' + (p.id === g.currentPlayerId ? ' turn' : '') + (p.id === meId ? ' me' : ''), style: '--seat:' + seatColor(p.id) },
      h('div', { class: 'pl-h' }, token(p.id, true), h('span', { class: 'pl-n' }, p.name, p.id === meId ? h('em', null, '（我）') : null),
        p.id === g.firstPlayerId ? h('span', { class: 'badge', title: '本轮先手' }, '先手') : null,
        h('span', { class: 'pl-vp', title: '胜利点' }, icon('vp'), p.vp)),
      ld ? h('button', { class: 'pl-ld', type: 'button', 'data-peek': faceInfo(ld.id) ? ld.id : null, title: '被动：' + ld.passive + '\n戒指：' + ld.signet,
        onclick: () => openZoom(ld.id, ld.name, '被动：' + ld.passive + ' 戒指：' + ld.signet) }, icon('crown'), ld.name) : null,
      h('div', { class: 'pl-r' }, chip('spice', p.resources.spice), chip('solari', p.resources.solari), chip('water', p.resources.water),
        h('span', { class: 'chip r-agent', title: '可用特工' }, icon('agent'), h('b', null, p.agentsAvailable))),
      h('div', { class: 'pl-t' }, h('span', { title: '驻军：可部署到冲突' }, '驻军 ', h('b', null, p.troops.garrison)), h('span', { title: '已在冲突中' }, '冲突 ', h('b', null, p.troops.conflict)), h('span', { title: '储备：尚未招募' }, '储备 ', h('b', null, p.troops.supply))),
      h('div', { class: 'pl-t' }, h('span', null, '手牌 ', h('b', null, p.handCount)), h('span', null, '牌库 ', h('b', null, p.deckCount)), h('span', null, '弃牌 ', h('b', null, p.discard.length)), h('span', null, '阴谋 ', h('b', null, p.intrigueCount))),
      ix || imm ? h('div', { class: 'pl-t' },
        ix ? [h('span', { title: '无畏舰：驻军 / 参战 / 储备' }, '舰 ', h('b', null, ixOf(p.id).dreadnoughts.garrison + '/' + ixOf(p.id).dreadnoughts.conflict + '/' + ixOf(p.id).dreadnoughts.supply)),
          h('span', null, '谈判员 ', h('b', null, ixOf(p.id).negotiators)), h('span', null, '运输 ', h('b', null, ixOf(p.id).shipping)), h('span', null, '科技 ', h('b', null, ixOf(p.id).tech.length))] : null,
        imm ? [h('span', null, '标本 ', h('b', null, immOf(p.id).specimens)), h('span', null, '基因 ', h('b', null, immOf(p.id).geneticMarker))] : null) : null,
      h('div', { class: 'pl-f' },
        p.swordmaster ? h('span', { class: 'badge' }, '剑术大师') : null, p.highCouncil ? h('span', { class: 'badge' }, '议会席位') : null,
        g.mentatOwner === p.id ? h('span', { class: 'badge' }, '门泰特') : null,
        p.revealed ? h('span', { class: 'badge on' }, '已揭示') : null,
        ls.masterstrokeUsed ? h('span', { class: 'badge' }, '已揭示秘密势力') : null,
        p.persuasion ? chip('persuasion', p.persuasion) : null),
      ls.masterstrokeFactions ? h('div', { class: 'pl-play' }, h('i', null, ls.masterstrokeUsed ? '秘密势力' : '我的秘密势力'), ls.masterstrokeFactions.map(f => h('span', null, ICON_NAME[f] || f))) : null,
      p.deckTop ? h('div', { class: 'pl-play' }, h('i', null, '牌库顶（仅我可见）'), names([p.deckTop], c.cards)) : null,
      p.inPlay.length ? h('div', { class: 'pl-play' }, h('i', null, '场上'), names(p.inPlay, c.cards)) : null,
      live.length ? h('div', { class: 'pl-play' }, h('i', null, '生效阴谋'), names(live, c.intrigues)) : null);
  }));

  /* 市场 */
  const buyActs = legal('buy'), buying = myTurn && buyActs.length > 0 || (myTurn && g.phase === 'reveal');
  const shop = (def, pick, extra) => {
    const a = buyActs.find(b => pick(b) && !b.destination), top = buyActs.find(b => pick(b) && b.destination === 'deck');
    return cardEl(def, { onclick: a ? () => act(a) : null, can: !!a, dim: (buying && !a) || (extra && extra.out), disabled: S.busy,
      foot: [extra && extra.text ? h('span', { class: 'c-left' }, extra.text) : null, a ? h('span', { class: 'c-buy' }, '点牌购买') : null,
        top ? h('button', { class: 'c-alt', type: 'button', disabled: S.busy, onclick: () => act(top) }, '买到牌库顶') : null] });
  };
  /* 特莱拉牌用标本获取，和用说服力买帝国牌分开标注 */
  const tlActs = legal('buyTleilaxu');
  const tlLabel = a => (a.reclaimedChoice === 'troops' ? '获取：征募 2 兵' : a.reclaimedChoice === 'tleilaxu' ? '获取：特莱拉轨 +1' : a.destination === 'deck' ? '获取并置于牌库顶' : '用标本获取');
  const tlShop = (def, acts, tag) => cardEl(def, { can: acts.length > 0, dim: myTurn && tlActs.length > 0 && !acts.length, disabled: S.busy, cls: 'tl',
    foot: [h('span', { class: 'c-left' }, (tag ? tag + ' · ' : '') + '标本 ' + (def.specimenCost != null ? def.specimenCost : '?')),
      acts.map(a => h('button', { class: 'c-alt', type: 'button', disabled: S.busy, onclick: () => act(a) }, tlLabel(a)))] });
  const aside = g.players.flatMap(p => (p.setAsideMarket || []).map(x => ({ x, p })));
  const market = g.market ? h('section', { class: 'panel market sec sec-market' },
    h('div', { class: 'mk-h' }, h('h3', null, icon('draw'), '帝国牌市'), h('span', { class: 'mut' }, '牌堆 ' + g.marketDeckCount),
      myTurn && g.phase === 'reveal' ? h('span', { class: 'mk-p', title: '我现在的说服力' }, chip('persuasion', me.persuasion)) : null),
    h('div', { class: 'cards', 'data-keep': 'market' },
      g.market.map(x => shop(c.cards[x.cardId], b => b.source === 'market' && b.cardUid === x.uid)),
      aside.length ? h('span', { class: 'cards-sep' }, '移出') : null,
      aside.map(({ x, p }) => shop(c.cards[x.cardId], b => b.source === 'set-aside' && b.cardUid === x.uid, { text: p.name + ' 可买' })),
      h('span', { class: 'cards-sep' }, '保留牌'),
      ['arrakis-liaison', 'the-spice-must-flow', 'foldspace'].map(id => shop(c.cards[id], b => b.source === 'reserve' && b.cardId === id,
        { text: '余 ' + g.reserve[id] + (id === 'foldspace' ? ' · 仅行动格获取' : ''), out: !g.reserve[id] })),
      imm ? [h('span', { class: 'cards-sep tl' }, '特莱拉 · 用标本'),
        imm.tleilaxuRow.map(x => tlShop(c.cards[x.cardId], tlActs.filter(a => a.cardUid === x.uid))),
        imm.fixedCard && c.cards[imm.fixedCard] ? tlShop(c.cards[imm.fixedCard], tlActs.filter(a => a.cardId === imm.fixedCard && !a.cardUid), '固定') : null] : null)) : null;

  /* 扩展面板：伊克斯（科技、运输、无畏舰）与永生（研究、特莱拉轨、标本）。只画 game.expansionState 给出的公开状态；
     棋盘交互提交服务器给出的 chooseEffect 索引，不自行计算费用或可达路径 */
  const techDef = id => ((c.expansions || {}).tech || {})[id] || { id, name: id };
  const techId = t => (t && t.techId) || t;
  const techActs = legal('useTech');
  const ixPanel = ix ? h('div', { class: 'region ix' },
    h('div', { class: 'blk' }, head('landsraad', '伊克斯科技', h('span', { class: 'mut' }, '只公开每堆顶上一块')),
      h('div', { class: 'tech-row' }, ix.techStacks.map(st => {
        if (!st.top) return h('div', { class: 'tech empty' }, '这堆已空');
        const choices = boardChoices('tech').filter(o => o.ui.techId === st.top);
        const selected = S.sel.tech === st.top;
        return h('div', { class: 'tech-offer' },
          h('button', { class: 'tech' + (choices.length ? ' available' : '') + (selected ? ' sel' : ''), type: 'button',
            'data-peek': faceInfo(st.top) ? st.top : null, 'aria-pressed': selected,
            onclick: () => { if (choices.length) { S.sel.tech = st.top; render(); } else openZoom(st.top, techDef(st.top).name); } },
            faceImg(st.top, 'tech-face') || h('span', { class: 'tech-none' }, techDef(st.top).name),
            h('span', { class: 'tech-cap' }, techDef(st.top).name),
            h('span', { class: 'tech-meta' }, '原价 ', chip('spice', techDef(st.top).cost), '余 ' + st.remaining),
            choices.length ? h('b', null, '点击选择支付方案') : null),
          selected && choices.length ? h('div', { class: 'tech-payment' }, choices.map(o => h('button', {
            class: 'btn sm', disabled: S.busy, onclick: () => chooseBoardOption(o)
          }, '确认：付 ' + o.ui.cost + ' ' + (RES_NAME[o.ui.currency] || o.ui.currency) + '，返还 ' + o.ui.negotiators + ' 名谈判员'))) : null);
      }))),
    h('div', { class: 'blk' }, head('spice-trade', '运输轨'), shippingTrack(ix, g.players)),
    h('div', { class: 'blk' }, head('spice-trade', '运输 · 舰队 · 已有科技'),
      h('table', { class: 'ftable' }, h('thead', null, h('tr', null, h('th', null, '玩家'), h('th', { title: '运输轨位置（0–3）；召回后按格领取奖励' }, '运输'), h('th', { title: '已派到伊克斯的谈判员，获取科技时可抵香料' }, '谈判员'),
        h('th', { title: '无畏舰：储备 / 驻军 / 参战' }, '无畏舰'), h('th', null, '科技'))),
        h('tbody', null, g.players.map(p => { const x = ixOf(p.id) || { dreadnoughts: {}, tech: [], recallRewards: [], revealTechUsed: [] };
          return h('tr', null, h('td', null, token(p.id), ' ' + p.name),
            h('td', null, x.shipping, x.recallRewards.length ? h('span', { class: 'badge warn' }, '待领 ' + x.recallRewards.length) : null),
            h('td', null, x.negotiators), h('td', null, x.dreadnoughts.supply + ' / ' + x.dreadnoughts.garrison + ' / ' + x.dreadnoughts.conflict),
            h('td', { class: 'own-tech' }, x.tech.length ? x.tech.map(t => h('span', { 'data-peek': faceInfo(techId(t)) ? techId(t) : null, class: (t && t.exhausted) || x.revealTechUsed.includes(techId(t)) ? 'used' : null,
              title: (t && t.exhausted) || x.revealTechUsed.includes(techId(t)) ? '本轮已用' : null }, techDef(techId(t)).name)) : '—')); }))),
      (ix.occupations || []).length ? h('p', { class: 'mut' }, '无畏舰临时占领：' + ix.occupations.map(o => pname(o.playerId) + ' → ' + (spaceDef(o.spaceId) || {}).name).join('；')) : null,
      techActs.length ? h('div', { class: 'opt-row' }, h('span', null, '使用科技'), h('div', { class: 'segs' }, techActs.map(a => {
        const hit = a.discardUid || a.trashUid, card = hit && [...me.hand, ...me.inPlay, ...me.discard].find(x => x.uid === hit);
        return h('button', { type: 'button', class: 'seg', disabled: S.busy, onclick: () => act(a) }, techDef(a.techId).name + (hit ? (a.discardUid ? '：弃「' : '：销毁「') + cardName(card) + '」' : '')); }))) : null)) : null;

  const research = (c.expansions || {}).research || {}, nodes = Object.values(research);
  const SHORT = { specimens: '标本', tleilaxu: '特莱拉', research: '研究', solari: '索拉里', spice: '香料', water: '水', troops: '兵', draw: '抽牌', intrigue: '阴谋', vp: '分', persuasion: '说服' };
  const shortFx = e => { const out = []; const walk = x => { for (const [k, v] of Object.entries(x || {})) { if (k === 'steps') v.forEach(walk); else if (SHORT[k]) out.push(SHORT[k] + '+' + v); else if (k === 'trashChoice') out.push('销毁'); else if (k !== 'optional') out.push('…'); } }; walk(e); return out.join(' '); };
  const NW = 78, NH = 40, ys = nodes.map(n => n.y), maxY = Math.max(0, ...ys), minY = Math.min(0, ...ys), maxX = Math.max(0, ...nodes.map(n => n.x));
  const at = n => [n.x * NW + NW / 2, (maxY - n.y) * NH + NH / 2];
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'rs-lines'); svg.setAttribute('viewBox', '0 0 ' + (maxX + 1) * NW + ' ' + (maxY - minY + 1) * NH);
  svg.innerHTML = nodes.flatMap(n => (n.next || []).filter(id => research[id]).map(id => { const [x1, y1] = at(n), [x2, y2] = at(research[id]); return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '"/>'; })).join('');   // 只有数字坐标
  const tlTrack = (c.expansions || {}).tleilaxuTrack || [];
  const immPanel = imm ? h('div', { class: 'region imm' },
    h('div', { class: 'blk' }, head('bene-gesserit', '研究轨', h('span', { class: 'mut' }, '点击亮起的研究格前进；越过分界线得基因标记')),
      h('div', { class: 'rs-scroll', 'data-keep': 'research' }, h('div', { class: 'rs', style: 'width:' + (maxX + 1) * NW + 'px;height:' + (maxY - minY + 1) * NH + 'px' }, svg,
        nodes.map(n => { const here = g.players.filter(p => (immOf(p.id) || {}).research === n.id), [x, y] = at(n);
          const choice = boardChoices('research').find(o => o.ui.target === n.id);
          return h('button', { type: 'button', disabled: !choice || S.busy, onclick: () => chooseBoardOption(choice), class: 'rs-n' + (choice ? ' available' : '') + (n.geneticMarker ? ' gm' + n.geneticMarker : '') + (here.some(p => p.id === meId) ? ' me' : ''), style: 'left:' + x + 'px;top:' + y + 'px', title: '研究格 ' + n.id + (n.geneticMarker ? ' · 基因标记 ' + n.geneticMarker : '') },
            h('i', null, shortFx(n.effect) || (n.x === 0 ? '起点' : '·')), here.map(p => token(p.id))); })))),
    h('div', { class: 'blk' }, head('fremen', '特莱拉轨与标本', imm.firstSpice ? h('span', { class: 'mut' }, '先到者另得 ' + imm.firstSpice + ' 香料') : null),
      h('div', { class: 'tl-track' }, tlTrack.map((fx, i) => h('span', { class: 'tk' }, h('i', null, i), g.players.filter(p => (immOf(p.id) || {}).tleilaxu === i).map(p => token(p.id)),
        Object.keys(fx).length ? h('em', null, shortFx(Object.fromEntries(Object.entries(fx).filter(([k]) => k !== 'firstSpice'))) + (fx.firstSpice ? ' ★' : '')) : null))),
      h('table', { class: 'ftable' }, h('thead', null, h('tr', null, h('th', null, '玩家'), h('th', { title: '标本占用普通兵储备，可用来获取特莱拉牌' }, '标本'), h('th', null, '基因标记'), h('th', { title: '每局一次：清空并重翻帝国牌市' }, '原子弹'))),
        h('tbody', null, g.players.map(p => { const x = immOf(p.id) || {};
          return h('tr', null, h('td', null, token(p.id), ' ' + p.name), h('td', null, x.specimens), h('td', null, x.geneticMarker), h('td', null, x.familyAtomicsUsed ? '已用' : '可用')); }))))) : null;
  const lab = ixPanel || immPanel ? h('section', { class: 'board lab sec sec-lab', 'aria-label': '研究与科技' }, ixPanel, immPanel) : null;

  const log = h('details', { class: 'panel log sec sec-log', 'data-d': 'log', open: S.tab === 'log' || null }, h('summary', null, '对局记录'), h('ol', { 'data-keep': 'log' }, g.events.slice(-40).reverse().map(e => h('li', null, h('i', null, 'R' + e.round), eventText(e)))));
  const dock = dockEl({ r, g, c, me, myTurn, selCard, selCard2, selActs, partners, agentActs });
  const result = g.result ? resultEl(g) : r.status === 'closed' ? h('section', { class: 'panel result' }, h('h2', null, '房间已关闭'), h('p', null, '房主中止了这局游戏，下面是关闭时的局面，不能再操作。'), h('a', { class: 'btn', href: '#/' }, '回大厅')) : null;
  const waitingFor = g.turn && g.turn.playerId && g.turn.playerId !== g.currentPlayerId ? '（' + pname(g.turn.playerId) + ' 的回合中）' : '';

  return [
    h('header', { class: 'top gbar' },
      h('a', { class: 'top-back', href: '#/' }, icon('back'), '大厅'),
      h('div', { class: 'g-title' }, h('b', null, r.name || '沙丘：帝国'), h('span', null, g.round ? '第 ' + g.round + ' 轮' : '开局'), ((g.options || r.options || {}).expansions || []).length ? h('span', { class: 'badge' }, configLabel(c, g.options || r.options)) : null, h('span', { class: 'badge on' }, PHASE[g.phase] || g.phase),
        g.currentPlayerId ? h('span', { class: 'g-cur' }, token(g.currentPlayerId), myTurn ? '轮到你' : '等待 ' + pname(g.currentPlayerId) + waitingFor) : null),
      h('div', { class: 'top-right' },
        h('a', { class: 'btn ghost sm', href: '#/cards/' + r.gameId, target: '_blank', rel: 'noopener' }, '图鉴'),
        h('button', { class: 'badge warn as-btn', title: '查看开发版限制', onclick: () => { S.showLimits = !S.showLimits; render(); } }, label),
        host && r.status === 'playing' ? armBtn('close', '关闭房间', '会中止整局，确定？', () => run((room, rid) => S.api.close(room, { requestId: rid })), 'ghost sm') : null)),
    S.showLimits ? h('div', { class: 'wrap' }, limitsBox(c.manifest, true, r.ruleset)) : null,
    /* 手机上一次只看一块：棋盘 / 牌市 / 玩家 / 记录；宽屏全部铺开，这排页签不显示 */
    h('nav', { class: 'tabs', 'aria-label': '切换区域' }, [['board', '棋盘'], ['market', '牌市'], ...(lab ? [['lab', '研究科技']] : []), ['players', '玩家'], ['log', '记录']].map(([id, text]) =>
      h('button', { type: 'button', class: 'tab' + (S.tab === id ? ' on' : ''), 'aria-pressed': String(S.tab === id), onclick: () => { S.tab = id; render(); scrollTo(0, 0); } },
        text, (id === 'market' && (buyActs.length || tlActs.length)) || (id === 'lab' && techActs.length) ? h('i', { class: 'dot', title: '这里现在有可做的操作' }) : null))),
    h('div', { class: 'table', 'data-tab': S.tab }, result, leaderPick, h('div', { class: 'stage' }, h('div', { class: 'stage-main' }, market, board, lab), players), log),
    dock,
  ];
}
function eventText(e) {
  const c = cat(), n = id => pname(id), sp = id => (spaceDef(id) ? spaceDef(id).name : id);
  switch (e.type) {
    case 'round-started': return '第 ' + e.round + ' 轮开始，先手 ' + n(e.firstPlayerId);
    case 'leader-selected': return n(e.playerId) + ' 选择领袖 ' + ((c.leaders || {})[e.leaderId] || {}).name;
    case 'agent-placed': return n(e.playerId) + ' 用「' + cardName(e.card) + '」派特工到 ' + sp(e.spaceId);
    case 'agent-recalled': return n(e.playerId) + ' 召回 1 名特工';
    case 'troops-deployed': return n(e.playerId) + ' 部署 ' + e.count + ' 支部队';
    case 'troops-retreated': return n(e.playerId) + ' 撤回 ' + e.count + ' 支部队';
    case 'hand-revealed': return n(e.playerId) + ' 揭示了 ' + e.cards.length + ' 张牌';
    case 'card-acquired': return n(e.playerId) + ' 购得「' + cardName(e.card) + '」';
    case 'card-trashed': return n(e.playerId) + ' 销毁「' + cardName(e.card) + '」';
    case 'card-discarded': return n(e.playerId) + ' 弃掉「' + cardName(e.card) + '」';
    case 'intrigue-played': return n(e.playerId) + ' 打出阴谋「' + cardName(e.card) + '」';
    case 'intrigue-stolen': return n(e.playerId) + ' 从 ' + n(e.fromPlayerId) + ' 手里偷走 1 张阴谋牌';
    case 'market-manipulated': return n(e.playerId) + ' 移走市场上的「' + cardName(e.card) + '」';
    case 'masterstroke-revealed': return n(e.playerId) + ' 揭示秘密势力：' + e.factions.map(f => ICON_NAME[f] || f).join('、');
    case 'alliance-transferred': return (ICON_NAME[e.faction] || e.faction) + ' 同盟转给 ' + n(e.playerId);
    case 'voice-used': return n(e.playerId) + ' 用魅音封锁 ' + sp(e.spaceId);
    case 'family-atomics': return n(e.playerId) + ' 引爆家族原子弹，帝国牌市重翻';
    case 'tech-acquired': return n(e.playerId) + ' 获取科技' + (e.techId ? '「' + ((((c.expansions || {}).tech || {})[e.techId] || {}).name || e.techId) + '」' : '');
    case 'tleilaxu-acquired': return n(e.playerId) + ' 用标本获取「' + cardName(e.card || { cardId: e.cardId }) + '」';
    case 'dreadnought-victory': return n(e.playerId) + ' 的无畏舰临时占领 ' + sp(e.spaceId);
    case 'ilesa-card-returned': return n(e.playerId) + ' 取回留置的牌';
    case 'combat-started': return '战斗开始';
    case 'combat-resolved': return '战斗结算：' + (e.results.length ? e.results.map(x => n(x.playerId) + ' 第 ' + x.place + ' 名').join('，') : '无人参战');
    case 'endgame-started': return '进入终局';
    case 'game-finished': return '对局结束，胜者 ' + e.winnerIds.map(n).join('、');
    default: return e.type;
  }
}
function resultEl(g) {
  const res = g.result, labels = { vp: '胜利点', spice: '香料', solari: '索拉里', water: '水', garrison: '驻军' };
  const cols = res.tiebreakers.filter(k => labels[k]);
  return h('section', { class: 'panel result' },
    h('p', { class: 'eyebrow' }, 'Game over'),
    h('h2', null, icon('crown'), res.winnerIds.map(pname).join('、') + (res.winnerIds.length > 1 ? ' 并列获胜' : ' 获胜')),
    h('table', null, h('thead', null, h('tr', null, h('th', null, '名次'), h('th', null, '玩家'), cols.map(k => h('th', null, labels[k])))),
      h('tbody', null, res.rankings.map((x, i) => h('tr', { class: res.winnerIds.includes(x.playerId) ? 'win' : null },
        h('td', null, i + 1), h('td', null, token(x.playerId), ' ' + pname(x.playerId)), cols.map(k => h('td', null, x.score[res.tiebreakers.indexOf(k)])))))),
    h('p', { class: 'mut' }, '平分时依次比较：香料、索拉里、水、驻军，最后看谁更晚揭示。'),
    h('a', { class: 'btn', href: '#/' }, '回大厅'));
}
/* 底部操作区：提示 + 按钮 + 手牌。能做什么完全照 legalActions 来，这里不推断规则 */
function dockEl({ r, g, c, me, myTurn, selCard, selCard2, selActs, partners, agentActs }) {
  const playable = new Map(legal('playIntrigue').map(a => [a.cardUid, a]));
  const prompt = [], tools = [], extra = [];
  let body = null;
  const say = (...x) => prompt.push(...x);
  const btn = (text, action, cls) => h('button', { class: 'btn' + (cls ? ' ' + cls : ''), disabled: S.busy, onclick: () => act(action) }, text);
  const pick = uid => {
    const next = { space: null, pick: {}, intrigue: S.sel.intrigue };
    if (P === 'agent-choice') Object.assign(next, { card: S.sel.card === uid ? null : uid, card2: null });     // 销毁选牌：单选
    else if (uid === selCard) Object.assign(next, { card: selCard2, card2: null });                        // 取消第一张，第二张顶上
    else if (uid === selCard2) Object.assign(next, { card: selCard, card2: null });
    else if (selCard && !selCard2 && partners.has(uid)) Object.assign(next, { card: selCard, card2: uid });   // 第二张：嫁接
    else Object.assign(next, { card: uid, card2: null });
    S.sel = next; render();
  };
  const P = g.phase, pend = g.pending || {}, options = legal('chooseEffect'), deploys = legal('deploy'), endAgent = legal('endAgent')[0];

  if (r.status !== 'playing') say(r.status === 'finished' ? '对局结束。' : '房间已关闭。');
  else if (!myTurn) say(token(g.currentPlayerId), '等待 ' + pname(g.currentPlayerId) + '：' + (PHASE[P] || P));
  else if (P === 'leader-selection') say('轮到你选领袖：在上面的领袖里选一位。');
  else if (options.length) {
    const src = pend.sourceCardId && (c.cards[pend.sourceCardId] || c.intrigues[pend.sourceCardId] || (c.leaders || {})[pend.sourceCardId] || (c.conflicts || []).find(x => x.id === pend.sourceCardId));
    say(src ? h('b', { 'data-peek': faceInfo(src.id) ? src.id : null }, '「' + src.name + '」') : null, '需要你做一个选择：');
    const defs = pend.options || [];
    const visual = defs.some(o => o.ui && ['research', 'shipping', 'shipping-reward', 'tech'].includes(o.ui.kind));
    if (visual) tools.push(h('button', { class: 'btn', onclick: () => { S.tab = 'lab'; render(); document.querySelector('.sec-lab')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); } }, '到研究科技面板选择亮起的目标'));
    tools.push(options.filter(a => { const o = defs.find(x => x.option === a.option); return !['research', 'shipping', 'shipping-reward', 'tech'].includes(o?.ui?.kind) || o.ui.target === 'draw'; }).map(a => { const o = defs.find(x => x.option === a.option) || {};
      return h('button', { class: 'btn' + (/^(跳过|不|暂不)/.test(o.label || '') ? ' ghost' : ''), disabled: S.busy, 'data-peek': o.cardId && faceInfo(o.cardId) ? o.cardId : null, onclick: () => act(a) }, zh(o.label || '选项 ' + (a.option + 1))); }));
  } else if (P === 'round-start') {
    const sp = spaceDef(g.conflict.control);
    say('你控制着 ' + (sp ? sp.name : '冲突地点') + '，本轮冲突在这里：要不要免费派 1 支部队防守？');
    tools.push(btn('派 1 支防守', { type: 'defend', deploy: true }), btn('不派', { type: 'defend', deploy: false }, 'ghost'));
  } else if (P === 'agent-choice' && pend.stage === 'trash') {
    const acts = legal('chooseTrash'), zones = [['手牌', me.hand], ['弃牌堆', me.discard], ['场上', me.inPlay]];
    say('选择性育种：选一张牌销毁并抽 2 张，或者放弃。');
    const chosen = acts.find(a => a.cardUid && a.cardUid === S.sel.card);
    tools.push(chosen ? btn('销毁选中的牌', chosen, 'danger') : null, btn('不销毁', { type: 'chooseTrash', cardUid: null }, 'ghost'));
    body = h('div', { class: 'hand', 'data-keep': 'trash' }, zones.map(([label, list]) => list.filter(x => acts.some(a => a.cardUid === x.uid)).map((x, i) =>
      [i === 0 ? h('span', { class: 'cards-sep' }, label) : null, cardEl(c.cards[x.cardId], { sel: S.sel.card === x.uid, onclick: () => pick(x.uid) })])));
  } else if (P === 'agent-choice' || P === 'agent-end') {
    say(deploys.length ? (P === 'agent-end' ? '还可以追加部署，或者结束这个特工回合。' : '向冲突部署多少部队？') + '（驻军 ' + me.troops.garrison + '）' : '特工效果结算完了。');
    const force = a => [a.count ? a.count + ' 兵' : null, a.dreadnoughts ? a.dreadnoughts + ' 舰' : null].filter(Boolean).join(' + ');
    tools.push(deploys.map(a => btn(force(a) ? (P === 'agent-end' ? '再部署 ' : '部署 ') + force(a) : '不部署', a, force(a) ? '' : 'ghost')),
      endAgent ? btn('结束特工回合', endAgent, deploys.some(a => a.count) ? 'ghost' : '') : null);
  } else if (P === 'player-turns') {
    if (selCard && S.sel.space) {
      const sp = spaceDef(S.sel.space), handName = uid => c.cards[me.hand.find(x => x.uid === uid).cardId].name;
      const def = { name: selCard2 ? handName(selCard) + '」+「' + handName(selCard2) : handName(selCard) };
      const variants = selActs.filter(a => a.spaceId === S.sel.space);
      /* 同一张牌 + 同一格可能有多个合法对象（卖几份香料、移动哪名特工、结算顺序…），逐项选好后拼出其中一个 */
      const DIMS = ['spice', 'agentUid', 'graftMarketUid', 'dispatchCardUid', 'effectOrder', 'leaderEffectAt'], chosen = { ...S.sel.pick };
      const fits = a => DIMS.every(k => !(k in chosen) || a[k] === chosen[k]);
      for (const k of DIMS) if (!(k in chosen)) chosen[k] = (variants.find(fits) || variants[0])[k];
      const action = variants.find(fits) || variants[0];
      const dimLabel = { spice: '卖出', agentUid: '特工', graftMarketUid: '嫁接牌市', dispatchCardUid: '一并派出', effectOrder: '结算顺序', leaderEffectAt: '领袖抽牌' };
      const valueLabel = (k, v) => {
        if (k === 'spice') return v + ' 香料 → ' + (v * 2 + 2) + ' 索拉里';
        if (k === 'agentUid') { const at = (g.agentPositions || []).find(a => a.agentUid === v); return at ? '移动「' + spaceDef(at.spaceId).name + '」上的' : v === 'mentat' ? '门泰特' : '新派一名'; }
        if (k === 'graftMarketUid') return v ? '嫁接「' + cardName((g.market || []).find(x => x.uid === v)) + '」' : '不嫁接';
        if (k === 'dispatchCardUid') return v ? '带上「' + cardName(me.hand.find(x => x.uid === v)) + '」' : '不带';
        if (k === 'effectOrder') return orderText(v || (c.effectOrders || ['card-first'])[0]);
        return v === undefined ? '最先' : '第 ' + v + ' 段之后';
      };
      for (const k of DIMS) {
        const values = [...new Set(variants.map(a => a[k]))];
        if (values.length < 2) continue;
        const segs = h('div', { class: 'segs' }, values.map(v => h('button', { type: 'button', class: 'seg' + (action[k] === v ? ' on' : ''), 'aria-pressed': String(action[k] === v),
          onclick: () => { S.sel.pick = { ...chosen, [k]: v }; render(); } }, valueLabel(k, v))));
        /* 结算顺序多数时候用默认就行，收起来免得每次派遣都铺六个按钮 */
        extra.push(k === 'effectOrder' ? h('details', { class: 'opt-more', 'data-d': 'order' }, h('summary', null, '结算顺序：' + valueLabel(k, action[k]) + '（点开调整）'), segs)
          : h('div', { class: 'opt-row' }, h('span', null, dimLabel[k]), segs));
      }
      const pay = action.spice ? { spice: action.spice } : (g.effectiveSpaceCosts && g.effectiveSpaceCosts[sp.id]) || sp.cost;
      say('用「' + def.name + '」派特工到 ', h('b', null, sp.name), '：',
        Object.values(pay).some(Boolean) ? [h('span', { class: 'fx-cost' }, h('i', null, '付'), effectChips(pay, ''))] : note('免费'),
        h('span', { class: 'fx-cost' }, h('i', null, '得'), action.spice ? chip('solari', '+' + (action.spice * 2 + 2)) : effectChips(sp.effect)),
        sp.combat ? note('之后可部署部队') : null);
      tools.push(btn('确认派遣', action), h('button', { class: 'btn ghost', onclick: () => { S.sel.space = null; S.sel.pick = {}; render(); } }, '换一格'));
    } else if (selCard) {
      say(selCard2 ? '嫁接两张牌：' : '', selActs.length ? '点棋盘上亮起的行动格。' : '现在没有可去的行动格，点变暗的格子看原因。',
        !selCard2 && partners.size ? note('也可以再点一张发亮的手牌，两张嫁接着派出') : null);
      tools.push(h('button', { class: 'btn ghost', onclick: () => { S.sel = { card: null, card2: null, space: null, pick: {}, intrigue: null }; render(); } }, '取消选牌'));
    } else {
      say(agentActs.length ? '轮到你：选一张手牌派特工（还有 ' + me.agentsAvailable + ' 名），或者揭示手牌。' : '没有能派的特工了：揭示手牌，进入购买。');
      if (legal('reveal').length) tools.push(armBtn('reveal', '揭示手牌', '揭示后本轮不能再派特工，确定？', () => act({ type: 'reveal' }), agentActs.length ? 'ghost' : ''));
    }
  } else if (P === 'reveal') {
    const todo = legal('resolveReveal'), end = legal('endReveal')[0];
    say(todo.length ? '逐张点下面「待结算」的牌来结算展示效果（顺序你定），中途也可以买牌。' : '展示完成，在市场里点能买的牌，买完后结束。',
      ' 说服力 ', chip('persuasion', me.persuasion), ' 剑 ', chip('swords', me.swords));
    if (end) tools.push(legal('buy').length ? armBtn('endReveal', '结束揭示', '还有牌买得起，确定结束？', () => act(end)) : btn('结束揭示', end));
    if (todo.length) extra.push(h('div', { class: 'hand todo' }, h('span', { class: 'cards-sep' }, '待结算'),
      todo.map(a => { const x = (me.unresolvedReveal || []).find(u => u.uid === a.cardUid); return x ? cardEl(c.cards[x.cardId], { can: true, disabled: S.busy, onclick: () => act(a) }) : null; })));
  } else if (P === 'combat') {
    say('战斗：你的战力 ', h('b', null, me.strength), '。可以打出战斗阴谋牌，或者让过。');
    tools.push(btn('让过', { type: 'passCombat' }));
  } else if (P === 'combat-end') {
    say('战斗结束后的窗口：可以按提示获取特莱拉牌或打出阴谋牌，或者直接结束。');
    tools.push(btn('结束', { type: 'passCombatEnd' }));
  } else if (P === 'combat-win') {
    say('你独得第一：可以打出「获胜时」的阴谋牌，或者直接结束战斗。');
    tools.push(btn('结束战斗', { type: 'passCombatWin' }));
  } else if (P === 'endgame') {
    say('终局：可以打出终局阴谋牌，或者结束等待计分。');
    tools.push(btn('不再出牌', { type: 'passEndgame' }));
  } else say(PHASE[P] || P);

  if (legal('useMasterstroke').length) tools.push(armBtn('ms', '揭示秘密势力', '每局只能一次，确定揭示？', () => act({ type: 'useMasterstroke' })));
  /* 不分轮次的扩展动作：谁有合法动作谁就能点（返还标本在别人回合也可以） */
  const atomics = legal('familyAtomics')[0], giveBack = legal('returnSpecimens');
  if (atomics) tools.push(armBtn('atomics', '家族原子弹', '每局一次，清空并重翻帝国牌市，确定？', () => act(atomics)));
  if (giveBack.length) extra.push(h('div', { class: 'opt-row' }, h('span', { title: '把标本还回储备，变回可招募的普通兵' }, '返还标本'),
    h('div', { class: 'segs' }, giveBack.map(a => h('button', { type: 'button', class: 'seg', disabled: S.busy, onclick: () => act(a) }, a.count + ' 个')))));
  const HANDLED = ['familyAtomics', 'returnSpecimens', 'useTech', 'buyTleilaxu', 'passCombatEnd', 'agent', 'chooseLeader', 'chooseEffect', 'defend', 'deploy', 'endAgent', 'chooseTrash', 'reveal', 'resolveReveal', 'buy', 'endReveal', 'playIntrigue', 'passCombat', 'passCombatWin', 'passEndgame', 'useMasterstroke'];
  const unknown = r.legalActions.filter(a => !HANDLED.includes(a.type));
  if (unknown.length) extra.push(h('div', { class: 'opt-row' }, h('span', { title: '服务器给出的合法操作，前端还没有为它做专门界面，点击会原样提交' }, '其他操作'),
    h('div', { class: 'segs' }, unknown.slice(0, 40).map(a => h('button', { type: 'button', class: 'seg', disabled: S.busy, onclick: () => act(a) },
      Object.entries(a).map(([k, v]) => (k === 'type' ? v : k + ' ' + (typeof v === 'object' ? JSON.stringify(v) : v))).join(' · '))))));
  const selIntr = playable.get(S.sel.intrigue);
  if (selIntr) tools.unshift(btn('打出「' + cardName(me.intrigues.find(x => x.uid === S.sel.intrigue)) + '」', selIntr, 'danger'));

  const canPlace = myTurn && P === 'player-turns';
  if (!body) body = h('div', { class: 'hand', 'data-keep': 'hand' },
    me.hand.length ? me.hand.map(x => { const usable = canPlace && agentActs.some(a => a.cardUid === x.uid || (a.cardUids || []).includes(x.uid));
      return cardEl(c.cards[x.cardId], { sel: selCard === x.uid || selCard2 === x.uid, can: partners.has(x.uid), dim: canPlace && !usable && !partners.has(x.uid), onclick: canPlace ? () => pick(x.uid) : null, disabled: S.busy }); })
      : h('span', { class: 'empty' }, P === 'leader-selection' || P === 'leader-setup' ? '领袖选完后发第一轮手牌。' : me.revealed ? '手牌已全部揭示。' : '没有手牌。'),
    me.intrigues.length ? h('span', { class: 'cards-sep' }, '阴谋牌') : null,
    me.intrigues.map(x => { const a = playable.get(x.uid);
      return cardEl(c.intrigues[x.cardId], { kind: 'intrigue', can: !!a, sel: !!a && S.sel.intrigue === x.uid, disabled: S.busy,
        onclick: a ? () => { S.sel.intrigue = S.sel.intrigue === x.uid ? null : x.uid; render(); } : null }); }));

  return h('section', { class: 'dock' + (myTurn ? ' mine' : ''), 'aria-label': '我的操作' },
    retryBar(),
    h('div', { class: 'prompt' }, h('p', { 'aria-live': 'polite' }, prompt), h('div', { class: 'tools', 'data-keep': 'tools' }, tools)),
    extra, body);
}

/* ---------- 图鉴与扩展设置预览 ----------
   只读页面：图鉴按来源（基础版 / 各扩展）分开看；「设置预览」把后端 catalog.expansions.plans 的四种组合画出来。
   预览不是可开局模式，页面上没有任何会提交命令的按钮。 */
const CATEGORY = { leader: '领袖', starter: '起始牌', reserve: '保留牌', imperium: '帝国牌', intrigue: '阴谋牌', conflict: '冲突牌',
  tech: '科技', tleilaxu: '特莱拉牌', location: '行动格', variant: '可选变体' };
const BOARD_NAME = { base: '基础棋盘', 'choam-overlay': '宇联公司覆盖板', ix: '伊克斯科技板', shipping: '运输轨',
  'research-station-overlay': '研究站覆盖', 'bene-tleilax': '贝尼·特莱拉研究板', 'tleilaxu-row': '特莱拉牌市' };
const expansionName = (c, id) => (((c.expansions || {}).definitions || {})[id] || {}).name || id;
const configLabel = (c, options) => { const list = (options && options.expansions) || []; return list.length ? '基础版 + ' + list.map(id => expansionName(c, id)).join(' + ') : '基础版'; };
function viewCatalog() {
  const c = S.catalogs[S.route.gameId];
  if (!c) return [topbar(), h('p', { class: 'boot' }, S.missing || '载入图鉴…')];
  const ex = c.expansions || {}, defs = Object.values(ex.definitions || {}), plans = Object.values(ex.plans || {});
  const set = S.cardSet === 'preview' && !plans.length ? 'base' : S.cardSet;
  const pickSet = (id, text) => h('button', { type: 'button', class: 'seg' + (set === id ? ' on' : ''), 'aria-pressed': String(set === id), onclick: () => { S.cardSet = id; render(); } }, text);
  const zhName = x => x.name || (c.cards[x.id] || c.intrigues[x.id] || (c.leaders || {})[x.id] || (c.conflicts || []).find(y => y.id === x.id) || c.spaces.find(s => 'space-' + s.id === x.id) || {}).name;
  const gallery = ref => Object.keys(CATEGORY).map(k => { const list = ref.filter(x => x.category === k);
    return list.length ? [h('h2', null, CATEGORY[k], h('span', { class: 'mut' }, ' ' + list.length + ' 种')),
      h('div', { class: 'gallery' + (k === 'leader' || k === 'location' ? ' wide' : '') }, list.map(x => h('button', { class: 'g-item', type: 'button', onclick: () => openZoom(x.id, zhName(x) || x.englishName, x.englishName) },
        faceImg(x.id, 'g-face') || h('span', { class: 'g-none' }, '暂无图片'),
        h('span', { class: 'g-name' }, zhName(x) || x.englishName), h('span', { class: 'g-en' }, (zhName(x) ? x.englishName : '') + (x.copies > 1 ? ' ×' + x.copies : '') + (x.fixed ? ' · 固定在牌市' : '')),
        x.implementation === 'playable' ? null : h('span', { class: 'badge warn', title: x.pendingReason || null }, k === 'location' ? '参考图' : x.implementation === 'excluded-variant' ? '不启用' : '仅图鉴'))))] : null; });

  let body;
  if (set === 'preview') {
    const plan = plans[Math.min(S.planIndex, plans.length - 1)], spaces = plan.spaces || [], by = f => spaces.filter(f);
    const tile = sp => h('div', { class: 'sp' + (c.spaces.some(b => b.id === sp.id) ? '' : ' new') },
      h('span', { class: 'sp-name' }, sp.name, sp.combat ? h('span', { class: 'sp-cb' }, icon('swords')) : null),
      Object.values(sp.cost || {}).some(Boolean) ? h('div', { class: 'sp-cost' }, h('i', null, '付'), effectChips(sp.cost, '')) : null,
      sp.requirement ? h('div', { class: 'sp-req' }, '需 ' + (ICON_NAME[sp.requirement.faction] || sp.requirement.faction) + ' 影响力 ' + sp.requirement.influence) : null,
      h('div', { class: 'sp-fx' }, effectChips(sp.effect || {})),
      c.spaces.some(b => b.id === sp.id) ? null : h('span', { class: 'sp-new' }, '扩展'));
    const tiles = list => h('div', { class: 'tiles', style: '--n:' + Math.max(1, list.length) }, list.map(tile));
    const head = (ic, text) => h('div', { class: 'rg-h g-' + ic }, h('span', { class: 'ic' }, icon(ic)), h('h3', null, text));
    const strangers = by(sp => !GROUPS.includes(sp.icon));
    const count = (label, n, base) => h('div', { class: 'stat' }, h('b', null, n), h('span', null, label), base != null && n !== base ? h('i', null, '+' + (n - base)) : null);
    const base = plans[0];
    const stacks = plan.techStackSizes || [], tech = ex.tech || {};
    body = [
      h('div', { class: 'segs plan-pick' }, plans.map((p, i) => h('button', { type: 'button', class: 'seg' + (plan === p ? ' on' : ''), 'aria-pressed': String(plan === p),
        onclick: () => { S.planIndex = i; render(); } }, configLabel(c, p.options)))),
      plan.previewOnly ? h('p', { class: 'limits' }, h('span', { class: 'badge warn' }, '仅预览'), ' 这套组合还不能开局：后端已录入牌库与机制库，对局接线未完成。下面是开局摆放的预览，不能操作。')
        : h('p', { class: 'hint' }, '这是现在可以开局的配置（' + plan.ruleset + '）。'),
      h('div', { class: 'stats' },
        count('帝国牌', plan.market.length, base.market.length), count('阴谋牌', plan.intrigue.length, base.intrigue.length),
        count('冲突牌池', plan.conflictPool.length, base.conflictPool.length), count('领袖', plan.leaders.length, base.leaders.length),
        count('行动格', spaces.length, base.spaces.length), plan.tech.length ? count('科技', plan.tech.length) : null,
        (plan.tleilaxu || []).length ? count('特莱拉牌', plan.tleilaxu.length) : null),
      h('p', { class: 'hint' }, '每局冲突：' + plan.conflictSelection.map(x => 'ⅠⅡⅢ'[x.level - 1] + ' 级 ' + x.count + ' 张').join('、') + '。用到的板块：' + plan.boards.map(b => BOARD_NAME[b] || b).join('、') + '。'),
      h('h2', null, '棋盘摆放', h('span', { class: 'mut' }, ' 带「扩展」角标的是这套组合替换或新增的格子')),
      h('section', { class: 'board preview', 'aria-label': '棋盘预览' },
        h('div', { class: 'region factions' }, c.factions.map(f => h('div', { class: 'frow g-' + f }, head(f, ICON_NAME[f] || f), tiles(by(sp => sp.icon === f))))),
        h('div', { class: 'region council' }, plan.options.expansions.includes('rise-of-ix') ? ixBoardLayout(spaces, tile, shippingTrack(null, [], false)) : [
          h('div', { class: 'blk' }, head('landsraad', '兰兹拉德议会'), tiles(by(sp => sp.icon === 'landsraad'))),
          h('div', { class: 'blk' }, head('spice-trade', '宇联公司'), tiles(by(sp => sp.icon === 'spice-trade' && !sp.maker)))]),
        h('div', { class: 'region arrakis' },
          h('div', { class: 'blk' }, head('city', '厄拉科斯 · 城镇'), tiles(by(sp => sp.icon === 'city'))),
          h('div', { class: 'blk' }, head('spice-trade', '沙漠 · 采香料'), tiles(by(sp => sp.icon === 'spice-trade' && sp.maker)))),
        strangers.length ? h('div', { class: 'region others' }, h('div', { class: 'blk' }, head('agent', '其他行动格'), tiles(strangers))) : null),
      stacks.length ? [h('h2', null, '科技板', h('span', { class: 'mut' }, ' ' + stacks.length + ' 堆，每堆 ' + stacks.join(' / ') + ' 块，只公开顶上一块')),
        h('div', { class: 'gallery' }, plan.tech.filter((id, i, a) => a.indexOf(id) === i).map(id => h('button', { class: 'g-item', type: 'button', onclick: () => openZoom(id, (tech[id] || {}).name || id) },
          faceImg(id, 'g-face') || h('span', { class: 'g-none' }, '暂无图片'), h('span', { class: 'g-name' }, (tech[id] || {}).name || id),
          tech[id] ? h('span', { class: 'g-en' }, '花费 ' + tech[id].cost + ' 香料') : null)))] : null,
      (plan.tleilaxu || []).length ? [h('h2', null, '特莱拉牌市', h('span', { class: 'mut' }, ' 公开 2 张，用标本获取' + ((plan.fixedTleilaxu || []).length ? '；另有固定牌 ' + plan.fixedTleilaxu.length + ' 张留在牌市' : ''))),
        h('div', { class: 'gallery' }, [...(plan.fixedTleilaxu || []), ...plan.tleilaxu.filter((id, i, a) => a.indexOf(id) === i)].map(id => { const r = (ex.referenceCards || {})[id] || {};
          return h('button', { class: 'g-item', type: 'button', onclick: () => openZoom(id, r.name || r.englishName || id) }, faceImg(id, 'g-face') || h('span', { class: 'g-none' }, '暂无图片'),
            h('span', { class: 'g-name' }, r.name || r.englishName || id), (plan.fixedTleilaxu || []).includes(id) ? h('span', { class: 'badge' }, '固定') : null); }))] : null,
    ];
  } else if (set === 'base') body = gallery(Object.values((c.referenceCatalog || {}).cards || {}));
  else {
    const def = (ex.definitions || {})[set] || {};
    body = [h('p', { class: 'limits' }, h('span', { class: 'badge warn' }, def.playable ? '可开局' : '未开放'), ' ' + (def.reason || ''),
      def.rulebook ? [' ', h('a', { href: def.rulebook, target: '_blank', rel: 'noopener noreferrer' }, '官方规则书')] : null),
      gallery(Object.values(ex.referenceCards || {}).filter(x => x.expansion === set))];
  }
  return [topbar(),
    h('section', { class: 'wrap wide' },
      h('p', { class: 'eyebrow' }, c.manifest.englishName + ' · Card reference'), h('h1', { class: 'room-title' }, c.manifest.name + ' 图鉴'),
      h('p', { class: 'hint' }, '中文名称为项目译名，保留英文卡面对照。只是查牌用的参考：点任意一张放大。这里不能出牌或购买；标「仅图鉴」的还没接进规则。'),
      h('div', { class: 'segs set-pick' }, pickSet('base', '基础版'), defs.map(d => pickSet(d.id, d.name)), plans.length ? pickSet('preview', '设置预览') : null),
      body)];
}

/* ---------- 房间外壳 ---------- */
function viewRoom() {
  const signed = S.me && S.me.name;
  if (!signed) return [topbar(), h('section', { class: 'wrap narrow' }, loginCard('这是一间桌游房间，登录后才能进入。'))];
  if (S.joinPrompt) return [topbar(), h('section', { class: 'wrap narrow' }, h('div', { class: 'panel center' },
    h('p', { class: 'eyebrow' }, '邀请'), h('h2', null, '加入房间 ', h('span', { class: 'mono' }, S.joinPrompt), '？'),
    h('p', { class: 'mut' }, '加入后会占一个座位；开局前可以离开。'),
    h('button', { class: 'btn', disabled: S.busy, onclick: () => {
      const roomId = S.joinPrompt;
      run((room, rid) => S.api.join(roomId, { requestId: rid }), null, () => { S.joinPrompt = null; });
    } }, '加入'),
    h('a', { class: 'btn ghost', href: '#/' }, '回大厅'), retryBar()))];
  if (S.missing) return [topbar(), h('section', { class: 'wrap narrow' }, h('div', { class: 'panel center' }, h('p', null, S.missing), h('a', { class: 'btn', href: '#/' }, '回大厅')))];
  if (!S.room) return [topbar(), h('p', { class: 'boot' }, '载入房间…')];
  if (S.room.game) return viewGame();
  if (S.room.status === 'waiting') return viewWaiting();
  return [topbar(), h('section', { class: 'wrap narrow' }, h('div', { class: 'panel center' }, h('h2', null, '房间已关闭'), h('p', { class: 'mut' }, '这间房在开局前就关闭了。'), h('a', { class: 'btn', href: '#/' }, '回大厅')))];
}

/* 整页重画后把焦点还给「同一个」控件：用标签、类名和文字认，够区分按钮和卡牌 */
function focusKey(el) {
  return el && $app.contains(el) ? el.tagName + '|' + el.className.replace(/ ?(sel|can|on|dim|no)/g, '') + '|' + (el.getAttribute('aria-label') || el.textContent).slice(0, 48) : null;
}
function render() {
  const keep = {}, opened = {}, focused = focusKey(document.activeElement);
  $app.querySelectorAll('details[data-d]').forEach(el => { opened[el.dataset.d] = el.open; });
  $app.querySelectorAll('[data-keep]').forEach(el => { keep[el.dataset.keep] = [el.scrollLeft, el.scrollTop]; });
  const inGame = S.route.name === 'room' && S.room && S.room.game;
  document.body.className = inGame ? 'in-game' : '';
  document.title = (S.route.name === 'room' && S.room ? (S.room.name || '房间') + ' · ' : '') + '桌游 · fengye';
  hidePeek();
  $app.replaceChildren(...[S.route.name === 'room' ? viewRoom() : S.route.name === 'cards' ? viewCatalog() : viewLobby()].flat(Infinity).filter(Boolean));
  $app.querySelectorAll('[data-keep]').forEach(el => { const at = keep[el.dataset.keep]; if (at) { el.scrollLeft = at[0]; el.scrollTop = at[1]; } });
  if (focused) { const again = [...$app.querySelectorAll('button,a,input')].find(el => focusKey(el) === focused); if (again) again.focus({ preventScroll: true }); }
  $app.querySelectorAll('details[data-d]').forEach(el => { if (opened[el.dataset.d]) el.open = true; });
  if (S.route.name === 'lobby') paintRoomList();
  const dock = $app.querySelector('.dock');
  if (dock) document.body.style.setProperty('--dock', dock.offsetHeight + 'px');
}

/* ---------- 启动 ---------- */
(async function boot() {
  try {
    const sdk = await import('/api/board-games/client.js');
    S.api = sdk.createBoardGamesClient();
    const [me, games] = await Promise.all([Auth.me(), S.api.games()]);
    S.me = me; S.games = games.games;
    await Promise.all(S.games.filter(g => g.assets).map(g => sdk.loadCardAssets(g).then(a => { S.assets[g.id] = a; }, () => {})));   // 读不到就用文字卡牌
  } catch (e) {
    $app.replaceChildren(h('p', { class: 'boot' }, '桌游服务暂时连不上，稍后刷新试试。'));
    return;
  }
  window.addEventListener('hashchange', go);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopPolling(); else if (S.route.name === 'room' && S.room) poll(); else schedule(); });
  go();
})();
