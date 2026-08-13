#!/usr/bin/env -S npx tsx
/**
 * @module bin/ratings
 *
 * List and rebuild player Elo ratings on disk. Ratings live in
 * `~/.meccg/players/<dirname>/rating.json` and are normally maintained by the
 * game-server the moment a game record is written (see `rating-store.ts` in
 * `@meccg/game-server` — the sole writer on the live path).
 *
 * `rebuild` is the migration: it discards every stored rating and replays
 * every completed-game record in `~/.meccg/games` in the order the games
 * finished, so ratings that predate the feature — or that drifted because a
 * record was rewritten after an undo — are recomputed from the full log.
 * It is idempotent: replaying the same log always yields the same ratings.
 *
 * Usage:
 *   bin/ratings.ts                    List every rated player, best first
 *   bin/ratings.ts rebuild            Replay every game record and rewrite ratings
 *   bin/ratings.ts rebuild --dry-run  Show what a rebuild would produce, write nothing
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { applyRatedGame, initialRating } from '../packages/game-server/src/ws/elo.js';
import type { PlayerRating } from '../packages/game-server/src/ws/elo.js';
import {
  playersDir, rebuildRatings, toDirName,
} from '../packages/game-server/src/ws/rating-store.js';
import type { RatableGame } from '../packages/game-server/src/ws/rating-store.js';

const GAME_RECORDS_DIR = process.env.GAME_RECORDS_DIR ?? join(homedir(), '.meccg', 'games');

/** The slice of a completed-game record this tool reads. */
interface GameRecordFile {
  readonly gameId?: string;
  readonly endedAt?: string;
  readonly winner?: string | null;
  readonly players?: readonly { readonly name?: string; readonly human?: boolean }[];
}

/**
 * Every completed-game record that can be rated. Records missing an id, an end
 * timestamp or two named players are skipped and reported — a malformed record
 * must not abort the rebuild.
 */
function readRatableGames(): { games: RatableGame[]; skipped: number } {
  let files: string[];
  try {
    files = readdirSync(GAME_RECORDS_DIR).filter(f => f.endsWith('.json'));
  } catch {
    return { games: [], skipped: 0 };
  }

  const games: RatableGame[] = [];
  let skipped = 0;
  for (const file of files) {
    let record: GameRecordFile;
    try {
      record = JSON.parse(readFileSync(join(GAME_RECORDS_DIR, file), 'utf-8')) as GameRecordFile;
    } catch {
      skipped++;
      continue;
    }
    const players = record.players ?? [];
    if (!record.gameId || !record.endedAt || players.length !== 2
        || !players[0]?.name || !players[1]?.name) {
      skipped++;
      continue;
    }
    games.push({
      gameId: record.gameId,
      endedAt: record.endedAt,
      winner: record.winner ?? null,
      players: players.map(p => ({
        name: p.name!,
        // Records predating the flag fall back to the lobby's AI- convention,
        // matching how the scoreboard reads the same records.
        human: p.human ?? !/^ai-/i.test(p.name!),
      })),
    });
  }
  return { games, skipped };
}

/** Replay the log in memory without touching disk, for `--dry-run`. */
function simulate(games: readonly RatableGame[]): PlayerRating[] {
  const ordered = [...games].sort((a, b) =>
    a.endedAt.localeCompare(b.endedAt) || a.gameId.localeCompare(b.gameId));
  const ratings = new Map<string, PlayerRating>();

  for (const game of ordered) {
    const [first, second] = game.players;
    if (toDirName(first.name) === toDirName(second.name)) continue;
    const [a, b] = applyRatedGame(
      ratings.get(toDirName(first.name)) ?? initialRating(first.name, first.human),
      ratings.get(toDirName(second.name)) ?? initialRating(second.name, second.human),
      { gameId: game.gameId, endedAt: game.endedAt, winner: game.winner },
    );
    ratings.set(toDirName(a.name), a);
    ratings.set(toDirName(b.name), b);
  }
  return [...ratings.values()].sort((a, b) => b.rating - a.rating);
}

/** Read every rating file currently on disk, best rating first. */
function readStoredRatings(): PlayerRating[] {
  let dirs: string[];
  try {
    dirs = readdirSync(playersDir());
  } catch {
    return [];
  }
  const ratings: PlayerRating[] = [];
  for (const dir of dirs) {
    try {
      ratings.push(JSON.parse(
        readFileSync(join(playersDir(), dir, 'rating.json'), 'utf-8')) as PlayerRating);
    } catch {
      // No rating file for this account, or it is malformed.
    }
  }
  return ratings.sort((a, b) => b.rating - a.rating);
}

/** Print ratings as an aligned table. */
function print(ratings: readonly PlayerRating[]): void {
  if (ratings.length === 0) {
    console.log('No rated players.');
    return;
  }
  const width = Math.max(...ratings.map(r => r.name.length), 6);
  console.log(`${'#'.padStart(3)}  ${'Player'.padEnd(width)}  Rating  Peak  Games   W   L   D`);
  ratings.forEach((r, index) => {
    const rating = `${r.rating}${r.provisional ? '?' : ' '}`;
    console.log(
      `${String(index + 1).padStart(3)}  ${r.name.padEnd(width)}  ${rating.padStart(6)}  `
      + `${String(r.peak).padStart(4)}  ${String(r.games).padStart(5)}  `
      + `${String(r.wins).padStart(2)}  ${String(r.losses).padStart(2)}  ${String(r.draws).padStart(2)}`
      + `${r.human ? '' : '  (AI)'}`);
  });
  console.log('\n? = provisional (fewer than 15 rated games)');
}

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: bin/ratings.ts [command]

Commands:
  (none)              List every rated player, best first
  rebuild             Replay every completed game and rewrite all rating files
  rebuild --dry-run   Show what a rebuild would produce, write nothing

Games are read from ${GAME_RECORDS_DIR}
Ratings are written to ${playersDir()}/<player>/rating.json`);
  process.exit(0);
}

if (args[0] === 'rebuild') {
  const { games, skipped } = readRatableGames();
  const dryRun = args.includes('--dry-run');
  console.log(`Read ${games.length} ratable game record${games.length === 1 ? '' : 's'} `
    + `from ${GAME_RECORDS_DIR}${skipped > 0 ? ` (${skipped} skipped as unusable)` : ''}.`);

  const ratings = dryRun ? simulate(games) : rebuildRatings(games);
  print(ratings);
  console.log(dryRun
    ? '\nDry run — nothing was written.'
    : `\nWrote ${ratings.length} rating file${ratings.length === 1 ? '' : 's'} under ${playersDir()}.`);
} else if (args.length === 0) {
  print(readStoredRatings());
} else {
  console.error(`Unknown command: ${args[0]}\nRun bin/ratings.ts --help for usage.`);
  process.exit(1);
}
