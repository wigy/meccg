/**
 * @module http/routes
 *
 * HTTP request handler for the lobby server. Serves:
 * - POST /api/register — create a new player account
 * - POST /api/login — authenticate and set session cookie
 * - POST /api/logout — clear session cookie
 * - GET /api/me — return current player name from session
 * - GET /api/decks — list all decks in the catalog
 * - GET /api/my-decks — list decks in the player's collection + current selection
 * - POST /api/my-decks — add a deck to the player's collection
 * - PUT /api/my-decks/current — set the player's current deck
 * - GET /cards/images/* — card image proxy with disk cache
 * - GET /* — static files from web-client/public/
 *
 * The lobby server replaces the web-client's serve.ts as the HTTP
 * entry point, serving the same static files but adding auth routes.
 */

import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { cardImageRawUrl } from '@meccg/shared';
import { DEV, MASTER_KEY } from '../config.js';
import { broadcastNotification } from '../lobby/lobby.js';
import { lobbyLog } from '../lobby-log.js';
import { findPlayer, findPlayerByEmail, createPlayer, listPlayerDecks, savePlayerDeck, getCurrentDeck, setCurrentDeck, listCardRequests, addCardRequest, listAllCardRequests, findCardRequestById } from '../players/store.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { signLobbyToken } from '../auth/jwt.js';
import { getSessionPlayer, setSessionCookie, clearSessionCookie } from '../auth/session.js';

const IMAGE_CACHE_DIR = process.env.IMAGE_CACHE_DIR ?? path.join(os.homedir(), '.meccg', 'image-cache');
const WEB_CLIENT_PUBLIC = path.join(__dirname, '../../../web-client/public');
const GAME_SERVER_SNAPSHOTS = path.join(__dirname, '../../../game-server/data/dev/snapshots/index.json');
const DECK_CATALOG_DIR = path.join(__dirname, '../../../../data/decks');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
};

/** Read the full request body as a string. */
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

/** Send a JSON response. */
function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** Validates that an image path component contains only safe characters. */
function isSafePathComponent(s: string): boolean {
  return /^[a-zA-Z0-9]+$/.test(s);
}

/** Fetch a URL over HTTPS, following up to 3 redirects. */
function httpsGet(url: string, redirects = 3): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        httpsGet(res.headers.location, redirects - 1).then(resolve, reject);
        res.resume();
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

/** Handle card image proxy requests. Returns true if handled. */
async function handleImageRequest(urlPath: string, res: http.ServerResponse): Promise<boolean> {
  const match = urlPath.match(/^\/cards\/images\/([a-z]+)\/([a-zA-Z0-9]+\.jpg)$/);
  if (!match) return false;

  const [, set, filename] = match;
  if (!isSafePathComponent(set)) {
    res.writeHead(400);
    res.end('Bad request');
    return true;
  }

  const cacheDir = path.join(IMAGE_CACHE_DIR, set);
  const cachePath = path.join(cacheDir, filename);

  try {
    const data = await fs.promises.readFile(cachePath);
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' });
    res.end(data);
    return true;
  } catch {
    // Cache miss
  }

  const rawUrl = cardImageRawUrl(set, filename);
  try {
    const data = await httpsGet(rawUrl);
    fs.promises.mkdir(cacheDir, { recursive: true })
      .then(() => fs.promises.writeFile(cachePath, data))
      .catch((err: unknown) => lobbyLog.log('error', { context: 'image-cache', path: cachePath, error: (err as Error).message }));
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' });
    res.end(data);
  } catch (err) {
    lobbyLog.log('error', { context: 'image-fetch', url: rawUrl, error: (err as Error).message });
    res.writeHead(502);
    res.end('Failed to fetch card image');
  }
  return true;
}

// ---- Live reload (dev mode) ----

/** Connected SSE clients waiting for reload signals. */
const reloadClients = new Set<http.ServerResponse>();

/** Script injected before </head> to expose server config to the browser. */
const CONFIG_SCRIPT = `<script>window.__MECCG_DEV=${DEV};window.__LOBBY=true;</script>`;

/** SSE script for auto-reload in dev mode. */
const RELOAD_SCRIPT = `<script>
(function() {
  var es = new EventSource('/__livereload');
  es.onmessage = function(e) { if (e.data === 'reload') location.reload(); };
})();
</script>`;

if (DEV) {
  let reloadTimeout: ReturnType<typeof setTimeout> | null = null;
  fs.watch(WEB_CLIENT_PUBLIC, { recursive: true }, (_event, filename) => {
    if (!filename || filename.endsWith('~')) return;
    if (reloadTimeout) clearTimeout(reloadTimeout);
    reloadTimeout = setTimeout(() => {
      lobbyLog.log('dev-reload', { filename });
      for (const client of reloadClients) {
        client.write('data: reload\n\n');
      }
    }, 100);
  });
}

