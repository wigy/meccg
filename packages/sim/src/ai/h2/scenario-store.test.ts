/**
 * @module ai/h2/scenario-store.test
 *
 * Makes the checked-in corpus self-checking: every scenario must still load,
 * verify its hash, and project a view an agent could act on. A test corpus
 * that silently rots is worse than none, because the modules it is supposed to
 * regression-test keep passing against positions that no longer mean anything.
 */

import { describe, test, expect } from 'vitest';
import type { GameState } from '@meccg/shared';
import { hashState, listScenarioIds, loadScenario, scenarioView, withStandardCardPool } from './scenario-store.js';

describe('content hashing', () => {
  test('ignores the embedded card pool', () => {
    // The pool is static repository data, so it is stripped on the way out
    // and restored on the way in; a hash that included it would differ
    // between a stored scenario and the live state it was captured from.
    const bare = { turnNumber: 3, stateSeq: 9 } as unknown as GameState;
    const withPool = { ...bare, cardPool: { 'tw-001': { name: 'x' } } } as unknown as GameState;
    expect(hashState(withPool)).toBe(hashState(bare));
  });

  test('ignores key order but not values', () => {
    const a = { turnNumber: 3, stateSeq: 9 } as unknown as GameState;
    const b = { stateSeq: 9, turnNumber: 3 } as unknown as GameState;
    const c = { stateSeq: 9, turnNumber: 4 } as unknown as GameState;
    expect(hashState(a)).toBe(hashState(b));
    expect(hashState(a)).not.toBe(hashState(c));
  });
});

describe('card pool rehydration', () => {
  test('attaches the standard pool to a state stored without one', () => {
    const rehydrated = withStandardCardPool({ turnNumber: 1 } as unknown as GameState);
    const pool = (rehydrated as unknown as { cardPool: Record<string, unknown> }).cardPool;
    expect(Object.keys(pool).length).toBeGreaterThan(100);
  });

  test('leaves a state that carries its own pool alone', () => {
    const own = { cardPool: { 'tw-001': {} } } as unknown as GameState;
    expect(withStandardCardPool(own)).toBe(own);
  });
});

describe('the checked-in corpus', () => {
  const ids = listScenarioIds();

  test('is not empty', () => {
    expect(ids.length).toBeGreaterThan(0);
  });

  test.each(ids)('%s loads, verifies and projects a playable view', id => {
    const scenario = loadScenario(id);
    expect(hashState(scenario.state)).toBe(scenario.hash);

    const view = scenarioView(scenario);
    expect(view.self.id).toBe(scenario.actingPlayer);
    expect(view.legalActions.some(e => e.viable)).toBe(true);
  });
});
