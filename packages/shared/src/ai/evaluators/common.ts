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
import { CardStatus } from '../../types/common.js';
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
export function resourcePlayableAt(def: CardDefinition, site: AnySiteCard): boolean {
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

  // Never move to a site where we have nothing to play — aimless travel
  // wastes turns and exposes the company to hazards for no gain. Resource
  // draws alone are not worth the risk.
  if (playableCount === 0) return 0;

  return Math.max(0, playableCount * 10 + resourceDraws * 2 - siteDanger - regionDanger);
}

/** Whether this character is wounded (inverted). */
export function isWounded(character: CharacterInPlay): boolean {
  return character.status === CardStatus.Inverted;
}

/** Whether this character is untapped (ready to act). */
export function isUntapped(character: CharacterInPlay): boolean {
  return character.status === CardStatus.Untapped;
}

/** IDs of wounded characters in a company (self side). */
export function woundedCharactersInCompany(
  view: PlayerView,
  company: Company,
): CardInstanceId[] {
  const out: CardInstanceId[] = [];
  for (const id of company.characters) {
    const ch = view.self.characters[id];
    if (ch && isWounded(ch)) out.push(id);
  }
  return out;
}

/** Whether any character in the company is currently untapped. */
export function hasUntappedCharacter(view: PlayerView, company: Company): boolean {
  for (const id of company.characters) {
    const ch = view.self.characters[id];
    if (ch && isUntapped(ch)) return true;
  }
  return false;
}

/**
 * Whether a site heals wounded characters during untap.
 * Covers havens and sites carrying the `heal-during-untap` site-rule
 * effect (e.g. Barad-dûr as Darkhaven). Override constraints granted
 * by separate cards (e.g. Sapling of the White Tree) are not visible
 * from the site definition alone and are treated conservatively.
 */
export function isHealingSite(def: CardDefinition | undefined): boolean {
  if (!isSite(def)) return false;
  if (def.siteType === 'haven') return true;
  const effects = (def as { effects?: readonly unknown[] }).effects;
  if (!Array.isArray(effects)) return false;
  for (const e of effects) {
    if (!e || typeof e !== 'object') continue;
    const eff = e as { type?: unknown; rule?: unknown };
    if (eff.type === 'site-rule' && eff.rule === 'heal-during-untap') return true;
  }
  return false;
}

/**
 * Scan a card's `effects` array for an effect that heals a wounded
 * character (brings them back to well/untapped). Two patterns count:
 * - Any effect (including `play-option` / `grant-action` wrappers) whose
 *   `apply.type` is `set-character-status` with `status: 'untapped'`.
 * - A `grant-action` effect whose `action` is `heal-company-character`.
 */
function effectsIncludeHeal(effects: readonly unknown[] | undefined): boolean {
  if (!effects) return false;
  for (const e of effects) {
    if (!e || typeof e !== 'object') continue;
    const eff = e as {
      type?: unknown;
      action?: unknown;
      apply?: { type?: unknown; status?: unknown };
    };
    if (eff.type === 'grant-action' && eff.action === 'heal-company-character') return true;
    const apply = eff.apply;
    if (apply && apply.type === 'set-character-status' && apply.status === 'untapped') return true;
  }
  return false;
}

/**
 * Whether the company has a way to heal a wounded character without
 * traveling to a haven — an equipped healing item (e.g. Foul-smelling
 * Paste) or a healing event in hand (e.g. Halfling Strength).
 */
export function hasHealingAvailable(
  view: PlayerView,
  pool: Readonly<Record<string, CardDefinition>>,
  company: Company,
): boolean {
  for (const charId of company.characters) {
    const ch = view.self.characters[charId];
    if (!ch) continue;
    for (const item of ch.items) {
      const def = lookupDef(pool, item.definitionId);
      if (!def) continue;
      const effects = (def as { effects?: readonly unknown[] }).effects;
      if (effectsIncludeHeal(effects)) return true;
    }
  }
  for (const card of view.self.hand) {
    const def = lookupDef(pool, card.definitionId);
    if (!def) continue;
    const effects = (def as { effects?: readonly unknown[] }).effects;
    if (effectsIncludeHeal(effects)) return true;
  }
  return false;
}

/**
 * Whether the company has access to an untap effect for a character —
 * a hand card or item that toggles a character's status to `untapped`.
 * Structurally identical to healing (both use `set-character-status` →
 * `untapped`), which is fine: either outcome unblocks resource play at
 * a site when all characters are currently tapped.
 */
export function hasUntapSource(
  view: PlayerView,
  pool: Readonly<Record<string, CardDefinition>>,
  company: Company,
): boolean {
  return hasHealingAvailable(view, pool, company);
}

/**
 * Whether the hand contains a card that can be played at the given site
 * without needing to tap any character — currently permanent resource
 * events that pass the site's play filters. Used to justify entering a
 * site whose only visitors are already tapped.
 */
export function handHasNoTapPlayableAt(
  view: PlayerView,
  pool: Readonly<Record<string, CardDefinition>>,
  site: AnySiteCard,
): boolean {
  for (const card of view.self.hand) {
    const def = lookupDef(pool, card.definitionId);
    if (!def) continue;
    if (def.cardType !== 'hero-resource-event' && def.cardType !== 'minion-resource-event') continue;
    const ev = def as { eventType?: string };
    if (ev.eventType !== 'permanent') continue;
    // A permanent event is considered a no-tap MP play here; more precise
    // site filtering is done by the engine when computing legal actions.
    // `site` is accepted but unused — reserved for future filter logic.
    void site;
    return true;
  }
  return false;
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
