/**
 * @module players/store
 *
 * File-based player account storage. Each player gets a subdirectory
 * under ~/.meccg/players/<normalized-name>/ with an info.json file
 * containing account data. The subdirectory can later hold decks, etc.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { PLAYERS_DIR } from '../config.js';
import type { PlayerRecord } from './types.js';

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

/** List all decks in a player's collection. Returns parsed JSON objects. */
export function listPlayerDecks(name: string): unknown[] {
  const dir = decksDir(name);
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    return files.map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as unknown);
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

// ---- Card requests ----

/** Path to a player's card requests file. */
function cardRequestsPath(name: string): string {
  return path.join(PLAYERS_DIR, toDirName(name), 'requests', 'cards.json');
}

/** A single card request entry. */
export interface CardRequest {
  /** Unique request identifier. */
  readonly id: string;
  /** Deck ID where the card is needed. */
  readonly deckId: string;
  /** Display name of the requested card. */
  readonly cardName: string;
  /** ISO 8601 timestamp of when the request was made. */
  readonly createdAt: string;
}

/** List all card requests for a player. */
export function listCardRequests(name: string): CardRequest[] {
  try {
    return JSON.parse(fs.readFileSync(cardRequestsPath(name), 'utf-8')) as CardRequest[];
  } catch {
    return [];
  }
}

/** Add a card request if not already present. Returns the new request's ID, or null if duplicate. */
export function addCardRequest(name: string, deckId: string, cardName: string): string | null {
  const requests = listCardRequests(name);
  const exists = requests.some(r => r.deckId === deckId && r.cardName === cardName);
  if (exists) return null;
  const id = crypto.randomBytes(8).toString('hex');
  requests.push({ id, deckId, cardName, createdAt: new Date().toISOString() });
  const filePath = cardRequestsPath(name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(requests, null, 2));
  return id;
}

/** A resolved card request with outcome. */
export interface ResolvedCardRequest extends CardRequest {
  /** ISO 8601 timestamp of resolution. */
  readonly resolvedAt: string;
  /** Explanation of what happened. */
  readonly explanation: string;
}

/** Find a card request by ID across all players. Returns the request and player name. */
export function findCardRequestById(requestId: string): { player: string; request: CardRequest } | null {
  ensureDir();
  try {
    const entries = fs.readdirSync(PLAYERS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const infoFile = path.join(PLAYERS_DIR, entry.name, 'info.json');
      let playerName: string;
      try {
        playerName = (JSON.parse(fs.readFileSync(infoFile, 'utf-8')) as PlayerRecord).name;
      } catch { continue; }
      const requests = listCardRequests(playerName);
      const req = requests.find(r => r.id === requestId);
      if (req) return { player: playerName, request: req };
    }
  } catch {
    // Directory doesn't exist
  }
  return null;
}

/** Move a request from cards.json to succeeded.json or failed.json. */
export function moveCardRequest(playerName: string, requestId: string, succeeded: boolean, explanation: string): void {
  // Remove from active requests
  const requests = listCardRequests(playerName);
  const req = requests.find(r => r.id === requestId);
  if (!req) return;
  const remaining = requests.filter(r => r.id !== requestId);
  const filePath = cardRequestsPath(playerName);
  fs.writeFileSync(filePath, JSON.stringify(remaining, null, 2));

  // Append to succeeded.json or failed.json
  const targetFile = path.join(path.dirname(filePath), succeeded ? 'succeeded.json' : 'failed.json');
  let resolved: ResolvedCardRequest[] = [];
  try {
    resolved = JSON.parse(fs.readFileSync(targetFile, 'utf-8')) as ResolvedCardRequest[];
  } catch {
    // File doesn't exist yet
  }
  resolved.push({ ...req, resolvedAt: new Date().toISOString(), explanation });
  fs.writeFileSync(targetFile, JSON.stringify(resolved, null, 2));
}

/** List all card requests across all players. */
export function listAllCardRequests(): Array<CardRequest & { player: string }> {
  ensureDir();
  const result: Array<CardRequest & { player: string }> = [];
  try {
    const entries = fs.readdirSync(PLAYERS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const infoFile = path.join(PLAYERS_DIR, entry.name, 'info.json');
      let playerName: string;
      try {
        playerName = (JSON.parse(fs.readFileSync(infoFile, 'utf-8')) as PlayerRecord).name;
      } catch { continue; }
      for (const req of listCardRequests(playerName)) {
        result.push({ ...req, player: playerName });
      }
    }
  } catch {
    // Directory doesn't exist
  }
  return result;
}

/** System accounts that are auto-created on server startup. */
const SYSTEM_PLAYERS: readonly { name: string; email: string }[] = [
  { name: 'ai', email: 'ai@meccg.local' },
  { name: 'server', email: 'server@meccg.local' },
  { name: 'admin', email: 'admin@meccg.local' },
];

/** Create system player accounts (ai, server) if they don't already exist. */
export function ensureSystemPlayers(): void {
  ensureDir();
  for (const { name, email } of SYSTEM_PLAYERS) {
    if (!findPlayer(name)) {
      const playerDir = path.join(PLAYERS_DIR, toDirName(name));
      fs.mkdirSync(playerDir, { recursive: true });
      const record: PlayerRecord = {
        name,
        email,
        passwordHash: '',
        createdAt: new Date().toISOString(),
        allowMasterKey: true,
      };
      fs.writeFileSync(path.join(playerDir, 'info.json'), JSON.stringify(record, null, 2));
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
