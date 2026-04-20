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
import twCharacters from './tw-characters.json';
import twItems from './tw-items.json';
import twCreatures from './tw-creatures.json';
import twSites from './tw-sites.json';
import twRegions from './tw-regions.json';
import twResources from './tw-resources.json';
import twHazards from './tw-hazards.json';

// ---- Against the Shadow (AS) — minion expansion ----
import asCharacters from './as-characters.json';
import asCreatures from './as-creatures.json';
import asHazards from './as-hazards.json';
import asSites from './as-sites.json';
import asResources from './as-resources.json';
import asItems from './as-items.json';

// ---- The Lidless Eye (LE) — minion expansion ----
import leCharacters from './le-characters.json';
import leCreatures from './le-creatures.json';
import leHazards from './le-hazards.json';
import leResources from './le-resources.json';
import leSites from './le-sites.json';
import leItems from './le-items.json';

// ---- The White Hand (WH) — fallen-wizard expansion ----
import whCharacters from './wh-characters.json';
import whItems from './wh-items.json';
import whResources from './wh-resources.json';
import whSites from './wh-sites.json';

// ---- The Dragons (TD) — dragon expansion ----
import tdCharacters from './td-characters.json';
import tdItems from './td-items.json';
import tdResources from './td-resources.json';
import tdHazards from './td-hazards.json';
import tdSites from './td-sites.json';
import tdCreatures from './td-creatures.json';

// ---- Dark Minions (DM) — expansion ----
import dmCreatures from './dm-creatures.json';
import dmHazards from './dm-hazards.json';
import dmResources from './dm-resources.json';
import dmSites from './dm-sites.json';

// ---- The Balrog (BA) — balrog expansion ----
import baCharacters from './ba-characters.json';
import baSites from './ba-sites.json';

/**
 * Pre-merged array of every card definition across all categories and sets.
 * The `as unknown as CardDefinition[]` casts are needed because TypeScript
 * infers JSON imports as their literal shape rather than the union type.
 */
const allCards: readonly CardDefinition[] = [
  // The Wizards (base set)
  ...(twCharacters as unknown as CardDefinition[]),
  ...(twItems as unknown as CardDefinition[]),
  ...(twResources as unknown as CardDefinition[]),
  ...(twCreatures as unknown as CardDefinition[]),
  ...(twHazards as unknown as CardDefinition[]),
  ...(twSites as unknown as CardDefinition[]),
  ...(twRegions as unknown as CardDefinition[]),
  // Against the Shadow
  ...(asCharacters as unknown as CardDefinition[]),
  ...(asCreatures as unknown as CardDefinition[]),
  ...(asHazards as unknown as CardDefinition[]),
  ...(asSites as unknown as CardDefinition[]),
  // The Lidless Eye
  ...(leCharacters as unknown as CardDefinition[]),
  ...(leCreatures as unknown as CardDefinition[]),
  ...(leHazards as unknown as CardDefinition[]),
  ...(leResources as unknown as CardDefinition[]),
  ...(leSites as unknown as CardDefinition[]),
  ...(leItems as unknown as CardDefinition[]),
  // The White Hand
  ...(whCharacters as unknown as CardDefinition[]),
  ...(whItems as unknown as CardDefinition[]),
  ...(whResources as unknown as CardDefinition[]),
  ...(whSites as unknown as CardDefinition[]),
  // The Dragons
  ...(tdCharacters as unknown as CardDefinition[]),
  ...(tdItems as unknown as CardDefinition[]),
  ...(tdResources as unknown as CardDefinition[]),
  ...(tdHazards as unknown as CardDefinition[]),
  ...(tdSites as unknown as CardDefinition[]),
  ...(tdCreatures as unknown as CardDefinition[]),
  // Dark Minions
  ...(dmCreatures as unknown as CardDefinition[]),
  ...(dmHazards as unknown as CardDefinition[]),
  ...(dmResources as unknown as CardDefinition[]),
  ...(dmSites as unknown as CardDefinition[]),
  // The Balrog
  ...(baCharacters as unknown as CardDefinition[]),
  ...(baSites as unknown as CardDefinition[]),
  ...(asResources as unknown as CardDefinition[]),
  ...(asItems as unknown as CardDefinition[]),
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
