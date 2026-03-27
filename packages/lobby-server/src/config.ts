/**
 * @module config
 *
 * Configuration constants for the lobby server. Values can be overridden
 * via environment variables for deployment flexibility.
 */

import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';

/** Port the lobby HTTP + WS server listens on. */
export const LOBBY_PORT = parseInt(process.env.LOBBY_PORT ?? '8080', 10);

/** Base port for spawned game servers. Each game gets the next available port. */
export const GAME_PORT_BASE = parseInt(process.env.GAME_PORT_BASE ?? '4000', 10);

/** Secret used to sign JWTs. Generated randomly at startup if not provided. */
export const JWT_SECRET = process.env.JWT_SECRET ?? crypto.randomBytes(32).toString('hex');

/** Directory where player account files are stored. */
export const PLAYERS_DIR = process.env.PLAYERS_DIR ?? path.join(os.homedir(), '.meccg', 'players');

/** JWT expiry for lobby session cookies. */
export const LOBBY_TOKEN_EXPIRY = '7d';

/** JWT expiry for game tokens (short-lived, only needed to join). */
export const GAME_TOKEN_EXPIRY = '24h';

/** Whether the server is in dev mode. */
export const DEV = process.argv.includes('--dev') || process.env.DEV === '1';
