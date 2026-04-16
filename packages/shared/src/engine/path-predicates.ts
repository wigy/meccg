/**
 * @module engine/path-predicates
 *
 * Shared predicates on company site paths (arrays of
 * {@link RegionType}). These are the predicates legal-action code
 * consults when deciding whether a path-gated effect (e.g. Great Ship's
 * cancel-hazard-by-tap) is available. One copy here — both the M/H
 * legal-action code and the chain legal-action code import from this
 * module so the rule lives in one place.
 *
 * Long term (plan #6), Great Ship's predicate becomes a `path.*`
 * condition on the card itself, removing these helpers entirely. Until
 * then, centralising them here is the minimum viable dedup.
 */

import { RegionType } from '../types/common.js';

/**
 * Great Ship coastal condition: path contains at least one Coastal Sea
 * region and never has two consecutive non-Coastal regions.
 */
export function isCoastalPath(path: readonly RegionType[]): boolean {
  if (path.length === 0) return false;
  let hasCoastal = false;
  let prevNonCoastal = false;
  for (const region of path) {
    if (region === RegionType.Coastal) {
      hasCoastal = true;
      prevNonCoastal = false;
    } else {
      if (prevNonCoastal) return false;
      prevNonCoastal = true;
    }
  }
  return hasCoastal;
}
