/**
 * @module data
 *
 * Card data loader that aggregates all card categories (characters, items,
 * creatures, sites, regions) from their respective JSON files into a single
 * lookup table keyed by card definition ID.
 *
 * The JSON files are the canonical source of card data — they encode every
 * stat, keyword, and site path needed by the game engine. This module is
 * the only place those files are imported, so all consumers go through
 * {@link loadCardPool} for a consistent, read-only view of the card universe.
 */

import type { CardDefinition } from '../types/cards.js';
// ---- The Wizards (TW) — base set ----
import characters from './characters.json';
import items from './items.json';
import creatures from './creatures.json';
import sites from './sites.json';
import regions from './regions.json';
import other from './other.json';

// ---- Against the Shadow (AS) — minion expansion ----
import asSites from './as-sites.json';

// ---- The Lidless Eye (LE) — minion expansion ----
import leCharacters from './le-characters.json';
import leResources from './le-resources.json';
import leSites from './le-sites.json';

// ---- The White Hand (WH) — fallen-wizard expansion ----
import whSites from './wh-sites.json';

// ---- The Balrog (BA) — balrog expansion ----
import baSites from './ba-sites.json';

/**
 * Pre-merged array of every card definition across all categories and sets.
 * The `as unknown as CardDefinition[]` casts are needed because TypeScript
 * infers JSON imports as their literal shape rather than the union type.
 */
const allCards: readonly CardDefinition[] = [
  // The Wizards (base set)
  ...(characters as unknown as CardDefinition[]),
  ...(items as unknown as CardDefinition[]),
  ...(creatures as unknown as CardDefinition[]),
  ...(sites as unknown as CardDefinition[]),
  ...(regions as unknown as CardDefinition[]),
  ...(other as unknown as CardDefinition[]),
  // Against the Shadow
  ...(asSites as unknown as CardDefinition[]),
  // The Lidless Eye
  ...(leCharacters as unknown as CardDefinition[]),
  ...(leResources as unknown as CardDefinition[]),
  ...(leSites as unknown as CardDefinition[]),
  // The White Hand
  ...(whSites as unknown as CardDefinition[]),
  // The Balrog
  ...(baSites as unknown as CardDefinition[]),
];

/**
 * Builds and returns an immutable card pool — a dictionary from card
 * definition ID strings to their full {@link CardDefinition} objects.
 *
 * Called once at server startup (or session creation) and threaded through
 * the game state so that the engine can resolve any card by ID in O(1).
 *
 * @returns A frozen record mapping definition ID → card definition.
 */
export function loadCardPool(): Readonly<Record<string, CardDefinition>> {
  const pool: Record<string, CardDefinition> = {};
  for (const card of allCards) {
    pool[card.id as string] = card;
  }
  return pool;
}
