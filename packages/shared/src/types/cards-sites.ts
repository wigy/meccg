/**
 * @module cards-sites
 *
 * Site and region card definition types for MECCG.
 *
 * Sites are the destinations for company movement. Each site has a type
 * (determining difficulty and available resources), a path of region types
 * leading from the nearest haven, and automatic attacks. Regions form the
 * connectivity graph of the game world.
 */

import type {
  Alignment,
  CardDefinitionId,
  RegionType,
  SiteType,
} from './common.js';
import type { CardEffect } from './effects.js';
import type { ItemSubtype } from './cards-resources.js';

// ---- Sites & Regions ----

/**
 * The types of resources that can be played at a given site.
 * This extends ItemSubtype with non-item resource categories (faction, ally, information).
 */
export type PlayableResourceType = ItemSubtype | 'faction' | 'ally' | 'information';

/**
 * An automatic attack that occurs when a company enters a site.
 *
 * Unlike creature hazards (played from hand by the opponent), automatic
 * attacks are built into the site card itself. They must be resolved before
 * any resources can be played at the site.
 */
export interface AutomaticAttack {
  /** The type of creatures guarding the site (e.g. "Orcs", "Undead"). Used for card interactions. */
  readonly creatureType: string;
  /** Number of strikes in this automatic attack. */
  readonly strikes: number;
  /** Combat strength of each strike. */
  readonly prowess: number;
}

/**
 * A hero site card representing a location on the Middle-earth map.
 *
 * Sites are the destinations for company movement. Each site has a type
 * (determining difficulty and available resources), a path of region types
 * leading from the nearest haven (determining which hazards can be played
 * during movement), and a list of automatic attacks that guard the site.
 * A company must survive the journey and the site's defenses to play
 * resources there.
 */
export interface HeroSiteCard {
  /** Discriminant for the card type union. */
  readonly cardType: 'hero-site';
  /** Which alignment this card belongs to. */
  readonly alignment: Alignment;
  /** Unique identifier in the static card pool. */
  readonly id: CardDefinitionId;
  /** Display name (e.g. "Rivendell", "Moria", "Mount Doom"). */
  readonly name: string;
  /** Full URL to the card's remastered image in the meccg-remaster repository. */
  readonly image: string;
  /** Classification determining the site's danger level and playable resources. */
  readonly siteType: SiteType;
  /**
   * Ordered sequence of region types traversed when traveling from the nearest haven.
   * The opponent can play hazard creatures keyed to these region types during movement.
   */
  readonly sitePath: readonly RegionType[];
  /** The haven from which this site's path originates (e.g. "Rivendell", "Lorien"). */
  readonly nearestHaven: string;
  /** The region this site is located in (e.g. "Rhudaur", "Redhorn Gate"). */
  readonly region: string;
  /** For haven cards only: maps other haven names to the region-type path between them. */
  readonly havenPaths?: Readonly<Record<string, readonly RegionType[]>>;
  /** Which resource types (items, factions, allies, etc.) can be played at this site. */
  readonly playableResources: readonly PlayableResourceType[];
  /** Per-subtype restrictions limiting which specific cards of that subtype may be played. */
  readonly playableItemRestrictions?: Readonly<Record<string, readonly string[]>>;
  /** Built-in attacks that companies face upon entering the site, before any resources can be played. */
  readonly automaticAttacks: readonly AutomaticAttack[];
  /**
   * Number of cards the resource player may draw when a company moves to this site.
   * Corresponds to the lighter box in the bottom-left of the physical card.
   */
  readonly resourceDraws: number;
  /**
   * Number of cards the hazard player may draw when a company moves to this site.
   * Corresponds to the darker box in the bottom-left of the physical card.
   */
  readonly hazardDraws: number;
  /** Flavor/rules text with additional site-specific conditions. */
  readonly text: string;
  /** Declarative effects for site-specific rules (e.g. healing, hazard-limit modifiers). */
  readonly effects?: readonly CardEffect[];
  /** Date when /certify-card confirmed all effects are engine-supported (ISO 8601). */
  readonly certified?: string;
}

/**
 * A region card representing a geographic area on the Middle-earth map.
 *
 * Regions form the connectivity graph of the game world. Companies move
 * through a path of regions from one site to another, and the region types
 * along the path determine which hazard creatures the opponent can play.
 * Regions are not part of a player's deck; they form the shared map.
 */
