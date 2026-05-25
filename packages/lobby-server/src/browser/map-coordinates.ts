/**
 * @module map-coordinates
 *
 * Lazy-loads and caches the site coordinate data from the static JSON asset.
 * Coordinates are [x, y] fractions in [0,1]×[0,1] relative to the map image,
 * where x=0 is the west edge, x=1 is the east edge, y=0 is the north edge,
 * and y=1 is the south edge.
 *
 * The JSON is fetched once on first call to {@link loadCoordinates} and cached
 * for the lifetime of the page. Subsequent calls resolve immediately.
 *
 * Lookup is case-insensitive to handle name mismatches between the Heinrich-Barth
 * coordinate source (mixed case) and our card definitions.
 */

/** Map from site name (lower-cased) to [x, y] fraction coordinates. */
let coordCache: Map<string, [number, number]> | null = null;

/** In-flight fetch promise — prevents duplicate requests during concurrent callers. */
let loadPromise: Promise<void> | null = null;

/**
 * Load and cache the site coordinate data from the static JSON asset.
 * Safe to call multiple times — the fetch is performed at most once.
 */
export async function loadCoordinates(): Promise<void> {
  if (coordCache !== null) return;
  if (loadPromise !== null) {
    await loadPromise;
    return;
  }

  loadPromise = (async () => {
    const response = await fetch('/data/site-coordinates.json');
    if (!response.ok) {
      throw new Error(`Failed to load site coordinates: ${response.status} ${response.statusText}`);
    }
    const raw: Record<string, [number, number]> = await response.json() as Record<string, [number, number]>;

    // Build case-insensitive lookup map
    const map = new Map<string, [number, number]>();
    for (const [name, coords] of Object.entries(raw)) {
      map.set(name.toLowerCase(), coords);
    }
    coordCache = map;
  })();

  await loadPromise;
}

/**
 * Look up the [x, y] fraction coordinates for a site by name.
 * Returns null if coordinates are not available (either not loaded yet,
 * or the site has no entry in the coordinate database).
 *
 * Lookup is case-insensitive.
 */
export function getCoordinates(siteName: string): [number, number] | null {
  if (coordCache === null) return null;
  return coordCache.get(siteName.toLowerCase()) ?? null;
}

/** Returns true once {@link loadCoordinates} has successfully completed. */
export function areCoordinatesLoaded(): boolean {
  return coordCache !== null;
}
