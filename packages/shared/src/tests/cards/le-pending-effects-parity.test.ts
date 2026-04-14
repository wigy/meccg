/**
 * @module le-pending-effects-parity.test
 *
 * Parity tests for the LE printings of the four pending-effects cards.
 *
 * Each LE printing must mirror its TW counterpart's effects exactly so
 * the constraint and resolution mechanics behave identically regardless
 * of which printing the player draws. We assert key fields rather than
 * deep-equal so future cosmetic differences (image URL, text wording)
 * don't trigger false positives.
 */

import { describe, test, expect } from 'vitest';
import { pool } from '../test-helpers.js';
import { LURE_OF_THE_SENSES, LOST_IN_FREE_DOMAINS, RIVER } from '../../card-ids.js';
import type { CardEffect, CardDefinitionId } from '../../index.js';

const LURE_OF_THE_SENSES_LE = 'le-124' as CardDefinitionId;
const LOST_IN_FREE_DOMAINS_LE = 'le-119' as CardDefinitionId;
const RIVER_LE = 'le-134' as CardDefinitionId;

/** Project an effect to its semantically meaningful fields for parity comparison. */
function effectShape(e: CardEffect): Record<string, unknown> {
  // Strip undefined / index-signature keys; keep only the discriminator and
  // the fields the engine actually reads. JSON.parse(JSON.stringify(...))
  // gives us a stable shape.
  return JSON.parse(JSON.stringify(e)) as Record<string, unknown>;
}

function assertEffectParity(twId: string, leId: string): void {
  const tw = pool[twId] as { effects?: readonly CardEffect[] };
  const le = pool[leId] as { effects?: readonly CardEffect[] };
  expect(tw, `${twId} not in card pool`).toBeDefined();
  expect(le, `${leId} not in card pool`).toBeDefined();
  expect(tw.effects, `${twId} has no effects`).toBeDefined();
  expect(le.effects, `${leId} has no effects`).toBeDefined();

  const twShapes = (tw.effects ?? []).map(effectShape);
  const leShapes = (le.effects ?? []).map(effectShape);
  expect(leShapes).toEqual(twShapes);
}

describe('LE printings — pending-effects card parity', () => {
  test('LE-124 Lure of the Senses mirrors TW-60', () => {
    assertEffectParity(LURE_OF_THE_SENSES as string, LURE_OF_THE_SENSES_LE as string);
  });

  test('LE-119 Lost in Free-domains mirrors TW-53', () => {
    assertEffectParity(LOST_IN_FREE_DOMAINS as string, LOST_IN_FREE_DOMAINS_LE as string);
  });

  test('LE-134 River mirrors TW-84', () => {
    assertEffectParity(RIVER as string, RIVER_LE as string);
  });
});
