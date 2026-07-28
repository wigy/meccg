/**
 * @module mc-agent.test
 *
 * Flat Monte-Carlo agent tests: the deck-list-free determinizer widens a
 * view without inventing information the searcher does not have, an
 * unidentified card keeps exactly one capability (face-down on-guard
 * placement), playouts terminate and score in tournament-score units, and
 * the agent plays a whole game returning only legal actions.
 */

import { describe, test, expect } from 'vitest';
import { loadCardPool, UNKNOWN_CARD, setEngineConsoleLog, computeLegalActions, reduce } from '@meccg/shared';
import type { CardInstanceId, GameAction, PlayerView } from '@meccg/shared';
import { playGame } from './runner.js';
import { createHeuristicAgent } from './agents/heuristic-agent.js';
import { createMcAgent } from './agents/mc-agent.js';
import { createRandomStream } from './random-stream.js';
import { loadDeck } from './decks.js';
import { determinizeNull, UNKNOWN_CARD_DEFINITION } from './search/determinize-null.js';
import { isDeterminizableView } from './search/determinize.js';
import { rollout, filterUnknownCardActions, stateTsd } from './search/rollout.js';
import type { Agent, AgentContext } from './types.js';

/**
 * Budget for a test that plays a whole game.
 *
 * Vitest's 5s default is not enough for one when the suite runs files in
 * parallel: these pass in isolation and fail together, which reads as a
 * flaky suite rather than as a slow test.
 */
const GAME_TIMEOUT = 30000;

const DECK_A = loadDeck('challenge-deck-a');
const DECK_B = loadDeck('challenge-deck-b');
const CARD_POOL = loadCardPool();

/** Captures quiet mid-game decision points through the agent seam. */
function captureViews(limit: number, seed: number): PlayerView[] {
  setEngineConsoleLog(false);
  const captured: PlayerView[] = [];
  const inner = createHeuristicAgent();
  const spy: Agent = {
    name: 'spy',
    chooseAction(context) {
      if (captured.length < limit && context.view.turnNumber >= 2 && isDeterminizableView(context.view)) {
        captured.push(context.view);
      }
      return inner.chooseAction(context);
    },
  };
  playGame({ agents: [spy, createHeuristicAgent()], decks: [DECK_A, DECK_B], seed, maxDecisions: 900, cardPool: CARD_POOL });
  return captured;
}

describe('null determinizer', () => {
  test('invents nothing: hidden cards stay unidentified', () => {
    const captured = captureViews(12, 4242);
    expect(captured.length).toBeGreaterThan(3);

    for (const view of captured.slice(0, 6)) {
      const world = determinizeNull({ view, seed: 99, cardPool: CARD_POOL });
      // Unlike the deck-list determinizer, which samples a real identity for
      // every hidden slot, nothing here is guessed.
      const oppIndex = 1 - view.selfIndex;
      for (const card of world.state.players[oppIndex].hand) {
        expect(card.definitionId).toBe(UNKNOWN_CARD);
        expect(world.unknownInstances.has(card.instanceId)).toBe(true);
      }
    }
  }, GAME_TIMEOUT);

  test('root candidates from the view remain applicable in the widened world', () => {
    // This is the property the agent actually rests on: it picks among the
    // view's candidates, then replays the chosen one in a sampled world.
    //
    // Exact candidate-list equality — which `search/determinize` can assert
    // because it knows both deck lists — does NOT hold here, and cannot: the
    // searcher's own play deck is unidentified, so actions the engine offers
    // from it (recruiting from the play deck, sideboard fetches) have no
    // counterpart in the world. Measured across five seeded games, 180/200
    // candidate lists matched exactly and 934/936 individual candidates
    // applied. The agent absorbs the remainder by skipping any candidate the
    // engine rejects in a given world, so the bar here is "almost always",
    // not "always".
    const captured = captureViews(40, 4242);
    let applied = 0;
    let failed = 0;
    for (const view of captured) {
      const world = determinizeNull({ view, seed: 99, cardPool: CARD_POOL });
      for (const evaluated of view.legalActions) {
        if (!evaluated.viable) continue;
        if (reduce(world.state, evaluated.action).error) failed++;
        else applied++;
      }
    }
    expect(applied + failed).toBeGreaterThan(100);
    expect(applied / (applied + failed)).toBeGreaterThan(0.98);
  });

  test('the unknown-card stand-in resolves in the pool so generators do not crash', () => {
    const view = captureViews(1, 4242)[0];
    const world = determinizeNull({ view, seed: 7, cardPool: CARD_POOL });
    expect(world.state.cardPool[UNKNOWN_CARD]).toBe(UNKNOWN_CARD_DEFINITION);

    // Legal actions compute for BOTH seats without throwing, which is the
    // failure this stand-in exists to prevent: the opponent's whole hand is
    // unidentified, and every hand-scanning generator resolves definitions.
    for (const player of world.state.players) {
      expect(() => computeLegalActions(world.state, player.id)).not.toThrow();
    }
  });

  test('hidden sites are sampled so companies can still move, or inerted on request', () => {
    const view = captureViews(1, 4242)[0];
    const oppIndex = 1 - view.selfIndex;

    const sampled = determinizeNull({ view, seed: 7, cardPool: CARD_POOL, unknownSites: 'sample' });
    for (const card of sampled.state.players[oppIndex].siteDeck) {
      expect(card.definitionId).not.toBe(UNKNOWN_CARD);
    }

    const inert = determinizeNull({ view, seed: 7, cardPool: CARD_POOL, unknownSites: 'inert' });
    const inertDeck = inert.state.players[oppIndex].siteDeck;
    if (inertDeck.length > 0) {
      expect(inertDeck.every(c => c.definitionId === UNKNOWN_CARD)).toBe(true);
    }
  });
});

