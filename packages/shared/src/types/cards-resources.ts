/**
 * @module cards-resources
 *
 * Resource card definition types for MECCG.
 *
 * Resources are beneficial cards (items, factions, allies, events) that the
 * active player plays during the Site phase to score marshalling points.
 * This module defines both hero and minion resource card interfaces, as well
 * as shared types like playable-at location specifiers and item subtypes.
 */

import type {
  Alignment,
  CardDefinitionId,
  Race,
  SiteType,
  MarshallingCategory,
} from './common.js';
import type { CardEffect, Condition } from './effects.js';

// ---- Playable-at location specifiers ----

/** A specific named site (e.g. "Eagles' Eyrie", "Edoras"). */
export interface PlayableAtSite {
  readonly site: string;
  /** Optional additional constraint the site must satisfy (e.g. a particular automatic-attack). */
  readonly when?: Condition;
}

/** Any site matching a given site type (e.g. any free-hold). */
export interface PlayableAtSiteType {
  readonly siteType: SiteType;
  /** Optional additional constraint the site must satisfy (e.g. a particular automatic-attack). */
  readonly when?: Condition;
}

/**
 * Describes a location where an ally or faction can be played.
 *
 * Most allies and factions are playable at a single named site, but
 * future cards may allow play at any site of a given type.
 * Entries may carry an optional `when` condition for extra constraints
 * (e.g. "Ruins & Lairs with a Wolf automatic-attack").
 */
export type PlayableAtEntry = PlayableAtSite | PlayableAtSiteType;

// ---- Item subtype ----

/**
 * Sub-classification for item cards, determining where they can be played
 * and how they interact with site types.
 *
 * - `minor` -- Common gear playable at most sites; up to 2 can be chosen as starting items.
 * - `major` -- Powerful artifacts found at specific dangerous locations.
 * - `greater` -- The most powerful items, typically found only at Shadow-holds or Dark-holds.
 * - `gold-ring` -- Special rings that can be tested to become more powerful ring items.
 * - `special` -- Items with unique play conditions outside the normal hierarchy.
 */
export type ItemSubtype = 'minor' | 'major' | 'greater' | 'gold-ring' | 'special';

// ---- Hero Resources ----

/**
 * An item resource card that can be played on a character at an appropriate site.
 *
 * Items attach to a specific character, granting combat bonuses and marshalling
 * points but also adding corruption points that risk the character's loyalty.
 * This risk/reward tension is central to MECCG strategy.
 */
export interface HeroItemCard {
  /** Discriminant for the card type union. */
  readonly cardType: 'hero-resource-item';
  /** Which alignment this card belongs to. */
  readonly alignment: Alignment;
  /** Unique identifier in the static card pool. */
  readonly id: CardDefinitionId;
  /** Display name (e.g. "Glamdring", "Mithril Coat"). */
  readonly name: string;
  /** Full URL to the card's remastered image in the meccg-remaster repository. */
  readonly image: string;
  /** Whether only one copy of this item can be in play across all players. */
  readonly unique: boolean;
  /** Item tier, determining which sites it can be played at. */
  readonly subtype: ItemSubtype;
  /** Victory points scored at the Free Council for controlling this item. */
  readonly marshallingPoints: number;
  /** Always 'item' -- used for scoring category calculations. */
  readonly marshallingCategory: MarshallingCategory.Item;
  /** Corruption points added to the bearing character, increasing risk of corruption check failure. */
  readonly corruptionPoints: number;
  /** Bonus (or penalty) to the bearing character's prowess in combat. */
  readonly prowessModifier: number;
  /** Bonus (or penalty) to the bearing character's body for defense. */
  readonly bodyModifier: number;
  /** Site types where this item can be played (e.g. Ruins-and-Lairs, Shadow-holds). */
  readonly playableAt: readonly SiteType[];
  /** Game keywords (e.g. "weapon", "armor") that affect card interactions. */
  readonly keywords?: readonly string[];
  /** Declarative effects describing this item's abilities and modifiers. */
  readonly effects?: readonly CardEffect[];
  /** Flavor/rules text describing special abilities or play conditions. */
  readonly text: string;
  /** Date when /certify-card confirmed all effects are engine-supported (ISO 8601). */
  readonly certified?: string;
}

