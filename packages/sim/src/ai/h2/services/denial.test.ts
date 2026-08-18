/**
 * @module ai/h2/services/denial.test
 *
 * What harming an opposing character is worth — and specifically the part of it
 * that comes from his card text rather than his prowess.
 *
 * The fixtures deliberately hold everything else equal. A test that put Fatty
 * Bolger beside a prowess-9 warrior would pass on the prowess difference alone
 * and prove nothing about the ability term, so the two targets here share a
 * definition and differ only in whether their abilities were classified. That
 * the classification is real for the real card is `ability.test.ts`'s job; this
 * file is about what the pricer and the attacker do with it.
 */

import { describe, test, expect } from 'vitest';
import { CardStatus, loadCardPool } from '@meccg/shared';
import type { CardInstanceId } from '@meccg/shared';
import { denialPricer } from './denial.js';
import type { DenialContext } from './denial.js';
import { combatAbilitiesOf, NO_ABILITIES } from './strike/ability.js';
import type { StrikeTarget } from './strike/prowess.js';
import { resolveAttacks } from './strike/sequence.js';
import type { AttackProfile } from './strike/sequence.js';
import { DEFAULT_TUNABLES } from '../core/tunables.js';
import type { Standing } from './standing.js';

const POOL = loadCardPool();

/** Fatty Bolger: taps to cancel a strike against another Hobbit in his company. */
const FATTY = 'tw-495';

/** Only `tsd` and `tsdAfter` are reached on the paths under test. */
const STANDING = { tsd: 0, tsdAfter: () => 0 } as unknown as Standing;

const CONTEXT: DenialContext = {
  untapped: 3,
  believedPlays: 3,
  tapUtilisation: 1,
  fullPlay: 1,
};

/** A strike target on Fatty's card, with his abilities read or suppressed. */
function target(id: string, withAbilities: boolean, prowess = 5): StrikeTarget {
  return {
    instanceId: id as CardInstanceId,
    definitionId: FATTY,
    name: id,
    prowess,
    status: CardStatus.Untapped,
    isAlly: false,
    abilities: withAbilities ? combatAbilitiesOf(POOL[FATTY]) : NO_ABILITIES,
  };
}

describe('the price of tapping a character out of his ability', () => {
  const price = denialPricer(POOL, STANDING, DEFAULT_TUNABLES, CONTEXT);
  const tapped = { p: 1, character: 'tapped', strike: 'undefeated' } as never;

  test('a tap is worth more against a character whose ability it takes away', () => {
    const plain = price(tapped, target('plain', false), { untappedBefore: 3 });
    const fatty = price(tapped, target('fatty', true), { untappedBefore: 3 });
    expect(fatty).toBeGreaterThan(plain);
  });

  test('and worth exactly the tunable it is charged from, per ability', () => {
    // No anonymous constants: the gap must be the named number, not a number
    // that happens to be close to it.
    const plain = price(tapped, target('plain', false), { untappedBefore: 3 });
    const fatty = price(tapped, target('fatty', true), { untappedBefore: 3 });
    const abilities = combatAbilitiesOf(POOL[FATTY]).tapGated.length;
    expect(fatty - plain).toBeCloseTo(abilities * DEFAULT_TUNABLES.abilityTapDenialTsd, 9);
  });

  test('a character with no card text is priced exactly as before', () => {
    const plain = price(tapped, target('plain', false), { untappedBefore: 3 });
    expect(plain).toBeCloseTo(DEFAULT_TUNABLES.tapTempoCost + CONTEXT.fullPlay, 9);
  });
});

describe('who an attacker-chooses attack actually strikes', () => {
  /** The character the attack opens on, given the roster in that order. */
  function opensOn(roster: readonly StrikeTarget[]): string {
    const profile: AttackProfile = {
      strikeProwess: 8,
      strikes: 1,
      creatureBody: null,
      detainment: false,
      bodyCheckModifier: 0,
      attackerChooses: true,
    };
    const result = resolveAttacks(
      roster, POOL, [profile],
      denialPricer(POOL, STANDING, DEFAULT_TUNABLES, CONTEXT),
      { maxStates: 192 },
    );
    return result.opening[0].target.name;
  }

  test('the one whose ability the strike takes away, all else equal', () => {
    // Identical prowess, identical body, identical printed points. The only
    // thing separating them is the card text, and it is enough.
    expect(opensOn([target('plain', false), target('fatty', true)])).toBe('fatty');
  });

  test('and the answer does not depend on the order of the roster', () => {
    expect(opensOn([target('fatty', true), target('plain', false)])).toBe('fatty');
  });

  test('while a defender-assigns attack still opens on the best parrier', () => {
    // The contrast that makes the change meaningful: without the rule, the
    // defence answers, and it puts its strongest forward regardless of text.
    const profile: AttackProfile = {
      strikeProwess: 8,
      strikes: 1,
      creatureBody: null,
      detainment: false,
      bodyCheckModifier: 0,
    };
    const result = resolveAttacks(
      [target('plain', false, 7), target('fatty', true, 2)], POOL, [profile],
      denialPricer(POOL, STANDING, DEFAULT_TUNABLES, CONTEXT),
      { maxStates: 192 },
    );
    expect(result.opening[0].target.name).toBe('plain');
  });
});
