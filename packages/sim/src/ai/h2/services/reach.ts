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
 *
 * Starter movement (a haven and each site whose `nearestHaven` names it, plus
 * haven-to-haven `havenPaths`) is a second, region-graph-independent way to
 * reach a site in one hop — the same adjacency `isStarterMovementPossible`
 * grants the real engine. Reporting only the region-graph BFS distance made a
 * haven detour from its own dependent site (e.g. healing a wounded character,
 * then returning to finish an already-committed plan) look like a multi-region
 * trek home, when the return is really the same one-hop link the company used
 * to get there — so this takes the shorter of the two.
 */

import { buildMovementMap, regionDistanceInclusive } from '@meccg/shared';
import type { CardDefinition } from '@meccg/shared';
import { memoizeOnFirst } from '../core/memo.js';

/** Inclusive region distance for a single movement action (one hop, not "already there"). */
const ONE_HOP_DISTANCE = 2;

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
    const nameOf = (definitionId: string): string | undefined =>
      (cardPool[definitionId] as unknown as { name?: string } | undefined)?.name;
    const starterAdjacent = (fromName: string, toName: string): boolean =>
      map.havenSites.get(fromName)?.has(toName) === true
      || map.havenSites.get(toName)?.has(fromName) === true
      || map.havenToHaven.get(fromName)?.has(toName) === true;
    return {
      between(fromDefinitionId: string, toDefinitionId: string): number | null {
        const fromName = nameOf(fromDefinitionId);
        const toName = nameOf(toDefinitionId);
        if (fromName === undefined || toName === undefined) return null;
        const from = map.siteRegion.get(fromName);
        const to = map.siteRegion.get(toName);
        const regionDistance = from === undefined || to === undefined
          ? null : regionDistanceInclusive(map, from, to);
        if (!starterAdjacent(fromName, toName)) return regionDistance;
        return regionDistance === null ? ONE_HOP_DISTANCE : Math.min(regionDistance, ONE_HOP_DISTANCE);
      },
    };
  },
);
