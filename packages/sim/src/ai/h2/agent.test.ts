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
function decisionContext(legalActions: readonly GameAction[]): AgentContext {
  return {
    view: testStandingView({ character: 4 }, { character: 4 }, 12),
    cardPool: {},
    legalActions,
    evaluated: [],
    random: () => 0,
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

describe('unowned decisions', () => {
  test('fall through to Heuristics 1', () => {
    const agent = createHeuristic2Agent({ available: [], model: testWinProbModel() });
    // With no modules enabled every decision belongs to H1, so an H2 game is
    // an H1 game — the baseline every per-module gate is measured against.
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
    expect(notes.every(n => n?.startsWith('heuristic fallback'))).toBe(true);
    expect(run.result.outcome).not.toBe('engine-error');
  });
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

  test('falls back when the covered opinion is too weak to stand alone', () => {
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
    expect(decision.note).toContain('heuristic fallback');
  });
});

describe('agent identity', () => {
  test('records the enabled module set in its name, so replays say what played', () => {
    expect(createHeuristic2Agent({ available: [REWARDS], model: testWinProbModel() }).name).toBe('h2');
    expect(createHeuristic2Agent({ modules: 'stub', available: [REWARDS], model: testWinProbModel() }).name)
      .toBe('h2:stub');
  });

  test('records a non-default fallback too — it is half of how the agent plays', () => {
    const agent = createHeuristic2Agent({
      available: [REWARDS], model: testWinProbModel(), fallback: stubFallback(PASS_A),
    });
    expect(agent.name).toBe('h2+stub-fallback');
  });
});

/** A fallback that always takes `pick`, so its decisions are recognisable. */
function stubFallback(pick: GameAction): Agent & { calls: AgentContext[] } {
  const calls: AgentContext[] = [];
  return {
    name: 'stub-fallback',
    calls,
    chooseAction(context: AgentContext) {
      calls.push(context);
      return { action: pick, note: 'stub chose' };
    },
  };
}

describe('the fallback seam', () => {
  const model = testWinProbModel();
  /** An action type no module owns. */
  const UNOWNED = { type: 'transfer-item', id: 'y' } as unknown as GameAction;

  test('a declined decision goes to the configured agent, not to Heuristics 1', () => {
    const fallback = stubFallback(PASS_A);
    const agent = createHeuristic2Agent({ available: [], model, fallback });
    const decision = agent.chooseAction(decisionContext([PASS_A, PASS_B, UNOWNED]));
    expect(decision.action).toBe(PASS_A);
    // The fallback's own note is kept, prefixed by who was asked — a
    // transcript has to say which agent produced the move.
    expect(decision.note).toBe('stub-fallback fallback: stub chose');
    expect(fallback.calls).toHaveLength(1);
  });

  test('the fallback sees the forward candidate list, not the raw one', () => {
    // H2 drops candidates the engine marked as undoing this phase's progress.
    // A fallback offered them could re-introduce the oscillation `ai/regress`
    // exists to stop.
    const undo = { type: 'pass', id: 'undo', regress: true } as unknown as GameAction;
    const fallback = stubFallback(PASS_A);
    const agent = createHeuristic2Agent({ available: [], model, fallback });
    agent.chooseAction(decisionContext([PASS_A, undo]));
    expect(fallback.calls[0].legalActions).toEqual([PASS_A]);
  });

  test('a decision the modules do own never reaches the fallback', () => {
    const fallback = stubFallback(PASS_A);
    const agent = createHeuristic2Agent({
      available: [REWARDS], model, fallback, temperature: 0.0001,
    });
    expect(agent.chooseAction(decisionContext([PASS_A, PASS_B])).action).toBe(PASS_B);
    expect(fallback.calls).toHaveLength(0);
  });
});

describe('a ranking that does not discriminate', () => {
  test('is handed to Heuristics 1 rather than resolved at random', () => {
    // Every candidate identical: `select-company` where nothing is playable at
    // any site. Coverage is complete, so the old rule would have acted — by
    // sampling uniformly, which is worse than the preference H1 still has.
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
    expect(agent.chooseAction(decisionContext([PASS_A, PASS_B])).note).toContain('heuristic fallback');
  });

  test('still acts when one candidate is clearly better', () => {
    const agent = createHeuristic2Agent({ available: [REWARDS], model: testWinProbModel(), temperature: 0.0001 });
    expect(agent.chooseAction(decisionContext([PASS_A, PASS_B])).action).toBe(PASS_B);
  });
});
