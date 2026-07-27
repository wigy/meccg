/**
 * @module ai/h2/game-log
 *
 * Reader for the game-server's JSONL game logs, the source of real positions
 * for the scenario corpus.
 *
 * The lobby's game server writes one record per state change to
 * `~/.meccg/logs/games/<gameId>.jsonl` (see `game-server/src/ws/game-log.ts`),
 * each carrying the full `GameState`. That makes `gameId#stateSeq` a stable
 * address for any position a real game ever reached — which is exactly what
 * `explain --game <id> --seq <n>` and `scenarios capture --game` need, and why
 * H2 does not have to invent its own recording format.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { GameState, PlayerId } from '@meccg/shared';

/** One record of a game log. Fields beyond these exist but are not needed here. */
export interface GameLogRecord {
  /** Record kind, e.g. `state` or `restore`. */
  readonly event: string;
  /** Engine state sequence number this record describes. */
  readonly stateSeq: number;
  /** Turn number at that point. */
  readonly turn: number;
  /** Phase at that point. */
  readonly phase: string;
  /** Setup step, when in setup. */
  readonly step?: string;
  /** Active player, or null in simultaneous phases. */
  readonly activePlayer: PlayerId | null;
  /** The full game state. */
  readonly state: GameState;
}

/** Default directory the game server writes logs to. */
export function gameLogDir(): string {
  return path.join(os.homedir(), '.meccg', 'logs', 'games');
}

/** Resolve a game reference — either a bare game ID or a path to a log file. */
export function resolveGameLogPath(gameIdOrPath: string): string {
  if (gameIdOrPath.includes('/') || gameIdOrPath.endsWith('.jsonl')) return gameIdOrPath;
  return path.join(gameLogDir(), `${gameIdOrPath}.jsonl`);
}

/**
 * Read every state record of a game log.
 *
 * Malformed trailing lines are skipped rather than fatal: a log belonging to a
 * game that is still in progress (or one whose server was killed mid-write)
 * is a perfectly good source for every position it did record.
 */
export function readGameLog(gameIdOrPath: string): GameLogRecord[] {
  const file = resolveGameLogPath(gameIdOrPath);
  if (!fs.existsSync(file)) throw new Error(`Game log not found: ${file}`);
  const records: GameLogRecord[] = [];
  for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
    if (line.trim().length === 0) continue;
    try {
      const record = JSON.parse(line) as GameLogRecord;
      if (record.state && typeof record.stateSeq === 'number') records.push(record);
    } catch {
      // Truncated final line of a live log — everything before it is still usable.
    }
  }
  return records;
}

/** The record at a given state sequence number, with a listing of what exists. */
export function findGameLogRecord(gameIdOrPath: string, stateSeq: number): GameLogRecord {
  const records = readGameLog(gameIdOrPath);
  const found = records.find(r => r.stateSeq === stateSeq);
  if (!found) {
    const seqs = records.map(r => r.stateSeq);
    const range = seqs.length === 0 ? '(none)' : `${Math.min(...seqs)}..${Math.max(...seqs)}`;
    throw new Error(`No record with stateSeq ${stateSeq} in ${resolveGameLogPath(gameIdOrPath)} — available: ${range}`);
  }
  return found;
}
