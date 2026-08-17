/**
 * @module observer-log-tail
 *
 * Follows a live game log and hands back the full `GameState` at any
 * `stateSeq` — the Ask AI observer's window into the position on the asker's
 * screen (`specs/2026-08-17-ask-ai-observer.md`).
 *
 * Why the log rather than the socket: an honest explanation of one seat's
 * decision must be computed from that seat's *own* projected view, which
 * requires the full state, and the game server never ships one — it projects
 * per player. The server does write every position to
 * `~/.meccg/logs/games/<gameId>.jsonl`, which is the same input
 * `explain --game <id> --seq <n>` already reads.
 *
 * Two properties of a *live* log drive the design:
 *
 * - The last line may be half-written, so a parse failure at the tail is normal
 *   and must not be fatal.
 * - It is not append-only. `undo` and `load` call the session's
 *   `truncateAfterSeq`, so the file can shrink; when it does, everything cached
 *   from the old tail may be wrong and the file has to be re-read.
 */

import * as fs from 'fs';
import type { GameLogRecord } from '@meccg/sim';
import { resolveGameLogPath } from '@meccg/sim';

/** How many recent records are kept — enough to answer about a position a few moves back. */
const RING_SIZE = 400;

/** A live tail over one game's log. */
export interface LogTail {
  /** The record at `stateSeq`, or null when the log does not have it (yet). */
  at(stateSeq: number): GameLogRecord | null;
  /** The most recent record read, or null when the log is empty. */
  newest(): GameLogRecord | null;
  /** Read whatever has been appended since the last call. Cheap when nothing has. */
  poll(): void;
  /** Path being followed, for logging. */
  readonly path: string;
}

/**
 * Open a tail over the log of `gameIdOrPath`.
 *
 * Polling rather than watching: `fs.watch` semantics differ per platform and a
 * missed event would mean answering about a position the observer cannot see,
 * while a stat call per question costs nothing.
 */
export function openLogTail(gameIdOrPath: string): LogTail {
  const path = resolveGameLogPath(gameIdOrPath);
  const records = new Map<number, GameLogRecord>();
  let order: number[] = [];
  let offset = 0;
  let carry = '';

  const remember = (record: GameLogRecord): void => {
    if (!records.has(record.stateSeq)) order.push(record.stateSeq);
    records.set(record.stateSeq, record);
    if (order.length > RING_SIZE) {
      const dropped = order.splice(0, order.length - RING_SIZE);
      for (const seq of dropped) {
        // A re-recorded seq (dev undo, then replay) keeps its newest copy: only
        // drop the entry if this seq is not still in the retained window.
        if (!order.includes(seq)) records.delete(seq);
      }
    }
  };

  const reset = (): void => {
    records.clear();
    order = [];
    offset = 0;
    carry = '';
  };

  const poll = (): void => {
    let size: number;
    try {
      size = fs.statSync(path).size;
    } catch {
      // Not written yet — the game may still be starting.
      return;
    }
    // A shrunk file is a rewritten history (`undo`, `load`), not an append:
    // everything after the truncation point is gone, so start over.
    if (size < offset) reset();
    if (size === offset) return;

    const fd = fs.openSync(path, 'r');
    try {
      const length = size - offset;
      const buffer = Buffer.allocUnsafe(length);
      fs.readSync(fd, buffer, 0, length, offset);
      offset = size;
      const text = carry + buffer.toString('utf-8');
      const lines = text.split('\n');
      // Whatever follows the final newline is an incomplete line; hold it back
      // until the writer finishes it.
      carry = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim().length === 0) continue;
        try {
          const record = JSON.parse(line) as GameLogRecord;
          if (record.state && typeof record.stateSeq === 'number') remember(record);
        } catch {
          // A line that never parses (a partial write the writer abandoned) is
          // skipped; every record before it is still usable.
        }
      }
    } finally {
      fs.closeSync(fd);
    }
  };

  return {
    path,
    poll,
    at(stateSeq: number): GameLogRecord | null {
      poll();
      return records.get(stateSeq) ?? null;
    },
    newest(): GameLogRecord | null {
      poll();
      const seq = order[order.length - 1];
      return seq === undefined ? null : records.get(seq) ?? null;
    },
  };
}

/** Outcome of waiting for a position: the record, and whether it is the one asked for. */
export interface ResolvedRecord {
  readonly record: GameLogRecord;
  /** False when the exact `stateSeq` never landed and the newest record was used. */
  readonly exact: boolean;
}

/**
 * Wait briefly for the record at `stateSeq`, then settle for the newest one.
 *
 * The question carries the server's authoritative sequence number, and the
 * broadcast that prompted it can beat the log write by a few milliseconds — so a
 * miss is usually a race, not an absence. Falling back to the newest record
 * rather than failing keeps a question answerable; the caller says so in the
 * output, because an explanation of the wrong position must never look like an
 * explanation of the right one.
 */
export async function resolveRecord(
  tail: LogTail,
  stateSeq: number,
  options: { timeoutMs?: number; pollMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<ResolvedRecord | null> {
  const timeoutMs = options.timeoutMs ?? 2_000;
  const pollMs = options.pollMs ?? 50;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));

  for (let waited = 0; ; waited += pollMs) {
    const exact = tail.at(stateSeq);
    if (exact) return { record: exact, exact: true };
    if (waited >= timeoutMs) break;
    await sleep(pollMs);
  }
  const newest = tail.newest();
  return newest ? { record: newest, exact: newest.stateSeq === stateSeq } : null;
}