/**
 * A faction resource card representing a Free Peoples group that can be
 * allied to the player's cause through an influence attempt.
 *
 * Factions are played at a specific site by a character making an influence
 * roll (2d6 >= influence number). They are always unique and provide
 * significant marshalling points, making them high-value targets.
 */
export interface HeroFactionCard {
  /** Discriminant for the card type union. */
  readonly cardType: 'hero-resource-faction';
  /** Which alignment this card belongs to. */
  readonly alignment: Alignment;
  /** Unique identifier in the static card pool. */
  readonly id: CardDefinitionId;
  /** Display name (e.g. "Riders of Rohan", "Rangers of the North"). */
  readonly name: string;
  /** Full URL to the card's remastered image in the meccg-remaster repository. */
  readonly image: string;
  /** Factions are always unique -- only one player can control each faction. */
  readonly unique: true;
  /** Victory points scored at the Free Council for controlling this faction. */
  readonly marshallingPoints: number;
  /** Always 'faction' -- used for scoring category calculations. */
  readonly marshallingCategory: MarshallingCategory.Faction;
  /** The 2d6 roll target needed to successfully influence this faction (lower = easier). */
  readonly influenceNumber: number;
  /** The faction's race, relevant for racial influence bonuses. */
  readonly race: Race;
  /** Locations where this faction can be played (typically a single named site). */
  readonly playableAt: readonly PlayableAtEntry[];
  /** Declarative effects describing this faction's abilities. */
  readonly effects?: readonly CardEffect[];
  /** Flavor/rules text describing special abilities or modifiers. */
  readonly text: string;
  /** Date when /certify-card confirmed all effects are engine-supported (ISO 8601). */
  readonly certified?: string;
}

/**
 * An ally resource card representing a unique companion that joins a company.
 *
 * Allies function similarly to characters in combat (they have prowess and body)
 * but are played as resource cards at specific sites rather than being recruited
 * via influence. They score marshalling points but don't carry items or exert influence.
 */
export interface HeroAllyCard {
  /** Discriminant for the card type union. */
  readonly cardType: 'hero-resource-ally';
  /** Which alignment this card belongs to. */
  readonly alignment: Alignment;
  /** Unique identifier in the static card pool. */
  readonly id: CardDefinitionId;
  /** Display name (e.g. "Tom Bombadil", "Goldberry"). */
  readonly name: string;
  /** Full URL to the card's remastered image in the meccg-remaster repository. */
  readonly image: string;
  /** Whether only one copy of this ally can be in play across all players. */
  readonly unique: boolean;
  /** The ally's combat strength when fighting or defending. */
  readonly prowess: number;
  /** The ally's resistance to being eliminated in combat. */
  readonly body: number;
  /** The ally's mind value, used as the comparison value in opponent influence attempts. */
  readonly mind: number;
  /** Victory points scored at the Free Council for controlling this ally. */
  readonly marshallingPoints: number;
  /** Always 'ally' -- used for scoring category calculations. */
  readonly marshallingCategory: MarshallingCategory.Ally;
  /** Locations where this ally can be played (typically specific named sites). */
  readonly playableAt: readonly PlayableAtEntry[];
  /** Declarative effects describing this ally's abilities. */
  readonly effects?: readonly CardEffect[];
  /** Flavor/rules text describing special abilities. */
  readonly text: string;
  /** Date when /certify-card confirmed all effects are engine-supported (ISO 8601). */
  readonly certified?: string;
}

/**
 * A resource event card providing one-time or ongoing beneficial effects.
 *
 * Resource events come in three durations:
 * - `short` -- Resolved immediately and discarded.
 * - `long` -- Stays in play until the next Long-event phase, then discarded.
 * - `permanent` -- Remains in play indefinitely.
 *
 * They score marshalling points in the 'misc' category (usually 0).
 */
