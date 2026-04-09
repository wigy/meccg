/**
 * @module ai/evaluators/common
 *
 * Shared scoring utilities for heuristic phase evaluators.
 *
 * Encapsulates lookups against the player view (find a card in hand, find
 * a character in play, dice success probability, etc.) so that individual
 * evaluators stay focused on their phase logic. All lookups are tolerant
 * of missing data — the AI never throws on partial information.
 */

import type { PlayerView } from '../../types/player-view.js';
import type {
  CardDefinition,
  CharacterCard,
  HeroItemCard,
  MinionItemCard,
  CreatureCard,
  HeroSiteCard,
  MinionSiteCard,
  FallenWizardSiteCard,
  BalrogSiteCard,
} from '../../types/cards.js';
import type { CardInstanceId, RegionType } from '../../types/common.js';
import type { CharacterInPlay, Company } from '../../types/state.js';
import {
  isCharacterCard,
  isItemCard,
  isFactionCard,
  isAllyCard,
} from '../../types/cards.js';

/** Union of all site card types — handy for movement scoring. */
export type AnySiteCard = HeroSiteCard | MinionSiteCard | FallenWizardSiteCard | BalrogSiteCard;

/** Look up a card definition from the pool, returning undefined if missing. */
export function lookupDef(
  pool: Readonly<Record<string, CardDefinition>>,
  defId: string | undefined,
): CardDefinition | undefined {
  if (!defId) return undefined;
  return pool[defId];
}

/** Look up the definition of a card instance held in any visible zone. */
export function defOfInstance(
  view: PlayerView,
  pool: Readonly<Record<string, CardDefinition>>,
  instanceId: CardInstanceId,
): CardDefinition | undefined {
  const fromHand = view.self.hand.find(c => c.instanceId === instanceId);
  if (fromHand) return lookupDef(pool, fromHand.definitionId);
  const char = view.self.characters[instanceId];
  if (char) return lookupDef(pool, char.definitionId);
  const oppChar = view.opponent.characters[instanceId];
  if (oppChar) return lookupDef(pool, oppChar.definitionId);
  // Search items / allies / hazards on every character
  for (const c of Object.values(view.self.characters)) {
    for (const it of c.items) if (it.instanceId === instanceId) return lookupDef(pool, it.definitionId);
    for (const al of c.allies) if (al.instanceId === instanceId) return lookupDef(pool, al.definitionId);
    for (const hz of c.hazards) if (hz.instanceId === instanceId) return lookupDef(pool, hz.definitionId);
  }
  for (const c of Object.values(view.opponent.characters)) {
    for (const it of c.items) if (it.instanceId === instanceId) return lookupDef(pool, it.definitionId);
    for (const al of c.allies) if (al.instanceId === instanceId) return lookupDef(pool, al.definitionId);
    for (const hz of c.hazards) if (hz.instanceId === instanceId) return lookupDef(pool, hz.definitionId);
  }
  for (const card of view.self.cardsInPlay) if (card.instanceId === instanceId) return lookupDef(pool, card.definitionId);
  for (const card of view.opponent.cardsInPlay) if (card.instanceId === instanceId) return lookupDef(pool, card.definitionId);
  return undefined;
}

/** Find a character in either player's in-play roster by instance ID. */
export function findCharacterInPlay(
  view: PlayerView,
  instanceId: CardInstanceId,
): { character: CharacterInPlay; isSelf: boolean } | null {
  const own = view.self.characters[instanceId];
  if (own) return { character: own, isSelf: true };
  const opp = view.opponent.characters[instanceId];
  if (opp) return { character: opp, isSelf: false };
  return null;
}

/** Find which company contains the given character (self side only). */
export function findCompanyOf(
  view: PlayerView,
  characterId: CardInstanceId,
): Company | null {
  for (const company of view.self.companies) {
    if (company.characters.includes(characterId)) return company;
  }
  return null;
}

/** Sum effective prowess of all characters in a company (self side only). */
export function companyProwess(view: PlayerView, company: Company): number {
  let sum = 0;
  for (const charId of company.characters) {
    const char = view.self.characters[charId];
    if (char) sum += char.effectiveStats.prowess;
  }
  return sum;
}

/** Marshalling-point value of a card definition (0 if unknown / non-scoring). */
export function mpValue(def: CardDefinition | undefined): number {
  if (!def) return 0;
  if ('marshallingPoints' in def && typeof def.marshallingPoints === 'number') {
    return def.marshallingPoints;
  }
  return 0;
}

/**
 * Probability of rolling at least `need` on 2d6 (×100, integer).
 * Used to score plays whose outcome depends on a dice roll.
 */
export function diceSuccessPct(need: number): number {
  if (need <= 2) return 100;
  if (need >= 13) return 0;
  // 2d6 success table for "roll >= need"
  const table: Record<number, number> = {
    2: 100, 3: 97, 4: 92, 5: 83, 6: 72,
    7: 58, 8: 42, 9: 28, 10: 17, 11: 8, 12: 3,
  };
  return table[need] ?? 0;
}

/** Whether the card definition is a character card. */
export function isCharacter(def: CardDefinition | undefined): def is CharacterCard {
  return isCharacterCard(def);
}

