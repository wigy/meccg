/**
 * @module games/scoreboard
 *
 * Scoreboard built from the completed-game records the game-server writes
 * to `~/.meccg/games/<gameId>.json` (see `game-record.ts` in
 * `@meccg/game-server`; the directory convention is shared via the
 * `GAME_RECORDS_DIR` env variable, the same way `PLAYERS_DIR` is). With no
 * ratings yet, rows are ordered by games played.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * The slice of a completed-game record the scoreboard reads. Structural
 * rather than imported: the lobby does not depend on `@meccg/game-server`,
 * and older records may lack newer fields (e.g. `human`).
 */
export interface ScoreboardGameRecord {
  readonly endedAt?: string;
  readonly winner?: string | null;
  readonly players?: readonly { readonly name?: string; readonly human?: boolean }[];
}

/** One scoreboard row: a player and their completed-game tally. */
export interface ScoreboardRow {
  readonly name: string;
  readonly human: boolean;
  readonly games: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  /** `endedAt` of the player's most recent game, ISO timestamp. */
  readonly lastPlayed: string | null;
}

/** Where the game-server writes completed-game records. */
function gameRecordsDir(): string {
  return process.env.GAME_RECORDS_DIR ?? path.join(os.homedir(), '.meccg', 'games');
}

/**
 * Aggregate records into per-player rows, sorted by games played
 * (descending), ties by name. Records that predate the `human` flag fall
 * back to the lobby's `AI-` naming convention.
 */
export function aggregateScoreboard(records: readonly ScoreboardGameRecord[]): ScoreboardRow[] {
  const byName = new Map<string, {
    name: string; human: boolean; games: number; wins: number; losses: number; draws: number;
    lastPlayed: string | null;
  }>();

  for (const record of records) {
    for (const player of record.players ?? []) {
      if (!player.name) continue;
      const key = player.name.toLowerCase();
      let row = byName.get(key);
      if (!row) {
        row = { name: player.name, human: true, games: 0, wins: 0, losses: 0, draws: 0, lastPlayed: null };
        byName.set(key, row);
      }
      row.human = player.human ?? !/^ai-/i.test(player.name);
      row.games++;
      if (record.winner == null) row.draws++;
      else if (record.winner.toLowerCase() === key) row.wins++;
      else row.losses++;
      if (record.endedAt && (row.lastPlayed === null || record.endedAt > row.lastPlayed)) {
        row.lastPlayed = record.endedAt;
      }
    }
  }

  return [...byName.values()].sort((a, b) =>
    b.games - a.games || a.name.localeCompare(b.name));
}

/**
 * Read every record in the games directory and aggregate it. Unreadable or
 * malformed files are skipped — a corrupt record must not take the
 * scoreboard down. Returns an empty list when the directory does not exist
 * (no completed games yet).
 */
export function loadScoreboard(): ScoreboardRow[] {
  const dir = gameRecordsDir();
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  } catch {
    return [];
  }
  const records: ScoreboardGameRecord[] = [];
  for (const file of files) {
    try {
      records.push(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')) as ScoreboardGameRecord);
    } catch {
      // Skip malformed records.
    }
  }
  return aggregateScoreboard(records);
}
