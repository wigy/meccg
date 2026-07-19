/**
 * @module movement-map
 *
 * Precalculated movement graph for determining which sites a company can
 * move to. Built once from the card pool and queried per-company during
 * the organization phase.
 *
 * Supports two movement types:
 * - **Starter Movement**: travel between a haven and its connected sites,
 *   or between two havens that list paths to each other.
 * - **Region Movement**: travel through up to 4 consecutive regions in
 *   the adjacency graph (including both origin and destination regions).
 */

import type { CardDefinition, SiteCard, RegionCard } from './types/index.js';
import { isSiteCard, Alignment } from './types/index.js';

/** Movement type used to reach a destination. */
export type MovementType = 'starter' | 'region';

/** A site reachable from a given origin, annotated with how to get there. */
export interface ReachableSite {
  /** The destination site card definition. */
  readonly site: SiteCard;
  /** Which movement type can be used. */
  readonly movementType: MovementType;
  /**
   * For region movement: number of consecutive regions (rules-style).
   * Same region = 1, adjacent regions = 2, default max = 4.
   */
  readonly regionDistance?: number;
}

/**
 * Precomputed movement graph built once from the card pool.
 *
 * Contains the region adjacency graph, all-pairs shortest distances,
 * site-to-region mappings, and haven connectivity. Used by
 * {@link getReachableSites} to determine legal movement destinations.
 */
export interface MovementMap {
  /** Region name -> set of adjacent region names. */
  readonly regionGraph: ReadonlyMap<string, ReadonlySet<string>>;
  /** Region A -> Region B -> shortest path in edges (adjacent = 1, same = 0). */
  readonly regionPathEdges: ReadonlyMap<string, ReadonlyMap<string, number>>;
  /** Site name -> region name. */
  readonly siteRegion: ReadonlyMap<string, string>;
  /** Haven name -> set of non-haven site names whose nearestHaven is this haven. */
  readonly havenSites: ReadonlyMap<string, ReadonlySet<string>>;
  /** Haven name -> set of other haven names reachable via starter movement. */
  readonly havenToHaven: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * Build the region adjacency graph from all RegionCards in the card pool.
 * Returns a Map where each region name maps to its set of adjacent region names.
 */
function buildRegionGraph(
  cardPool: Readonly<Record<string, CardDefinition>>,
): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();

  for (const card of Object.values(cardPool)) {
    if (card.cardType !== 'region') continue;
    const region: RegionCard = card;
    if (!graph.has(region.name)) {
      graph.set(region.name, new Set());
    }
    for (const adj of region.adjacentRegions) {
      graph.get(region.name)!.add(adj);
      // Ensure symmetric adjacency
      if (!graph.has(adj)) {
        graph.set(adj, new Set());
      }
      graph.get(adj)!.add(region.name);
    }
  }

  return graph;
}

/**
 * Compute all-pairs shortest distances via BFS from each region.
 * Distance is measured in edges (adjacent regions have distance 1).
 */
function computeAllPairsDistance(
  graph: Map<string, Set<string>>,
): Map<string, Map<string, number>> {
  const result = new Map<string, Map<string, number>>();

  for (const source of graph.keys()) {
    const dist = new Map<string, number>();
    dist.set(source, 0);
    const queue = [source];
    let head = 0;

    while (head < queue.length) {
      const current = queue[head++];
      const d = dist.get(current)!;
      const neighbors = graph.get(current);
      if (!neighbors) continue;
      for (const neighbor of neighbors) {
        if (!dist.has(neighbor)) {
          dist.set(neighbor, d + 1);
          queue.push(neighbor);
        }
      }
    }

    result.set(source, dist);
  }

  return result;
}

/**
 * Whether a site whose card-alignment is `siteAlignment` belongs in the
 * movement topology of a player whose deck-alignment is `playerAlignment`.
 *
 * Single-alignment players (Wizard, Ringwraith, Balrog) only ever stand on and
 * move between sites of their own alignment, so the match is exact. A
 * Fallen-wizard, however, builds a mixed location deck — one copy of each hero
 * site and each minion site plus Fallen-wizard sites (CoE rule 1.28) — and
 * occupies and moves between all three. Filtering a Fallen-wizard's map to only
 * `fallen-wizard` sites drops the hero and minion sites entirely, leaving their
 * companies with no region indexed and therefore no legal movement.
 */
