/**
 * @module ai/h2/services/strike/strike-model.test
 *
 * The dice half of the combat module. These are the claims the calibration
 * harness re-checks against the real reducer, so they are pinned here against
 * hand-counted 36ths rather than against each other.
 */

import { describe, test, expect } from 'vitest';
import { strikeOutcomes } from './strike-model.js';
import type { StrikeOption, StrikeSituation } from './strike-model.js';

/** A strike with no body: a parry defeats it outright. */
const NO_BODY: StrikeSituation = {
  creatureBody: null,
  detainment: false,
  characterBody: 9,
  alreadyWounded: false,
  bodyCheckModifier: 0,
};

/** Tap to fight, single roll, no card. */
function tapAt(need: number): StrikeOption {
  return { need, tapMode: 'always', bestOfTwo: false, bodyPenalty: 0 };
}

/** Total probability of the outcomes matching a predicate. */
function chance(outcomes: readonly { p: number }[], predicate: (o: never) => boolean = () => true): number {
  return outcomes.filter(predicate as (o: unknown) => boolean).reduce((sum, o) => sum + o.p, 0);
}

describe('the outcome distribution', () => {
  test('sums to 1 at every reachable target', () => {
    for (let need = 2; need <= 13; need++) {
      expect(chance(strikeOutcomes(tapAt(need), NO_BODY))).toBeCloseTo(1, 12);
    }
  });

  test('never lists an unreachable branch', () => {
    for (let need = 2; need <= 13; need++) {
      for (const outcome of strikeOutcomes(tapAt(need), NO_BODY)) expect(outcome.p).toBeGreaterThan(0);
    }
  });

  test('splits a need of 4 into 33, 2 and 1 of 36', () => {
    const outcomes = strikeOutcomes(tapAt(4), NO_BODY);
    expect(chance(outcomes, (o: { strike: string }) => o.strike === 'defeated')).toBeCloseTo(33 / 36, 12);
    expect(chance(outcomes, (o: { strike: string }) => o.strike === 'tie')).toBeCloseTo(2 / 36, 12);
    expect(chance(outcomes, (o: { strike: string }) => o.strike === 'struck')).toBeCloseTo(1 / 36, 12);
  });

  test('has no tie or wound once the target is clamped to 2', () => {
    // `need = max(2, prowess difference + 1)`: at the clamp the character
    // already out-prowesses the strike, so even a roll of 2 wins outright.
    const outcomes = strikeOutcomes(tapAt(2), NO_BODY);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].strike).toBe('defeated');
    expect(outcomes[0].p).toBe(1);
  });
});

describe('the attack body check', () => {
  test('a parry only defeats a strike whose body check fails', () => {
    const outcomes = strikeOutcomes(tapAt(2), { ...NO_BODY, creatureBody: 10 });
    // Body 10 fails on 11 or 12: 3 of 36.
    expect(chance(outcomes, (o: { strike: string }) => o.strike === 'defeated')).toBeCloseTo(3 / 36, 12);
    expect(chance(outcomes, (o: { strike: string }) => o.strike === 'survived')).toBeCloseTo(33 / 36, 12);
  });

  test('an attack with no body is defeated by the parry alone', () => {
    const outcomes = strikeOutcomes(tapAt(2), NO_BODY);
    expect(chance(outcomes, (o: { strike: string }) => o.strike === 'survived')).toBe(0);
  });
});

