/**
 * @module features.test
 *
 * Featurization tests (P3): card-vocabulary stability, action-type
 * coverage on real games, dimensional consistency and determinism of the
 * state/action featurizers, semantic spot checks against the view, and
 * the round-trip idempotence of `computeLegalActions` along a played
 * corpus of states (same state → same ordered candidates → same feature
 * vectors).
 */

import { describe, test, expect } from 'vitest';
import { createGame, reduce, loadCardPool, setEngineConsoleLog, Phase } from '@meccg/shared';
import type { GameConfig, PlayerId, PlayerView } from '@meccg/shared';
import { projectPlayerView } from '@meccg/game-server';
import { playGame } from './runner.js';
import { loadDeck, deckToPlayerConfig } from './decks.js';
import { createRandomStream } from './random-stream.js';
import type { Agent } from './types.js';
import {
  ACTION_TYPES,
  actionTypeIndex,
  buildCardVocab,
  featurizeState,
  featurizeActions,
  GLOBAL_FEATURE_NAMES,
  GLOBAL_FEATURE_WIDTH,
  ENTITY_FEATURE_NAMES,
  ENTITY_FEATURE_WIDTH,
  ACTION_FEATURE_NAMES,
  ACTION_FEATURE_WIDTH,
} from './features/index.js';

const DECKS: [ReturnType<typeof loadDeck>, ReturnType<typeof loadDeck>] =
  [loadDeck('challenge-deck-a'), loadDeck('challenge-deck-b')];
const CARD_POOL = loadCardPool();
const VOCAB = buildCardVocab(CARD_POOL);

describe('card vocabulary', () => {
  test('is stable, sorted, and reserves index 0 for unknown', () => {
    const again = buildCardVocab(CARD_POOL);
    expect(again.size).toBe(VOCAB.size);
    expect(again.hash).toBe(VOCAB.hash);
    expect(VOCAB.size).toBeGreaterThan(1000);

    const sortedIds = Object.keys(CARD_POOL).sort();
    expect(VOCAB.indexOf(sortedIds[0])).toBe(1);
    expect(VOCAB.indexOf(sortedIds[sortedIds.length - 1])).toBe(VOCAB.size);
    expect(VOCAB.indexOf('no-such-card')).toBe(0);
    expect(VOCAB.indexOf(null)).toBe(0);
    expect(VOCAB.indexOf(undefined)).toBe(0);
  });
});

describe('action-type vocabulary', () => {
  test('is unique and keeps its existing indices', () => {
    expect(new Set(ACTION_TYPES).size).toBe(ACTION_TYPES.length);
    expect(actionTypeIndex(ACTION_TYPES[0])).toBe(1);
    expect(actionTypeIndex('no-such-action')).toBe(0);

    // The list is a serialization format shared with every trained
    // checkpoint: a type's index is baked into each model's action-type
    // embedding. Inserting one mid-list shifts every index after it, which
    // silently re-labels that many action types for every existing model —
    // certifying tw-282 put `choose-peek-deck` at index 31, shifted 127 of
    // 158 types, and dropped the champion from 10-9 against the heuristic
    // to 0-18. Sortedness was the old assertion here and is exactly what
    // caused it, so lock the prefix instead: appending is free, inserting
    // fails. Extend LOCKED_PREFIX by hand only when models are retrained.
    const LOCKED_PREFIX = 159;
    const LOCKED_HASH = 0x8913f47c;
    let hash = 0x811c9dc5;
    for (const byte of Buffer.from(ACTION_TYPES.slice(0, LOCKED_PREFIX).join(','))) {
      hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
    }
    expect(ACTION_TYPES.length).toBeGreaterThanOrEqual(LOCKED_PREFIX);
    expect(hash).toBe(LOCKED_HASH);
  });

  test('covers every candidate offered in a real game', () => {
    const seen = new Set<string>();
    const spy: Agent = {
      name: 'spy',
      chooseAction(context) {
        for (const evaluated of context.evaluated) seen.add(evaluated.action.type);
        return { action: context.legalActions[Math.floor(context.random() * context.legalActions.length)] };
      },
    };
    playGame({ agents: [spy, spy], decks: DECKS, seed: 555, maxDecisions: 400, cardPool: CARD_POOL });
    expect(seen.size).toBeGreaterThan(5);
    const unknown = [...seen].filter(type => actionTypeIndex(type) === 0);
    expect(unknown).toEqual([]);
  });
});