export interface RegionCard {
  /** Discriminant for the card type union. */
  readonly cardType: 'region';
  /** Unique identifier in the static card pool. */
  readonly id: CardDefinitionId;
  /** Display name (e.g. "Eriador", "Rohan", "Mordor"). */
  readonly name: string;
  /** Full URL to the card's remastered image in the meccg-remaster repository. */
  readonly image: string;
  /** Terrain classification that determines which creatures can be played here. */
  readonly regionType: RegionType;
  /** Names of bordering regions, defining the map's connectivity graph for pathfinding. */
  readonly adjacentRegions: readonly string[];
  /** Flavor/rules text. */
  readonly text: string;
  /** Date when /certify-card confirmed all effects are engine-supported (ISO 8601). */
  readonly certified?: string;
}

// ---- Minion Sites ----

/**
 * A minion site card representing a Dark Lord stronghold or location.
 *
 * Minion sites serve the same role as hero sites but for minion players.
 * Minion havens (Dol Guldur, Minas Morgul, Carn Dum, Geann a-Lisch)
 * function as safe bases, while other minion sites are destinations
 * for resource plays. Site paths connect minion havens to each other.
 */
export interface MinionSiteCard {
  /** Discriminant for the card type union. */
  readonly cardType: 'minion-site';
  /** Which alignment this card belongs to. */
  readonly alignment: Alignment;
  /** Unique identifier in the static card pool. */
  readonly id: CardDefinitionId;
  /** Display name (e.g. "Dol Guldur", "Minas Morgul"). */
  readonly name: string;
  /** Full URL to the card's remastered image in the meccg-remaster repository. */
  readonly image: string;
  /** Classification determining the site's danger level and playable resources. */
  readonly siteType: SiteType;
  /**
   * Ordered sequence of region types traversed when traveling from the nearest haven.
   * For minion havens, this may be empty (haven-to-haven paths are listed separately).
   */
  readonly sitePath: readonly RegionType[];
  /** The minion haven from which this site's primary path originates. */
  readonly nearestHaven: string;
  /** The region this site is located in (e.g. "Southern Mirkwood", "Imlad Morgul"). */
  readonly region: string;
  /** For haven cards only: maps other haven names to the region-type path between them. */
  readonly havenPaths?: Readonly<Record<string, readonly RegionType[]>>;
  /** Which resource types can be played at this site. */
  readonly playableResources: readonly PlayableResourceType[];
  /** Per-subtype restrictions limiting which specific cards of that subtype may be played. */
  readonly playableItemRestrictions?: Readonly<Record<string, readonly string[]>>;
  /** Built-in attacks that companies face upon entering the site. */
  readonly automaticAttacks: readonly AutomaticAttack[];
  /**
   * Number of cards the resource player may draw when a company moves to this site.
   * Corresponds to the lighter box in the bottom-left of the physical card.
   */
  readonly resourceDraws: number;
  /**
   * Number of cards the hazard player may draw when a company moves to this site.
   * Corresponds to the darker box in the bottom-left of the physical card.
   */
  readonly hazardDraws: number;
  /** Flavor/rules text with additional site-specific conditions. */
  readonly text: string;
  /** Declarative effects for site-specific rules (e.g. healing, hazard-limit modifiers). */
  readonly effects?: readonly CardEffect[];
  /** Date when /certify-card confirmed all effects are engine-supported (ISO 8601). */
  readonly certified?: string;
}

// ---- Fallen-wizard Sites ----

/**
 * A fallen-wizard site card from The White Hand expansion.
 *
 * Fallen-wizard sites are used by fallen-wizard players (corrupted Istari).
 * They have similar structure to hero and minion sites but belong to the
 * fallen-wizard alignment, introducing unique locations and special rules.
 */
