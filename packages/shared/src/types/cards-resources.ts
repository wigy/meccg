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
  Keyword,
  ManifestId,
  Race,
  Skill,
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

/** Any non-haven site located in a named region (e.g. "Rohan"). */
export interface PlayableAtRegion {
  readonly region: string;
}

/**
 * Any site satisfying an explicit `when` condition, rather than a fixed
 * site type / name / region. The condition is evaluated against the site
 * context (`site.siteType`, `site.regionType`, `site.name`, `site.region`,
 * `site.autoAttack.race`), letting a card express a compound playability
 * rule such as "any non-Haven, non-Shadow-hold, non-Dark-hold site in a
 * Wilderness" (A Panoply of Wings wh-37). With no `when`, matches every site.
 */
export interface PlayableAtAny {
  /** Discriminant: matches any site (subject to `when`). */
  readonly any: true;
  /** Optional constraint the site must satisfy. */
  readonly when?: Condition;
}

/**
 * Describes a location where an ally or faction can be played.
 *
 * Most allies and factions are playable at a single named site, but
 * some allow play at any site of a given type or in a named region
 * (e.g. Noble Steed, playable at any non-Haven site in Rohan, etc.).
 * Entries may carry an optional `when` condition for extra constraints
 * (e.g. "Ruins & Lairs with a Wolf automatic-attack").
 */
export type PlayableAtEntry = PlayableAtSite | PlayableAtSiteType | PlayableAtRegion | PlayableAtAny;

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

// ---- Resource card bases ----
//
// Hero and minion resources of the same kind are structurally identical: they
// differ only in the `cardType` discriminant (plus the minion-only
// `manifestId` on factions). Each kind therefore gets a base interface that
// both alignments extend, so a field added to items or allies lands on both
// alignments by construction instead of by remembering to edit two blocks.

/**
 * Fields every resource card carries, whatever its kind or alignment.
 */
interface ResourceCardBase {
  /** Which alignment this card belongs to. */
  readonly alignment: Alignment;
  /** Unique identifier in the static card pool. */
  readonly id: CardDefinitionId;
  /** Display name (e.g. "Glamdring", "Black Mace"). */
  readonly name: string;
  /** Full URL to the card's remastered image in the meccg-remaster repository. */
  readonly image: string;
  /** Whether only one copy of this card can be in play across all players. */
  readonly unique: boolean;
  /** Victory points scored at the Free Council for controlling this card. */
  readonly marshallingPoints: number;
  /** Declarative effects describing this card's abilities and modifiers. */
  readonly effects?: readonly CardEffect[];
  /** Flavor/rules text describing special abilities or play conditions. */
  readonly text: string;
  /** Date when /certify-card confirmed all effects are engine-supported (ISO 8601). */
  readonly certified?: string;
}

/**
 * An item resource card that can be played on a character at an appropriate site.
 *
 * Items attach to a specific character, granting combat bonuses and marshalling
 * points but also adding corruption points that risk the character's loyalty.
 * This risk/reward tension is central to MECCG strategy.
 */
interface ItemCardBase extends ResourceCardBase {
  /** Item tier, determining which sites it can be played at. */
  readonly subtype: ItemSubtype;
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
  readonly keywords?: readonly Keyword[];
}

/**
 * A faction resource card representing a group that can be allied to the
 * player's cause through an influence attempt.
 *
 * Factions are played at a specific site by a character making an influence
 * roll (2d6 >= influence number). Most are unique and provide significant
 * marshalling points, making them high-value targets.
 */
interface FactionCardBase extends ResourceCardBase {
  /** Always 'faction' -- used for scoring category calculations. */
  readonly marshallingCategory: MarshallingCategory.Faction;
  /** The 2d6 roll target needed to successfully influence this faction (lower = easier). */
  readonly influenceNumber: number;
  /**
   * The value required when an opponent attempts to re-influence this faction
   * while it is already in play (CoE rule 8.3 final list, "the value required
   * for the influence check on the faction that is already in play"). If
   * omitted, the first-play `influenceNumber` is reused. Cards that include
   * the clause "Once in play, the number required to influence this faction
   * is N" set this explicitly (e.g. LE minion factions set 0).
   */
  readonly inPlayInfluenceNumber?: number;
  /** The faction's race, relevant for racial influence bonuses. */
  readonly race: Race;
  /** Locations where this faction can be played (typically a single named site). */
  readonly playableAt: readonly PlayableAtEntry[];
}

/**
 * An ally resource card representing a companion or creature that joins a company.
 *
 * Allies function similarly to characters in combat (they have prowess and body)
 * but are played as resource cards at specific sites rather than being recruited
 * via influence. They score marshalling points but don't carry items or exert influence.
 */
