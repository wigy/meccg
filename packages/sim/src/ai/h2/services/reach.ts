/**
 * @module ai/h2/services/reach
 *
 * How far a company is from a site, in the engine's own region distance.
 *
 * A service rather than a helper inside `travel` because three modules need
 * the same number and a second copy would be a second opinion about the map:
 * the proposers set a plan's route step from it, and `travel` recomputes it
 * for every candidate destination to price the progress a move makes. The
 * distance itself is `regionDistanceInclusive` — the engine's, not a
 * re-derivation — so nothing here can drift from what movement actually costs.
 */

import { buildMovementMap, regionDistanceInclusive } from '@meccg/shared';
import type { CardDefinition } from '@meccg/shared';
import { memoizeOnFirst } from '../core/memo.js';

/** Region distance between two site definitions, or null when unconnected. */
export interface Reach {
  /**
   * Inclusive region distance between two sites, the rules way: two sites in
   * one region are 1 apart and adjacent regions are 2.
   *
   * Null when either site is unknown to the map or no path joins them, which a
   * caller must treat as "no information" rather than "infinitely far" — an
   * unreachable-looking site is far more often a gap in the map than a real
   * island.
   */
  between(fromDefinitionId: string, toDefinitionId: string): number | null;
}

/** Build the reach service for a card pool. Memoized: the map is pool-wide. */
export const computeReach = memoizeOnFirst(
  (cardPool: Readonly<Record<string, CardDefinition>>): Reach => {
    const map = buildMovementMap(cardPool);
    const regionOf = (definitionId: string): string | undefined => {
      const name = (cardPool[definitionId] as unknown as { name?: string } | undefined)?.name;
      return name === undefined ? undefined : map.siteRegion.get(name);
    };
    return {
      between(fromDefinitionId: string, toDefinitionId: string): number | null {
        const from = regionOf(fromDefinitionId);
        const to = regionOf(toDefinitionId);
        if (from === undefined || to === undefined) return null;
        return regionDistanceInclusive(map, from, to);
      },
    };
  },
);
