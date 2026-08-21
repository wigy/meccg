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
import { readJson, readJsonDir, writeJson } from '../json-store.js';
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
  return readJson<PlayerRecord>(infoPath(name));
}

/** Look up a player by email. Scans all player directories. Returns null if not found. */
export function findPlayerByEmail(email: string): PlayerRecord | null {
  ensureDir();
  const lower = email.toLowerCase();
  try {
    const entries = fs.readdirSync(PLAYERS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const record = readJson<PlayerRecord>(path.join(PLAYERS_DIR, entry.name, 'info.json'));
      if (record && record.email.toLowerCase() === lower) return record;
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
  return readJsonDir<unknown>(decksDir(name));
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
  return readJson<DeckList>(playerPath)
    ?? readJson<DeckList>(path.join(DECK_CATALOG_DIR, `${deckId}.json`));
}

/** List all stock decks from the catalog directory. */
export function listCatalogDecks(): DeckList[] {
  return readJsonDir<DeckList>(DECK_CATALOG_DIR);
}

/** Save a deck to a player's collection. Overwrites if same id exists. */
export function savePlayerDeck(name: string, deck: { id: string; [key: string]: unknown }): void {
  const filename = deck.id.replace(/[^a-z0-9-]/g, '-') + '.json';
  writeJson(path.join(decksDir(name), filename), deck);
}

/** Delete a deck from a player's collection. Returns true if the file existed. */
export function deletePlayerDeck(name: string, deckId: string): boolean {
  const dir = decksDir(name);
  const filename = deckId.replace(/[^a-z0-9-]/g, '-') + '.json';
  const filePath = path.join(dir, filename);
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
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
  writeJson(infoPath(name), record);
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

// ---- Credits ----

/** Default credits for new player accounts. */
export const DEFAULT_CREDITS = 1000;

/** Get the player's current credits balance. */
export function getCredits(name: string): number {
  return findPlayer(name)?.credits ?? DEFAULT_CREDITS;
}

/**
 * One entry in a player's credit history log. The file lives at
 * `~/.meccg/players/<dirname>/credits.json` as a JSON array of these
 * entries, written by `bin/credits` (the sole credit mutator) and read
 * by the lobby for the Credit Usage page.
 */
export interface CreditHistoryEntry {
  /** ISO 8601 timestamp of the change. */
  readonly datetime: string;
  /** Signed change in credits (positive = added, negative = deducted). */
  readonly amount: number;
  /** Resulting credits balance after the change was applied. */
  readonly balance: number;
  /** Human-readable reason (e.g. "Card request: Gandalf", "Manual top-up"). */
  readonly explanation: string;
}

/** Path to a player's credit history file. */
function creditsHistoryPath(name: string): string {
  return path.join(PLAYERS_DIR, toDirName(name), 'credits.json');
}

/**
 * Read a player's credit history. Returns the entries in chronological
 * order (oldest first), or an empty array if no history exists yet.
 */
export function readCreditHistory(name: string): CreditHistoryEntry[] {
  const parsed = readJson<unknown>(creditsHistoryPath(name));
  return Array.isArray(parsed) ? (parsed as CreditHistoryEntry[]) : [];
}

/**
 * Credits consumed since the most recent addition: the absolute total of
 * every negative entry that follows the last positive one. With no addition
 * on record, the whole history counts — that is the consumption since the
 * account's opening balance.
 */
export function consumptionSinceLastAddition(history: readonly CreditHistoryEntry[]): number {
  let lastAddition = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].amount > 0) { lastAddition = i; break; }
  }
  let spent = 0;
  for (const entry of history.slice(lastAddition + 1)) {
    if (entry.amount < 0) spent -= entry.amount;
  }
  return spent;
}

/**
 * The top-up the admin screen offers: consumption since the last addition
 * times 1.5, rounded up to the nearest hundred. Zero when nothing has been
 * spent since, so the button has nothing to add.
 */
export function pendingTopUp(history: readonly CreditHistoryEntry[]): number {
  const spent = consumptionSinceLastAddition(history);
  if (spent <= 0) return 0;
  return Math.ceil((spent * 1.5) / 100) * 100;
}