describe('what happens to the character', () => {
  test('tapping to fight taps on a parry; staying untapped does not', () => {
    expect(strikeOutcomes(tapAt(4), NO_BODY).find(o => o.strike === 'defeated')?.character).toBe('tapped');
    expect(strikeOutcomes({ ...tapAt(4), tapMode: 'tie-only' }, NO_BODY)
      .find(o => o.strike === 'defeated')?.character).toBe('untapped');
  });

  test('a tie taps only a character who fought at full prowess (CoE 3.iv.7)', () => {
    // The -3 paid to stay untapped covers the tie as well: the rule taps the
    // character "unless a -3 modification was applied in Step 3", and the
    // engine never taps in untap or dodge mode.
    expect(strikeOutcomes(tapAt(4), NO_BODY)
      .find(o => o.strike === 'tie')?.character).toBe('tapped');
    expect(strikeOutcomes({ ...tapAt(4), tapMode: 'tie-only' }, NO_BODY)
      .find(o => o.strike === 'tie')?.character).toBe('untapped');
    expect(strikeOutcomes({ ...tapAt(4), tapMode: 'never' }, NO_BODY)
      .find(o => o.strike === 'tie')?.character).toBe('untapped');
  });

  test('a strike that gets through wounds, and may then eliminate', () => {
    const outcomes = strikeOutcomes(tapAt(10), NO_BODY);
    const wounded = outcomes.find(o => o.character === 'wounded');
    const eliminated = outcomes.find(o => o.character === 'eliminated');
    // Body 9 fails on 10 or better: 6 of 36 of the strikes that got through.
    expect(eliminated!.p / (wounded!.p + eliminated!.p)).toBeCloseTo(6 / 36, 12);
  });

  test('an already-wounded character is likelier to die, by exactly the +1', () => {
    // Body 9 fails on a modified roll above it: 10 or better healthy (6 of 36),
    // 9 or better once the wounded +1 applies (10 of 36). A need of 10 lets
    // 26 of 36 strikes through in the first place.
    const eliminated = (alreadyWounded: boolean): number =>
      chance(
        strikeOutcomes(tapAt(10), { ...NO_BODY, alreadyWounded }),
        (o: { character: string }) => o.character === 'eliminated',
      );
    expect(eliminated(false)).toBeCloseTo((26 / 36) * (6 / 36), 12);
    expect(eliminated(true)).toBeCloseTo((26 / 36) * (10 / 36), 12);
  });

  test('detainment taps instead of wounding, and can never eliminate', () => {
    const outcomes = strikeOutcomes(tapAt(10), { ...NO_BODY, detainment: true });
    expect(outcomes.some(o => o.character === 'eliminated')).toBe(false);
    expect(outcomes.find(o => o.strike === 'struck')?.character).toBe('tapped');
  });
});

describe('rerolls', () => {
  test('the better of two rolls beats a single one, and not by a flat bonus', () => {
    const single = chance(strikeOutcomes(tapAt(8), NO_BODY), (o: { strike: string }) => o.strike === 'defeated');
    const best = chance(strikeOutcomes({ ...tapAt(8), bestOfTwo: true }, NO_BODY), (o: { strike: string }) => o.strike === 'defeated');
    // 15/36 once → 1 − (21/36)² twice.
    expect(single).toBeCloseTo(15 / 36, 12);
    expect(best).toBeCloseTo(1 - (21 / 36) ** 2, 12);
  });

  test('a reroll distribution still sums to 1', () => {
    for (let need = 2; need <= 12; need++) {
      expect(chance(strikeOutcomes({ ...tapAt(need), bestOfTwo: true }, NO_BODY))).toBeCloseTo(1, 12);
    }
  });
});

describe('body modifiers from cards', () => {
  test('a dodge body penalty makes elimination likelier', () => {
    const plain = chance(strikeOutcomes(tapAt(10), NO_BODY), (o: { character: string }) => o.character === 'eliminated');
    const dodged = chance(
      strikeOutcomes({ ...tapAt(10), tapMode: 'never', bodyPenalty: -1 }, NO_BODY),
      (o: { character: string }) => o.character === 'eliminated',
    );
    expect(dodged).toBeGreaterThan(plain);
  });

  test('an attack-level body-check modifier does the same', () => {
    const plain = chance(strikeOutcomes(tapAt(10), NO_BODY), (o: { character: string }) => o.character === 'eliminated');
    const cruel = chance(
      strikeOutcomes(tapAt(10), { ...NO_BODY, bodyCheckModifier: 1 }),
      (o: { character: string }) => o.character === 'eliminated',
    );
    expect(cruel).toBeGreaterThan(plain);
  });
});
