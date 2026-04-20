/**
 * @module cards
 *
 * Static card definition types for all card categories in MECCG.
 *
 * These types represent the immutable data that defines what a card *is*
 * (its stats, abilities, and restrictions), as opposed to runtime card
 * instances which track in-game state like tapped/inverted. Card definitions
 * are loaded once from the JSON data files and stored in the GameState's
 * `cardPool` for lookup by CardDefinitionId.
 *
 * MECCG cards fall into four broad groups:
 * - **Characters** -- Heroes that form companies and carry items.
 * - **Resources** -- Beneficial cards (items, factions, allies, events)
 *   that the active player plays during the Site phase to score marshalling points.
 * - **Hazards** -- Hostile cards (creatures, events, corruption) that the
 *   opponent plays during the Movement/Hazard phase to impede the active player.
 * - **Sites & Regions** -- Map locations that define where companies travel
 *   and what resources can be found there.
 *
 * Individual card type interfaces are defined in focused sub-modules and
 * re-exported here so that existing imports continue to work unchanged.
 */

// Re-export all types from sub-modules
export type { PlayableAtSite, PlayableAtSiteType, PlayableAtEntry, ItemSubtype } from './cards-resources.js';
export type {
  HeroItemCard,
  HeroFactionCard,
  HeroAllyCard,
  HeroResourceEventCard,
  MinionItemCard,
  MinionFactionCard,
  MinionAllyCard,
  MinionResourceEventCard,
} from './cards-resources.js';

export type { HeroCharacterCard, MinionCharacterCard } from './cards-characters.js';

export type {
  CreatureKeyRestriction,
  CreatureCard,
  HazardEventCard,
  CorruptionCard,
} from './cards-hazards.js';

export type {
  PlayableResourceType,
  AutomaticAttack,
  HeroSiteCard,
  RegionCard,
  MinionSiteCard,
  FallenWizardSiteCard,
  BalrogSiteCard,
} from './cards-sites.js';

export type {
  Deck,
  DeckListEntry,
  DeckListCards,
  DeckList,
} from './cards-deck.js';

// ---- Union types and type guards ----

import type { HeroCharacterCard, MinionCharacterCard } from './cards-characters.js';
import type {
  HeroItemCard,
  HeroFactionCard,
  HeroAllyCard,
  HeroResourceEventCard,
  MinionItemCard,
  MinionFactionCard,
  MinionAllyCard,
  MinionResourceEventCard,
} from './cards-resources.js';
import type { CreatureCard, HazardEventCard, CorruptionCard } from './cards-hazards.js';
import type {
  HeroSiteCard,
  RegionCard,
  MinionSiteCard,
  FallenWizardSiteCard,
  BalrogSiteCard,
} from './cards-sites.js';

/**
 * All hero resource card types -- beneficial cards played by the active player.
 * Discriminated by `cardType`: `'hero-resource-item'`, `'hero-resource-faction'`,
 * `'hero-resource-ally'`, or `'hero-resource-event'`.
 */
export type HeroResourceCard = HeroItemCard | HeroFactionCard | HeroAllyCard | HeroResourceEventCard;

/**
 * All hazard card types -- hostile cards played by the opponent.
 * Discriminated by `cardType`: `'hazard-creature'`, `'hazard-event'`, or `'hazard-corruption'`.
 */
export type HazardCard = CreatureCard | HazardEventCard | CorruptionCard;

/**
 * Cards that go into the shared play deck (resources + hazards).
 * Both players draw from this deck; they play resources on their own turn
 * and hazards on the opponent's turn.
 */
export type PlayDeckCard = HeroResourceCard | HazardCard;

/**
 * All minion resource card types -- beneficial cards played by the minion player.
 * Discriminated by `cardType`: `'minion-resource-item'`, `'minion-resource-faction'`,
 * `'minion-resource-ally'`, or `'minion-resource-event'`.
 */
export type MinionResourceCard = MinionItemCard | MinionFactionCard | MinionAllyCard | MinionResourceEventCard;

/**
 * Union of all character card types (hero and minion). Use this when code
 * needs to handle characters generically regardless of alignment.
 */
export type CharacterCard = HeroCharacterCard | MinionCharacterCard;

/** Character card type discriminants — the set of `cardType` values that represent characters. */
export const CHARACTER_CARD_TYPES: ReadonlySet<string> = new Set(['hero-character', 'minion-character']);

/**
 * Type guard that narrows a CardDefinition to {@link CharacterCard}.
 * Works for both hero and minion characters.
 */
export function isCharacterCard(card: CardDefinition | undefined): card is CharacterCard {
  return card !== undefined && CHARACTER_CARD_TYPES.has(card.cardType);
}

