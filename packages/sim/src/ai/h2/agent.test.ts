/**
 * @module ai/h2/agent.test
 *
 * The agent seam. Two properties matter at P0, before any module exists:
 * a decision no module claims must play exactly as Heuristics 1 did (so
 * `h2:<module>` is a genuine ablation rather than a rewrite), and a decision a
 * module does claim must be ranked by win-probability utility.
 */

import { describe, test, expect } from 'vitest';
import type { GameAction } from '@meccg/shared';
import { playGame } from '../../runner.js';
import { createHeuristicAgent } from '../../agents/heuristic-agent.js';
import { loadDeck } from '../../decks.js';
import type { Agent, AgentContext } from '../../types.js';
import { createHeuristic2Agent } from './agent.js';
import type { Evaluation, H2Module } from './core/types.js';
import { leaf } from './core/rationale.js';
import { testStandingView, testWinProbModel } from './test-support.js';

const DECKS: [ReturnType<typeof loadDeck>, ReturnType<typeof loadDeck>] =
  [loadDeck('challenge-deck-a'), loadDeck('challenge-deck-b')];

const PASS_A = { type: 'pass', id: 'a' } as unknown as GameAction;
const PASS_B = { type: 'pass', id: 'b' } as unknown as GameAction;

/**
 * Budget for a test that plays a whole game.
 *
 * Vitest's 5s default is not enough for one when the suite runs files in
 * parallel: these pass in isolation and fail together, which reads as a
 * flaky suite rather than as a slow test.
 */
const GAME_TIMEOUT = 60000;

/** A module that prefers whichever pass action carries the larger reward. */
const REWARDS: H2Module = {
  name: 'stub',
  ownedActionTypes: ['pass'],
  evaluate(action): Evaluation {
    const dtsd = action === PASS_B ? 6 : 1;
    return {
      action,
      module: 'stub',
      outcomes: [{ p: 1, label: 'certain', dtsd }],
      expectedTsd: dtsd,
      sigmaTsd: 0,
      utility: dtsd / 100,
      method: 'integrated',
      rationale: leaf('stub', dtsd, { unit: 'tsd' }),
      assumptions: ['stub module'],
    };
  },
};

/** A decision context carrying only what the H2 path reads. */
function decisionContext(legalActions: readonly GameAction[], random: () => number = () => 0): AgentContext {
  return {
    view: testStandingView({ character: 4 }, { character: 4 }, 12),
    cardPool: {},
    legalActions,
    evaluated: [],
    random,
  } as unknown as AgentContext;
}

describe('module-owned decisions', () => {
  const agent = createHeuristic2Agent({
    available: [REWARDS],
    model: testWinProbModel(),
    temperature: 0.0001,
  });

  test('picks the highest-utility action', () => {
    expect(agent.chooseAction(decisionContext([PASS_A, PASS_B])).action).toBe(PASS_B);
  });

  test('reports the whole candidate list as a distribution for the training pipeline', () => {
    const decision = agent.chooseAction(decisionContext([PASS_A, PASS_B]));
    expect(decision.considered).toHaveLength(2);
    const total = decision.considered!.reduce((sum, c) => sum + c.weight, 0);
    expect(total).toBeCloseTo(1, 12);
  });

  test('names the module and the win-probability delta in its note', () => {
    const decision = agent.chooseAction(decisionContext([PASS_A, PASS_B]));
    expect(decision.note).toContain('stub');
    expect(decision.note).toContain('ΔP(win)');
  });
});

describe('what is reported and what is played', () => {
  // The distribution and the move answer different questions. At the shipped
  // temperature a candidate half a percent of win probability behind still
  // carries weight ~0.44, so sampling it is not a rounding error.
  const model = testWinProbModel();

  test('plays the argmax even where the reported distribution is nearly flat', () => {
    const agent = createHeuristic2Agent({ available: [REWARDS], model });
    // A stream that returns ~1 lands in the last bucket, so a sampling agent
    // would take the *worse* candidate here.
    const decision = agent.chooseAction(decisionContext([PASS_A, PASS_B], () => 0.999999));
    expect(decision.action).toBe(PASS_B);
    // …and the distribution is still reported, unsharpened, for training.
    const weights = decision.considered!.map(c => c.weight);
    expect(weights.reduce((sum, w) => sum + w, 0)).toBeCloseTo(1, 12);
    expect(Math.max(...weights)).toBeLessThan(1);
  });

  test('samples when asked to explore, and says so in its name', () => {
    const agent = createHeuristic2Agent({ available: [REWARDS], model, sample: true, temperature: 1 });
    expect(agent.name).toBe('h2@1');
    expect(agent.chooseAction(decisionContext([PASS_A, PASS_B], () => 0.999999)).action).toBe(PASS_A);
  });

  test('argmax play is not named after a temperature it does not use', () => {
    expect(createHeuristic2Agent({ available: [REWARDS], model, temperature: 1 }).name).toBe('h2');
  });
});

