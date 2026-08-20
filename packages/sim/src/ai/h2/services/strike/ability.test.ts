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
import { attackerChoosesDefenders, cancelProtects, combatAbilitiesOf, NO_ABILITIES, strikeCancelGuardOf } from './ability.js';

const POOL = loadCardPool();

/** Fatty Bolger — prowess 1, body 8, taps to cancel a strike against a Hobbit. */
const FATTY = 'tw-495';
/** Sam Gamgee — a Hobbit Fatty's cancel protects. */
const SAM = 'tw-180';
/** Glorfindel II — an Elf it does not. */
const GLORFINDEL = 'tw-161';
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

describe('the tap-to-cancel-a-strike guard', () => {
  test('is read off Fatty Bolger as shipped', () => {
    const guard = strikeCancelGuardOf(POOL[FATTY]);
    expect(guard).not.toBeNull();
    // His filter is real data, so protection follows the printed races.
    expect(cancelProtects(guard!, POOL[SAM])).toBe(true);
    expect(cancelProtects(guard!, POOL[GLORFINDEL])).toBe(false);
  });

  test('a character without the ability carries none', () => {
    expect(strikeCancelGuardOf(POOL[ARAGORN])).toBeNull();
    expect(strikeCancelGuardOf(undefined)).toBeNull();
  });

  test('protects nobody the definition cannot be read for', () => {
    const guard = strikeCancelGuardOf(POOL[FATTY]);
    // A filtered guard with no target definition to evaluate it against must
    // fail closed — claiming protection it cannot verify would let the walk
    // cancel strikes the engine would never offer to cancel.
    expect(cancelProtects(guard!, undefined)).toBe(false);
  });
});