export interface HeroResourceEventCard {
  /** Discriminant for the card type union. */
  readonly cardType: 'hero-resource-event';
  /** Which alignment this card belongs to. */
  readonly alignment: Alignment;
  /** Unique identifier in the static card pool. */
  readonly id: CardDefinitionId;
  /** Display name (e.g. "Dark Quarrels", "A Short Rest"). */
  readonly name: string;
  /** Full URL to the card's remastered image in the meccg-remaster repository. */
  readonly image: string;
  /** Whether only one copy of this event can be in play. Mainly relevant for long/permanent events. */
  readonly unique: boolean;
  /** Duration class determining when this event is removed from play. */
  readonly eventType: 'short' | 'long' | 'permanent';
  /** Victory points scored at the Free Council (typically 0 for events). */
  readonly marshallingPoints: number;
  /** Always 'misc' -- resource events fall into the miscellaneous scoring category. */
  readonly marshallingCategory: MarshallingCategory.Misc;
  /** Game keywords (e.g. "environment") that affect card interactions. */
  readonly keywords?: readonly string[];
  /** Declarative effects describing this event's abilities. */
  readonly effects?: readonly CardEffect[];
  /** Flavor/rules text describing the event's effect. */
  readonly text: string;
  /** Date when /certify-card confirmed all effects are engine-supported (ISO 8601). */
  readonly certified?: string;
}

// ---- Minion Resources ----

/**
 * A minion item resource card that can be played on a minion character.
 *
 * Minion items work identically to hero items but belong to the minion
 * alignment — they are played at minion sites and carried by minion characters.
 * They include thematic equipment like Black Mace, High Helm, and Saw-toothed Blade.
 */
export interface MinionItemCard {
  /** Discriminant for the card type union. */
  readonly cardType: 'minion-resource-item';
  /** Which alignment this card belongs to. */
  readonly alignment: Alignment;
  /** Unique identifier in the static card pool. */
  readonly id: CardDefinitionId;
  /** Display name (e.g. "Black Mace", "Saw-toothed Blade"). */
  readonly name: string;
  /** Full URL to the card's remastered image in the meccg-remaster repository. */
  readonly image: string;
  /** Whether only one copy of this item can be in play across all players. */
  readonly unique: boolean;
  /** Item tier, determining which sites it can be played at. */
  readonly subtype: ItemSubtype;
  /** Victory points scored for controlling this item. */
  readonly marshallingPoints: number;
  /** Always 'item' -- used for scoring category calculations. */
  readonly marshallingCategory: MarshallingCategory.Item;
  /** Corruption points added to the bearing character. */
  readonly corruptionPoints: number;
  /** Bonus (or penalty) to the bearing character's prowess in combat. */
  readonly prowessModifier: number;
  /** Bonus (or penalty) to the bearing character's body for defense. */
  readonly bodyModifier: number;
  /** Site types where this item can be played. */
  readonly playableAt: readonly SiteType[];
  /** Game keywords (e.g. "weapon", "armor") that affect card interactions. */
  readonly keywords?: readonly string[];
  /** Declarative effects describing this item's abilities and modifiers. */
  readonly effects?: readonly CardEffect[];
  /** Flavor/rules text describing special abilities or play conditions. */
  readonly text: string;
  /** Date when /certify-card confirmed all effects are engine-supported (ISO 8601). */
  readonly certified?: string;
}

/**
 * A minion faction resource card representing a group that can be
 * swayed to serve the Dark Lord through an influence attempt.
 *
 * Minion factions include Orc tribes, Troll bands, and corrupted Men.
 * They work like hero factions but are played at minion sites.
 */
export interface MinionFactionCard {
  /** Discriminant for the card type union. */
  readonly cardType: 'minion-resource-faction';
  /** Which alignment this card belongs to. */
  readonly alignment: Alignment;
  /** Unique identifier in the static card pool. */
  readonly id: CardDefinitionId;
  /** Display name (e.g. "Goblins of Goblin-gate"). */
  readonly name: string;
  /** Full URL to the card's remastered image in the meccg-remaster repository. */
  readonly image: string;
  /** Factions are always unique. */
  readonly unique: true;
  /** Victory points scored for controlling this faction. */
  readonly marshallingPoints: number;
  /** Always 'faction' -- used for scoring category calculations. */
  readonly marshallingCategory: MarshallingCategory.Faction;
  /** The 2d6 roll target needed to successfully influence this faction. */
  readonly influenceNumber: number;
  /** The faction's race. */
  readonly race: Race;
  /** Locations where this faction can be played (typically a single named site). */
  readonly playableAt: readonly PlayableAtEntry[];
  /** Declarative effects describing this faction's abilities. */
  readonly effects?: readonly CardEffect[];
  /** Flavor/rules text describing special abilities or modifiers. */
  readonly text: string;
  /** Date when /certify-card confirmed all effects are engine-supported (ISO 8601). */
  readonly certified?: string;
}

