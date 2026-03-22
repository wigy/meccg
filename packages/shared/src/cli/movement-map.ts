/**
 * @module cli/movement-map
 *
 * CLI tool that builds the movement map from the card pool and prints
 * its contents in a human-readable format. Useful for verifying region
 * adjacency, haven connectivity, and site reachability.
 *
 * Usage: npx tsx packages/shared/src/cli/movement-map.ts [--from <site>] [--max-distance <n>]
 */

import { loadCardPool } from '../data/index.js';
import { buildMovementMap, getReachableSites } from '../movement-map.js';
import { isSiteCard } from '../types/index.js';
import type { SiteCard } from '../types/index.js';

const cardPool = loadCardPool();
const map = buildMovementMap(cardPool);

const args = process.argv.slice(2);
const fromIndex = args.indexOf('--from');
const fromSite = fromIndex >= 0 ? args.slice(fromIndex + 1).join(' ').split('--')[0].trim() : null;
const maxDistIndex = args.indexOf('--max-distance');
const maxDistance = maxDistIndex >= 0 ? parseInt(args[maxDistIndex + 1], 10) : undefined;

// Collect all site cards for reachability queries
const allSites: SiteCard[] = [];
for (const card of Object.values(cardPool)) {
  if (isSiteCard(card)) {
    allSites.push(card);
  }
}

// Deduplicate sites by name (multiple alignments share the same site name)
const sitesByName = new Map<string, SiteCard>();
for (const site of allSites) {
  if (!sitesByName.has(site.name)) {
    sitesByName.set(site.name, site);
  }
}
const uniqueSites = [...sitesByName.values()];

if (fromSite) {
  // --from mode: show reachable sites from a specific site
  printReachableFrom(fromSite, maxDistance);
} else {
  // Default: print full movement map overview
  printRegionGraph();
  printHavenConnectivity();
  printSitesByRegion();
  printSitesByHaven();
}

function printReachableFrom(siteName: string, maxDist?: number): void {
  const site = sitesByName.get(siteName);
  if (!site) {
    console.error(`Site not found: "${siteName}"`);
    console.error('Available sites:');
    for (const name of [...sitesByName.keys()].sort()) {
      console.error(`  ${name}`);
    }
    process.exit(1);
  }

  const reachable = getReachableSites(map, site, uniqueSites, maxDist);

  console.log(`\n=== Reachable from ${site.name} (${site.region}, ${site.siteType}) ===\n`);

  // Group by movement type
  const starter = reachable.filter((r) => r.movementType === 'starter');
  const region = reachable.filter((r) => r.movementType === 'region');

  if (starter.length > 0) {
    console.log('Starter movement:');
    for (const r of starter.sort((a, b) => a.site.name.localeCompare(b.site.name))) {
      console.log(`  ${r.site.name} (${r.site.siteType}, ${r.site.region})`);
    }
    console.log();
  }

  if (region.length > 0) {
    console.log('Region movement:');
    // Group by distance
    const byDist = new Map<number, typeof region>();
    for (const r of region) {
      const d = r.regionDistance ?? 0;
      if (!byDist.has(d)) byDist.set(d, []);
      byDist.get(d)!.push(r);
    }
    for (const dist of [...byDist.keys()].sort()) {
      const sites = byDist.get(dist)!;
      console.log(`  Distance ${dist} (${dist} region${dist > 1 ? 's' : ''}):`);
      for (const r of sites.sort((a, b) => a.site.name.localeCompare(b.site.name))) {
        console.log(`    ${r.site.name} (${r.site.siteType}, ${r.site.region})`);
      }
    }
    console.log();
  }

  console.log(`Total: ${reachable.length} reachable sites`);
}

function printRegionGraph(): void {
  console.log('=== Region Adjacency Graph ===\n');

  const regions = [...map.regionGraph.keys()].sort();
  console.log(`${regions.length} regions\n`);

  for (const region of regions) {
    const adjacent = [...(map.regionGraph.get(region) ?? [])].sort();
    console.log(`${region} (${adjacent.length} neighbors)`);
    for (const adj of adjacent) {
      console.log(`  -> ${adj}`);
    }
  }
  console.log();
}

function printHavenConnectivity(): void {
  console.log('=== Haven Connectivity ===\n');

  const havens = [...map.havenToHaven.keys()].sort();
  for (const haven of havens) {
    const connected = [...(map.havenToHaven.get(haven) ?? [])].sort();
    console.log(`${haven} <-> ${connected.join(', ')}`);
  }
  console.log();
}

function printSitesByRegion(): void {
  console.log('=== Sites by Region ===\n');

  // Invert siteRegion: region -> sites
  const regionToSites = new Map<string, string[]>();
  for (const [site, region] of map.siteRegion) {
    if (!regionToSites.has(region)) regionToSites.set(region, []);
    regionToSites.get(region)!.push(site);
  }

  const regions = [...regionToSites.keys()].sort();
  for (const region of regions) {
    const sites = regionToSites.get(region)!.sort();
    console.log(`${region} (${sites.length} sites)`);
    for (const site of sites) {
      const card = sitesByName.get(site);
      const type = card ? card.siteType : '?';
      console.log(`  ${site} [${type}]`);
    }
  }
  console.log();
}

function printSitesByHaven(): void {
  console.log('=== Sites by Nearest Haven (Starter Movement) ===\n');

  const havens = [...map.havenSites.keys()].sort();
  for (const haven of havens) {
    const sites = [...(map.havenSites.get(haven) ?? [])].sort();
    console.log(`${haven} (${sites.length} sites)`);
    for (const site of sites) {
      const card = sitesByName.get(site);
      const region = card ? card.region : '?';
      const type = card ? card.siteType : '?';
      console.log(`  ${site} [${type}, ${region}]`);
    }
  }
  console.log();
}