function alignmentUsesSite(playerAlignment: Alignment, siteAlignment: Alignment | undefined): boolean {
  if (playerAlignment === Alignment.FallenWizard) {
    return siteAlignment === Alignment.Wizard
      || siteAlignment === Alignment.Ringwraith
      || siteAlignment === Alignment.FallenWizard;
  }
  return siteAlignment === playerAlignment;
}

/**
 * Build a precalculated movement map from the card pool.
 *
 * Scans all region cards for the adjacency graph, all site cards for
 * region assignments and haven connectivity. Computes all-pairs shortest
 * paths for the region graph (small graph, ~52 nodes).
 *
 * @param cardPool - The full static card definition pool.
 * @param alignment - When provided, only sites of this alignment are indexed
 *   into the site/haven maps. This is essential because the same physical
 *   location has separate site cards per alignment (e.g. hero Rivendell is a
 *   haven while minion Rivendell is a free-hold reachable from Carn Dûm).
 *   Indexing by name across alignments would conflate them, so callers must
 *   pass the moving company's alignment. Region adjacency is alignment-neutral
 *   and is always built from all region cards. Omitting the argument indexes
 *   all alignments (only correct when the pool already holds a single side).
 * @returns A frozen {@link MovementMap} ready for queries.
 */
export function buildMovementMap(
  cardPool: Readonly<Record<string, CardDefinition>>,
  alignment?: Alignment,
): MovementMap {
  const regionGraph = buildRegionGraph(cardPool);
  const regionPathEdges = computeAllPairsDistance(regionGraph);

  const siteRegion = new Map<string, string>();
  const havenSites = new Map<string, Set<string>>();
  const havenToHaven = new Map<string, Set<string>>();

  for (const card of Object.values(cardPool)) {
    if (!isSiteCard(card)) continue;
    // Only index sites of the moving company's alignment so same-named sites
    // of other alignments do not pollute this side's haven/region topology.
    // A Fallen-wizard is the exception: its location deck mixes hero, minion,
    // and Fallen-wizard sites, so all three must be indexed (see
    // {@link alignmentUsesSite}).
    if (alignment !== undefined && !alignmentUsesSite(alignment, card.alignment)) continue;

    const site = card;
    if (site.region) {
      siteRegion.set(site.name, site.region);
    }

    const isHaven = site.siteType === 'haven';
    if (isHaven) {
      // Index haven-to-haven connectivity from havenPaths
      if (site.havenPaths) {
        if (!havenToHaven.has(site.name)) {
          havenToHaven.set(site.name, new Set());
        }
        for (const otherHaven of Object.keys(site.havenPaths)) {
          havenToHaven.get(site.name)!.add(otherHaven);
          // Ensure symmetric connectivity
          if (!havenToHaven.has(otherHaven)) {
            havenToHaven.set(otherHaven, new Set());
          }
          havenToHaven.get(otherHaven)!.add(site.name);
        }
      }
    } else if (site.nearestHaven) {
      // Index non-haven sites by their nearest haven
      if (!havenSites.has(site.nearestHaven)) {
        havenSites.set(site.nearestHaven, new Set());
      }
      havenSites.get(site.nearestHaven)!.add(site.name);
    }
  }

  return {
    regionGraph,
    regionPathEdges,
    siteRegion,
    havenSites,
    havenToHaven,
  };
}

/**
 * Default maximum region distance for region movement.
 * The rules say "four consecutive regions" counting both origin and destination.
 */
const DEFAULT_MAX_REGION_DISTANCE = 4;

/**
 * Inclusive region distance between two regions, counting both endpoints:
 * same region = 1, adjacent = 2, … (the rules-style region count used by
 * Prophet of Doom wh-106, per CRF 22 — "«Number of regions between» includes
 * the region of Pallando's site and the region the faction is played in").
 *
 * Returns `null` when the regions are unknown or unreachable in the region
 * graph (callers decide how to treat that — Prophet of Doom treats it as an
 * impossible reach).
 */
export function regionDistanceInclusive(
  map: MovementMap,
  regionA: string,
  regionB: string,
): number | null {
  if (regionA === regionB) return 1;
  const edges = map.regionPathEdges.get(regionA)?.get(regionB);
  if (edges === undefined) return null;
  return edges + 1;
}