/** Outcome of {@link updateCredits}. */
export interface CreditUpdateResult {
  /** Balance before the change. */
  readonly previous: number;
  /** Balance after the change. */
  readonly balance: number;
  /** Signed change applied (balance - previous). */
  readonly delta: number;
}

/**
 * Mutate a player's credit balance and append an audit entry to their
 * history file. Mirrors the behavior of `bin/credits add|set` so remote
 * AI workers can charge credits over the system API without shelling out
 * to the script. Returns null if the player does not exist.
 *
 * @param mode  'add' applies a signed delta; 'set' replaces the balance outright
 * @param amount  Signed integer (for 'add') or absolute value (for 'set')
 * @param reason  Human-readable explanation recorded in credits.json
 */
export function updateCredits(
  name: string,
  mode: 'add' | 'set',
  amount: number,
  reason: string,
): CreditUpdateResult | null {
  const player = findPlayer(name);
  if (!player) return null;
  const previous = player.credits ?? DEFAULT_CREDITS;
  const balance = mode === 'add' ? previous + amount : amount;
  const delta = balance - previous;
  updatePlayer(name, { ...player, credits: balance });
  const entry: CreditHistoryEntry = {
    datetime: new Date().toISOString(),
    amount: delta,
    balance,
    explanation: reason,
  };
  const history = readCreditHistory(name);
  history.push(entry);
  writeJson(creditsHistoryPath(name), history);
  return { previous, balance, delta };
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
      const record: PlayerRecord = {
        name,
        email,
        passwordHash: '',
        createdAt: new Date().toISOString(),
        allowMasterKey: true,
        ...(displayName ? { displayName } : {}),
      };
      writeJson(path.join(PLAYERS_DIR, toDirName(name), 'info.json'), record);
    } else if (displayName && existing.displayName !== displayName) {
      updatePlayer(name, { ...existing, displayName });
    }
  }
}

// ---- Admin listings ----

/** One row of the admin user list. */
export interface PlayerSummary {
  readonly name: string;
  readonly displayName: string;
  readonly email: string;
  readonly credits: number;
  readonly createdAt: string;
  /** True for the auto-created accounts (ai, server, admin, reviewers). */
  readonly system: boolean;
}

/**
 * A player's full account record for the admin detail view, with the
 * password hash replaced by a boolean — the admin needs to know whether a
 * password is set, never what it hashes to.
 */
export interface PlayerProfile extends Omit<PlayerRecord, 'passwordHash'> {
  readonly hasPassword: boolean;
  readonly system: boolean;
}

/** Every account on disk, ordered by name. Unreadable records are skipped. */
export function listPlayers(): PlayerSummary[] {
  ensureDir();
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(PLAYERS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  const rows: PlayerSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const record = readJson<PlayerRecord>(path.join(PLAYERS_DIR, entry.name, 'info.json'));
    if (!record) continue;
    rows.push({
      name: record.name,
      displayName: record.displayName ?? record.name,
      email: record.email,
      credits: record.credits ?? DEFAULT_CREDITS,
      createdAt: record.createdAt,
      system: isSystemPlayer(record.name),
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/** A player's account record without the password hash. Null if unknown. */
export function getPlayerProfile(name: string): PlayerProfile | null {
  const player = findPlayer(name);
  if (!player) return null;
  const { passwordHash, ...rest } = player;
  return {
    ...rest,
    credits: player.credits ?? DEFAULT_CREDITS,
    hasPassword: passwordHash !== '',
    system: isSystemPlayer(player.name),
  };
}

/** Whether the name belongs to an auto-created system account. */
function isSystemPlayer(name: string): boolean {
  return SYSTEM_PLAYERS.some(p => p.name.toLowerCase() === name.toLowerCase());
}

/** Save a new player record. Throws if the name is already taken. */
export function createPlayer(record: PlayerRecord): void {
  ensureDir();
  const playerDir = path.join(PLAYERS_DIR, toDirName(record.name));
  const filePath = path.join(playerDir, 'info.json');
  if (fs.existsSync(filePath)) {
    throw new Error(`Player "${record.name}" already exists`);
  }
  writeJson(filePath, record);
}
