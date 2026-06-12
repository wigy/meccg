/**
 * @module engine/region-keying
 *
 * Helpers for `region-keying-boost` environment effects (Withered Lands,
 * td-85). A boost lets one region in a company's site path count as additional
 * regions of another type when checking whether a hazard creature can be keyed
 * to that company.
 *
 * The creature-keying matchers live in two places — `findCreatureKeyingMatches`
 * (legal-actions, for emitting playable creatures) and `checkCreatureKeying`
 * (reducer, for validating a play). Both consult these helpers so the boost is
 * honoured identically on the read and write paths. The underlying site path is
 * never mutated: instead `regionPathsWithBoosts` produces candidate paths and
 * the caller tests each.
 */

import type { GameState } from '../types/state.js';
import type { RegionType } from '../types/common.js';
import type { RegionKeyingBoost } from '../types/effects.js';

export type { RegionKeyingBoost };

/**
 * Collect every region treatment offered by active `region-keying-boost`
 * constraints (e.g. Withered Lands). The constraints are global environment
 * effects, so all are returned regardless of which company is being keyed.
 */
export function collectRegionKeyingBoosts(state: GameState): RegionKeyingBoost[] {
  const boosts: RegionKeyingBoost[] = [];
  for (const c of state.activeConstraints) {
    if (c.kind.type === 'region-keying-boost') {
      boosts.push(...c.kind.boosts);
    }
  }
  return boosts;
}

/**
 * Build the set of candidate region-type paths a creature may be keyed against:
 * the base path plus, for each applicable boost, one variant where a single
 * region of the boost's `from` type is replaced by `count` regions of its
 * `asType`. A boost contributes a variant only when the path actually contains
 * a region of its `from` type. Boosts are never combined — each variant applies
 * exactly one boost (the card grants "one ... or one ... or one"), so the base
 * path is always included as the no-boost option.
 */
export function regionPathsWithBoosts(
  basePath: readonly RegionType[],
  boosts: readonly RegionKeyingBoost[],
): RegionType[][] {
  const paths: RegionType[][] = [[...basePath]];
  for (const b of boosts) {
    const idx = basePath.indexOf(b.from);
    if (idx === -1) continue;
    const variant = [...basePath];
    variant.splice(idx, 1);
    for (let i = 0; i < b.count; i++) variant.push(b.asType);
    paths.push(variant);
  }
  return paths;
}