interface AllyCardBase extends ResourceCardBase {
  /** The ally's combat strength when fighting or defending. */
  readonly prowess: number;
  /** The ally's resistance to being eliminated in combat. */
  readonly body: number;
  /** The ally's mind value, used as the comparison value in opponent influence attempts. */
  readonly mind: number;
  /**
   * The ally's direct influence, relevant only when the ally can "attempt to
   * influence factions as if he were a character" (the `influences-factions`
   * play-flag, e.g. Radagast's Black Bird wh-114). Optional: most allies do not
   * influence factions and have no printed direct-influence value.
   */
  readonly directInfluence?: number;
  /**
   * Skills the ally possesses (e.g. Sage). Per CoE rule 2.V.2.2, allies are
   * treated as characters when fulfilling "skill only" active conditions, so
   * a sage ally (e.g. Treebeard) can tap to play a Sage-only card like
   * Marvels Told. Optional: most allies have no skills.
   */
  readonly skills?: readonly Skill[];
  /** Always 'ally' -- used for scoring category calculations. */
  readonly marshallingCategory: MarshallingCategory.Ally;
  /** Locations where this ally can be played (typically specific named sites). */
  readonly playableAt: readonly PlayableAtEntry[];
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
interface ResourceEventCardBase extends ResourceCardBase {
  /** Duration class determining when this event is removed from play. */
  readonly eventType: 'short' | 'long' | 'permanent';
  /** Always 'misc' -- resource events fall into the miscellaneous scoring category. */
  readonly marshallingCategory: MarshallingCategory.Misc;
  /** Game keywords (e.g. "environment") that affect card interactions. */
  readonly keywords?: readonly Keyword[];
}

// ---- Hero Resources ----

/**
 * A hero item resource card (e.g. "Glamdring", "Mithril Coat"), played on a
 * hero character at an appropriate hero site.
 */
export interface HeroItemCard extends ItemCardBase {
  /** Discriminant for the card type union. */
  readonly cardType: 'hero-resource-item';
}

/**
 * A hero faction resource card representing a Free Peoples group
 * (e.g. "Riders of Rohan", "Rangers of the North").
 */
export interface HeroFactionCard extends FactionCardBase {
  /** Discriminant for the card type union. */
  readonly cardType: 'hero-resource-faction';
}

/**
 * A hero ally resource card representing a unique companion that joins a
 * hero company (e.g. "Tom Bombadil", "Goldberry").
 */
export interface HeroAllyCard extends AllyCardBase {
  /** Discriminant for the card type union. */
  readonly cardType: 'hero-resource-ally';
}

/**
 * A hero resource event card (e.g. "Dark Quarrels", "A Short Rest").
 */
export interface HeroResourceEventCard extends ResourceEventCardBase {
  /** Discriminant for the card type union. */
  readonly cardType: 'hero-resource-event';
}

// ---- Minion Resources ----

/**
 * A minion item resource card that can be played on a minion character.
 *
 * Minion items work identically to hero items but belong to the minion
 * alignment — they are played at minion sites and carried by minion characters.
 * They include thematic equipment like Black Mace, High Helm, and Saw-toothed Blade.
 */
export interface MinionItemCard extends ItemCardBase {
  /** Discriminant for the card type union. */
  readonly cardType: 'minion-resource-item';
}

/**
 * A minion faction resource card representing a group that can be
 * swayed to serve the Dark Lord through an influence attempt.
 *
 * Minion factions include Orc tribes, Troll bands, and corrupted Men.
 * They work like hero factions but are played at minion sites, and are the
 * only factions that can take part in a Dragon manifestation chain.
 */
export interface MinionFactionCard extends FactionCardBase {
  /** Discriminant for the card type union. */
  readonly cardType: 'minion-resource-faction';
  /**
   * Manifestation-chain tag (Dragons expansion). A "Roused" faction such as
   * Smaug Roused (le-285) is one in-game form of a unique Dragon; every card in
   * the chain — the basic creature, the Ahunt long-event, the At-Home
   * permanent-event, and this faction — carries the same `manifestId` (by
   * convention the basic form's id). Wires the faction into manifestation
   * uniqueness (g.man.1), the defeat cascade, and "manifestations of <Dragon>"
   * references such as this card's own attack-cancellation.
   */
  readonly manifestId?: ManifestId;
}

/**
 * A minion ally resource card representing a creature or servant
 * that joins a minion company (e.g. "The Warg-king", "War-wolf").
 */
export interface MinionAllyCard extends AllyCardBase {
  /** Discriminant for the card type union. */
  readonly cardType: 'minion-resource-ally';
}

/**
 * A minion resource event card -- the minion counterpart to
 * {@link HeroResourceEventCard} (e.g. "Orc Quarrels", "A Nice Place to Hide").
 */
export interface MinionResourceEventCard extends ResourceEventCardBase {
  /** Discriminant for the card type union. */
  readonly cardType: 'minion-resource-event';
}
