/**
 * @module ai/regress.test
 *
 * The engine tells us which candidates undo this phase's own progress. Every
 * agent has to honour that, and the two that did not each inherited an infinite
 * loop — so these pin the filter itself, and that each agent applies it.
 */

import { describe, expect, test } from 'vitest';
import type { GameAction } from '@meccg/shared';
import { computeLegalActions, loadCardPool } from '@meccg/shared';
import { forwardActions, isRegressive } from './regress.js';
import { heuristicStrategy } from './heuristic.js';
import type { AiContext } from './strategy.js';
import { createHeuristic2Agent } from './h2/agent.js';
import { loadScenario, scenarioView } from './h2/scenario-store.js';
import { testWinProbModel } from './h2/test-support.js';
import type { AgentContext } from '../types.js';

/** A forward candidate. */
const SPLIT = { type: 'split-company', player: 'p1', sourceCompanyId: 'c1', characterId: 'x' } as unknown as GameAction;
/** The same shape of candidate, marked by the engine as an undo. */
const SPLIT_BACK = { ...SPLIT, regress: true } as unknown as GameAction;
/** Passing is never a reverse of anything. */
const PASS = { type: 'pass', player: 'p1' } as unknown as GameAction;

describe('the engine\'s regress flag', () => {
  test('recognises a marked candidate and only a marked one', () => {
    expect(isRegressive(SPLIT_BACK)).toBe(true);
    expect(isRegressive(SPLIT)).toBe(false);
    expect(isRegressive(PASS)).toBe(false);
    // Not merely "the field is present": the engine stamps it only when true,
    // but a `false` must not read as an undo either.
    expect(isRegressive({ ...SPLIT, regress: false } as unknown as GameAction)).toBe(false);
  });

  test('drops the undos and keeps everything else', () => {
    expect(forwardActions([SPLIT, SPLIT_BACK, PASS])).toEqual([SPLIT, PASS]);
  });

  test('never returns an empty decision', () => {
    // Should not arise — passing is never a reverse — but a filter that can
    // hand an agent nothing is a crash waiting for the position that proves it.
    expect(forwardActions([SPLIT_BACK])).toEqual([SPLIT_BACK]);
  });
});

describe('the agents honour it', () => {
  test('heuristics 2 never ranks an undo, on a real position that offers one', () => {
    const scenario = loadScenario('organization/replanned-movement');
    const view = scenarioView(scenario);
    const cardPool = loadCardPool();
    const offered = computeLegalActions(scenario.state, scenario.actingPlayer)
      .filter(legal => legal.viable)
      .map(legal => legal.action);
    expect(offered.filter(isRegressive)).toHaveLength(1);

    // Handed the *unfiltered* list, so the agent has to drop the undo itself —
    // pre-filtering here would test the helper twice and the agent not at all.
    const agent = createHeuristic2Agent({ model: testWinProbModel() });
    const decision = agent.chooseAction({
      view,
      cardPool,
      legalActions: offered,
      random: () => 0.5,
    } as unknown as AgentContext);
    expect(isRegressive(decision.action)).toBe(false);
    for (const candidate of decision.considered ?? []) {
      expect(isRegressive(candidate.action)).toBe(false);
    }
  });

  test('heuristics 1 does not weigh an undo', () => {
    const context = {
      view: { phaseState: { phase: 'organization' }, self: { companies: [] } },
      cardPool: {},
      legalActions: [SPLIT_BACK, PASS],
    } as unknown as AiContext;
    const weighted = heuristicStrategy.weighActions(context);
    expect(weighted.some(w => w.action === SPLIT_BACK)).toBe(false);
  });
});
