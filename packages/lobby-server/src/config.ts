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

// ---- Secrets (persisted to ~/.meccg/secrets.json) ----

const SECRETS_PATH = path.join(os.homedir(), '.meccg', 'secrets.json');

interface Secrets {
  jwtSecret: string;
  masterKey: string;
}

/** Load secrets from disk, generating missing ones. */
function loadSecrets(): Secrets {
  let existing: Partial<Secrets> = {};
  try {
    existing = JSON.parse(fs.readFileSync(SECRETS_PATH, 'utf-8')) as Partial<Secrets>;
  } catch {
    // File doesn't exist yet
  }
  const secrets: Secrets = {
    jwtSecret: process.env.JWT_SECRET ?? existing.jwtSecret ?? crypto.randomBytes(32).toString('hex'),
    masterKey: process.env.MASTER_KEY ?? existing.masterKey ?? crypto.randomBytes(32).toString('hex'),
  };
  fs.mkdirSync(path.dirname(SECRETS_PATH), { recursive: true });
  fs.writeFileSync(SECRETS_PATH, JSON.stringify(secrets, null, 2), { mode: 0o600 });
  return secrets;
}

const secrets = loadSecrets();

/** Secret used to sign JWTs. Persisted to disk so sessions survive restarts. */
export const JWT_SECRET = secrets.jwtSecret;

/** Master access key for system API calls. */
export const MASTER_KEY = secrets.masterKey;

/** Directory where player account files are stored. */
export const PLAYERS_DIR = process.env.PLAYERS_DIR ?? path.join(os.homedir(), '.meccg', 'players');

/** JWT expiry for lobby session cookies. */
export const LOBBY_TOKEN_EXPIRY = '7d';

/** JWT expiry for game tokens (short-lived, only needed to join). */
export const GAME_TOKEN_EXPIRY = '24h';

/** Whether the server is in dev mode. */
export const DEV = process.argv.includes('--dev') || process.env.DEV === '1';

/** Directory containing the stock deck catalog (shipped with the repo). */
export const DECK_CATALOG_DIR = path.join(__dirname, '../../../data/decks');

/** Reviewer player names who receive review requests and can approve changes. */
export const REVIEWER_PLAYERS: readonly string[] = ['wigy', 'karmi', 'admin'];
