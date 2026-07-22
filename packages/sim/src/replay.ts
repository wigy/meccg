/**
 * @module replay
 *
 * Replay persistence and verification. A replay is a JSONL file: one
 * {@link ReplayHeader} line, then interleaved {@link DecisionRecord} and
 * {@link TransitionRecord} lines in game order, closed by a
 * {@link GameResultRecord} line. The header (seed + deck IDs) plus the
 * recorded actions make every replay independently verifiable: because the
 * engine is a deterministic pure reducer, re-applying the recorded actions
 * from the same seed must reproduce the same state sequence, which
 * {@link verifyReplay} checks step by step.
 */

import * as fs from 'fs';
import { createGame, reduce, loadCardPool, setEngineConsoleLog, Phase } from '@meccg/shared';
import type { GameConfig, PlayerId } from '@meccg/shared';
import type {
  DecisionRecord,
  GameObserver,
  GameResultRecord,
  ReplayHeader,
  ReplayRecord,
  TransitionRecord,
} from './types.js';
import { loadDeck, deckToPlayerConfig } from './decks.js';

/** A fully-parsed replay file. */
export interface Replay {
  readonly header: ReplayHeader;
  /** Decisions and transitions, in game order. */
  readonly records: readonly (DecisionRecord | TransitionRecord)[];
  /** The closing result record — absent if the file was truncated. */
  readonly result?: GameResultRecord;
}

/**
 * Observer that streams the game to a JSONL replay file as it is played.
 * Call {@link close} after the game to flush the stream.
 */
export class ReplayWriter implements GameObserver {
  private readonly stream: fs.WriteStream;

  constructor(filePath: string) {
    this.stream = fs.createWriteStream(filePath, { encoding: 'utf-8' });
  }

  private write(record: ReplayRecord): void {
    this.stream.write(JSON.stringify(record) + '\n');
  }

  onHeader(header: ReplayHeader): void {
    this.write(header);
  }

  onDecision(record: DecisionRecord): void {
    this.write(record);
  }

  onTransition(record: TransitionRecord): void {
    this.write(record);
  }

  onResult(record: GameResultRecord): void {
    this.write(record);
  }

  /** Close the underlying stream. Resolves when everything is on disk. */
  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.stream.end((err?: Error | null) => (err ? reject(err) : resolve()));
    });
  }
}

/** Parse a JSONL replay file. */
export function readReplay(filePath: string): Replay {
  const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(l => l.trim().length > 0);
  if (lines.length === 0) throw new Error(`Replay file is empty: ${filePath}`);
  const parsed = lines.map(l => JSON.parse(l) as ReplayRecord);
  const header = parsed[0];
  if (header.kind !== 'header') throw new Error(`Replay file does not start with a header record: ${filePath}`);
  const records: (DecisionRecord | TransitionRecord)[] = [];
  let result: GameResultRecord | undefined;
  for (const record of parsed.slice(1)) {
    if (record.kind === 'decision' || record.kind === 'transition') records.push(record);
    else if (record.kind === 'result') result = record;
  }
  return { header, records, result };
}

/** Outcome of {@link verifyReplay}. */
export interface ReplayVerification {
  /** True when every recorded action re-applied cleanly and all checks matched. */
  readonly ok: boolean;
  /** Decisions re-applied. */
  readonly decisionsReplayed: number;
  /** Mismatch descriptions (empty when ok). */
  readonly mismatches: readonly string[];
}

/**
 * Re-simulate a replay from its header (seed + decks) and verify that the
 * engine accepts every recorded action and that the recorded state
 * sequence numbers, turns, and phases match the re-simulation. Proves the
 * replay is an authentic, reproducible record of a legal game.
 */
export function verifyReplay(replay: Replay): ReplayVerification {
  setEngineConsoleLog(false);
  const cardPool = loadCardPool();
  const mismatches: string[] = [];
  const config: GameConfig = {
    players: [
      deckToPlayerConfig(loadDeck(replay.header.players[0].deckId), replay.header.players[0].id, replay.header.players[0].name),
      deckToPlayerConfig(loadDeck(replay.header.players[1].deckId), replay.header.players[1].id, replay.header.players[1].name),
    ],
    seed: replay.header.seed,
  };
  let state = createGame(config, cardPool);
  let replayed = 0;

  for (const record of replay.records) {
    if (record.kind !== 'decision') continue;
    if (state.stateSeq !== record.stateSeq) {
      mismatches.push(`decision ${record.seq}: stateSeq ${state.stateSeq} != recorded ${record.stateSeq}`);
    }
    if (state.phaseState.phase !== record.phase) {
      mismatches.push(`decision ${record.seq}: phase ${state.phaseState.phase} != recorded ${record.phase}`);
    }
    if (state.turnNumber !== record.turn) {
      mismatches.push(`decision ${record.seq}: turn ${state.turnNumber} != recorded ${record.turn}`);
    }
    if (mismatches.length >= 10) {
      mismatches.push('too many mismatches — aborting verification');
      return { ok: false, decisionsReplayed: replayed, mismatches };
    }
    const result = reduce(state, record.action);
    if (result.error) {
      mismatches.push(`decision ${record.seq}: engine rejected recorded action '${record.action.type}': ${result.error}`);
      return { ok: false, decisionsReplayed: replayed, mismatches };
    }
    state = result.state;
    replayed++;
  }

  if (replay.result?.outcome === 'completed' && state.phaseState.phase !== Phase.GameOver) {
    mismatches.push(`replay claims completion but re-simulation ended in phase ${state.phaseState.phase}`);
  }
  if (replay.result?.outcome === 'completed' && state.phaseState.phase === Phase.GameOver) {
    const recordedWinner = replay.result.winner;
    const actualWinner: PlayerId | null = state.phaseState.winner;
    if (recordedWinner !== actualWinner) {
      mismatches.push(`recorded winner ${String(recordedWinner)} != re-simulated winner ${String(actualWinner)}`);
    }
  }

  return { ok: mismatches.length === 0, decisionsReplayed: replayed, mismatches };
}
