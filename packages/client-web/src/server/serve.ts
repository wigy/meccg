/**
 * @module serve
 *
 * HTTP server for static files + WebSocket proxy to the game server.
 * The browser connects here for both HTTP (HTML/JS/CSS) and WebSocket
 * (game protocol). WS connections are transparently proxied to the
 * game server — no message transformation.
 */

import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { WebSocketServer, WebSocket } from 'ws';
import { colorDebug, cardImageRawUrl, DEBUG_JSON_COMPACT_LIMIT } from '@meccg/shared';

const DEBUG = process.argv.includes('--debug') || process.env.DEBUG === '1';
const DEV = process.argv.includes('--dev') || process.env.DEV === '1';
const PORT = parseInt(process.env.PORT ?? '8080', 10);
const GAME_SERVER = process.env.GAME_SERVER ?? 'ws://localhost:3000';
const PUBLIC_DIR = path.join(__dirname, '../../public');
const IMAGE_CACHE_DIR = process.env.IMAGE_CACHE_DIR ?? path.join(os.homedir(), '.meccg', 'image-cache');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

/**
 * Validates that an image path component contains only safe characters
 * (alphanumeric, no path separators or special characters).
 */
function isSafePathComponent(s: string): boolean {
  return /^[a-zA-Z0-9]+$/.test(s);
}

/**
 * Fetches a URL over HTTPS and returns the response body as a Buffer.
 * Follows up to 3 redirects. Rejects on HTTP errors or network failures.
 */
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

/**
 * Handles requests to `/cards/images/{set}/{filename}.jpg`.
 * Checks the local disk cache first; on miss, fetches from the
 * upstream GitHub remaster repository and caches for future requests.
 * Returns true if the request was handled, false otherwise.
 */
async function handleImageRequest(
  urlPath: string,
  res: http.ServerResponse,
): Promise<boolean> {
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

  // Serve from cache if available
  try {
    const data = await fs.promises.readFile(cachePath);
    res.writeHead(200, {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=86400',
    });
    res.end(data);
    return true;
  } catch {
    // Cache miss — fetch from upstream
  }

  const rawUrl = cardImageRawUrl(set, filename);
  try {
    const data = await httpsGet(rawUrl);
    // Cache to disk (fire-and-forget, don't block response)
    fs.promises.mkdir(cacheDir, { recursive: true })
      .then(() => fs.promises.writeFile(cachePath, data))
      .catch((err: unknown) => console.error(`Failed to cache ${cachePath}:`, (err as Error).message));
    res.writeHead(200, {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=86400',
    });
    res.end(data);
  } catch (err) {
    console.error(`Failed to fetch card image: ${rawUrl}`, (err as Error).message);
    res.writeHead(502);
    res.end('Failed to fetch card image');
  }
  return true;
}

// ---- Live reload (dev mode only) ----

/** Connected SSE clients waiting for reload signals. */
const reloadClients = new Set<http.ServerResponse>();

/** Script injected before </body> to expose server config to the browser. */
const CONFIG_SCRIPT = `<script>window.__MECCG_DEV=${DEV};</script>`;

/** Small script injected before </body> in dev mode to auto-reload on changes. */
const RELOAD_SCRIPT = `<script>
(function() {
  var es = new EventSource('/__livereload');
  es.onmessage = function(e) { if (e.data === 'reload') location.reload(); };
})();
</script>`;

if (DEV) {
  let reloadTimeout: ReturnType<typeof setTimeout> | null = null;
  fs.watch(PUBLIC_DIR, { recursive: true }, (_event, filename) => {
    if (!filename || filename.endsWith('~')) return;
    // Debounce: wait 100ms for writes to settle
    if (reloadTimeout) clearTimeout(reloadTimeout);
    reloadTimeout = setTimeout(() => {
      console.log(`File changed: ${filename}, signaling reload...`);
      for (const client of reloadClients) {
        client.write('data: reload\n\n');
      }
    }, 100);
  });
}

