/**
 * @module ai/h2/core/registry.test
 *
 * Dispatch is where the hybrid fallback lives, and the property worth
 * protecting is negative: H2 utilities and H1 weights must never end up in the
 * same distribution. A module therefore takes a decision whole or not at all,
 * and these tests pin every way it can decline.
 */

import { describe, test, expect } from 'vitest';
import type { GameAction } from '@meccg/shared';
import type { Evaluation, H2Module, ModuleContext } from './types.js';
import { coversDecision, evaluateDecision, ownerOf, resolveModules } from './registry.js';
import { leaf } from './rationale.js';

const PASS = { type: 'pass' } as unknown as GameAction;
const DRAFT_STOP = { type: 'draft-stop' } as unknown as GameAction;
const RESOLVE_STRIKE = { type: 'resolve-strike' } as unknown as GameAction;

/** An evaluation with a given utility, valid enough to pass the invariants. */
function evaluation(action: GameAction, module: string, utility: number): Evaluation {
  return {
    action,
    module,
    outcomes: [{ p: 1, label: 'certain', dtsd: utility }],
    expectedTsd: utility,
    sigmaTsd: 0,
    utility,
    method: 'integrated',
    rationale: leaf('stub', utility),
    assumptions: [],
  };
}

/** A module owning the two pass-like action types, scoring by index. */
function stubModule(overrides: Partial<H2Module> = {}): H2Module {
  return {
    name: 'stub',
    ownedActionTypes: ['pass', 'draft-stop'],
    evaluate: (action, context) => evaluation(action, 'stub', context.legalActions.indexOf(action)),
    ...overrides,
  };
}

/** The slice of a module context dispatch itself reads. */
function context(legalActions: readonly GameAction[]): ModuleContext {
  return { legalActions } as unknown as ModuleContext;
}

describe('claiming a decision', () => {
  test('claims when it owns the type of every action offered', () => {
    expect(coversDecision([stubModule()], context([PASS, DRAFT_STOP]))).toBe(true);
  });

  test('declines the whole decision when one action is not its own', () => {
    // Scoring two of three candidates and leaving the third to H1 would put a
    // win-probability delta and a unitless weight in one ranking. Coverage is
    // therefore all or nothing across the whole module set.
    expect(coversDecision([stubModule()], context([PASS, RESOLVE_STRIKE]))).toBe(false);
  });

  test('a context gate narrows ownership', () => {
    // The gate can only narrow ownership, never widen it past the action types
    // a module declares — so a permissive gate still does not cover a strike.
    const gated = stubModule({ claims: () => false });
    expect(ownerOf([gated], PASS, context([PASS]))).toBeNull();
    expect(ownerOf([stubModule()], PASS, context([PASS]))?.name).toBe('stub');
  });

  test('falls through to Heuristics 1 when no module is enabled', () => {
    expect(coversDecision([], context([PASS]))).toBe(false);
  });

  test('does not claim a decision with nothing to decide', () => {
    // "Owns every action" is vacuously true of an empty list, and an empty
    // ranking is not an opinion.
    expect(coversDecision([stubModule()], context([]))).toBe(false);
  });
});

describe('evaluating a decision', () => {
  test('ranks every action best first', () => {
    const { modules, evaluations } = evaluateDecision([stubModule()], context([PASS, DRAFT_STOP]));
    expect(modules).toEqual(['stub']);
    expect(evaluations).toHaveLength(2);
    expect(evaluations[0].utility).toBeGreaterThan(evaluations[1].utility);
    expect(evaluations[0].action).toBe(DRAFT_STOP);
  });

  test('withdraws the claim when the module cannot score one of the actions', () => {
    const partial = stubModule({
      evaluate: (action, ctx) => (action === PASS ? null : evaluation(action, 'stub', ctx.legalActions.length)),
    });
    expect(evaluateDecision([partial], context([PASS, DRAFT_STOP])).modules).toEqual([]);
  });

  test('rejects a distribution that does not sum to 1, naming the module', () => {
    const broken = stubModule({
      evaluate: action => ({ ...evaluation(action, 'stub', 1), outcomes: [{ p: 0.5, label: 'half', dtsd: 1 }] }),
    });
    expect(() => evaluateDecision([broken], context([PASS]))).toThrow('stub: outcome probabilities');
  });
});

describe('module selection', () => {
  test('resolves names and reports unknown ones', () => {
    const available = [stubModule(), stubModule({ name: 'other' })];
    expect(resolveModules('other', available).map(m => m.name)).toEqual(['other']);
    expect(resolveModules('stub,other', available)).toHaveLength(2);
    expect(() => resolveModules('nope', available)).toThrow('Unknown H2 module "nope"');
  });

  test('enables everything for an absent or "all" selector', () => {
    const available = [stubModule(), stubModule({ name: 'other' })];
    expect(resolveModules(undefined, available)).toHaveLength(2);
    expect(resolveModules('all', available)).toHaveLength(2);
  });
});