describe('unowned decisions', () => {
  test('are answered by passing, not handed to Heuristics 1', () => {
    const agent = createHeuristic2Agent({ available: [], model: testWinProbModel() });
    // With no modules enabled H2 has an opinion about nothing — and it plays
    // the game anyway. It used to be an exact replay of Heuristics 1 here,
    // which made H1 the floor *and* the ceiling of every measurement taken
    // against it.
    const notes: (string | undefined)[] = [];
    const watcher: Agent = {
      name: 'watch',
      chooseAction(context) {
        const decision = agent.chooseAction(context);
        notes.push(decision.note);
        return decision;
      },
    };
    const run = playGame({
      agents: [watcher, createHeuristicAgent()],
      decks: DECKS,
      seed: 11,
      maxDecisions: 300,
    });
    expect(notes.length).toBeGreaterThan(50);
    expect(notes.some(n => n?.includes('fallback'))).toBe(false);
    expect(notes.every(n => n?.startsWith('no opinion'))).toBe(true);
    expect(run.result.outcome).not.toBe('engine-error');
  }, GAME_TIMEOUT);
});

describe('partial coverage', () => {
  const model = testWinProbModel();
  /** An action type no module owns. */
  const UNOWNED = { type: 'transfer-item', id: 'x' } as unknown as GameAction;

  test('acts on a partial view when the covered opinion clears the margin', () => {
    // PASS_B is worth +6 tsd to the stub, comfortably above the margin, so the
    // agent speaks even though it cannot score the third candidate.
    const agent = createHeuristic2Agent({ available: [REWARDS], model, temperature: 0.0001 });
    const decision = agent.chooseAction(decisionContext([PASS_A, PASS_B, UNOWNED]));
    expect(decision.action).toBe(PASS_B);
    expect(decision.note).toContain('partial coverage');
    // A partial candidate list is not a distribution over the decision, so no
    // weights are reported — the training pipeline must not learn from it.
    expect(decision.considered).toBeUndefined();
  });

  test('declines when the covered opinion is too weak to stand alone', () => {
    const weak: H2Module = {
      name: 'weak',
      ownedActionTypes: ['pass'],
      evaluate: action => ({
        action, module: 'weak',
        outcomes: [{ p: 1, label: 'negligible', dtsd: 0.001 }],
        expectedTsd: 0.001, sigmaTsd: 0, utility: 0.00001,
        method: 'integrated', rationale: leaf('weak', 0), assumptions: [],
      }),
    };
    const agent = createHeuristic2Agent({ available: [weak], model });
    // No H1 opinion is consulted for comparison — the fallback replaces the
    // whole decision rather than mixing the two scales.
    const decision = agent.chooseAction(decisionContext([PASS_A, UNOWNED]));
    expect(decision.note).toContain('no opinion');
  });
});

describe('agent identity', () => {
  test('records the enabled module set in its name, so replays say what played', () => {
    expect(createHeuristic2Agent({ available: [REWARDS], model: testWinProbModel() }).name).toBe('h2');
    expect(createHeuristic2Agent({ modules: 'stub', available: [REWARDS], model: testWinProbModel() }).name)
      .toBe('h2:stub');
  });
});

