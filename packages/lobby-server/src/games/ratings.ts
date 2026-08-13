/**
 * @module games/ratings
 *
 * Read side of the Elo ratings the game-server writes to
 * `~/.meccg/players/<name>/rating.json` (see `rating-store.ts` in
 * `@meccg/game-server`; the directory convention is shared via `PLAYERS_DIR`,
 * the same way `GAME_RECORDS_DIR` is). The lobby never writes these files —
 * `bin/ratings rebuild` is the only thing that touches them out of band.
 *
 * The stored shape is declared structurally rather than imported, for the same
 * reason `scoreboard.ts` declares the game record structurally: the lobby does
 * not depend on `@meccg/game-server`, and files written by older versions may
 * lack newer fields.
 */

import * as fs from 'fs';
import * as path from 'path';
import { PLAYERS_DIR } from '../config.js';

/** One rated game as stored in a player's rating history. */
export interface StoredRatingHistoryEntry {
  readonly gameId?: string;
  readonly opponent?: string;
  readonly opponentRating?: number;
  readonly before?: number;
  readonly after?: number;
  readonly delta?: number;
}

/** A player's rating file, as read off disk. */
export interface StoredRating {
  readonly name?: string;
  readonly rating?: number;
  readonly peak?: number;
  readonly games?: number;
  readonly provisional?: boolean;
  readonly updatedAt?: string | null;
  readonly history?: readonly StoredRatingHistoryEntry[];
}

/** A player's rating as the scoreboard consumes it. */
export interface PlayerRatingSummary {
  readonly rating: number;
  readonly peak: number;
  readonly ratedGames: number;
  readonly provisional: boolean;
}

/**
 * Every rating on disk, keyed by lowercase player name — the same key
 * `aggregateScoreboard` and `playerGames` use. Unreadable or malformed files
 * are skipped: a corrupt rating must not take the scoreboard down.
 */
export function loadRatings(): Map<string, PlayerRatingSummary> {
  const ratings = new Map<string, PlayerRatingSummary>();
  for (const [, stored] of readRatingFiles()) {
    if (!stored.name || typeof stored.rating !== 'number') continue;
    ratings.set(stored.name.toLowerCase(), {
      rating: stored.rating,
      peak: stored.peak ?? stored.rating,
      ratedGames: stored.games ?? 0,
      provisional: stored.provisional ?? true,
    });
  }
  return ratings;
}

/**
 * One player's rating history keyed by game id, for annotating the games on
 * the player detail page. Empty when the player has no rating file yet.
 */
export function loadRatingHistory(playerName: string): Map<string, StoredRatingHistoryEntry> {
  const key = playerName.toLowerCase();
  const byGame = new Map<string, StoredRatingHistoryEntry>();
  for (const [, stored] of readRatingFiles()) {
    if (stored.name?.toLowerCase() !== key) continue;
    for (const entry of stored.history ?? []) {
      if (entry.gameId) byGame.set(entry.gameId, entry);
    }
  }
  return byGame;
}

/** Read every `rating.json` under the players directory, dir name and all. */
function readRatingFiles(): [string, StoredRating][] {
  let dirs: string[];
  try {
    dirs = fs.readdirSync(PLAYERS_DIR);
  } catch {
    return [];
  }
  const files: [string, StoredRating][] = [];
  for (const dir of dirs) {
    try {
      const raw = fs.readFileSync(path.join(PLAYERS_DIR, dir, 'rating.json'), 'utf-8');
      files.push([dir, JSON.parse(raw) as StoredRating]);
    } catch {
      // No rating file for this account, or it is malformed.
    }
  }
  return files;
}
