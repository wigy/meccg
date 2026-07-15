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
  CardInstanceId,
  Keyword,
  ManifestId,
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
 *
 * The optional `body` and `sourceInstanceId` fields are used only for
 * augmented attacks injected at runtime by `permanent-event-auto-attack`
 * effects (e.g. Balrog of Moria, Spawn events). The `combatRules` field may
 * appear on both printed site attacks (e.g. "attacker-chooses-defenders") and
 * runtime-injected attacks.
 */
export interface AutomaticAttack {
  /** The type of creatures guarding the site (e.g. "Orcs", "Undead"). Used for card interactions. */
  readonly creatureType: string;
  /** Number of strikes in this automatic attack. */
  readonly strikes: number;
  /** Combat strength of each strike. */
  readonly prowess: number;
  /** Body value for body checks. Absent means no body check (e.g. Balrog of Moria "18/-"). */
  readonly body?: number;
  /**
   * Combat rules that modify how this attack plays out (e.g.
   * "attacker-chooses-defenders", "each-character", "cannot-be-canceled" —
   * the last suppresses cancel-attack, used by Vile Fumes' Gas attack).
   */
  readonly combatRules?: readonly string[];
  /**
   * Restricts which companies face this automatic-attack based on their
   * covert/overt status (MELE site guardians). `'overt'` means the attack
   * is faced only by an overt company (e.g. Minas Tirith le-391's Dúnedain
   * attack, "against overt company only"); `'covert'` restricts it to a
   * covert company. Absent means every company faces the attack — note that
   * a "detainment against covert company" attack still has *no* `appliesTo`
   * (it is faced by overt companies too, as a regular non-detainment attack
   * per the MELE rules); its detainment-vs-covert nature is expressed
   * separately by a `combat-detainment` site effect gated on
   * `defender.covert`.
   */
  readonly appliesTo?: 'covert' | 'overt';
  /**
   * If this attack originates from a permanent-event in play (not from the
   * site card itself), the instance ID of that event. Used by finalizeCombat
   * to trigger `onDefeat` logic (e.g. Balrog of Moria removal from play).
   */
  readonly sourceInstanceId?: CardInstanceId;
  /**
   * When true, this attack is detainment regardless of the defending
   * alignment or site type. Set on runtime-injected attacks that have no
   * race/keying (so the standard §3.II detainment derivation cannot apply)
   * but are printed as detainment — e.g. FEAR! FIRE! FOES! (as-29) Mode A's
   * additional automatic-attack ("5 strikes with 8 prowess (detainment, no
   * attack type)"). Still overridden by a defender's `detainment-attacks-normal`
   * effect (Alatar wh-1), matching every other detainment source.
   */
  readonly forceDetainment?: boolean;
}

/**
 * A bespoke automatic-attack that replaces a site's printed attacks at runtime.
 * Produced by a `transform-site` effect's `apply.attack` (Vile Fumes wh-54's
 * "Gas—each character faces 1 strike with 7 prowess, cannot be canceled") and
 * carried verbatim by the resulting `replace-automatic-attacks` constraint;
 * `manifestations.ts` returns `[attack]` in place of the printed list while the
 * constraint is active. Distinct from {@link AutomaticAttack} (printed site
 * guardians): it omits the printed-only `combatRules`/`appliesTo` fields and
 * instead carries the runtime `uncancelable`/`eachCharacter` flags the
 * transform sets. Naming the shape keeps the transform-site producer and the
 * replace-automatic-attacks consumer in sync from one definition.
 */
export interface BespokeAutoAttack {
  /** The creature type of the replacement attack. */
  readonly creatureType: string;
  /** Number of strikes in the replacement attack. */
  readonly strikes: number;
  /** Combat strength of each strike. */
  readonly prowess: number;
  /** Body value for body checks. Absent means no body check. */
  readonly body?: number;
  /** When true, the attack cannot be canceled (sets `combat.uncancelable`). */
  readonly uncancelable?: boolean;
  /** When true, every character in the company faces one strike. */
  readonly eachCharacter?: boolean;
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
  /** Built-in attacks that companies face upon entering the site, before any resources can be played. */
  readonly automaticAttacks: readonly AutomaticAttack[];
  /**
   * For Dragon lairs: the {@link ManifestId} of the resident Dragon
   * (i.e. the basic creature card's definition id). When that
   * manifestation is defeated, the site's Dragon-typed automatic-attacks
   * are suppressed. See `engine/manifestations.ts`.
   */
  readonly lairOf?: ManifestId;
  /**
   * Game keywords (e.g. `hoard`) that affect card interactions. Mirrors
   * the `keywords` field on items and events so the same tagging
   * mechanism covers both — hoard items use a generic site-keyword
   * filter (`{ "site.keywords": { "$includes": "hoard" } }`) rather
   * than a per-tag boolean field.
   */
  readonly keywords?: readonly Keyword[];
  /**
   * For Under-deeps sites only: maps adjacent site names to the minimum 2d6 roll
   * required to move there. A roll of 0 means the site is always reachable (no roll needed).
   * Not present on surface sites that use normal region-path movement.
   *
   * **Wildcard key convention**: a key of the form `"*region:<RegionName>"` matches
   * any site whose `region` field equals `<RegionName>`. Used for sites like
   * The Under-galleries that list "Any site in Ûdun (0)" as an adjacency — stored
   * as `{ "*region:Ûdun": 0 }`. The adjacency resolver scans the card pool for
   * sites in that region and returns the associated roll.
   */
  readonly adjacentSites?: Readonly<Record<string, number>>;
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
  /** Built-in attacks that companies face upon entering the site. */
  readonly automaticAttacks: readonly AutomaticAttack[];
  /** Game keywords (e.g. `hoard`) that affect card interactions. */
  readonly keywords?: readonly Keyword[];
  /**
   * For Under-deeps sites only: maps adjacent site names to the minimum dice roll
   * required to move there. A roll of 0 means the site is always reachable (no roll needed).
   * Not present on surface sites that use normal region-path movement.
   */
  readonly adjacentSites?: Readonly<Record<string, number>>;
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
  /** Built-in attacks that companies face upon entering the site. */
  readonly automaticAttacks: readonly AutomaticAttack[];
  /** Game keywords (e.g. `hoard`) that affect card interactions. */
  readonly keywords?: readonly Keyword[];
  /**
   * For Under-deeps sites only: maps adjacent site names to the minimum dice roll
   * required to move there. A roll of 0 means the site is always reachable (no roll needed).
   * Not present on surface sites that use normal region-path movement.
   */
  readonly adjacentSites?: Readonly<Record<string, number>>;
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
  /** Built-in attacks that companies face upon entering the site. */
  readonly automaticAttacks: readonly AutomaticAttack[];
  /** Game keywords (e.g. `hoard`) that affect card interactions. */
  readonly keywords?: readonly Keyword[];
  /**
   * For Under-deeps sites only: maps adjacent site names to the minimum dice roll
   * required to move there. A roll of 0 means the site is always reachable (no roll needed).
   * Not present on surface sites that use normal region-path movement.
   */
  readonly adjacentSites?: Readonly<Record<string, number>>;
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
