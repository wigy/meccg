/**
 * @module game-record.test
 *
 * Tests for {@link buildCompletedGameRecord}: the completed-game statistics
 * record written once per game when the state enters game over.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, test, expect, vi } from 'vitest';
import { createGame, loadCardPool, Alignment, Phase } from '@meccg/shared';
import type {
  CardDefinitionId, GameConfig, GameOverPhaseState, GameState, MarshallingPointTotals, PlayerId,
} from '@meccg/shared';
import { buildCompletedGameRecord } from './game-record.js';
import type { PlayerDeckInfo } from './game-record.js';

const ALICE = 'p1' as PlayerId;
const BOB = 'p2' as PlayerId;
const BALIN = 'tw-123' as CardDefinitionId;
const GANDALF = 'tw-156' as CardDefinitionId;
const THRAIN = 'tw-149' as CardDefinitionId;
const RIVENDELL = 'tw-258' as CardDefinitionId;
const THE_ONE_RING = 'tw-236' as CardDefinitionId;

const pool = loadCardPool();

const START_MS = Date.UTC(2026, 6, 28, 12, 0, 0);

const MP_ALICE: MarshallingPointTotals = { character: 5, item: 3, faction: 2, ally: 0, kill: 1, misc: 0 };
const MP_BOB: MarshallingPointTotals = { character: 2, item: 1, faction: 0, ally: 0, kill: 0, misc: 1 };

const DECKS: Record<string, PlayerDeckInfo> = {
  alice: { id: 'challenge-deck-a', name: 'Stewards of Gondor', gameLength: 'short' },
};

/** A real created game forced into the given game-over phase. */
function gameOverState(over: Omit<GameOverPhaseState, 'phase'>): GameState {
  const config: GameConfig = {
    players: [
      { id: ALICE, name: 'Alice', alignment: Alignment.Wizard,
        draftPool: [BALIN], playDeck: [GANDALF], siteDeck: [RIVENDELL], sideboard: [] },
      { id: BOB, name: 'Bob', alignment: Alignment.Wizard,
        draftPool: [THRAIN], playDeck: [], siteDeck: [RIVENDELL], sideboard: [] },
    ],
    seed: 12345,
  };
  const state = createGame(config, pool);
  return {
    ...state,
    gameId: `${START_MS.toString(36)}-test`,
    startingPlayer: BOB,
    turnNumber: 9,
    players: [
      { ...state.players[0], marshallingPoints: MP_ALICE },
      { ...state.players[1], marshallingPoints: MP_BOB },
    ] as unknown as GameState['players'],
    phaseState: { phase: Phase.GameOver, ...over },
  };
}

describe('buildCompletedGameRecord', () => {
  test('marshalling-points win maps both players and decodes timestamps', () => {
    const state = gameOverState({
      winner: ALICE,
      finalScores: { [ALICE]: 13, [BOB]: 4 },
      finishedPlayers: [],
      winReason: { kind: 'marshalling-points' },
      uniqueCardReveals: [],
    });
    const endedAt = new Date(START_MS + 90 * 60 * 1000);
    const record = buildCompletedGameRecord(state, DECKS, new Set(['bob']), endedAt);

    expect(record.gameId).toBe(state.gameId);
    expect(record.startedAt).toBe(new Date(START_MS).toISOString());
    expect(record.endedAt).toBe(endedAt.toISOString());
    expect(record.durationSeconds).toBe(90 * 60);
    expect(record.turns).toBe(9);
    expect(record.seed).toBe(state.rng.seed);
    expect(record.stateSeq).toBe(state.stateSeq);
    expect(record.winner).toBe('Alice');
    expect(record.winnerPlayerId).toBe(ALICE);
    expect(record.winReason).toBe('marshalling-points');
    expect(record.winCard).toBeNull();
    expect(record.winAlignment).toBeNull();

    const [alice, bob] = record.players;
    expect(alice.name).toBe('Alice');
    expect(alice.human).toBe(true);
    expect(bob.human).toBe(false);
    expect(alice.playerId).toBe(ALICE);
    expect(alice.alignment).toBe(Alignment.Wizard);
    expect(alice.deck).toEqual(DECKS.alice);
    // The avatar is recovered from the cards, wherever they rest — Alice's
    // Wizard is still in her play deck.
    expect(alice.avatar).toBe('Gandalf');
    expect(alice.startingPlayer).toBe(false);
    expect(alice.finalScore).toBe(13);
    expect(alice.mp).toEqual(MP_ALICE);
    expect(alice.stagePoints).toBe(0);

    // Bob sent no deck list — identity stays null rather than guessed, and
    // his cards hold no avatar to recover.
    expect(bob.deck).toEqual({ id: null, name: null, gameLength: null });
    expect(bob.avatar).toBeNull();
    expect(bob.startingPlayer).toBe(true);
    expect(bob.finalScore).toBe(4);
    expect(bob.mp).toEqual(MP_BOB);

    // Tournament breakdown is the CoE §10.3 adjustment, not the raw totals:
    // Alice's faction points double because Bob scored no faction MPs.
    expect(alice.tournamentMp.faction).toBe(4);
    expect(bob.tournamentMp.faction).toBe(0);
  });

  test('one-ring win denormalizes the ring card and alignment', () => {
    const state = gameOverState({
      winner: BOB,
      finalScores: { [ALICE]: 0, [BOB]: 25 },
      finishedPlayers: [],
      winReason: { kind: 'one-ring', alignment: Alignment.Ringwraith, card: THE_ONE_RING },
      uniqueCardReveals: [],
    });
    const record = buildCompletedGameRecord(state, {}, new Set(), new Date(START_MS + 1000));

    expect(record.winner).toBe('Bob');
    expect(record.winReason).toBe('one-ring');
    expect(record.winCard).toBe(THE_ONE_RING);
    expect(record.winAlignment).toBe(Alignment.Ringwraith);
  });

  test('throws when the game is not over', () => {
    const state = gameOverState({
      winner: null, finalScores: { [ALICE]: 0, [BOB]: 0 }, finishedPlayers: [],
      winReason: { kind: 'marshalling-points' },
      uniqueCardReveals: [],
    });
    const running = { ...state, phaseState: { phase: Phase.Setup } } as unknown as GameState;
    expect(() => buildCompletedGameRecord(running, {}, new Set(), new Date())).toThrow('not over');
  });
});

describe('writeCompletedGameRecord', () => {
  test('writes <gameId>.json into GAME_RECORDS_DIR', async () => {
    process.env.GAME_RECORDS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'meccg-records-'));
    // Re-evaluate the module after setting the env override — the dir is
    // read at module load.
    vi.resetModules();
    const fresh = await import('./game-record.js');
    const state = gameOverState({
      winner: ALICE,
      finalScores: { [ALICE]: 1, [BOB]: 0 },
      finishedPlayers: [],
      winReason: { kind: 'marshalling-points' },
      uniqueCardReveals: [],
    });
    const record = fresh.buildCompletedGameRecord(state, {}, new Set(), new Date());
    const filePath = fresh.writeCompletedGameRecord(record);

    expect(filePath).toBe(path.join(process.env.GAME_RECORDS_DIR, `${state.gameId}.json`));
    const written = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as typeof record;
    expect(written).toEqual(JSON.parse(JSON.stringify(record)));
  });
});
