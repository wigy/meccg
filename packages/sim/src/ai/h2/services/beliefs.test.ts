/**
 * @module ai/h2/services/beliefs.test
 *
 * The service estimates what redaction hides, so the tests are mostly about
 * what it must *not* do: read the opponent's hand, or claim confidence it has
 * not earned.
 */

import { describe, test, expect } from 'vitest';
import type { CardDefinition, PlayerView } from '@meccg/shared';
import { computeBeliefs, kindOf } from './beliefs.js';

const CREATURE = 'c';
const RESOURCE = 'r';
const CHARACTER = 'h';

const POOL = {
  [CREATURE]: { cardType: 'hazard-creature' },
  [RESOURCE]: { cardType: 'hero-resource-item' },
  [CHARACTER]: { cardType: 'hero-character' },
} as unknown as Readonly<Record<string, CardDefinition>>;

/** A view where the opponent has shown the given cards and holds `hand` more. */
function viewWith(discard: readonly string[], hand: number): PlayerView {
  return {
    self: { marshallingPoints: {}, characters: {}, companies: [], cardsInPlay: [] },
    opponent: {
      hand: new Array(hand).fill({ instanceId: 'x', definitionId: 'unknown' }),
      discardPile: discard.map((d, i) => ({ instanceId: `d${i}`, definitionId: d })),
      killPile: [],
      outOfPlayPile: [],
      cardsInPlay: [],
      characters: {},
    },
  } as unknown as PlayerView;
}

describe('classification', () => {
  test('maps card types onto the kinds a consumer cares about', () => {
    expect(kindOf(POOL[CREATURE])).toBe('creature');
    expect(kindOf(POOL[RESOURCE])).toBe('resource');
    expect(kindOf(POOL[CHARACTER])).toBe('character');
    expect(kindOf(undefined)).toBeNull();
  });
});

describe('with nothing shown', () => {
  test('the estimate is the prior, and says it has no confidence', () => {
    const beliefs = computeBeliefs(viewWith([], 8), POOL);
    expect(beliefs.observed).toBe(0);
    expect(beliefs.confidence).toBe(0);
    expect(beliefs.share('creature')).toBeCloseTo(0.30, 9);
  });
});

describe('as evidence accumulates', () => {
  test('the estimate moves toward what was actually shown', () => {
    const few = computeBeliefs(viewWith(new Array(4).fill(CREATURE), 8), POOL);
    const many = computeBeliefs(viewWith(new Array(40).fill(CREATURE), 8), POOL);
    // Both saw only creatures; the one with more evidence believes it more.
    expect(many.share('creature')).toBeGreaterThan(few.share('creature'));
    expect(few.share('creature')).toBeGreaterThan(0.30);
    expect(many.confidence).toBeGreaterThan(few.confidence);
  });

  test('a resource-heavy opponent is believed to be holding resources', () => {
    const beliefs = computeBeliefs(viewWith(new Array(30).fill(RESOURCE), 8), POOL);
    expect(beliefs.share('resource')).toBeGreaterThan(beliefs.share('creature'));
  });

  test('confidence never reaches certainty', () => {
    expect(computeBeliefs(viewWith(new Array(500).fill(CREATURE), 8), POOL).confidence).toBeLessThan(1);
  });
});

describe('what it tells a consumer', () => {
  test('the expected number of a kind in hand scales with hand size', () => {
    const small = computeBeliefs(viewWith(new Array(20).fill(CREATURE), 2), POOL);
    const large = computeBeliefs(viewWith(new Array(20).fill(CREATURE), 8), POOL);
    expect(large.expectedInHand('creature')).toBeGreaterThan(small.expectedInHand('creature'));
  });

  test('the chance of holding at least one rises with hand size, and is zero on an empty hand', () => {
    expect(computeBeliefs(viewWith([CREATURE], 0), POOL).holdsAtLeastOne('creature')).toBe(0);
    const one = computeBeliefs(viewWith(new Array(20).fill(CREATURE), 1), POOL);
    const six = computeBeliefs(viewWith(new Array(20).fill(CREATURE), 6), POOL);
    expect(six.holdsAtLeastOne('creature')).toBeGreaterThan(one.holdsAtLeastOne('creature'));
    expect(six.holdsAtLeastOne('creature')).toBeLessThan(1);
  });

  test('reads the hand only as a count, never as cards', () => {
    // The two views differ only in what the redacted hand entries claim to be;
    // a service that peeked would give different answers.
    const honest = computeBeliefs(viewWith([CREATURE], 5), POOL);
    const tempting = {
      ...viewWith([CREATURE], 5),
      opponent: {
        ...viewWith([CREATURE], 5).opponent,
        hand: new Array(5).fill({ instanceId: 'x', definitionId: RESOURCE }),
      },
    } as unknown as PlayerView;
    expect(computeBeliefs(tempting, POOL).share('creature')).toBe(honest.share('creature'));
  });
});