/**
 * Returns true if the definition is a character with no mind cost — i.e. an
 * avatar (wizard, ringwraith, balrog, or fallen-wizard). Avatars are the only
 * characters allowed to have `mind === null`, so this doubles as the canonical
 * "is this an avatar?" check. Returns plain `boolean` rather than narrowing
 * to `CharacterCard` so that callers which have already narrowed with
 * `isCharacterCard` do not get their type collapsed to `never` in the else
 * branch.
 */
export function isAvatarCharacter(card: CardDefinition | undefined): boolean {
  return isCharacterCard(card) && card.mind === null;
}

/**
 * Union of all item card types (hero and minion). Use this when code
 * needs to handle items generically regardless of alignment.
 */
export type ItemCard = HeroItemCard | MinionItemCard;

/** Item card type discriminants — the set of `cardType` values that represent items. */
export const ITEM_CARD_TYPES: ReadonlySet<string> = new Set(['hero-resource-item', 'minion-resource-item']);

/**
 * Type guard that narrows a CardDefinition to {@link ItemCard}.
 * Works for both hero and minion items.
 */
export function isItemCard(card: CardDefinition | undefined): card is ItemCard {
  return card !== undefined && ITEM_CARD_TYPES.has(card.cardType);
}

/**
 * Union of all ally card types (hero and minion). Use this when code
 * needs to handle allies generically regardless of alignment.
 */
export type AllyCard = HeroAllyCard | MinionAllyCard;

/** Ally card type discriminants — the set of `cardType` values that represent allies. */
export const ALLY_CARD_TYPES: ReadonlySet<string> = new Set(['hero-resource-ally', 'minion-resource-ally']);

/**
 * Type guard that narrows a CardDefinition to {@link AllyCard}.
 * Works for both hero and minion allies.
 */
export function isAllyCard(card: CardDefinition | undefined): card is AllyCard {
  return card !== undefined && ALLY_CARD_TYPES.has(card.cardType);
}

/** Faction card type discriminants. */
export const FACTION_CARD_TYPES: ReadonlySet<string> = new Set(['hero-resource-faction', 'minion-resource-faction']);

/** Union of all faction card types. */
export type FactionCard = HeroFactionCard | MinionFactionCard;

/**
 * Type guard that narrows a CardDefinition to {@link FactionCard}.
 */
export function isFactionCard(card: CardDefinition | undefined): card is FactionCard {
  return card !== undefined && FACTION_CARD_TYPES.has(card.cardType);
}

/** Resource-event card type discriminants. */
export const RESOURCE_EVENT_CARD_TYPES: ReadonlySet<string> = new Set(['hero-resource-event', 'minion-resource-event']);

/** Union of hero and minion resource-event cards. */
export type ResourceEventCard = HeroResourceEventCard | MinionResourceEventCard;

/**
 * Type guard that narrows a CardDefinition to {@link ResourceEventCard}.
 * Works for both hero and minion resource events (short, long, permanent).
 */
export function isResourceEventCard(card: CardDefinition | undefined): card is ResourceEventCard {
  return card !== undefined && RESOURCE_EVENT_CARD_TYPES.has(card.cardType);
}

/**
 * Union of all site card types (hero, minion, and fallen-wizard). Use this
 * when code needs to handle sites generically regardless of alignment.
 */
export type SiteCard = HeroSiteCard | MinionSiteCard | FallenWizardSiteCard | BalrogSiteCard;

/** Site card type discriminants — the set of `cardType` values that represent sites. */
export const SITE_CARD_TYPES: ReadonlySet<string> = new Set(['hero-site', 'minion-site', 'fallen-wizard-site', 'balrog-site']);

/**
 * Type guard that narrows a CardDefinition to {@link SiteCard}.
 * Works for hero, minion, and fallen-wizard sites.
 */
export function isSiteCard(card: CardDefinition | undefined): card is SiteCard {
  return card !== undefined && SITE_CARD_TYPES.has(card.cardType);
}

/**
 * The top-level union of every card definition type in the game.
 * Used as the value type in `GameState.cardPool` for generic card lookups.
 * Discriminated by the `cardType` field.
 */
export type CardDefinition =
  | HeroCharacterCard
  | HeroItemCard
  | HeroFactionCard
  | HeroAllyCard
  | HeroResourceEventCard
  | CreatureCard
  | HazardEventCard
  | CorruptionCard
  | HeroSiteCard
  | MinionCharacterCard
  | MinionItemCard
  | MinionFactionCard
  | MinionAllyCard
  | MinionResourceEventCard
  | MinionSiteCard
  | FallenWizardSiteCard
  | BalrogSiteCard
  | RegionCard;
