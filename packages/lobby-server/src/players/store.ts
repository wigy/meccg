/**
 * @module players/store
 *
 * File-based player account storage. Each player is stored as a separate
 * JSON file in ~/.meccg/players/<normalized-name>.json. This avoids
 * contention and makes manual inspection easy.
 */

import * as fs from 'fs';
import * as path from 'path';
import { PLAYERS_DIR } from '../config.js';
import type { PlayerRecord } from './types.js';

/** Normalize a player name to a safe filename (lowercase, alphanumeric + hyphens). */
function toFilename(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '-') + '.json';
}

/** Ensure the players directory exists. */
function ensureDir(): void {
  fs.mkdirSync(PLAYERS_DIR, { recursive: true });
}

/** Look up a player by name (case-insensitive). Returns null if not found. */
export function findPlayer(name: string): PlayerRecord | null {
  const filePath = path.join(PLAYERS_DIR, toFilename(name));
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data) as PlayerRecord;
  } catch {
    return null;
  }
}

/** Look up a player by email. Scans all player files. Returns null if not found. */
export function findPlayerByEmail(email: string): PlayerRecord | null {
  ensureDir();
  const lower = email.toLowerCase();
  try {
    const files = fs.readdirSync(PLAYERS_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const data = fs.readFileSync(path.join(PLAYERS_DIR, file), 'utf-8');
      const record = JSON.parse(data) as PlayerRecord;
      if (record.email.toLowerCase() === lower) return record;
    }
  } catch {
    // Directory doesn't exist yet
  }
  return null;
}

/** Save a new player record. Throws if the name is already taken. */
export function createPlayer(record: PlayerRecord): void {
  ensureDir();
  const filePath = path.join(PLAYERS_DIR, toFilename(record.name));
  if (fs.existsSync(filePath)) {
    throw new Error(`Player "${record.name}" already exists`);
  }
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2));
}
