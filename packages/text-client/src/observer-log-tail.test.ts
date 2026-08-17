/**
 * @module observer-log-tail.test
 *
 * The observer's window into a *live* game log
 * (`specs/2026-08-17-ask-ai-observer.md`). Two properties of a log being
 * written underneath the reader drive every case here: the last line may be
 * half-written, and the file is not append-only — a dev `undo` truncates it.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { GameLogRecord } from '@meccg/sim';
import { openLogTail, resolveRecord } from './observer-log-tail.js';

let dir: string;
let logPath: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meccg-observer-tail-'));
  logPath = path.join(dir, 'game.jsonl');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** One state record, as the game server writes them. */
function record(stateSeq: number, turn = 1): string {
  const entry = {
    ts: new Date(0).toISOString(),
    event: 'state',
    stateSeq,
    turn,
    phase: 'site',
    activePlayer: 'p1',
    state: { stateSeq, turnNumber: turn, players: [] },
  };
  return `${JSON.stringify(entry)}\n`;
}

describe('following a log', () => {
  test('returns nothing while the log does not exist yet', () => {
    const tail = openLogTail(logPath);
    expect(tail.newest()).toBeNull();
    expect(tail.at(1)).toBeNull();
  });

  test('picks up records as they are appended', () => {
    fs.writeFileSync(logPath, record(1));
    const tail = openLogTail(logPath);
    expect(tail.at(1)?.stateSeq).toBe(1);
    expect(tail.at(2)).toBeNull();

    fs.appendFileSync(logPath, record(2, 2));
    expect(tail.at(2)?.turn).toBe(2);
    expect(tail.newest()?.stateSeq).toBe(2);
  });

  test('skips a half-written final line and reads it once complete', () => {
    // The writer got as far as the opening brace of the next record.
    fs.writeFileSync(logPath, `${record(1)}{"event":"state","stateSeq":2,"st`);
    const tail = openLogTail(logPath);
    expect(tail.newest()?.stateSeq).toBe(1);

    // Rest of the line lands.
    fs.appendFileSync(logPath, 'ate":{"stateSeq":2,"players":[]},"turn":2,"phase":"site"}\n');
    expect(tail.at(2)?.stateSeq).toBe(2);
  });

  test('re-reads from the start when the log is truncated', () => {
    fs.writeFileSync(logPath, record(1) + record(2) + record(3));
    const tail = openLogTail(logPath);
    expect(tail.newest()?.stateSeq).toBe(3);

    // A dev `undo` calls truncateAfterSeq, so the file shrinks and everything
    // cached from the old tail may be wrong.
    fs.writeFileSync(logPath, record(1));
    expect(tail.newest()?.stateSeq).toBe(1);
    expect(tail.at(3)).toBeNull();
  });

  test('keeps the newest copy of a re-recorded sequence number', () => {
    fs.writeFileSync(logPath, record(4, 1));
    const tail = openLogTail(logPath);
    expect(tail.at(4)?.turn).toBe(1);

    // Replayed after an undo: same seq, different content.
    fs.appendFileSync(logPath, record(4, 7));
    expect(tail.at(4)?.turn).toBe(7);
  });

  test('resolves a game id against the standard log directory', () => {
    const tail = openLogTail('alice-vs-bob-1755000000000');
    expect(tail.path).toContain(path.join('.meccg', 'logs', 'games'));
    expect(tail.path).toContain('alice-vs-bob-1755000000000.jsonl');
  });
});

describe('resolveRecord', () => {
  /** A sleep that also lets the log gain the record being waited for. */
  function sleepThatWrites(writeAt: number, line: string): (ms: number) => Promise<void> {
    let calls = 0;
    return () => {
      if (++calls === writeAt) fs.appendFileSync(logPath, line);
      return Promise.resolve();
    };
  }

  test('returns the exact record when it is already there', async () => {
    fs.writeFileSync(logPath, record(9));
    const resolved = await resolveRecord(openLogTail(logPath), 9);
    expect(resolved).toMatchObject({ exact: true });
    expect(resolved?.record.stateSeq).toBe(9);
  });

  test('waits out the write race and then returns the exact record', async () => {
    fs.writeFileSync(logPath, record(9));
    const tail = openLogTail(logPath);
    // The broadcast that prompted the question can beat the log write.
    const resolved = await resolveRecord(tail, 10, {
      sleep: sleepThatWrites(2, record(10)),
    });
    expect(resolved).toMatchObject({ exact: true });
    expect(resolved?.record.stateSeq).toBe(10);
  });

  test('falls back to the newest record, flagged as not exact', async () => {
    fs.writeFileSync(logPath, record(9));
    const resolved = await resolveRecord(openLogTail(logPath), 42, {
      timeoutMs: 10,
      pollMs: 5,
      sleep: () => Promise.resolve(),
    });
    // The caller says so in the output: an explanation of the wrong position
    // must never look like an explanation of the right one.
    expect(resolved?.exact).toBe(false);
    expect(resolved?.record.stateSeq).toBe(9);
  });

  test('returns null when the log has nothing at all', async () => {
    const resolved = await resolveRecord(openLogTail(logPath), 1, {
      timeoutMs: 0,
      sleep: () => Promise.resolve(),
    });
    expect(resolved).toBeNull();
  });

  test('the records it returns carry the full state the explainer needs', async () => {
    fs.writeFileSync(logPath, record(3));
    const resolved = await resolveRecord(openLogTail(logPath), 3);
    const state = resolved?.record.state as unknown as { stateSeq: number };
    expect(state.stateSeq).toBe(3);
    // Typing check: it is a GameLogRecord, the shape explainDecision consumes.
    const typed: GameLogRecord | undefined = resolved?.record;
    expect(typed?.activePlayer).toBe('p1');
  });
});