/**
 * Determine which sites a company can move to from its current site.
 *
 * Checks both starter movement (haven-based) and region movement
 * (up to 4 consecutive regions by default). Region distance counts
 * regions the rules way: origin and destination both count, so two
 * sites in the same region have distance 1 and adjacent regions
 * have distance 2.
 *
 * @param map - The precomputed movement map.
 * @param currentSite - The site card definition where the company currently is.
 * @param candidateSites - The site card definitions available to move to (from the player's site deck).
 * @param maxRegionDistance - Maximum region distance (default 4 = four consecutive regions).
 * @returns Array of reachable sites with their movement type and distance.
 */
/**
 * Find all region paths from one region to another within a maximum
 * number of regions (rules-style counting: origin and destination both
 * count, so maxRegions=4 means up to 3 edges).
 *
 * Returns every distinct path as an array of region names (including
 * both the origin and destination regions). Paths never revisit a region.
 *
 * @param map - The precomputed movement map.
 * @param fromRegion - The starting region name.
 * @param toRegion - The destination region name.
 * @param maxRegions - Maximum number of regions in the path (default 4).
 * @returns Array of paths, each path being an array of region names.
 */
export function findRegionPaths(
  map: MovementMap,
  fromRegion: string,
  toRegion: string,
  maxRegions = DEFAULT_MAX_REGION_DISTANCE,
): string[][] {
  const results: string[][] = [];
  const maxEdges = maxRegions - 1;

  function dfs(current: string, path: string[], visited: Set<string>): void {
    if (current === toRegion) {
      results.push([...path]);
      return;
    }
    if (path.length - 1 >= maxEdges) return;

    const neighbors = map.regionGraph.get(current);
    if (!neighbors) return;
    for (const next of neighbors) {
      if (visited.has(next)) continue;
      visited.add(next);
      path.push(next);
      dfs(next, path, visited);
      path.pop();
      visited.delete(next);
    }
  }

  if (!map.regionGraph.has(fromRegion)) return results;
  // Same region is a trivial path of length 1
  if (fromRegion === toRegion) {
    return [[fromRegion]];
  }

  const visited = new Set<string>([fromRegion]);
  dfs(fromRegion, [fromRegion], visited);
  return results;
}

export function getReachableSites(
  map: MovementMap,
  currentSite: SiteCard,
  candidateSites: readonly SiteCard[],
  maxRegionDistance = DEFAULT_MAX_REGION_DISTANCE,
): ReachableSite[] {
  const results: ReachableSite[] = [];
  const currentIsHaven = currentSite.siteType === 'haven';
  const currentRegion = map.siteRegion.get(currentSite.name);

  for (const dest of candidateSites) {
    // Can't move to the same site you're at
    if (dest.name === currentSite.name) continue;

    const destIsHaven = dest.siteType === 'haven';

    // --- Starter Movement ---
    if (currentIsHaven && destIsHaven) {
      // Haven to haven: both must list paths to each other
      const connected = map.havenToHaven.get(currentSite.name);
      if (connected?.has(dest.name)) {
        results.push({ site: dest, movementType: 'starter' });
      }
    } else if (currentIsHaven && !destIsHaven) {
      // From haven to non-haven: dest's nearestHaven must be this haven
      if (dest.nearestHaven === currentSite.name) {
        results.push({ site: dest, movementType: 'starter' });
      }
    } else if (!currentIsHaven && destIsHaven) {
      // From non-haven to haven: current site's nearestHaven must be the destination
      if (currentSite.nearestHaven === dest.name) {
        results.push({ site: dest, movementType: 'starter' });
      }
    }

    // --- Region Movement ---
    if (currentRegion && dest.region) {
      const destRegion = dest.region;
      const edgeMap = map.regionPathEdges.get(currentRegion);
      const edges = edgeMap?.get(destRegion);
      if (edges !== undefined) {
        // Convert edge count to region distance (rules-style: edges + 1)
        const regDist = edges + 1;
        if (regDist <= maxRegionDistance) {
          results.push({ site: dest, movementType: 'region', regionDistance: regDist });
        }
      }
    }
  }

  return results;
}