describe('a tie at the top with an unrelated worse candidate', () => {
  const model = testWinProbModel();
  // Reproduces game msp8zwew-ddwnxz, turn 2: a resource player offered several
  // marshalling-point-neutral `transfer-item`/`store-item` choices (correctly
  // tied at utility 0) alongside a `split-company` that `defence` prices
  // negative. `best.utility - worst.utility` reads that spread as an opinion
  // and plays whichever tied candidate the stable sort put first — which is
  // how H2 came to shuffle two starting items around and store them for
  // nothing, never once comparing them to `pass`.
  const TRANSFER = { type: 'transfer-item', id: 't' } as unknown as GameAction;
  const STORE = { type: 'store-item', id: 's' } as unknown as GameAction;
  const SPLIT = { type: 'split-company', id: 'c' } as unknown as GameAction;
  const tiedTopWorseOutlier: H2Module = {
    name: 'shape-and-items',
    ownedActionTypes: ['transfer-item', 'store-item', 'split-company'],
    evaluate(action) {
      const dtsd = action === SPLIT ? -4 : 0;
      const utility = action === SPLIT ? -0.04 : 0;
      return {
        action, module: 'shape-and-items',
        outcomes: [{ p: 1, label: 'x', dtsd }],
        expectedTsd: dtsd, sigmaTsd: 0, utility,
        method: 'integrated', rationale: leaf('x', 0), assumptions: [],
      };
    },
  };

  test('passes instead of playing the first tied candidate', () => {
    // It used to hand this to a fallback. There is no fallback now, and the
    // answer is the same one for the same reason: a tie at the top is not a
    // preference, and an action nothing prices as better still costs a card, a
    // tap, or information.
    const agent = createHeuristic2Agent({
      available: [tiedTopWorseOutlier], model, temperature: 0.0001,
    });
    const decision = agent.chooseAction(decisionContext([TRANSFER, STORE, SPLIT, PASS_A]));
    expect(decision.action).toBe(PASS_A);
    expect(decision.note).toContain('no opinion');
  });

  test('takes its own best when there is nothing to pass with', () => {
    // No `pass` on offer, so declining is not available and H2 must still name
    // a move. It names its own, never anyone else's.
    const agent = createHeuristic2Agent({
      available: [tiedTopWorseOutlier], model, temperature: 0.0001,
    });
    expect(agent.chooseAction(decisionContext([TRANSFER, STORE, SPLIT])).action).not.toBe(SPLIT);
  });

  test('still acts when the top is uncontested', () => {
    // Same shape, minus the tie: one candidate clears the runner-up, so
    // there is a real opinion and the module tree acts on it.
    const agent = createHeuristic2Agent({
      available: [tiedTopWorseOutlier], model, temperature: 0.0001,
    });
    expect(agent.chooseAction(decisionContext([TRANSFER, SPLIT])).action).toBe(TRANSFER);
  });
});

describe('a decision the modules decline', () => {
  const model = testWinProbModel();
  /** An action type no module owns. */
  const UNOWNED = { type: 'transfer-item', id: 'y' } as unknown as GameAction;

  test('is answered by H2 itself, because there is no one else to ask', () => {
    const agent = createHeuristic2Agent({ available: [], model });
    const decision = agent.chooseAction(decisionContext([PASS_A, PASS_B, UNOWNED]));
    expect(decision.action).toBe(PASS_A);
    expect(decision.note).toContain('no opinion');
    expect(decision.note).not.toContain('fallback');
  });

  test('never names a candidate the engine proved undoes this phase', () => {
    // H2 drops candidates marked as undoing progress. Choosing among the raw
    // list would re-introduce the oscillation `ai/regress` exists to stop —
    // which used to be a property of what the *fallback* was shown, and is now
    // a property of what H2 chooses from directly.
    const undo = { type: 'pass', id: 'undo', regress: true } as unknown as GameAction;
    const agent = createHeuristic2Agent({ available: [], model });
    expect(agent.chooseAction(decisionContext([PASS_A, undo])).action).toBe(PASS_A);
  });

  test('a decision the modules do own is decided by them, not by declining', () => {
    const agent = createHeuristic2Agent({ available: [REWARDS], model, temperature: 0.0001 });
    const decision = agent.chooseAction(decisionContext([PASS_A, PASS_B]));
    expect(decision.action).toBe(PASS_B);
    expect(decision.note).not.toContain('no opinion');
  });
});

describe('a ranking that does not discriminate', () => {
  test('is declined rather than resolved at random', () => {
    // Every candidate identical: `select-company` where nothing is playable at
    // any site. Coverage is complete, so an older rule acted here by sampling
    // uniformly. H2 declines instead — a flat ranking is the absence of a
    // preference, and inventing one by coin flip is not better than saying so.
    const flat: H2Module = {
      name: 'flat',
      ownedActionTypes: ['pass'],
      evaluate: action => ({
        action, module: 'flat',
        outcomes: [{ p: 1, label: 'nothing to choose between', dtsd: 0 }],
        expectedTsd: 0, sigmaTsd: 0, utility: 0,
        method: 'integrated', rationale: leaf('flat', 0), assumptions: [],
      }),
    };
    const agent = createHeuristic2Agent({ available: [flat], model: testWinProbModel() });
    expect(agent.chooseAction(decisionContext([PASS_A, PASS_B])).note).toContain('no opinion');
  });

  test('still acts when one candidate is clearly better', () => {
    const agent = createHeuristic2Agent({ available: [REWARDS], model: testWinProbModel(), temperature: 0.0001 });
    expect(agent.chooseAction(decisionContext([PASS_A, PASS_B])).action).toBe(PASS_B);
  });
});