describe('unknown-card action filter', () => {
  const unknown = new Set<CardInstanceId>(['hidden-1' as CardInstanceId]);
  const play = { type: 'play-hazard', player: 'p1', cardInstanceId: 'hidden-1' } as unknown as GameAction;
  const onGuard = { type: 'place-on-guard', player: 'p1', cardInstanceId: 'hidden-1' } as unknown as GameAction;
  const discard = { type: 'discard-card', player: 'p1', cardInstanceId: 'hidden-1' } as unknown as GameAction;
  const known = { type: 'pass', player: 'p1' } as unknown as GameAction;

  test('an unidentified card may only be placed on-guard or discarded', () => {
    const kept = filterUnknownCardActions([play, onGuard, discard, known], unknown);
    expect(kept).toEqual([onGuard, discard, known]);
  });

  test('filtering never empties the candidate list', () => {
    // A step where the only legal action uses the unknown card must stay
    // playable, or a mandatory discard would deadlock the playout.
    expect(filterUnknownCardActions([play], unknown)).toEqual([play]);
  });

  test('nested instance references are found, not just top-level ones', () => {
    const nested = { type: 'play-hazard', player: 'p1', payload: { targets: ['hidden-1'] } } as unknown as GameAction;
    expect(filterUnknownCardActions([nested, known], unknown)).toEqual([known]);
  });
});

describe('rollout', () => {
  test('terminates within its horizon and scores in tournament-score units', () => {
    const view = captureViews(1, 4242)[0];
    const world = determinizeNull({ view, seed: 11, cardPool: CARD_POOL });
    const searcher = view.self.id;
    const playerIds: [typeof searcher, typeof searcher] = view.selfIndex === 0
      ? [searcher, view.opponent.id]
      : [view.opponent.id, searcher];

    let random = 12345;
    const stream = (): number => {
      random = (random * 1103515245 + 12345) & 0x7fffffff;
      return random / 0x7fffffff;
    };

    const result = rollout(world.state, {
      playerIds,
      searcher,
      unknownInstances: world.unknownInstances,
      horizonTurns: 1,
      maxDecisions: 400,
      random: stream,
    });

    expect(Number.isFinite(result.tsd)).toBe(true);
    expect(result.decisions).toBeLessThanOrEqual(400);
    // 'decision-cap' would mean the horizon is unreachable within the cap,
    // which silently truncates every playout — worth failing on.
    expect(result.end).not.toBe('decision-cap');
  });

  test('TSD is zero-sum around the two seats', () => {
    const view = captureViews(1, 4242)[0];
    const world = determinizeNull({ view, seed: 11, cardPool: CARD_POOL });
    expect(stateTsd(world.state, view.self.id)).toBe(-stateTsd(world.state, view.opponent.id));
  });
});

describe('mc agent', () => {
  /** Rebuilds the agent context the runner would pass for a captured view. */
  function contextFor(view: PlayerView): AgentContext {
    return {
      view,
      cardPool: CARD_POOL,
      legalActions: view.legalActions.filter(e => e.viable).map(e => e.action),
      evaluated: view.legalActions,
      random: createRandomStream(7),
    };
  }

  test('returns one of the offered actions at every captured decision', () => {
    const captured = captureViews(15, 4242);
    const mc = createMcAgent({ rollouts: 1, horizonTurns: 1, maxDecisions: 150, maxCandidates: 4 });
    for (const view of captured) {
      const context = contextFor(view);
      const decision = mc.chooseAction(context);
      expect(context.legalActions).toContain(decision.action);
    }
  }, 120_000);

  test('the candidate cap keeps a wide decision affordable and keeps the fallback pick', () => {
    // The branching factor reaches 640; without the cap a single decision
    // searches every one of them and costs a minute on its own.
    const widest = captureViews(60, 4242)
      .filter(v => v.legalActions.filter(e => e.viable).length > 6)
      .sort((a, b) => b.legalActions.length - a.legalActions.length)[0];
    expect(widest).toBeDefined();

    const capped = createMcAgent({ rollouts: 1, horizonTurns: 1, maxDecisions: 150, maxCandidates: 3 });
    const decision = capped.chooseAction(contextFor(widest));
    expect(decision.considered?.length).toBeLessThanOrEqual(3);
    expect(contextFor(widest).legalActions).toContain(decision.action);
  }, 120_000);
});