export interface FallenWizardSiteCard {
  /** Discriminant for the card type union. */
  readonly cardType: 'fallen-wizard-site';
  /** Which alignment this card belongs to. */
  readonly alignment: Alignment;
  /** Unique identifier in the static card pool. */
  readonly id: CardDefinitionId;
  /** Display name (e.g. "The White Towers"). */
  readonly name: string;
  /** Full URL to the card's remastered image in the meccg-remaster repository. */
  readonly image: string;
  /** Classification determining the site's danger level and playable resources. */
  readonly siteType: SiteType;
  /**
   * Ordered sequence of region types traversed when traveling from the nearest haven.
   * Empty for havens.
   */
  readonly sitePath: readonly RegionType[];
  /** The haven from which this site's path originates. */
  readonly nearestHaven: string;
  /** The region this site is located in. */
  readonly region: string;
  /** For haven cards only: maps other haven names to the region-type path between them. */
  readonly havenPaths?: Readonly<Record<string, readonly RegionType[]>>;
  /** Which resource types can be played at this site. */
  readonly playableResources: readonly PlayableResourceType[];
  /** Per-subtype restrictions limiting which specific cards of that subtype may be played. */
  readonly playableItemRestrictions?: Readonly<Record<string, readonly string[]>>;
  /** Built-in attacks that companies face upon entering the site. */
  readonly automaticAttacks: readonly AutomaticAttack[];
  /**
   * Number of cards the resource player may draw when a company moves to this site.
   * Corresponds to the lighter box in the bottom-left of the physical card.
   */
  readonly resourceDraws: number;
  /**
   * Number of cards the hazard player may draw when a company moves to this site.
   * Corresponds to the darker box in the bottom-left of the physical card.
   */
  readonly hazardDraws: number;
  /** Flavor/rules text with additional site-specific conditions. */
  readonly text: string;
  /** Declarative effects for site-specific rules (e.g. healing, hazard-limit modifiers). */
  readonly effects?: readonly CardEffect[];
  /** Date when /certify-card confirmed all effects are engine-supported (ISO 8601). */
  readonly certified?: string;
}

// ---- Balrog Sites ----

/**
 * A balrog site card from The Balrog expansion.
 *
 * Balrog sites include the surface darkhaven Moria and the Under-deeps
 * network beneath it. Under-deeps sites use adjacency lists instead of
 * region paths and introduce special movement rules.
 */
export interface BalrogSiteCard {
  /** Discriminant for the card type union. */
  readonly cardType: 'balrog-site';
  /** Which alignment this card belongs to. */
  readonly alignment: Alignment;
  /** Unique identifier in the static card pool. */
  readonly id: CardDefinitionId;
  /** Display name (e.g. "Moria", "The Under-gates"). */
  readonly name: string;
  /** Full URL to the card's remastered image in the meccg-remaster repository. */
  readonly image: string;
  /** Classification determining the site's danger level and playable resources. */
  readonly siteType: SiteType;
  /**
   * Ordered sequence of region types traversed when traveling from the nearest haven.
   * Empty for havens and Under-deeps sites (which use adjacency instead).
   */
  readonly sitePath: readonly RegionType[];
  /** The haven from which this site's path originates. Empty for havens and Under-deeps. */
  readonly nearestHaven: string;
  /** The region this site is located in. */
  readonly region: string;
  /** For haven cards only: maps other haven names to the region-type path between them. */
  readonly havenPaths?: Readonly<Record<string, readonly RegionType[]>>;
  /** Which resource types can be played at this site. */
  readonly playableResources: readonly PlayableResourceType[];
  /** Per-subtype restrictions limiting which specific cards of that subtype may be played. */
  readonly playableItemRestrictions?: Readonly<Record<string, readonly string[]>>;
  /** Built-in attacks that companies face upon entering the site. */
  readonly automaticAttacks: readonly AutomaticAttack[];
  /**
   * Number of cards the resource player may draw when a company moves to this site.
   * Corresponds to the lighter box in the bottom-left of the physical card.
   */
  readonly resourceDraws: number;
  /**
   * Number of cards the hazard player may draw when a company moves to this site.
   * Corresponds to the darker box in the bottom-left of the physical card.
   */
  readonly hazardDraws: number;
  /** Whether this is an Under-deeps site (underground network below Middle-earth). */
  readonly underDeeps: boolean;
  /** Flavor/rules text with additional site-specific conditions. */
  readonly text: string;
  /** Declarative effects for site-specific rules (e.g. healing, hazard-limit modifiers). */
  readonly effects?: readonly CardEffect[];
  /** Date when /certify-card confirmed all effects are engine-supported (ISO 8601). */
  readonly certified?: string;
}
