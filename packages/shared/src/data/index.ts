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

import { isResourceEventCard, type CardDefinition, type ResourceEventCard, type SiteCard } from '../types/cards.js';
import { ACTS_AS_SITE_ID_SUFFIX, type ActsAsSiteEffect } from '../types/effects.js';
import type { HeroSiteCard, MinionSiteCard, FallenWizardSiteCard, BalrogSiteCard } from '../types/cards-sites.js';
import type { CardDefinitionId } from '../types/common.js';
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
import whCreatures from './wh-creatures.json';
import whHazards from './wh-hazards.json';

// ---- The Dragons (TD) — dragon expansion ----
import tdCharacters from './td-characters.json';
import tdItems from './td-items.json';
import tdResources from './td-resources.json';
import tdHazards from './td-hazards.json';
import tdSites from './td-sites.json';
import tdCreatures from './td-creatures.json';

// ---- Dark Minions (DM) — expansion ----
import dmCharacters from './dm-characters.json';
import dmCreatures from './dm-creatures.json';
import dmHazards from './dm-hazards.json';
import dmResources from './dm-resources.json';
import dmSites from './dm-sites.json';
import dmItems from './dm-items.json';

// ---- The Balrog (BA) — balrog expansion ----
import baCharacters from './ba-characters.json';
import baSites from './ba-sites.json';
import baHazards from './ba-hazards.json';
import baResources from './ba-resources.json';
import baCreatures from './ba-creatures.json';
import baItems from './ba-items.json';

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
  ...(whCreatures as unknown as CardDefinition[]),
  ...(whHazards as unknown as CardDefinition[]),
  // The Dragons
  ...(tdCharacters as unknown as CardDefinition[]),
  ...(tdItems as unknown as CardDefinition[]),
  ...(tdResources as unknown as CardDefinition[]),
  ...(tdHazards as unknown as CardDefinition[]),
  ...(tdSites as unknown as CardDefinition[]),
  ...(tdCreatures as unknown as CardDefinition[]),
  // Dark Minions
  ...(dmCharacters as unknown as CardDefinition[]),
  ...(dmCreatures as unknown as CardDefinition[]),
  ...(dmHazards as unknown as CardDefinition[]),
  ...(dmResources as unknown as CardDefinition[]),
  ...(dmSites as unknown as CardDefinition[]),
  ...(dmItems as unknown as CardDefinition[]),
  // The Balrog
  ...(baCharacters as unknown as CardDefinition[]),
  ...(baSites as unknown as CardDefinition[]),
  ...(baHazards as unknown as CardDefinition[]),
  ...(baResources as unknown as CardDefinition[]),
  ...(baCreatures as unknown as CardDefinition[]),
  ...(baItems as unknown as CardDefinition[]),
  // Against the Shadow resources/items (loaded here alongside BA)
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
/**
 * Site-card `cardType` discriminant for each alignment, used to synthesize
 * `acts-as-site` companion definitions with the correct type for their
 * source card's alignment.
 */
const SITE_CARD_TYPE_BY_ALIGNMENT: Readonly<Record<string, SiteCard['cardType']>> = {
  wizard: 'hero-site',
  ringwraith: 'minion-site',
  'fallen-wizard': 'fallen-wizard-site',
  balrog: 'balrog-site',
};

/**
 * Synthesizes a `SiteCard`-shaped companion definition for a card carrying an
 * `acts-as-site` effect (Wondrous Maps td-171, Refuge td-145), so every
 * existing site-lookup path (`isSiteCard`, automatic attacks, playable
 * resources, hazard/resource draws) treats it exactly like a real site once
 * a company is there — see {@link ActsAsSiteEffect} for the full mechanism.
 *
 * `region` and `nearestHaven` are deliberately left empty: `buildMovementMap`
 * only indexes a site into the shared movement graph when those fields are
 * non-empty, so the synthesized site can never be offered as a generic
 * movement destination — it is reachable only via its source card's own
 * `declare-virtual-site-movement` apply.
 */
function synthesizeActsAsSiteDefinition(source: ResourceEventCard, effect: ActsAsSiteEffect): SiteCard {
  const cardType = SITE_CARD_TYPE_BY_ALIGNMENT[source.alignment as string] ?? 'hero-site';
  return {
    cardType,
    alignment: source.alignment,
    id: `${source.id as string}${ACTS_AS_SITE_ID_SUFFIX}` as CardDefinitionId,
    name: source.name,
    image: source.image,
    siteType: effect.siteType,
    sitePath: [],
    nearestHaven: '',
    region: '',
    playableResources: effect.playableResources,
    automaticAttacks: effect.automaticAttacks,
    resourceDraws: effect.resourceDraws,
    hazardDraws: effect.hazardDraws,
    text: source.text,
    // Carries the same `acts-as-site` effect object so movement-legality
    // checks (`handleRevealNewSite`) can read `requiredMovementType` /
    // `requiredLastRegionType` / `leaveRequiresRegionMovement` directly off
    // whichever side (origin or destination) resolves to this definition,
    // without needing to strip the id suffix to find the source card.
    effects: [effect],
  } as HeroSiteCard | MinionSiteCard | FallenWizardSiteCard | BalrogSiteCard;
}

export function loadCardPool(): Readonly<Record<string, CardDefinition>> {
  const pool: Record<string, CardDefinition> = {};
  for (const card of allCards) {
    pool[card.id as string] = card;
  }
  // Synthesize `acts-as-site` companion definitions (see
  // synthesizeActsAsSiteDefinition) for every card that carries one, after
  // the real pool is fully populated so `source.text`/`source.image` etc.
  // are read from the finished card object.
  for (const card of allCards) {
    if (!isResourceEventCard(card)) continue;
    const actsAsSite = card.effects?.find((e): e is ActsAsSiteEffect => e.type === 'acts-as-site');
    if (!actsAsSite) continue;
    const siteDef = synthesizeActsAsSiteDefinition(card, actsAsSite);
    pool[siteDef.id as string] = siteDef;
  }
  return pool;
}
