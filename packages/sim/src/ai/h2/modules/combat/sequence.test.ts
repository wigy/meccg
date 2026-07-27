/**
 * @module ai/h2/modules/combat/sequence.test
 *
 * The point of resolving an attack strike by strike is that the strikes are
 * *not* independent, so the tests are about exactly that: a company that has
 * already been hit answers the next strike worse, and the kill MP that depends
 * on defeating all of them is banked only where all of them were defeated.
 *
 * A two-strike attack on two healthy characters shows none of this — each
 * takes one — which is why these fixtures deliberately give the attack more
 * strikes than the company has bodies.
 */

import { describe, test, expect } from 'vitest';
import { CardStatus } from '@meccg/shared';
import type { CardDefinition, CombatState, PlayerView } from '@meccg/shared';
import { resolveSequentially } from './sequence.js';
import type { SequencePricer } from './sequence.js';

const HERO = 'tw-hero';

const POOL = {
  [HERO]: { marshallingPoints: 1, marshallingCategory: 'character', body: 8 },
} as unknown as Readonly<Record<string, CardDefinition>>;

/** A defending company of characters with the given prowess. */
function viewWith(prowess: readonly number[]): PlayerView {
  const characters: Record<string, unknown> = {};
  const ids: string[] = [];
  prowess.forEach((value, i) => {
    const id = `c${i}`;
    ids.push(id);
    characters[id] = {
      instanceId: id,
      definitionId: HERO,
      status: CardStatus.Untapped,
      items: [],
      allies: [],
      hazards: [],
      effectiveStats: { prowess: value, body: 8, directInfluence: 0, corruptionPoints: 0 },
    };
  });
  return {
    self: { id: 'p1', characters, companies: [{ id: 'company', characters: ids }], cardsInPlay: [] },
    opponent: { characters: {}, cardsInPlay: [] },
  } as unknown as PlayerView;
}

/** An attack of `strikes` strikes at `prowess`, nothing assigned yet. */
function attack(strikes: number, prowess: number): CombatState {
  return {
    attackSource: { type: 'creature', instanceId: 'creature' },
    companyId: 'company',
    defendingPlayerId: 'p1',
    attackingPlayerId: 'p2',
    strikesTotal: strikes,
    strikeProwess: prowess,
    creatureBody: null,
    detainment: false,
    strikeAssignments: [],
    currentStrikeIndex: 0,
    phase: 'assign-strikes',
  } as unknown as CombatState;
}

/** A pricer that only counts harm, so the tests read as probabilities. */
const HARM: SequencePricer = outcome =>
  outcome.character === 'eliminated' ? -10 : outcome.character === 'wounded' ? -1 : 0;

/** Total probability of the outcomes matching a predicate. */
function chance(outcomes: readonly { p: number; label: string; dtsd: number }[], predicate: (o: { label: string; dtsd: number }) => boolean): number {
  return outcomes.filter(predicate).reduce((sum, o) => sum + o.p, 0);
}

describe('the enumeration', () => {
  test('is a probability distribution at every depth', () => {
    for (let strikes = 1; strikes <= 5; strikes++) {
      const result = resolveSequentially(viewWith([6, 5]), POOL, attack(strikes, 7), strikes, HARM, { maxStates: 192 });
      expect(chance(result.outcomes, () => true)).toBeCloseTo(1, 9);
    }
  });

  test('conserves probability even when states are merged', () => {
    // A tight cap forces the merge path; mass must survive it.
    const result = resolveSequentially(viewWith([6, 5, 4]), POOL, attack(4, 8), 4, HARM, { maxStates: 4 });
    expect(result.merged).toBe(true);
    expect(chance(result.outcomes, () => true)).toBeCloseTo(1, 9);
  });

  test('reports who is projected to face each strike', () => {
    const result = resolveSequentially(viewWith([6, 3]), POOL, attack(2, 8), 2, HARM, { maxStates: 192 });
    // The better parrier goes first; the strike after it falls to the other.
    expect(result.opening).toHaveLength(2);
    expect(result.opening[0].target.instanceId).toBe('c0');
    expect(result.opening[1].target.instanceId).toBe('c1');
  });
});

describe('degradation between strikes', () => {
  test('a second strike on the same character is harder than the first', () => {
    // One defender, two strikes: the first taps him, and he meets the second
    // at −1 for being tapped and −1 more as an excess strike. Independent
    // pricing would have squared the first strike's survival rate.
    const single = resolveSequentially(viewWith([5]), POOL, attack(1, 8), 1, HARM, { maxStates: 192 });
    const double = resolveSequentially(viewWith([5]), POOL, attack(2, 8), 2, HARM, { maxStates: 192 });

    const unharmedOnce = chance(single.outcomes, o => o.dtsd === 0);
    const unharmedTwice = chance(double.outcomes, o => o.dtsd === 0);
    expect(unharmedTwice).toBeLessThan(unharmedOnce ** 2);
  });

  test('a bigger company absorbs an attack better than a small one', () => {
    const alone = resolveSequentially(viewWith([6]), POOL, attack(3, 8), 3, HARM, { maxStates: 192 });
    const together = resolveSequentially(viewWith([6, 6, 6]), POOL, attack(3, 8), 3, HARM, { maxStates: 192 });
    const expected = (outcomes: readonly { p: number; dtsd: number }[]): number =>
      outcomes.reduce((sum, o) => sum + o.p * o.dtsd, 0);
    // Same three strikes, same prowess — only the number of bodies differs.
    expect(expected(alone.outcomes)).toBeLessThan(expected(together.outcomes));
  });

  test('the harm is monotone in the number of strikes', () => {
    const expected = (strikes: number): number =>
      resolveSequentially(viewWith([6, 5]), POOL, attack(strikes, 8), strikes, HARM, { maxStates: 192 })
        .outcomes.reduce((sum, o) => sum + o.p * o.dtsd, 0);
    expect(expected(3)).toBeLessThan(expected(2));
    expect(expected(2)).toBeLessThan(expected(1));
  });
});

describe('kill marshalling points', () => {
  const KILL_TSD = 4;

  test('are banked only on the branches where every strike was defeated', () => {
    const result = resolveSequentially(viewWith([6, 5]), POOL, attack(2, 8), 2, HARM, {
      maxStates: 192,
      killTsd: KILL_TSD,
      killLabel: 'attack beaten',
    });
    const banked = result.outcomes.filter(o => o.label.includes('attack beaten'));
    expect(banked.length).toBeGreaterThan(0);
    for (const outcome of banked) expect(outcome.dtsd).toBeGreaterThanOrEqual(KILL_TSD - 1e-9);
    for (const outcome of result.outcomes) {
      if (!outcome.label.includes('attack beaten')) expect(outcome.dtsd).toBeLessThan(KILL_TSD);
    }
  });

  test('get rarer as the attack gets longer, because every strike must be defeated', () => {
    const pBanked = (strikes: number): number => {
      const result = resolveSequentially(viewWith([6, 5]), POOL, attack(strikes, 8), strikes, HARM, {
        maxStates: 192, killTsd: KILL_TSD, killLabel: 'attack beaten',
      });
      return chance(result.outcomes, o => o.label.includes('attack beaten'));
    };
    expect(pBanked(3)).toBeLessThan(pBanked(2));
    expect(pBanked(2)).toBeLessThan(pBanked(1));
  });
});