/** Whether the card definition is any kind of item. */
export function isItem(def: CardDefinition | undefined): def is HeroItemCard | MinionItemCard {
  return isItemCard(def);
}

/** Whether the card definition is a faction. */
export function isFaction(def: CardDefinition | undefined): boolean {
  return isFactionCard(def);
}

/** Whether the card definition is an ally. */
export function isAlly(def: CardDefinition | undefined): boolean {
  return isAllyCard(def);
}

/** Whether the card definition is a creature hazard. */
export function isCreature(def: CardDefinition | undefined): def is CreatureCard {
  return def !== undefined && def.cardType === 'hazard-creature';
}

/** Whether the card definition is a corruption hazard. */
export function isCorruption(def: CardDefinition | undefined): boolean {
  return def !== undefined && def.cardType === 'hazard-corruption';
}

/** Whether the card definition is a hazard event. */
export function isHazardEvent(def: CardDefinition | undefined): boolean {
  return def !== undefined && def.cardType === 'hazard-event';
}

/** Mind cost (general influence) of a character, defaulting to 0 for avatars. */
export function mindCost(def: CardDefinition | undefined): number {
  if (!def || !isCharacter(def)) return 0;
  return def.mind ?? 0;
}

/** Whether a card definition is a site (any alignment). */
export function isSite(def: CardDefinition | undefined): def is AnySiteCard {
  if (!def) return false;
  return (
    def.cardType === 'hero-site' ||
    def.cardType === 'minion-site' ||
    def.cardType === 'fallen-wizard-site' ||
    def.cardType === 'balrog-site'
  );
}

/** Region-type danger weight (higher = more dangerous, better avoided). */
const REGION_DANGER: Record<string, number> = {
  'free-domain': 0,
  border: 1,
  wilderness: 2,
  'shadow-land': 4,
  'dark-domain': 5,
};

/** Site-type danger weight (higher = more dangerous). */
const SITE_DANGER: Record<string, number> = {
  haven: 0,
  'free-hold': 0,
  'border-hold': 1,
  'ruins-and-lairs': 3,
  'shadow-hold': 5,
  'dark-hold': 7,
};

/** Whether a hand resource card can be played at the given site. */
function resourcePlayableAt(def: CardDefinition, site: AnySiteCard): boolean {
  // Items: matched by site type.
  if (def.cardType === 'hero-resource-item' || def.cardType === 'minion-resource-item') {
    return def.playableAt.includes(site.siteType);
  }
  // Factions / allies: matched by named site or site type.
  if (
    def.cardType === 'hero-resource-faction' ||
    def.cardType === 'minion-resource-faction' ||
    def.cardType === 'hero-resource-ally' ||
    def.cardType === 'minion-resource-ally'
  ) {
    for (const entry of def.playableAt) {
      if ('site' in entry && entry.site === site.name) return true;
      if ('siteType' in entry && entry.siteType === site.siteType) return true;
    }
    return false;
  }
  // Events / characters: not site-specific in this scoring pass.
  return false;
}

/**
 * Score a destination site for movement-planning.
 *
 * Combines:
 * - The number of hand resources that become playable at the destination
 *   (×10 — by far the dominant term, this is the whole point of moving).
 * - Resource-draw count printed on the site (×2).
 * - Penalties for the danger of the site type and traversed regions.
 *
 * Returns a non-negative integer; 0 means "do not move here".
 */
export function scoreDestinationSite(
  view: PlayerView,
  pool: Readonly<Record<string, CardDefinition>>,
  destSite: AnySiteCard,
): number {
  let playableCount = 0;
  for (const card of view.self.hand) {
    const def = lookupDef(pool, card.definitionId);
    if (def && resourcePlayableAt(def, destSite)) playableCount++;
  }

  const resourceDraws = 'resourceDraws' in destSite ? destSite.resourceDraws : 0;
  const siteDanger = SITE_DANGER[destSite.siteType] ?? 2;
  let regionDanger = 0;
  if ('sitePath' in destSite && Array.isArray(destSite.sitePath)) {
    for (const region of destSite.sitePath as readonly RegionType[]) {
      regionDanger += REGION_DANGER[region] ?? 1;
    }
  }

  return Math.max(0, playableCount * 10 + resourceDraws * 2 - siteDanger - regionDanger);
}

/**
 * Resolve a site `CardInstanceId` (from a `plan-movement` action) to its
 * static {@link AnySiteCard} definition by searching the player's site deck
 * and any in-play sites.
 */
export function findSiteDef(
  view: PlayerView,
  pool: Readonly<Record<string, CardDefinition>>,
  siteInstanceId: CardInstanceId,
): AnySiteCard | undefined {
  const fromDeck = view.self.siteDeck.find(c => c.instanceId === siteInstanceId);
  if (fromDeck) {
    const def = lookupDef(pool, fromDeck.definitionId);
    if (isSite(def)) return def;
  }
  for (const company of view.self.companies) {
    if (company.currentSite?.instanceId === siteInstanceId) {
      const def = lookupDef(pool, company.currentSite.definitionId);
      if (isSite(def)) return def;
    }
    if (company.destinationSite?.instanceId === siteInstanceId) {
      const def = lookupDef(pool, company.destinationSite.definitionId);
      if (isSite(def)) return def;
    }
  }
  return undefined;
}
