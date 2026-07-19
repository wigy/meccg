/**
 * @module le-pending-effects-parity.test
 *
 * Parity tests for the four corruption "pending-effects" hazards printed in
 * both The Wizards (TW) and The Lidless Eye (LE):
 *   Despair of the Heart, Greed, Lure of the Senses, Weariness of the Heart.
 *
 * Each LE printing must mirror its TW counterpart's effects exactly so the
 * constraint / pending-resolution mechanics behave identically regardless of
 * which printing the player draws. The engine is driven entirely by a card's
 * `effects` array plus a few structural fields, so effect-array parity *is*
 * behavioral parity. We assert the effect array and key structural fields
 * rather than deep-equalling the whole definition, so cosmetic differences
 * (image URL, text wording) never trigger a false positive.
 *
 * This also guards against the regression these pairs previously exhibited:
 * one printing carrying the full effects while its sibling had an empty
 * `effects: []` (an inert card that silently does nothing when played).
 */

import { describe, test, expect } from 'vitest';
import { pool } from '../test-helpers.js';

/** The optional fields these hazards are compared on. */
type Printing = {
  readonly cardType: string;
  readonly unique: boolean;
  readonly effects?: readonly unknown[];
  readonly eventType?: string;
  readonly keywords?: readonly string[];
};

const PAIRS: ReadonlyArray<{ readonly name: string; readonly tw: string; readonly le: string }> = [
  { name: 'Despair of the Heart', tw: 'tw-27', le: 'le-109' },
  { name: 'Greed', tw: 'tw-42', le: 'le-113' },
  { name: 'Lure of the Senses', tw: 'tw-60', le: 'le-124' },
  { name: 'Weariness of the Heart', tw: 'tw-111', le: 'le-149' },
];

describe('LE printings — pending-effects card parity', () => {
  for (const { name, tw, le } of PAIRS) {
    describe(name, () => {
      const twDef = pool[tw] as Printing | undefined;
      const leDef = pool[le] as Printing | undefined;

      test(`both printings exist (${tw} / ${le})`, () => {
        expect(twDef).toBeDefined();
        expect(leDef).toBeDefined();
      });

      test('effect arrays are identical — same engine behavior', () => {
        expect(leDef!.effects).toEqual(twDef!.effects);
        // Neither printing may be inert: an empty effects array is the bug this guards.
        expect((twDef!.effects ?? []).length).toBeGreaterThan(0);
      });

      test('key structural fields match', () => {
        expect(leDef!.cardType).toBe(twDef!.cardType);
        expect(leDef!.eventType).toBe(twDef!.eventType);
        expect(leDef!.unique).toBe(twDef!.unique);
        expect(leDef!.keywords ?? []).toEqual(twDef!.keywords ?? []);
      });
    });
  }
});
