/**
 * @module ai/h2/core/baseline.test
 *
 * The baseline makes one claim — declining to act is worth zero — so the tests
 * are about *which* declinings it recognises. The engine spells the same
 * non-act three ways depending on where it offers it, and a spelling this list
 * has not learned is a whole decision handed to Heuristics 1 for want of the
 * candidate that means "nothing".
 *
 * That is why the last test plays real games: a list checked only against
 * itself would go on passing the day the engine renames one of them.
 */

import { describe, expect, test } from 'vitest';
import { setEngineConsoleLog } from '@meccg/shared';
import type { GameAction } from '@meccg/shared';
import { playGame } from '../../../runner.js';
import { loadDeck } from '../../../decks.js';
import { createHeuristicAgent } from '../../../agents/heuristic-agent.js';
import type { Agent, AgentContext } from '../../../types.js';
import { BASELINE_ACTION_TYPES, BASELINE_NAME, evaluateBaseline } from './baseline.js';
import type { ModuleContext } from './types.js';

/** The baseline reads nothing from the context, so an empty one is honest. */
const CONTEXT = {} as unknown as ModuleContext;

/** An action of the given type, which is all the baseline looks at. */
const action = (type: string): GameAction => ({ type, player: 'p1' } as unknown as GameAction);

describe('the spellings of doing nothing', () => {
  test('every one of them is worth exactly zero', () => {
    for (const type of BASELINE_ACTION_TYPES) {
      const evaluation = evaluateBaseline(action(type), CONTEXT)!;
      expect(evaluation).not.toBeNull();
      expect(evaluation.utility).toBe(0);
      expect(evaluation.expectedTsd).toBe(0);
      expect(evaluation.sigmaTsd).toBe(0);
      expect(evaluation.module).toBe(BASELINE_NAME);
    }
  });

  test('and the tree says which one it spoke for', () => {
    // `explain` prints this, and "pass" on a chain-priority decision would send
    // a reader looking for a pass that is not on the table.
    for (const type of BASELINE_ACTION_TYPES) {
      expect(evaluateBaseline(action(type), CONTEXT)!.rationale.label).toBe(type);
    }
  });

  test('anything else is declined, exactly like a module that had nothing to say', () => {
    expect(evaluateBaseline(action('play-hazard'), CONTEXT)).toBeNull();
    expect(evaluateBaseline(action('resolve-strike'), CONTEXT)).toBeNull();
  });
});

/**
 * A whole game does not fit vitest's default when files run in parallel —
 * and even 60s is too tight under CI's parallel matrix load (observed
 * 56-68s for the same two seeded games run standalone in ~28s).
 */
const GAME_TIMEOUT = 120_000;

describe('the list against the engine', () => {
  test('the engine still offers every spelling this claims to cover', () => {
    // The failure this guards: the engine renames one of these and the list
    // goes on looking complete while the decisions it named fall through.
    setEngineConsoleLog(false);
    const decks: [ReturnType<typeof loadDeck>, ReturnType<typeof loadDeck>] =
      [loadDeck('challenge-deck-a'), loadDeck('challenge-deck-b')];
    const seen = new Set<string>();
    const spy = (inner: Agent): Agent => ({
      name: inner.name,
      chooseAction(context: AgentContext) {
        for (const legal of context.legalActions) seen.add(legal.type);
        return inner.chooseAction(context);
      },
    });
    for (const seed of [11, 12]) {
      playGame({
        agents: [spy(createHeuristicAgent()), spy(createHeuristicAgent())],
        decks,
        seed,
        maxDecisions: 4000,
      });
    }
    expect([...BASELINE_ACTION_TYPES].filter(type => !seen.has(type))).toEqual([]);
  }, GAME_TIMEOUT);
});