// ---- Client log endpoint ----

const CLIENT_LOG_DIR = path.join(os.homedir(), '.meccg', 'logs', 'client-web');
fs.mkdirSync(CLIENT_LOG_DIR, { recursive: true });

function getClientLogStream(): fs.WriteStream {
  const date = new Date().toISOString().slice(0, 10);
  const logPath = path.join(CLIENT_LOG_DIR, `${date}.jsonl`);
  return fs.createWriteStream(logPath, { flags: 'a' });
}

let clientLogStream = getClientLogStream();
let clientLogDate = new Date().toISOString().slice(0, 10);

function writeClientLog(entry: string): void {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== clientLogDate) {
    clientLogStream.end();
    clientLogStream = getClientLogStream();
    clientLogDate = today;
  }
  clientLogStream.write(entry + '\n');
}

/** Serve static files from the public/ directory, with card image proxy. */
const server = http.createServer((req, res) => {
  const urlPath = req.url === '/' ? '/index.html' : req.url ?? '/index.html';

  // Live reload SSE endpoint (dev mode)
  if (DEV && urlPath === '/__livereload') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write('data: connected\n\n');
    reloadClients.add(res);
    req.on('close', () => reloadClients.delete(res));
    return;
  }

  // Client log endpoint
  if (req.method === 'POST' && urlPath === '/log') {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString();
      writeClientLog(body);
      res.writeHead(204);
      res.end();
    });
    return;
  }

  // Card image proxy route
  if (urlPath.startsWith('/cards/images/')) {
    handleImageRequest(urlPath, res).catch((err) => {
      console.error('Image handler error:', err);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end('Internal server error');
      }
    });
    return;
  }

  const filePath = path.join(PUBLIC_DIR, urlPath);

  // Prevent directory traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
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
    // Inject server config before bundle, and live-reload script in dev mode
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
});

/** WebSocket proxy: browser ↔ game server. */
const wss = new WebSocketServer({ server });

wss.on('connection', (browserWs) => {
  console.log('Browser connected, proxying to game server...');

  const gameWs = new WebSocket(GAME_SERVER);
  const pendingMessages: Buffer[] = [];

  gameWs.on('open', () => {
    console.log('Connected to game server');
    for (const msg of pendingMessages) {
      gameWs.send(msg);
    }
    pendingMessages.length = 0;
  });

  // Proxy: browser → game server (buffer until upstream is open)
  browserWs.on('message', (data: Buffer) => {
    if (DEBUG) {
      const str = data.toString();
      const display = str.length > DEBUG_JSON_COMPACT_LIMIT ? JSON.stringify(JSON.parse(str), null, 2) : str;
      console.log(colorDebug(`browser >> ${display}`));
    }
    if (gameWs.readyState === WebSocket.OPEN) {
      gameWs.send(data);
    } else {
      pendingMessages.push(Buffer.from(data));
    }
  });

  // Proxy: game server → browser
  gameWs.on('message', (data: Buffer) => {
    if (DEBUG) {
      const str = data.toString();
      const display = str.length > DEBUG_JSON_COMPACT_LIMIT ? JSON.stringify(JSON.parse(str), null, 2) : str;
      console.log(colorDebug(`server >> ${display}`));
    }
    if (browserWs.readyState === WebSocket.OPEN) {
      browserWs.send(data);
    }
  });

  // Close propagation
  browserWs.on('close', () => {
    console.log('Browser disconnected');
    gameWs.close();
  });

  gameWs.on('close', () => {
    console.log('Game server disconnected');
    browserWs.close();
  });

  gameWs.on('error', (err) => {
    console.error('Game server error:', err.message);
    browserWs.close();
  });
});

server.listen(PORT, () => {
  console.log(`MECCG web client serving on http://localhost:${PORT}`);
  console.log(`Proxying WebSocket to ${GAME_SERVER}`);
});