describe('featurizers', () => {
  test('feature name lists match the declared widths', () => {
    expect(GLOBAL_FEATURE_NAMES.length).toBe(GLOBAL_FEATURE_WIDTH);
    expect(ENTITY_FEATURE_NAMES.length).toBe(ENTITY_FEATURE_WIDTH);
    expect(ACTION_FEATURE_NAMES.length).toBe(ACTION_FEATURE_WIDTH);
    expect(new Set(GLOBAL_FEATURE_NAMES).size).toBe(GLOBAL_FEATURE_WIDTH);
  });

  test('vectors are dimensionally consistent, masked correctly, and deterministic', () => {
    interface Snapshot {
      readonly global: readonly number[];
      readonly entities: readonly (readonly number[])[];
      readonly candidates: readonly (readonly number[])[];
      readonly mask: readonly number[];
      readonly viable: readonly boolean[];
      readonly candidateCount: number;
    }
    const capture = (): Snapshot[] => {
      const snapshots: Snapshot[] = [];
      const spy: Agent = {
        name: 'spy',
        chooseAction(context) {
          const state = featurizeState(context.view, context.cardPool, VOCAB);
          const actions = featurizeActions(context.view, context.cardPool, VOCAB);
          snapshots.push({
            global: state.global,
            entities: state.entities,
            candidates: actions.candidates,
            mask: actions.mask,
            viable: context.evaluated.map(e => e.viable),
            candidateCount: context.evaluated.length,
          });
          return { action: context.legalActions[Math.floor(context.random() * context.legalActions.length)] };
        },
      };
      playGame({ agents: [spy, spy], decks: DECKS, seed: 321, maxDecisions: 250, cardPool: CARD_POOL });
      return snapshots;
    };

    const first = capture();
    expect(first.length).toBe(250);
    for (const snapshot of first) {
      expect(snapshot.global.length).toBe(GLOBAL_FEATURE_WIDTH);
      for (const row of snapshot.entities) expect(row.length).toBe(ENTITY_FEATURE_WIDTH);
      expect(snapshot.entities.length).toBeGreaterThan(0);
      expect(snapshot.candidates.length).toBe(snapshot.candidateCount);
      for (const candidate of snapshot.candidates) expect(candidate.length).toBe(ACTION_FEATURE_WIDTH);
      expect(snapshot.mask).toEqual(snapshot.viable.map(v => (v ? 1 : 0)));
      // Identity columns stay within their vocabularies.
      for (const row of snapshot.entities) {
        expect(row[2]).toBeGreaterThanOrEqual(0);
        expect(row[2]).toBeLessThanOrEqual(VOCAB.size);
      }
      for (const candidate of snapshot.candidates) {
        expect(candidate[0]).toBeGreaterThanOrEqual(0);
        expect(candidate[0]).toBeLessThanOrEqual(ACTION_TYPES.length);
      }
    }

    const second = capture();
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  test('global features mirror the view they came from', () => {
    let view: PlayerView | null = null;
    const spy: Agent = {
      name: 'spy',
      chooseAction(context) {
        view ??= context.view;
        return { action: context.legalActions[0] };
      },
    };
    playGame({ agents: [spy, spy], decks: DECKS, seed: 42, maxDecisions: 30, cardPool: CARD_POOL });
    expect(view).not.toBeNull();
    if (view === null) throw new Error('no view captured');
    const captured: PlayerView = view;

    const state = featurizeState(captured, CARD_POOL, VOCAB);
    const names = GLOBAL_FEATURE_NAMES;
    const at = (name: string): number => state.global[names.indexOf(name)];

    // Exactly one phase bit is set and it is the view's phase.
    const phaseBits = names
      .map((name, i) => [name, state.global[i]] as const)
      .filter(([name]) => name.startsWith('phase:'));
    expect(phaseBits.reduce((sum, [, bit]) => sum + bit, 0)).toBe(1);
    expect(at(`phase:${captured.phaseState.phase}`)).toBe(1);

    expect(at('turn')).toBeCloseTo(captured.turnNumber / 100, 10);
    expect(at('self-hand-size')).toBeCloseTo(captured.self.hand.length / 10, 10);
    expect(at('self-mp-character')).toBeCloseTo(captured.self.marshallingPoints.character / 10, 10);
    expect(at('opp-mp-kill')).toBeCloseTo(captured.opponent.marshallingPoints.kill / 10, 10);
    expect(at('self-gi-total')).toBeCloseTo(captured.self.generalInfluence / 20, 10);
  });
});

describe('legal-action idempotence', () => {
  test('computeLegalActions is idempotent along a played corpus', () => {
    setEngineConsoleLog(false);
    const playerIds: [PlayerId, PlayerId] = ['p1' as PlayerId, 'p2' as PlayerId];
    const config: GameConfig = {
      players: [
        deckToPlayerConfig(DECKS[0], playerIds[0], 'A'),
        deckToPlayerConfig(DECKS[1], playerIds[1], 'B'),
      ],
      seed: 77,
    };
    let state = createGame(config, CARD_POOL);
    const random = createRandomStream(123);
    let checked = 0;

    for (let step = 0; step < 300 && state.phaseState.phase !== Phase.GameOver; step++) {
      const order: number[] = state.activePlayer === playerIds[1] ? [1, 0] : [0, 1];
      let view: PlayerView | null = null;
      for (const i of order) {
        const candidate = projectPlayerView(state, playerIds[i]);
        if (candidate.legalActions.some(e => e.viable)) {
          view = candidate;
          break;
        }
      }
      expect(view).not.toBeNull();
      if (view === null) break;

      // Round trip: projecting the same state again yields the same ordered
      // candidate list (types, canonical ids, viability) and therefore the
      // same feature vectors — visit-count targets stay aligned.
      const again = projectPlayerView(state, view.self.id);
      expect(again.legalActions.map(e => [e.action.type, e.actionId, e.viable]))
        .toEqual(view.legalActions.map(e => [e.action.type, e.actionId, e.viable]));
      expect(featurizeActions(again, CARD_POOL, VOCAB)).toEqual(featurizeActions(view, CARD_POOL, VOCAB));
      checked++;

      const viable = view.legalActions.filter(e => e.viable);
      const action = viable[Math.floor(random() * viable.length)].action;
      const reduced = reduce(state, action);
      expect(reduced.error).toBeUndefined();
      state = reduced.state;
    }
    expect(checked).toBeGreaterThan(200);
  });
});
