/**
 * @module games/replay.test
 *
 * Tests for reading recorded games back out of the game server's JSONL state
 * logs and projecting them for the replay viewer.
 *
 * The fixtures are written in the game server's own log format (see
 * `game-log.ts` / `game-session.ts#logState`): scalar metadata first, then
 * `legalActions`, then the state with its card pool stripped. That ordering
 * matters — the index parses only the prefix before `legalActions`, so a
 * fixture that reorders the keys would exercise the wrong path.
 *
 * `GAME_LOG_DIR` points at a temp directory for the whole file; the module
 * reads it per call, so setting it in `beforeAll` is enough.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import {
  createGame, reduce, loadCardPool, Alignment, UNKNOWN_CARD,
} from '@meccg/shared';
import type {
  GameState, GameConfig, GameAction, PlayerId, CardDefinitionId, CardInstanceId,
} from '@meccg/shared';
import { loadReplayIndex, loadReplayFrame } from './replay.js';

const ALICE = 'p1' as PlayerId;
const BOB = 'p2' as PlayerId;
const BALIN = 'tw-123' as CardDefinitionId;
const ARAGORN = 'tw-120' as CardDefinitionId;
const RIVENDELL = 'tw-258' as CardDefinitionId;
const LORIEN = 'tw-251' as CardDefinitionId;

const pool = loadCardPool();

const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meccg-replay-'));

/** Instance id of a freshly-minted draft-pool card for player `idx`. */
function draftInst(state: GameState, idx: number, defId: CardDefinitionId): CardInstanceId {
  const phase = state.phaseState;
  if (phase.phase !== 'setup' || phase.setupStep.step !== 'character-draft') throw new Error('not in draft');
  const card = phase.setupStep.draftState[idx].pool.find(c => c.definitionId === defId);
  if (!card) throw new Error(`draft card ${defId} not found for player ${idx}`);
  return card.instanceId;
}

/** A two-seat game plus the first few draft picks, as recorded state snapshots. */
function recordedGame(): { states: GameState[]; actions: (GameAction | null)[] } {
  const config: GameConfig = {
    players: [
      { id: ALICE, name: 'Alice', alignment: Alignment.Wizard,
        draftPool: [BALIN, ARAGORN], playDeck: [], siteDeck: [RIVENDELL], sideboard: [] },
      { id: BOB, name: 'Bob', alignment: Alignment.Wizard,
        draftPool: [ARAGORN, BALIN], playDeck: [], siteDeck: [LORIEN], sideboard: [] },
    ],
    seed: 42,
  };
  const first = createGame(config, pool);
  const alicePick: GameAction = { type: 'draft-pick', player: ALICE, characterInstanceId: draftInst(first, 0, BALIN) };
  const second = reduce(first, alicePick).state;
  const bobPick: GameAction = { type: 'draft-pick', player: BOB, characterInstanceId: draftInst(second, 1, ARAGORN) };
  const third = reduce(second, bobPick).state;
  return { states: [first, second, third], actions: [null, alicePick, bobPick] };
}

/** One log line in the game server's format, with the card pool stripped. */
function stateLine(state: GameState, action: GameAction | null, reason: string): string {
  const { cardPool: _pool, ...rest } = state as GameState & { cardPool: unknown };
  return JSON.stringify({
    ts: '2026-08-01T10:00:00.000Z',
    event: 'state',
    stateSeq: state.stateSeq,
    reason,
    ...(action ? { action } : {}),
    turn: state.turnNumber,
    phase: state.phaseState.phase,
    step: 'character-draft',
    activePlayer: state.activePlayer,
    legalActions: { p1: [], p2: [] },
    state: rest,
  });
}

/** Write a game log made of the given raw lines. */
function writeLog(gameId: string, lines: readonly string[]): void {
  fs.writeFileSync(path.join(logDir, `${gameId}.jsonl`), lines.join('\n') + '\n', 'utf-8');
}

const GAME = 'mtest01-abcdef';
let recorded: ReturnType<typeof recordedGame>;

beforeAll(() => {
  process.env.GAME_LOG_DIR = logDir;
  recorded = recordedGame();
  writeLog(GAME, [
    stateLine(recorded.states[0], null, 'new-game'),
    // A non-state line: the log also carries bookkeeping the viewer must skip.
    JSON.stringify({ ts: '2026-08-01T10:00:01.000Z', event: 'restore', stateSeq: 0 }),
    stateLine(recorded.states[1], recorded.actions[1], 'draft-pick'),
    stateLine(recorded.states[2], recorded.actions[2], 'draft-pick'),
  ]);
});

afterAll(() => {
  delete process.env.GAME_LOG_DIR;
  fs.rmSync(logDir, { recursive: true, force: true });
});

