/**
 * @module ai/h2/services/reach.test
 *
 * Regression: a company parked at Minas Tirith (tw-412) with a wounded
 * character and a committed resource-play plan never left for turns 18-26 of
 * a real game (bug report, game mt7a24d0-qcbgun, stateSeq 1077) — every
 * `plan-movement` candidate, including to Lórien (tw-412's own `nearestHaven`
 * and the nearest place to heal), scored worse than `pass`. `explain` traced
 * it to `computeReach.between` reporting the *region graph's* distance
 * between Minas Tirith (Anórien) and Lórien (Wold & Foothills) — three
 * regions apart — even though a company at either site can reach the other in
 * a single starter-movement hop, the same one-hop link `isStarterMovementPossible`
 * grants the real engine. `travel`'s plan-step pricing (`reachProbability`)
 * then treated the return trip as needing two full region-crossings instead of
 * one starter-movement hop, pricing the detour's plan-protection penalty far
 * above what a single-hop trip actually costs.
 */

import { describe, test, expect } from 'vitest';
import { loadCardPool } from '@meccg/shared';
import { computeReach } from './reach.js';

// Minas Tirith (tw-412, free-hold): nearestHaven is Lórien.
const MINAS_TIRITH = 'tw-412';
// Lórien (tw-408, haven).
const LORIEN = 'tw-408';
// Bandit Lair (tw-373, ruins-and-lairs): nearestHaven is also Lórien, but it
// is not itself a haven and is not Minas Tirith's nearestHaven — the two sites
// share a haven without being starter-movement-adjacent to each other, so
// this confirms the fix does not collapse every distance to one hop.
const BANDIT_LAIR = 'tw-373';

describe('computeReach', () => {
  test('a site and its nearest haven are one hop apart, not the region graph\'s distance', () => {
    const reach = computeReach(loadCardPool());
    // regionDistanceInclusive: 1 = same region, 2 = one region-hop away.
    // Minas Tirith and Lórien sit three regions apart on the plain region
    // graph — this asserts the starter-movement shortcut wins instead.
    expect(reach.between(MINAS_TIRITH, LORIEN)).toBe(2);
  });

  test('the shortcut is symmetric: the haven back to its dependent site', () => {
    const reach = computeReach(loadCardPool());
    expect(reach.between(LORIEN, MINAS_TIRITH)).toBe(2);
  });

  test('a pair with no starter-movement link still reports the plain region distance', () => {
    const reach = computeReach(loadCardPool());
    const direct = reach.between(MINAS_TIRITH, BANDIT_LAIR);
    // Neither is the other's nearestHaven and neither is a haven, so nothing
    // shortcuts this pair — the fix must leave it exactly as before.
    expect(direct).not.toBeNull();
    expect(direct).toBeGreaterThan(2);
  });
});
