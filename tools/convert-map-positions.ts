/**
 * @module convert-map-positions
 *
 * One-shot build tool that reads the Heinrich-Barth map-positions.json
 * (Leaflet lat/lng coordinates for all MECCG sites) and converts them
 * to [x, y] fractions in [0,1]×[0,1] relative to the map image extent.
 *
 * Usage:
 *   npx tsx tools/convert-map-positions.ts /tmp/map-positions.json \
 *       packages/shared/src/data/site-coordinates.json
 *
 * The Heinrich-Barth coordinate file uses Leaflet lat/lng pairs where:
 * - lat increases northward (higher = further north on the map)
 * - lng increases eastward (less negative = further right on the map)
 *
 * Conversion formula:
 *   x_fraction = (lng - lng_min) / (lng_max - lng_min)
 *   y_fraction = 1 - (lat - lat_min) / (lat_max - lat_min)   // y flipped: top = high lat
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

function parseCoord(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return parseFloat(value);
  throw new Error(`Unexpected coordinate type: ${typeof value}`);
}

function main() {
  const inputPath = process.argv[2] ?? '/tmp/map-positions.json';
  const outputPath = process.argv[3] ?? 'packages/shared/src/data/site-coordinates.json';

  const raw: Record<string, [unknown, unknown]> = JSON.parse(readFileSync(resolve(inputPath), 'utf-8'));

  // Normalise all values to numbers
  const parsed: Record<string, [number, number]> = {};
  for (const [name, pair] of Object.entries(raw)) {
    try {
      parsed[name] = [parseCoord(pair[0]), parseCoord(pair[1])];
    } catch (e) {
      console.warn(`Skipping "${name}": ${String(e)}`);
    }
  }

  const lats = Object.values(parsed).map(([lat]) => lat);
  const lngs = Object.values(parsed).map(([, lng]) => lng);
  const latMin = Math.min(...lats);
  const latMax = Math.max(...lats);
  const lngMin = Math.min(...lngs);
  const lngMax = Math.max(...lngs);

  console.log(`Lat range: ${latMin.toFixed(4)} to ${latMax.toFixed(4)}`);
  console.log(`Lng range: ${lngMin.toFixed(4)} to ${lngMax.toFixed(4)}`);
  console.log(`Total entries: ${Object.keys(parsed).length}`);

  // Convert to [x, y] fractions
  const coordinates: Record<string, [number, number]> = {};
  for (const [name, [lat, lng]] of Object.entries(parsed)) {
    const x = (lng - lngMin) / (lngMax - lngMin);
    const y = 1 - (lat - latMin) / (latMax - latMin);
    // Round to 4 decimal places to keep file compact
    coordinates[name] = [Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000];
  }

  const json = JSON.stringify(coordinates, null, 2);
  writeFileSync(resolve(outputPath), json, 'utf-8');
  console.log(`Written ${Object.keys(coordinates).length} entries to ${outputPath}`);
}

main();