describe('loadReplayIndex', () => {
  test('lists both seats and one frame per recorded state, skipping other events', () => {
    const index = loadReplayIndex(GAME)!;
    expect(index.gameId).toBe(GAME);
    expect(index.seats).toEqual([{ id: 'p1', name: 'Alice' }, { id: 'p2', name: 'Bob' }]);
    expect(index.frames).toHaveLength(3);
    expect(index.frames.map(f => f.index)).toEqual([0, 1, 2]);
    expect(index.frames.map(f => f.seq)).toEqual(recorded.states.map(s => s.stateSeq));
  });

  test('carries the action that produced each frame, so the timeline can be labelled', () => {
    const index = loadReplayIndex(GAME)!;
    expect(index.frames[0].action).toBeNull();
    expect(index.frames[0].reason).toBe('new-game');
    expect(index.frames[1].action).toMatchObject({ type: 'draft-pick', player: 'p1' });
    expect(index.frames[2].action).toMatchObject({ type: 'draft-pick', player: 'p2' });
  });

  test('falls back to a full parse for lines that carry no legalActions', () => {
    // The fast path slices the line at `legalActions`; a line without it must
    // still be indexed rather than silently dropped.
    const gameId = 'mtest02-nolegal';
    const line = JSON.parse(stateLine(recorded.states[0], null, 'new-game')) as Record<string, unknown>;
    delete line.legalActions;
    writeLog(gameId, [JSON.stringify(line)]);
    const index = loadReplayIndex(gameId)!;
    expect(index.frames).toHaveLength(1);
    expect(index.frames[0].reason).toBe('new-game');
  });

  test('returns null for a game with no log, an empty log, or a traversing id', () => {
    expect(loadReplayIndex('mtest03-missing')).toBeNull();
    writeLog('mtest04-empty', []);
    expect(loadReplayIndex('mtest04-empty')).toBeNull();
    expect(loadReplayIndex('../../etc/passwd')).toBeNull();
    expect(loadReplayIndex(`${GAME}/../${GAME}`)).toBeNull();
  });

  test('picks up a log that changed on disk rather than serving the cached index', () => {
    const gameId = 'mtest05-grows';
    writeLog(gameId, [stateLine(recorded.states[0], null, 'new-game')]);
    expect(loadReplayIndex(gameId)!.frames).toHaveLength(1);
    writeLog(gameId, [
      stateLine(recorded.states[0], null, 'new-game'),
      stateLine(recorded.states[1], recorded.actions[1], 'draft-pick'),
    ]);
    expect(loadReplayIndex(gameId)!.frames).toHaveLength(2);
  });
});

describe('loadReplayFrame', () => {
  test('projects the frame from the requested seat, hiding the other side', () => {
    const view = loadReplayFrame(GAME, 2, 'p1')!;
    expect(view.self.name).toBe('Alice');
    expect(view.opponent.name).toBe('Bob');
    expect(view.stateSeq).toBe(recorded.states[2].stateSeq);
    // Alice sees her own play deck order redacted only where the engine says
    // so, but Bob's hand is never hers to read.
    expect(view.opponent.hand.every(c => c.definitionId === UNKNOWN_CARD)).toBe(true);
  });

  test('the other seat sees the mirror image of the same moment', () => {
    const alice = loadReplayFrame(GAME, 2, 'p1')!;
    const bob = loadReplayFrame(GAME, 2, 'p2')!;
    expect(bob.self.name).toBe('Bob');
    expect(bob.opponent.name).toBe('Alice');
    expect(bob.stateSeq).toBe(alice.stateSeq);
    expect(bob.selfIndex).toBe(1);
  });

  test('offers no legal actions — a replay is read-only', () => {
    expect(loadReplayFrame(GAME, 0, 'p1')!.legalActions).toEqual([]);
  });

  test('returns null for an unknown game, frame, or seat', () => {
    expect(loadReplayFrame('mtest03-missing', 0, 'p1')).toBeNull();
    expect(loadReplayFrame(GAME, 99, 'p1')).toBeNull();
    expect(loadReplayFrame(GAME, -1, 'p1')).toBeNull();
    expect(loadReplayFrame(GAME, 1.5, 'p1')).toBeNull();
    expect(loadReplayFrame(GAME, 0, 'p3')).toBeNull();
  });

  test('projects a recording made before later state fields existed', () => {
    // Games recorded months ago lack fields the projection now reads. Stripping
    // them reproduces those logs; the frame must still render rather than
    // throwing on an undefined pile.
    const gameId = 'mtest06-legacy';
    const line = JSON.parse(stateLine(recorded.states[0], null, 'new-game')) as
      { state: Record<string, unknown> };
    for (const key of ['handRevealedInstances', 'revealedInstances', 'singletonTapLocks',
      'hazardHosts', 'pendingResolutions', 'activeConstraints', 'cheated']) {
      delete line.state[key];
    }
    for (const player of line.state.players as Record<string, unknown>[]) {
      for (const key of ['agents', 'callableMarshallingPoints', 'generalInfluenceBonus',
        'generalInfluenceControlPenalty', 'outOfPlayPile', 'reservedCreatures', 'stagePoints']) {
        delete player[key];
      }
    }
    writeLog(gameId, [JSON.stringify(line)]);

    const view = loadReplayFrame(gameId, 0, 'p1')!;
    expect(view.self.name).toBe('Alice');
    expect(view.self.outOfPlayPile).toEqual([]);
    expect(view.self.stagePoints).toBe(0);
    expect(view.cheated).toBe(false);
    // The probe in loadReplayIndex must agree that this one is replayable.
    expect(loadReplayIndex(gameId)).not.toBeNull();
  });

  test('reports a recording it cannot project instead of throwing', () => {
    const gameId = 'mtest07-broken';
    const line = JSON.parse(stateLine(recorded.states[0], null, 'new-game')) as
      { state: Record<string, unknown> };
    // A pile the defaults table does not cover: too damaged to render.
    for (const player of line.state.players as Record<string, unknown>[]) {
      delete player.killPile;
    }
    writeLog(gameId, [JSON.stringify(line)]);

    expect(loadReplayFrame(gameId, 0, 'p1')).toBeNull();
    expect(loadReplayIndex(gameId)).toBeNull();
  });
});
