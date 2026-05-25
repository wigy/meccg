/**
 * @module convert-under-deeps-positions
 *
 * One-shot build tool that reads the Heinrich-Barth map-positions.json and
 * filters entries to those matching the known Under-deeps sites in MECCG.
 * Converts Leaflet lat/lng coordinates to [x, y] fractions in [0,1]×[0,1]
 * relative to the bounding box of Under-deeps entries only.
 *
 * Usage:
 *   npx tsx tools/convert-under-deeps-positions.ts /tmp/map-positions.json \
 *       packages/shared/src/data/under-deeps-coordinates.json
 *
 * The resulting JSON is also copied to:
 *   packages/lobby-server/public/data/under-deeps-coordinates.json
 *
 * Under-deeps sites are identified by `keywords: ["under-deeps"]` in
 * dm-sites.json and ba-sites.json. The known names are:
 *   The Under-vaults, The Under-leas, The Under-grottos, The Under-gates,
 *   The Under-galleries, The Under-courts, The Sulfur-deeps, The Pûkel-deeps,
 *   The Iron-deeps, The Gem-deeps, The Drowning-deeps, Moria, The Rusted-deeps,
 *   The Wind-deeps, Remains of Thangorodrim
 *
 * Conversion formula (bounds computed from Under-deeps entries only):
 *   x_fraction = (lng - lng_min) / (lng_max - lng_min)
 *   y_fraction = 1 - (lat - lat_min) / (lat_max - lat_min)
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

/** All known Under-deeps site names (from dm-sites.json + ba-sites.json under-deeps keyword). */
const UNDER_DEEPS_SITES = new Set([
  'the under-vaults',
  'the under-leas',
  'the under-grottos',
  'the under-gates',
  'the under-galleries',
  'the under-courts',
  'the sulfur-deeps',
  'the pûkel-deeps',
  'the iron-deeps',
  'the gem-deeps',
  'the drowning-deeps',
  'moria',
  'the rusted-deeps',
  'the wind-deeps',
  'remains of thangorodrim',
]);

function parseCoord(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return parseFloat(value);
  throw new Error(`Unexpected coordinate type: ${typeof value}`);
}

function main() {
  const inputPath = process.argv[2] ?? '/tmp/map-positions.json';
  const outputPath = process.argv[3] ?? 'packages/shared/src/data/under-deeps-coordinates.json';
  const publicPath = 'packages/lobby-server/public/data/under-deeps-coordinates.json';

  const raw: Record<string, [unknown, unknown]> = JSON.parse(readFileSync(resolve(inputPath), 'utf-8'));

  // Normalise all values to numbers and filter to Under-deeps only
  const parsed: Record<string, [number, number]> = {};
  for (const [name, pair] of Object.entries(raw)) {
    if (!UNDER_DEEPS_SITES.has(name.toLowerCase())) continue;
    try {
      parsed[name] = [parseCoord(pair[0]), parseCoord(pair[1])];
    } catch (e) {
      console.warn(`Skipping "${name}": ${String(e)}`);
    }
  }

  const matched = Object.keys(parsed);
  console.log(`Matched ${matched.length} of ${UNDER_DEEPS_SITES.size} expected Under-deeps sites`);
  console.log('Matched:', matched.sort());

  const missing = [...UNDER_DEEPS_SITES].filter(ud => !matched.some(m => m.toLowerCase() === ud));
  if (missing.length > 0) {
    console.warn('Missing entries:', missing);
  }

  if (matched.length === 0) {
    console.error('No entries matched — aborting.');
    process.exit(1);
  }

  // Compute bounds from Under-deeps entries only
  const lats = Object.values(parsed).map(([lat]) => lat);
  const lngs = Object.values(parsed).map(([, lng]) => lng);
  const latMin = Math.min(...lats);
  const latMax = Math.max(...lats);
  const lngMin = Math.min(...lngs);
  const lngMax = Math.max(...lngs);

  // Add padding (5% on each side) so dots don't crowd the edges
  const latPad = (latMax - latMin) * 0.05;
  const lngPad = (lngMax - lngMin) * 0.05;
  const latMinP = latMin - latPad;
  const latMaxP = latMax + latPad;
  const lngMinP = lngMin - lngPad;
  const lngMaxP = lngMax + lngPad;

  console.log(`Lat range: ${latMin.toFixed(4)} to ${latMax.toFixed(4)}`);
  console.log(`Lng range: ${lngMin.toFixed(4)} to ${lngMax.toFixed(4)}`);

  // Convert to [x, y] fractions within the Under-deeps bounding box
  const coordinates: Record<string, [number, number]> = {};
  for (const [name, [lat, lng]] of Object.entries(parsed)) {
    const x = (lng - lngMinP) / (lngMaxP - lngMinP);
    const y = 1 - (lat - latMinP) / (latMaxP - latMinP);
    // Round to 4 decimal places to keep file compact
    coordinates[name] = [Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000];
  }

  const json = JSON.stringify(coordinates, null, 2);
  const resolvedOutput = resolve(outputPath);
  writeFileSync(resolvedOutput, json, 'utf-8');
  console.log(`Written ${Object.keys(coordinates).length} entries to ${outputPath}`);

  // Also copy to the lobby-server public directory
  const resolvedPublic = resolve(publicPath);
  writeFileSync(resolvedPublic, json, 'utf-8');
  console.log(`Copied to ${publicPath}`);
}

main();