/** Notify SSE clients to reload (called after game events too). */
export function signalReload(): void {
  for (const client of reloadClients) {
    client.write('data: reload\n\n');
  }
}

/** Main HTTP request handler. */
export async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const urlPath = req.url === '/' ? '/index.html' : req.url ?? '/index.html';
  const method = req.method ?? 'GET';

  // Live reload SSE
  if (DEV && urlPath === '/__livereload') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    res.write('data: connected\n\n');
    reloadClients.add(res);
    req.on('close', () => reloadClients.delete(res));
    return;
  }

  // Dev snapshots index endpoint
  if (DEV && urlPath === '/api/snapshots') {
    fs.readFile(GAME_SERVER_SNAPSHOTS, (err, data) => {
      if (err) { res.writeHead(404); res.end('[]'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(data);
    });
    return;
  }

  // ---- API routes ----

  if (urlPath === '/api/register' && method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req)) as { name?: string; email?: string; password?: string };
      const { name, email, password } = body;
      if (!name || !email || !password) {
        sendJson(res, 400, { error: 'Name, email, and password are required' });
        return;
      }
      if (name.length < 2 || name.length > 30) {
        sendJson(res, 400, { error: 'Name must be 2-30 characters' });
        return;
      }
      if (!/^[a-zA-Z0-9 _-]+$/.test(name)) {
        sendJson(res, 400, { error: 'Name may only contain letters, numbers, spaces, hyphens, and underscores' });
        return;
      }
      if (password.length < 4) {
        sendJson(res, 400, { error: 'Password must be at least 4 characters' });
        return;
      }
      if (findPlayer(name)) {
        sendJson(res, 409, { error: 'Name already taken' });
        return;
      }
      if (findPlayerByEmail(email)) {
        sendJson(res, 409, { error: 'Email already registered' });
        return;
      }

      const passwordHash = await hashPassword(password);
      createPlayer({ name, email, passwordHash, createdAt: new Date().toISOString() });
      const token = signLobbyToken(name);
      setSessionCookie(res, token);
      sendJson(res, 201, { name });
      lobbyLog.log('register', { name });
    } catch (err) {
      lobbyLog.log('error', { context: 'register', error: String(err) });
      sendJson(res, 500, { error: 'Registration failed' });
    }
    return;
  }

  if (urlPath === '/api/login' && method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req)) as { name?: string; password?: string };
      const { name, password } = body;
      if (!name || !password) {
        sendJson(res, 400, { error: 'Name and password are required' });
        return;
      }
      const player = findPlayer(name);
      if (!player) {
        sendJson(res, 401, { error: 'Invalid name or password' });
        return;
      }
      const valid = await verifyPassword(password, player.passwordHash);
      if (!valid) {
        sendJson(res, 401, { error: 'Invalid name or password' });
        return;
      }

      const token = signLobbyToken(player.name);
      setSessionCookie(res, token);
      sendJson(res, 200, { name: player.name });
      lobbyLog.log('login', { name: player.name });
    } catch (err) {
      lobbyLog.log('error', { context: 'login', error: String(err) });
      sendJson(res, 500, { error: 'Login failed' });
    }
    return;
  }

  if (urlPath === '/api/logout' && method === 'POST') {
    clearSessionCookie(res);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (urlPath === '/api/me' && method === 'GET') {
    const playerName = getSessionPlayer(req);
    if (playerName) {
      sendJson(res, 200, { name: playerName });
    } else {
      sendJson(res, 401, { error: 'Not logged in' });
    }
    return;
  }

  // ---- Deck catalog ----

  if (urlPath === '/api/decks' && method === 'GET') {
    try {
      const files = fs.readdirSync(DECK_CATALOG_DIR).filter(f => f.endsWith('.json'));
      const decks = files.map(f => JSON.parse(fs.readFileSync(path.join(DECK_CATALOG_DIR, f), 'utf-8')) as unknown);
      sendJson(res, 200, decks);
    } catch (err) {
      lobbyLog.log('error', { context: 'deck-catalog', error: String(err) });
      sendJson(res, 500, { error: 'Failed to load deck catalog' });
    }
    return;
  }

  // ---- Player deck collection ----

  if (urlPath === '/api/my-decks' && method === 'GET') {
    const playerName = getSessionPlayer(req);
    if (!playerName) { sendJson(res, 401, { error: 'Not logged in' }); return; }
    try {
      const decks = listPlayerDecks(playerName);
      const currentDeck = getCurrentDeck(playerName);
      sendJson(res, 200, { decks, currentDeck });
    } catch (err) {
      lobbyLog.log('error', { context: 'my-decks', error: String(err) });
      sendJson(res, 500, { error: 'Failed to load decks' });
    }
    return;
  }

  if (urlPath === '/api/my-decks/current' && method === 'PUT') {
    const playerName = getSessionPlayer(req);
    if (!playerName) { sendJson(res, 401, { error: 'Not logged in' }); return; }
    try {
      const body = JSON.parse(await readBody(req)) as { deckId?: string };
      if (!body.deckId) { sendJson(res, 400, { error: 'deckId is required' }); return; }
      setCurrentDeck(playerName, body.deckId);
      sendJson(res, 200, { ok: true, currentDeck: body.deckId });
      lobbyLog.log('deck-selected', { player: playerName, deck: body.deckId });
    } catch (err) {
      lobbyLog.log('error', { context: 'select-deck', error: String(err) });
      sendJson(res, 500, { error: 'Failed to select deck' });
    }
    return;
  }

  if (urlPath === '/api/my-decks' && method === 'POST') {
    const playerName = getSessionPlayer(req);
    if (!playerName) { sendJson(res, 401, { error: 'Not logged in' }); return; }
    try {
      const deck = JSON.parse(await readBody(req)) as { id?: string; name?: string; [key: string]: unknown };
      if (!deck.id || !deck.name) {
        sendJson(res, 400, { error: 'Deck must have id and name' });
        return;
      }
      savePlayerDeck(playerName, deck as { id: string; [key: string]: unknown });
      sendJson(res, 201, { ok: true });
      lobbyLog.log('deck-saved', { player: playerName, deck: deck.id });
    } catch (err) {
      lobbyLog.log('error', { context: 'save-deck', error: String(err) });
      sendJson(res, 500, { error: 'Failed to save deck' });
    }
    return;
  }

  // ---- Card requests ----

  if (urlPath === '/api/card-requests' && method === 'GET') {
    const playerName = getSessionPlayer(req);
    if (!playerName) { sendJson(res, 401, { error: 'Not logged in' }); return; }
    sendJson(res, 200, listCardRequests(playerName));
    return;
  }

  if (urlPath === '/api/card-requests' && method === 'POST') {
    const playerName = getSessionPlayer(req);
    if (!playerName) { sendJson(res, 401, { error: 'Not logged in' }); return; }
    try {
      const body = JSON.parse(await readBody(req)) as { deckId?: string; cardName?: string };
      if (!body.deckId || !body.cardName) {
        sendJson(res, 400, { error: 'deckId and cardName are required' });
        return;
      }
      const id = addCardRequest(playerName, body.deckId, body.cardName);
      if (id) {
        sendJson(res, 201, { ok: true, id });
      } else {
        sendJson(res, 200, { ok: true, duplicate: true });
      }
    } catch (err) {
      lobbyLog.log('error', { context: 'card-request', error: String(err) });
      sendJson(res, 500, { error: 'Failed to save card request' });
    }
    return;
  }

  // ---- System API (master key required) ----

  if (urlPath.startsWith('/api/system/')) {
    const authHeader = req.headers.authorization ?? '';
    const key = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (key !== MASTER_KEY) {
      sendJson(res, 403, { error: 'Invalid master key' });
      return;
    }

    if (urlPath === '/api/system/card-requests' && method === 'GET') {
      sendJson(res, 200, listAllCardRequests());
      return;
    }

    const requestMatch = urlPath.match(/^\/api\/system\/card-requests\/([a-f0-9]+)$/);
    if (requestMatch && method === 'GET') {
      const result = findCardRequestById(requestMatch[1]);
      if (!result) { sendJson(res, 404, { error: 'Request not found' }); return; }
      sendJson(res, 200, result);
      return;
    }

    if (urlPath === '/api/system/notify' && method === 'POST') {
      try {
        const body = JSON.parse(await readBody(req)) as { message?: string };
        if (!body.message) { sendJson(res, 400, { error: 'message is required' }); return; }
        broadcastNotification(body.message);
        lobbyLog.log('system-notify', { message: body.message });
        sendJson(res, 200, { ok: true });
      } catch (err) {
        lobbyLog.log('error', { context: 'system-notify', error: String(err) });
        sendJson(res, 500, { error: 'Failed to send notification' });
      }
      return;
    }

    sendJson(res, 404, { error: 'Unknown system endpoint' });
    return;
  }

  // ---- Card image proxy ----
  if (urlPath.startsWith('/cards/images/')) {
    try {
      const handled = await handleImageRequest(urlPath, res);
      if (handled) return;
    } catch (err) {
      lobbyLog.log('error', { context: 'image-handler', error: String(err) });
      if (!res.headersSent) { res.writeHead(500); res.end('Internal server error'); }
      return;
    }
  }

  // ---- Static files ----
  const filePath = path.join(WEB_CLIENT_PUBLIC, urlPath);
  if (!filePath.startsWith(WEB_CLIENT_PUBLIC)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    if (ext === '.html') {
      const reloadInject = DEV ? RELOAD_SCRIPT : '';
      const html = data.toString()
        .replace('</head>', `${CONFIG_SCRIPT}</head>`)
        .replace('</body>', `${reloadInject}</body>`);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(html);
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}
