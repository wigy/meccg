/**
 * @module players/store
 *
 * File-based player account storage. Each player gets a subdirectory
 * under ~/.meccg/players/<normalized-name>/ with an info.json file
 * containing account data. The subdirectory can later hold decks, etc.
 */

import * as fs from 'fs';
import * as path from 'path';
import { PLAYERS_DIR, REVIEWER_PLAYERS, DECK_CATALOG_DIR } from '../config.js';
import type { PlayerRecord } from './types.js';
import type { DeckList } from '@meccg/shared';

/** Normalize a player name to a safe directory name (lowercase, alphanumeric + hyphens). */
export function toDirName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '-');
}

/** Path to a player's info.json file. */
function infoPath(name: string): string {
  return path.join(PLAYERS_DIR, toDirName(name), 'info.json');
}

/** Ensure the players directory exists. */
function ensureDir(): void {
  fs.mkdirSync(PLAYERS_DIR, { recursive: true });
}

/** Look up a player by name (case-insensitive). Returns null if not found. */
export function findPlayer(name: string): PlayerRecord | null {
  try {
    const data = fs.readFileSync(infoPath(name), 'utf-8');
    return JSON.parse(data) as PlayerRecord;
  } catch {
    return null;
  }
}

/** Look up a player by email. Scans all player directories. Returns null if not found. */
export function findPlayerByEmail(email: string): PlayerRecord | null {
  ensureDir();
  const lower = email.toLowerCase();
  try {
    const entries = fs.readdirSync(PLAYERS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const filePath = path.join(PLAYERS_DIR, entry.name, 'info.json');
      try {
        const data = fs.readFileSync(filePath, 'utf-8');
        const record = JSON.parse(data) as PlayerRecord;
        if (record.email.toLowerCase() === lower) return record;
      } catch {
        continue;
      }
    }
  } catch {
    // Directory doesn't exist yet
  }
  return null;
}

// ---- Player deck collection ----

/** Path to a player's decks directory. */
function decksDir(name: string): string {
  return path.join(PLAYERS_DIR, toDirName(name), 'decks');
}

/** List decks in a player's personal collection (excludes stock catalog decks). */
export function listPlayerDecks(name: string): unknown[] {
  const dir = decksDir(name);
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    return files.map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as unknown);
  } catch {
    return [];
  }
}

/**
 * Find a deck by ID, checking the player's collection first, then the stock catalog.
 * Returns null if the deck is not found in either location.
 */
export function findDeckById(playerName: string, deckId: string): DeckList | null {
  // Check player's personal collection
  const dir = decksDir(playerName);
  const filename = deckId.replace(/[^a-z0-9-]/g, '-') + '.json';
  const playerPath = path.join(dir, filename);
  try {
    return JSON.parse(fs.readFileSync(playerPath, 'utf-8')) as DeckList;
  } catch {
    // Not in player collection
  }
  // Check stock catalog
  const catalogPath = path.join(DECK_CATALOG_DIR, `${deckId}.json`);
  try {
    return JSON.parse(fs.readFileSync(catalogPath, 'utf-8')) as DeckList;
  } catch {
    return null;
  }
}

/** List all stock decks from the catalog directory. */
export function listCatalogDecks(): DeckList[] {
  try {
    const files = fs.readdirSync(DECK_CATALOG_DIR).filter(f => f.endsWith('.json'));
    return files.map(f => JSON.parse(fs.readFileSync(path.join(DECK_CATALOG_DIR, f), 'utf-8')) as DeckList);
  } catch {
    return [];
  }
}

/** Save a deck to a player's collection. Overwrites if same id exists. */
export function savePlayerDeck(name: string, deck: { id: string; [key: string]: unknown }): void {
  const dir = decksDir(name);
  fs.mkdirSync(dir, { recursive: true });
  const filename = deck.id.replace(/[^a-z0-9-]/g, '-') + '.json';
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(deck, null, 2));
}

// ---- Current deck selection ----

/** Get the player's currently selected deck ID, or null if none. */
export function getCurrentDeck(name: string): string | null {
  return findPlayer(name)?.currentDeck ?? null;
}

/** Set the player's currently selected deck ID. */
export function setCurrentDeck(name: string, deckId: string): void {
  const player = findPlayer(name);
  if (!player) return;
  updatePlayer(name, { ...player, currentDeck: deckId });
}

/** Overwrite a player's info.json with an updated record. */
function updatePlayer(name: string, record: PlayerRecord): void {
  fs.writeFileSync(infoPath(name), JSON.stringify(record, null, 2));
}

// ---- Display name ----

/** Get the player's display name, falling back to their account name. */
export function getDisplayName(name: string): string {
  return findPlayer(name)?.displayName ?? name;
}

/** Set the player's display name. */
export function setDisplayName(name: string, displayName: string): void {
  const player = findPlayer(name);
  if (!player) return;
  updatePlayer(name, { ...player, displayName });
}

// ---- Mail view tracking ----

/** Get the player's last mail view timestamp, or null if never viewed. */
export function getLastMailView(name: string): string | null {
  return findPlayer(name)?.lastMailView ?? null;
}

/** Update the player's last mail view timestamp to now. */
export function touchLastMailView(name: string): void {
  const player = findPlayer(name);
  if (!player) return;
  updatePlayer(name, { ...player, lastMailView: new Date().toISOString() });
}

/** System accounts that are auto-created on server startup. */
const SYSTEM_PLAYERS: readonly { name: string; email: string; displayName?: string }[] = [
  { name: 'ai', email: 'ai@meccg.local', displayName: 'Eru Ilúvatar' },
  { name: 'server', email: 'server@meccg.local' },
  { name: 'admin', email: 'admin@meccg.local' },
  ...REVIEWER_PLAYERS
    .filter(name => !['ai', 'server', 'admin'].includes(name))
    .map(name => ({ name, email: `${name}@meccg.local` })),
];

/** Create system player accounts (ai, server) if they don't already exist. */
export function ensureSystemPlayers(): void {
  ensureDir();
  for (const { name, email, displayName } of SYSTEM_PLAYERS) {
    const existing = findPlayer(name);
    if (!existing) {
      const playerDir = path.join(PLAYERS_DIR, toDirName(name));
      fs.mkdirSync(playerDir, { recursive: true });
      const record: PlayerRecord = {
        name,
        email,
        passwordHash: '',
        createdAt: new Date().toISOString(),
        allowMasterKey: true,
        ...(displayName ? { displayName } : {}),
      };
      fs.writeFileSync(path.join(playerDir, 'info.json'), JSON.stringify(record, null, 2));
    } else if (displayName && existing.displayName !== displayName) {
      updatePlayer(name, { ...existing, displayName });
    }
  }
}

/** Save a new player record. Throws if the name is already taken. */
export function createPlayer(record: PlayerRecord): void {
  ensureDir();
  const playerDir = path.join(PLAYERS_DIR, toDirName(record.name));
  const filePath = path.join(playerDir, 'info.json');
  if (fs.existsSync(filePath)) {
    throw new Error(`Player "${record.name}" already exists`);
  }
  fs.mkdirSync(playerDir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2));
}
