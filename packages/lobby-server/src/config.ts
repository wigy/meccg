/**
 * @module config
 *
 * Configuration constants for the lobby server. Values can be overridden
 * via environment variables for deployment flexibility.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';

/** Port the lobby HTTP + WS server listens on. */
export const LOBBY_PORT = parseInt(process.env.LOBBY_PORT ?? '8080', 10);

/** Base port for spawned game servers. Each game gets the next available port. */
export const GAME_PORT_BASE = parseInt(process.env.GAME_PORT_BASE ?? '4000', 10);

/** Path to the persisted JWT secret file. */
const JWT_SECRET_PATH = path.join(os.homedir(), '.meccg', 'jwt-secret');

/** Load or generate a persistent JWT secret so sessions survive server restarts. */
function loadJwtSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  try {
    return fs.readFileSync(JWT_SECRET_PATH, 'utf-8').trim();
  } catch {
    const secret = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(path.dirname(JWT_SECRET_PATH), { recursive: true });
    fs.writeFileSync(JWT_SECRET_PATH, secret, { mode: 0o600 });
    return secret;
  }
}

/** Secret used to sign JWTs. Persisted to disk so sessions survive restarts. */
export const JWT_SECRET = loadJwtSecret();

/** Directory where player account files are stored. */
export const PLAYERS_DIR = process.env.PLAYERS_DIR ?? path.join(os.homedir(), '.meccg', 'players');

/** JWT expiry for lobby session cookies. */
export const LOBBY_TOKEN_EXPIRY = '7d';

/** JWT expiry for game tokens (short-lived, only needed to join). */
export const GAME_TOKEN_EXPIRY = '24h';

/** Whether the server is in dev mode. */
export const DEV = process.argv.includes('--dev') || process.env.DEV === '1';
