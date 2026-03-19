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
import type { CardDefinitionId } from '../types/common.js';
import { SiteType, MarshallingCategory, RegionType } from '../types/common.js';
import { UNKNOWN_CARD, UNKNOWN_SITE } from '../card-ids.js';
import characters from './characters.json';
import items from './items.json';
import creatures from './creatures.json';
import sites from './sites.json';
import regions from './regions.json';

/**
 * Pre-merged array of every card definition across all categories.
 * The `as unknown as CardDefinition[]` casts are needed because TypeScript
 * infers JSON imports as their literal shape rather than the union type.
 */
const allCards: readonly CardDefinition[] = [
  ...(characters as unknown as CardDefinition[]),
  ...(items as unknown as CardDefinition[]),
  ...(creatures as unknown as CardDefinition[]),
  ...(sites as unknown as CardDefinition[]),
  ...(regions as unknown as CardDefinition[]),
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
/**
 * Placeholder card definitions for face-down / unknown cards.
 * Used by the formatter and client to display card backs instead of `???`.
 */
const placeholderCards: readonly CardDefinition[] = [
  {
    cardType: 'hero-resource-event',
    id: UNKNOWN_CARD,
    name: '[face-down card]',
    unique: false,
    eventType: 'short',
    marshallingPoints: 0,
    marshallingCategory: MarshallingCategory.Misc,
    text: '',
  },
  {
    cardType: 'hero-site',
    id: UNKNOWN_SITE,
    name: '[face-down site]',
    siteType: SiteType.Haven,
    sitePath: [] as readonly RegionType[],
    nearestHaven: '',
    playableResources: [],
    automaticAttacks: [],
    text: '',
  },
];

export function loadCardPool(): Readonly<Record<string, CardDefinition>> {
  const pool: Record<string, CardDefinition> = {};
  for (const card of allCards) {
    pool[card.id] = card;
  }
  for (const card of placeholderCards) {
    pool[card.id as string] = card;
  }
  return pool;
}
