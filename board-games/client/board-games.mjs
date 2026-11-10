// UI-independent browser SDK. Production uses the existing same-origin login cookie.
export class BoardGamesError extends Error {
  constructor(status, error) {
    super(error?.message || '桌游请求失败');
    this.status = status;
    this.code = error?.code || 'REQUEST_FAILED';
    this.details = error?.details;
  }
}

// Card artwork is fetched once from the static site, separately from live room snapshots.
export async function loadCardAssets(gameManifest, { fetchImpl = globalThis.fetch, signal } = {}) {
  const manifestUrl = gameManifest?.assets?.manifestUrl;
  if (gameManifest?.assets?.mode !== 'local-static' ||
      !/^\/board-games\/assets\/[a-z0-9-]+\/manifest\.json$/.test(manifestUrl || '')) {
    throw new BoardGamesError(400, { code: 'INVALID_ASSET_MANIFEST', message: '卡牌资源必须使用本站静态目录' });
  }
  const response = await fetchImpl(manifestUrl, { credentials: 'same-origin', cache: 'no-cache', signal });
  if (!response.ok) throw new BoardGamesError(response.status, { code: 'ASSET_LOAD_FAILED', message: '卡牌资源清单读取失败，可继续显示文字卡牌' });
  const manifest = await response.json();
  if (manifest?.schemaVersion !== 1 || manifest.gameId !== gameManifest.id ||
      !manifest.images || typeof manifest.images !== 'object' || Array.isArray(manifest.images)) {
    throw new BoardGamesError(400, { code: 'INVALID_ASSET_MANIFEST', message: '卡牌资源清单格式无效' });
  }
  const directory = manifestUrl.slice(0, manifestUrl.lastIndexOf('/') + 1);
  function image(record) {
    const segments = typeof record?.src === 'string' ? record.src.split('/') : [];
    if (!segments.length || segments.some(segment => !/^[a-z0-9][a-z0-9._-]*$/i.test(segment)) ||
        !/\.(?:avif|webp|png|jpe?g|svg)$/i.test(record.src) ||
        !Number.isSafeInteger(record.width) || record.width < 1 || record.width > 8192 ||
        !Number.isSafeInteger(record.height) || record.height < 1 || record.height > 8192) {
      throw new BoardGamesError(400, { code: 'INVALID_ASSET_MANIFEST', message: '卡牌图片路径或尺寸无效' });
    }
    return Object.freeze({
      src: directory + record.src, width: record.width, height: record.height,
      alt: typeof record.alt === 'string' ? record.alt : '卡牌图片', placeholder: record.placeholder === true
    });
  }
  const fallback = image(manifest.defaults?.face);
  const back = image(manifest.defaults?.back);
  const images = new Map(Object.entries(manifest.images).map(([cardId, record]) => [cardId, image(record)]));
  return Object.freeze({
    revision: manifest.revision, fallback, back,
    imageFor: (cardId, { hidden = false } = {}) => hidden ? back : (images.get(cardId) || fallback)
  });
}

export function createBoardGamesClient({ baseUrl = '/api/board-games', fetchImpl = globalThis.fetch, devUser } = {}) {
  const base = baseUrl.replace(/\/$/, '');
  async function request(path, body, options = {}) {
    const headers = { Accept: 'application/json', ...(devUser ? { 'X-Dev-User': devUser } : {}) };
    if (body !== undefined) Object.assign(headers, { 'Content-Type': 'application/json', 'X-Board-Games-Request': '1' });
    const response = await fetchImpl(base + path, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
      headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: options.signal
    });
    const data = await response.json();
    if (!response.ok) throw new BoardGamesError(response.status, data.error);
    return data;
  }
  const id = value => encodeURIComponent(value);
  function mutate(room, operation, body = {}, options = {}) {
    const payload = {
      ...body, expectedVersion: room.version,
      requestId: options.requestId || globalThis.crypto.randomUUID()
    };
    return request('/rooms/' + id(room.id) + '/' + operation, payload, options);
  }
  return {
    games: options => request('/games', undefined, options),
    catalog: (gameId, options) => request('/games/' + id(gameId), undefined, options),
    rooms: options => request('/rooms', undefined, options),
    room: (roomId, options) => request('/rooms/' + id(roomId), undefined, options),
    create: (settings, options = {}) => request('/rooms', { ...settings, requestId: options.requestId || globalThis.crypto.randomUUID() }, options),
    join: (roomId, options = {}) => request('/rooms/' + id(roomId) + '/join', { requestId: options.requestId || globalThis.crypto.randomUUID() }, options),
    ready: (room, ready, options) => mutate(room, 'ready', { ready }, options),
    leave: (room, options) => mutate(room, 'leave', {}, options),
    start: (room, options) => mutate(room, 'start', {}, options),
    close: (room, options) => mutate(room, 'close', {}, options),
    act: (room, action, options) => mutate(room, 'actions', { action }, options)
  };
}