/**
 * A minion ally resource card representing a creature or servant
 * that joins a minion company.
 *
 * Minion allies include beasts and monsters like War-wargs and the Warg-king.
 * They have prowess and body for combat but don't carry items.
 */
export interface MinionAllyCard {
  /** Discriminant for the card type union. */
  readonly cardType: 'minion-resource-ally';
  /** Which alignment this card belongs to. */
  readonly alignment: Alignment;
  /** Unique identifier in the static card pool. */
  readonly id: CardDefinitionId;
  /** Display name (e.g. "The Warg-king", "War-wolf"). */
  readonly name: string;
  /** Full URL to the card's remastered image in the meccg-remaster repository. */
  readonly image: string;
  /** Whether only one copy of this ally can be in play across all players. */
  readonly unique: boolean;
  /** The ally's combat strength when fighting or defending. */
  readonly prowess: number;
  /** The ally's resistance to being eliminated in combat. */
  readonly body: number;
  /** The ally's mind value, used as the comparison value in opponent influence attempts. */
  readonly mind: number;
  /** Victory points scored for controlling this ally. */
  readonly marshallingPoints: number;
  /** Always 'ally' -- used for scoring category calculations. */
  readonly marshallingCategory: MarshallingCategory.Ally;
  /** Locations where this ally can be played (typically specific named sites). */
  readonly playableAt: readonly PlayableAtEntry[];
  /** Declarative effects describing this ally's abilities. */
  readonly effects?: readonly CardEffect[];
  /** Flavor/rules text describing special abilities. */
  readonly text: string;
  /** Date when /certify-card confirmed all effects are engine-supported (ISO 8601). */
  readonly certified?: string;
}

// ---- Minion Resource Events ----

/**
 * A minion resource event card -- the minion counterpart to {@link HeroResourceEventCard}.
 *
 * Minion resource events are beneficial cards played by the minion player.
 * Like hero resource events, they have a duration class:
 * - `short` -- Resolved immediately and discarded.
 * - `long` -- Stays in play until the next Long-event phase, then discarded.
 * - `permanent` -- Remains in play indefinitely.
 *
 * They score marshalling points in the 'misc' category (usually 0).
 */
export interface MinionResourceEventCard {
  /** Discriminant for the card type union. */
  readonly cardType: 'minion-resource-event';
  /** Which alignment this card belongs to. */
  readonly alignment: Alignment;
  /** Unique identifier in the static card pool. */
  readonly id: CardDefinitionId;
  /** Display name (e.g. "Orc Quarrels", "A Nice Place to Hide"). */
  readonly name: string;
  /** Full URL to the card's remastered image in the meccg-remaster repository. */
  readonly image: string;
  /** Whether only one copy of this event can be in play. Mainly relevant for long/permanent events. */
  readonly unique: boolean;
  /** Duration class determining when this event is removed from play. */
  readonly eventType: 'short' | 'long' | 'permanent';
  /** Victory points scored at the Free Council (typically 0 for events). */
  readonly marshallingPoints: number;
  /** Always 'misc' -- resource events fall into the miscellaneous scoring category. */
  readonly marshallingCategory: MarshallingCategory.Misc;
  /** Game keywords that affect card interactions. */
  readonly keywords?: readonly string[];
  /** Declarative effects describing this event's abilities. */
  readonly effects?: readonly CardEffect[];
  /** Flavor/rules text describing the event's effect. */
  readonly text: string;
  /** Date when /certify-card confirmed all effects are engine-supported (ISO 8601). */
  readonly certified?: string;
}
