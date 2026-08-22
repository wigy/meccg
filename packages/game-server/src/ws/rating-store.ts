/**
 * @module rating-store
 *
 * The sole writer of `~/.meccg/players/<name>/rating.json`, the file holding
 * a player's Elo rating and the history of rated games behind it. It sits
 * beside the account's `info.json` (owned by the lobby) and `games.json`
 * (this package's per-player history), following the same one-directory-per-
 * player convention as `bin/credits`.
 *
 * Ratings are updated the moment a game record is written — the same single
 * point per game as `game-record.ts` — because that is the only place both
 * player names, the outcome and the engine `gameId` are known together. The
 * lobby cannot do it: it only ever learns a game's *port*, never its gameId.
 *
 * Every update is idempotent in the `gameId`, so re-running the whole log is
 * safe. `bin/ratings rebuild` does exactly that, which is how ratings get
 * seeded from games finished before this module existed and how a rewritten
 * record (undo, then game over again) is reconciled.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { writeFileAtomic } from './atomic-write.js';
import { applyRatedGame, initialRating } from './elo.js';
import type { PlayerRating, RatedGameResult } from './elo.js';
import type { CompletedGameRecord } from './game-record.js';

/**
 * Where player account directories live; mirrors the lobby's `PLAYERS_DIR`.
 * Read on each call rather than captured at load, the same way `scoreboard.ts`
 * resolves the records directory, so a test can redirect it.
 */
export function playersDir(): string {
  return process.env.PLAYERS_DIR ?? path.join(os.homedir(), '.meccg', 'players');
}

/**
 * A player's directory name. Identical to `toDirName` in the lobby's
 * `players/store.ts` — the two must agree or ratings land beside the wrong
 * account.
 */
export function toDirName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '-');
}

/** Path of a player's rating file, whether or not it exists yet. */
export function ratingPath(name: string): string {
  return path.join(playersDir(), toDirName(name), 'rating.json');
}

/**
 * Read a player's rating, or the unrated starting point when the file is
 * missing or unreadable. A corrupt rating file must not stop a game being
 * recorded, and `bin/ratings rebuild` can always restore it from the log.
 */
export function readRating(name: string, human: boolean): PlayerRating {
  try {
    const parsed = JSON.parse(fs.readFileSync(ratingPath(name), 'utf-8')) as PlayerRating;
    // Keep the name and AI flag fresh: the record is the authority on both.
    return { ...parsed, name, human };
  } catch {
    return initialRating(name, human);
  }
}

/** Write a player's rating file, creating the account directory if needed. */
export function writeRating(rating: PlayerRating): string {
  const filePath = ratingPath(rating.name);
  writeFileAtomic(filePath, JSON.stringify(rating, null, 2) + '\n');
  return filePath;
}

/** The rating-relevant slice of a completed-game record. */
export interface RatableGame {
  readonly gameId: string;
  readonly endedAt: string;
  readonly winner: string | null;
  readonly players: readonly { readonly name: string; readonly human: boolean }[];
}

/**
 * Fold one finished game into both players' ratings on disk and return the
 * updated pair, or null when the game cannot be rated (not exactly two named
 * players, or already counted). Both files are rewritten; a player facing
 * themselves is refused rather than double-counted.
 */
export function recordRatedGame(game: RatableGame): readonly [PlayerRating, PlayerRating] | null {
  const [first, second] = game.players;
  if (!first?.name || !second?.name) return null;
  if (toDirName(first.name) === toDirName(second.name)) return null;

  const result: RatedGameResult = {
    gameId: game.gameId,
    endedAt: game.endedAt,
    winner: game.winner,
  };
  const before = [
    readRating(first.name, first.human),
    readRating(second.name, second.human),
  ] as const;
  const after = applyRatedGame(before[0], before[1], result);
  if (after[0] === before[0] && after[1] === before[1]) return null;

  writeRating(after[0]);
  writeRating(after[1]);
  return after;
}

/** Narrow a full game record to what {@link recordRatedGame} needs. */
export function toRatableGame(record: CompletedGameRecord): RatableGame {
  return {
    gameId: record.gameId,
    endedAt: record.endedAt,
    winner: record.winner,
    players: record.players.map(p => ({ name: p.name, human: p.human })),
  };
}

/**
 * Recompute every rating from scratch by replaying `games` in the order they
 * finished, and write the result. Ratings are order-dependent, so the replay
 * order — `endedAt` ascending, `gameId` breaking ties — defines the outcome;
 * it matches the order the live path applies games in.
 *
 * Existing rating files for players not appearing in `games` are deleted, so
 * a rebuild leaves no stale ratings behind.
 */
export function rebuildRatings(
  games: readonly RatableGame[],
  humanByName: ReadonlyMap<string, boolean> = new Map(),
): PlayerRating[] {
  const ordered = [...games].sort((a, b) =>
    a.endedAt.localeCompare(b.endedAt) || a.gameId.localeCompare(b.gameId));

  const ratings = new Map<string, PlayerRating>();
  const get = (name: string, human: boolean): PlayerRating =>
    ratings.get(toDirName(name)) ?? initialRating(name, human);

  for (const game of ordered) {
    const [first, second] = game.players;
    if (!first?.name || !second?.name) continue;
    if (toDirName(first.name) === toDirName(second.name)) continue;

    const humanFirst = humanByName.get(toDirName(first.name)) ?? first.human;
    const humanSecond = humanByName.get(toDirName(second.name)) ?? second.human;
    const [a, b] = applyRatedGame(
      { ...get(first.name, humanFirst), human: humanFirst },
      { ...get(second.name, humanSecond), human: humanSecond },
      { gameId: game.gameId, endedAt: game.endedAt, winner: game.winner },
    );
    ratings.set(toDirName(a.name), a);
    ratings.set(toDirName(b.name), b);
  }

  for (const rating of ratings.values()) writeRating(rating);
  removeStaleRatings(new Set(ratings.keys()));
  return [...ratings.values()].sort((a, b) => b.rating - a.rating);
}

/** Delete rating files for accounts no longer backed by any game record. */
function removeStaleRatings(keep: ReadonlySet<string>): void {
  let dirs: string[];
  try {
    dirs = fs.readdirSync(playersDir());
  } catch {
    return;
  }
  for (const dir of dirs) {
    if (keep.has(dir)) continue;
    try {
      fs.rmSync(path.join(playersDir(), dir, 'rating.json'));
    } catch {
      // No rating file for this account, or it is not ours to remove.
    }
  }
}
