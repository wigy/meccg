/**
 * @module ai/h2/services/strike/ability.test
 *
 * The classifier is checked against real cards rather than hand-built effect
 * literals, because its whole claim is that it reads the shipped data — a test
 * that invents its own `cancel-strike` would pass while the real column was
 * named something else.
 */

import { describe, test, expect } from 'vitest';
import { loadCardPool } from '@meccg/shared';
import { attackerChoosesDefenders, combatAbilitiesOf, NO_ABILITIES } from './ability.js';

const POOL = loadCardPool();

/** Fatty Bolger — prowess 1, body 8, taps to cancel a strike against a Hobbit. */
const FATTY = 'tw-495';
/** Cave-drake — two strikes, attacker chooses defending characters. */
const CAVE_DRAKE = 'le-66';
/** Cave Worm — one strike at prowess 16, defender assigns as usual. */
const CAVE_WORM = 'le-65';
/** Aragorn II — a plain warrior with no combat text to strike him for. */
const ARAGORN = 'tw-119';

describe('what a character is worth striking for his card text', () => {
  test('reads a tap-gated cancel off the shipped card data', () => {
    const abilities = combatAbilitiesOf(POOL[FATTY]);
    expect(abilities.tapGated.map(a => a.kind)).toContain('cancel-strike');
    // The removal is the point: a tap is enough, which is why he is worth
    // aiming at despite a body of 8 making him very hard to wound.
    expect(abilities.tapGated.every(a => a.removal === 'tap')).toBe(true);
  });

  test('a character with no combat text carries nothing', () => {
    expect(combatAbilitiesOf(POOL[ARAGORN])).toBe(NO_ABILITIES);
  });

  test('an unknown definition is not an error', () => {
    expect(combatAbilitiesOf(undefined)).toBe(NO_ABILITIES);
  });

  test('does not count a stat-modifier, which is already in effective prowess', () => {
    // Every character carrying one would otherwise be priced twice: once
    // through `effectiveStats.prowess` on the strike target, and again here.
    const doubleCounted = Object.keys(POOL).filter(id => {
      const def = POOL[id] as unknown as { cardType?: string };
      if (def.cardType !== 'hero-character' && def.cardType !== 'minion-character') return false;
      const abilities = combatAbilitiesOf(POOL[id]);
      return [...abilities.tapGated, ...abilities.passive].some(a => a.kind === 'stat-modifier');
    });
    expect(doubleCounted).toEqual([]);
  });
});

describe('which attacks let the attacker choose', () => {
  test('Cave-drake does and Cave Worm does not', () => {
    expect(attackerChoosesDefenders(POOL[CAVE_DRAKE])).toBe(true);
    expect(attackerChoosesDefenders(POOL[CAVE_WORM])).toBe(false);
  });

  test('the rule is found on creatures across the pool, not just one card', () => {
    // A guard on the detector rather than on the data: if the effect type were
    // renamed, this drops to zero and the whole feature silently stops firing.
    const creatures = Object.keys(POOL).filter(id => {
      const def = POOL[id] as unknown as { cardType?: string };
      return def.cardType === 'hazard-creature';
    });
    const choosing = creatures.filter(id => attackerChoosesDefenders(POOL[id]));
    expect(choosing.length).toBeGreaterThan(1);
    expect(choosing).toContain(CAVE_DRAKE);
  });
});
