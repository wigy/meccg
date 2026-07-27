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
    expect(notes.every(n => n === 'h1 fallback' || n === 'h1 fallback: no weighted actions')).toBe(true);
    expect(run.result.outcome).not.toBe('engine-error');
  });
});

describe('agent identity', () => {
  test('records the enabled module set in its name, so replays say what played', () => {
    expect(createHeuristic2Agent({ available: [REWARDS], model: testWinProbModel() }).name).toBe('h2');
    expect(createHeuristic2Agent({ modules: 'stub', available: [REWARDS], model: testWinProbModel() }).name)
      .toBe('h2:stub');
  });
});
