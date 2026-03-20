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
 */

import {
  Alignment,
  CardDefinitionId,
  Race,
  Skill,
  RegionType,
  SiteType,
  MarshallingCategory,
} from './common.js';
import type { CardEffect } from './effects.js';

// ---- Hero Character ----

/**
 * A hero character card that can be brought into play via general influence
 * or direct influence from another character.
 *
 * Characters are the backbone of any company -- they carry items, fight
 * creatures, make influence attempts on factions, and contribute marshalling
 * points. Each character has a home site where they can be played, combat
 * stats (prowess/body), and a mind value that determines how much influence
 * is needed to control them.
 */
export interface HeroCharacterCard {
  /** Discriminant for the card type union. */
  readonly cardType: 'hero-character';
  /** Which alignment (wizard, ringwraith, fallen-wizard, balrog) this card belongs to. */
  readonly alignment: Alignment;
  /** Unique identifier in the static card pool. */
  readonly id: CardDefinitionId;
  /** Display name (e.g. "Aragorn II", "Legolas"). */
  readonly name: string;
  /** Full URL to the card's remastered image in the meccg-remaster repository. */
  readonly image: string;
  /** Characters are always unique -- only one copy can be in play at a time. */
  readonly unique: true;
  /** The character's race, which affects faction influence and certain card interactions. */
  readonly race: Race;
  /** Special skills the character possesses (e.g. Warrior, Ranger), enabling specific card plays and bonuses. */
  readonly skills: readonly Skill[];
  /** Base combat strength used when attacking or defending against strikes. */
  readonly prowess: number;
  /** Resistance to being eliminated -- a successful strike must exceed body to wound/kill. */
  readonly body: number;
  /**
   * The amount of general or direct influence required to control this character.
   * Null for wizards, who are controlled automatically as the player's avatar.
   */
  readonly mind: number | null;
  /** Influence points this character can exert to control other characters or sway factions. */
  readonly directInfluence: number;
  /** Victory points awarded at the Free Council for having this character in play. */
  readonly marshallingPoints: number;
  /** Always 'character' -- used for scoring category calculations at the Free Council. */
  readonly marshallingCategory: MarshallingCategory.Character;
  /** Modifier applied to this character's corruption checks (negative = harder to resist). */
  readonly corruptionModifier: number;
  /** The site name where this character can be played from hand into a company. */
  readonly homesite: string;
  /** Declarative effects describing this character's special abilities. */
  readonly effects?: readonly CardEffect[];
  /** Flavor/rules text describing special abilities. */
  readonly text: string;
}

// ---- Hero Resources ----

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
  /** Declarative effects describing this item's abilities and modifiers. */
  readonly effects?: readonly CardEffect[];
  /** Flavor/rules text describing special abilities or play conditions. */
  readonly text: string;
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
  /** The specific site name where this faction can be played. */
  readonly playableAt: string;
  /** Declarative effects describing this faction's abilities. */
  readonly effects?: readonly CardEffect[];
  /** Flavor/rules text describing special abilities or modifiers. */
  readonly text: string;
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
  /** Victory points scored at the Free Council for controlling this ally. */
  readonly marshallingPoints: number;
  /** Always 'ally' -- used for scoring category calculations. */
  readonly marshallingCategory: MarshallingCategory.Ally;
  /** Site types where this ally can be played. */
  readonly playableAt: readonly SiteType[];
  /** Declarative effects describing this ally's abilities. */
  readonly effects?: readonly CardEffect[];
  /** Flavor/rules text describing special abilities. */
  readonly text: string;
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
  /** Declarative effects describing this event's abilities. */
  readonly effects?: readonly CardEffect[];
  /** Flavor/rules text describing the event's effect. */
  readonly text: string;
}

// ---- Hazards ----

/**
 * Restriction describing where a creature can legally be played.
 *
 * A creature is "keyed to" certain map features -- it can only attack
 * companies that are moving through matching regions or at matching sites.
 * Multiple restrictions are OR'd: the creature is playable if any one matches.
 */
export interface CreatureKeyRestriction {
  /** Region terrain types where this creature can be played (e.g. Wilderness, Shadow). */
  readonly regionTypes?: readonly RegionType[];
  /** Specific region names where this creature can be played. */
  readonly regionNames?: readonly string[];
  /** Site types where this creature can attack (e.g. Ruins-and-Lairs). */
  readonly siteTypes?: readonly SiteType[];
}

/**
 * A hazard creature card that the opponent plays to attack a moving company.
 *
 * Creatures are the primary threat during the Movement/Hazard phase. Each
 * creature has one or more strikes that must be assigned to characters in
 * the target company. Combat is resolved as 2d6 + prowess vs. the creature's
 * prowess. Defeating the creature awards kill marshalling points to the
 * defending player.
 */
export interface CreatureCard {
  /** Discriminant for the card type union. */
  readonly cardType: 'hazard-creature';
  /** Unique identifier in the static card pool. */
  readonly id: CardDefinitionId;
  /** Display name (e.g. "Cave-drake", "Orc-patrol"). */
  readonly name: string;
  /** Full URL to the card's remastered image in the meccg-remaster repository. */
  readonly image: string;
  /** Whether only one copy can be in play (relevant for unique named creatures like dragons). */
  readonly unique: boolean;
  /** Number of strikes the creature delivers -- each must be assigned to a different character if possible. */
  readonly strikes: number;
  /** The creature's combat strength, compared against the defending character's roll + prowess. */
  readonly prowess: number;
  /**
   * The creature's body value for the body check after a successful strike.
   * Null for creatures that are automatically defeated if any strike succeeds.
   */
  readonly body: number | null;
  /** Marshalling points (in the Kill category) awarded to the defending player for defeating this creature. */
  readonly killMarshallingPoints: number;
  /** Terrain and site restrictions determining where this creature can legally attack. */
  readonly keyedTo: readonly CreatureKeyRestriction[];
  /** Declarative effects describing this creature's special combat abilities. */
  readonly effects?: readonly CardEffect[];
  /** Flavor/rules text describing special abilities or attack modifiers. */
  readonly text: string;
}

/**
 * A hazard event card that imposes harmful effects on the opponent.
 *
 * Like resource events, hazard events come in short, long, and permanent
 * varieties. They can modify the game environment, hinder movement, or
 * create ongoing threats. Unlike creatures, they don't directly initiate combat.
 */
export interface HazardEventCard {
  /** Discriminant for the card type union. */
  readonly cardType: 'hazard-event';
  /** Unique identifier in the static card pool. */
  readonly id: CardDefinitionId;
  /** Display name (e.g. "Doors of Night", "Twilight"). */
  readonly name: string;
  /** Full URL to the card's remastered image in the meccg-remaster repository. */
  readonly image: string;
  /** Whether only one copy can be in play (relevant for long/permanent events). */
  readonly unique: boolean;
  /** Duration class determining when this event is removed from play. */
  readonly eventType: 'short' | 'long' | 'permanent';
  /** Declarative effects describing this event's abilities. */
  readonly effects?: readonly CardEffect[];
  /** Flavor/rules text describing the event's effect. */
  readonly text: string;
}

/**
 * A hazard corruption card that attaches to a character, increasing their
 * corruption point total and making corruption checks more dangerous.
 *
 * Corruption is MECCG's primary risk/reward mechanic: powerful items grant
 * marshalling points but add corruption, and corruption hazards pile on
 * more. If a character fails a corruption check (2d6 roll), they are
 * removed from the game -- potentially costing the player significant points.
 */
export interface CorruptionCard {
  /** Discriminant for the card type union. */
  readonly cardType: 'hazard-corruption';
  /** Unique identifier in the static card pool. */
  readonly id: CardDefinitionId;
  /** Display name (e.g. "Lure of Expedience", "Lure of Nature"). */
  readonly name: string;
  /** Full URL to the card's remastered image in the meccg-remaster repository. */
  readonly image: string;
  /** Whether only one copy can be in play. */
  readonly unique: boolean;
  /** Additional corruption points imposed on the targeted character. */
  readonly corruptionPoints: number;
  /** Declarative effects describing this corruption card's abilities. */
  readonly effects?: readonly CardEffect[];
  /** Flavor/rules text describing special conditions or effects. */
  readonly text: string;
}

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
  /** Which resource types (items, factions, allies, etc.) can be played at this site. */
  readonly playableResources: readonly PlayableResourceType[];
  /** Built-in attacks that companies face upon entering the site, before any resources can be played. */
  readonly automaticAttacks: readonly AutomaticAttack[];
  /** Flavor/rules text with additional site-specific conditions. */
  readonly text: string;
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
  /** Which alignment this card belongs to. */
  readonly alignment: Alignment;
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
  /** Declarative effects describing this item's abilities and modifiers. */
  readonly effects?: readonly CardEffect[];
  /** Flavor/rules text describing special abilities or play conditions. */
  readonly text: string;
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
  /** The specific site name where this faction can be played. */
  readonly playableAt: string;
  /** Declarative effects describing this faction's abilities. */
  readonly effects?: readonly CardEffect[];
  /** Flavor/rules text describing special abilities or modifiers. */
  readonly text: string;
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
  /** Victory points scored for controlling this ally. */
  readonly marshallingPoints: number;
  /** Always 'ally' -- used for scoring category calculations. */
  readonly marshallingCategory: MarshallingCategory.Ally;
  /** Site types where this ally can be played. */
  readonly playableAt: readonly SiteType[];
  /** Declarative effects describing this ally's abilities. */
  readonly effects?: readonly CardEffect[];
  /** Flavor/rules text describing special abilities. */
  readonly text: string;
}

// ---- Minion Characters ----

/**
 * A minion character card from The Lidless Eye and related expansion sets.
 *
 * Minion characters serve the Dark Lord and operate from minion havens
 * (Dol Guldur, Minas Morgul, etc.). They share the same core stats as
 * hero characters but include new races (Orc, Troll, Ringwraith) and
 * minion-specific keywords (Leader, Uruk-hai, Olog-hai).
 */
export interface MinionCharacterCard {
  /** Discriminant for the card type union. */
  readonly cardType: 'minion-character';
  /** Which alignment this card belongs to. */
  readonly alignment: Alignment;
  /** Unique identifier in the static card pool. */
  readonly id: CardDefinitionId;
  /** Display name (e.g. "Gorbag", "The Mouth", "Lieutenant of Dol Guldur"). */
  readonly name: string;
  /** Full URL to the card's remastered image in the meccg-remaster repository. */
  readonly image: string;
  /** Minion characters are always unique -- only one copy can be in play at a time. */
  readonly unique: true;
  /** The character's race (Man, Orc, Troll, Ringwraith, etc.). */
  readonly race: Race;
  /** Special skills the character possesses. */
  readonly skills: readonly Skill[];
  /** Base combat strength used when attacking or defending against strikes. */
  readonly prowess: number;
  /** Resistance to being eliminated -- a successful strike must exceed body to wound/kill. */
  readonly body: number;
  /**
   * The amount of general or direct influence required to control this character.
   * Null for Ringwraiths, who are controlled automatically as the player's avatar.
   */
  readonly mind: number | null;
  /** Influence points this character can exert to control other characters or sway factions. */
  readonly directInfluence: number;
  /** Victory points awarded at the Free Council for having this character in play. */
  readonly marshallingPoints: number;
  /** Always 'character' -- used for scoring category calculations. */
  readonly marshallingCategory: MarshallingCategory.Character;
  /** Modifier applied to this character's corruption checks. */
  readonly corruptionModifier: number;
  /** The site name where this character can be played from hand into a company. */
  readonly homesite: string;
  /** Minion-specific keywords (e.g. "Leader", "Uruk-hai", "Olog-hai"). */
  readonly keywords?: readonly string[];
  /** Declarative effects describing this character's special abilities. */
  readonly effects?: readonly CardEffect[];
  /** Flavor/rules text describing special abilities. */
  readonly text: string;
}

// ---- Minion Sites ----

/**
 * A minion site card representing a Dark Lord stronghold or location.
 *
 * Minion sites serve the same role as hero sites but for minion players.
 * Minion havens (Dol Guldur, Minas Morgul, Carn Dûm, Geann a-Lisch)
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
  /** Which resource types can be played at this site. */
  readonly playableResources: readonly PlayableResourceType[];
  /** Built-in attacks that companies face upon entering the site. */
  readonly automaticAttacks: readonly AutomaticAttack[];
  /** Flavor/rules text with additional site-specific conditions. */
  readonly text: string;
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
  /** Which resource types can be played at this site. */
  readonly playableResources: readonly PlayableResourceType[];
  /** Built-in attacks that companies face upon entering the site. */
  readonly automaticAttacks: readonly AutomaticAttack[];
  /** Flavor/rules text with additional site-specific conditions. */
  readonly text: string;
}

// ---- Deck ----

/**
 * A player's deck configuration submitted before the game begins.
 *
 * MECCG decks have three components:
 * - `pool` -- Characters available for the pre-game draft.
 * - `playDeck` -- The shuffled deck of resource and hazard cards drawn during play.
 * - `sideboard` -- Reserve cards that can be fetched under specific conditions.
 */
export interface Deck {
  /** Character card IDs available for selection during the draft phase (up to 10). */
  readonly pool: readonly CardDefinitionId[];
  /** Resource and hazard card IDs forming the main shuffled draw pile. */
  readonly playDeck: readonly CardDefinitionId[];
  /** Reserve card IDs that can be fetched into hand or play deck under specific game conditions. */
  readonly sideboard: readonly CardDefinitionId[];
}

// ---- Union types ----

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
 * or `'minion-resource-ally'`.
 */
export type MinionResourceCard = MinionItemCard | MinionFactionCard | MinionAllyCard;

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
 * Union of all site card types (hero, minion, and fallen-wizard). Use this
 * when code needs to handle sites generically regardless of alignment.
 */
export type SiteCard = HeroSiteCard | MinionSiteCard | FallenWizardSiteCard;

/** Site card type discriminants — the set of `cardType` values that represent sites. */
export const SITE_CARD_TYPES: ReadonlySet<string> = new Set(['hero-site', 'minion-site', 'fallen-wizard-site']);

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
  | MinionSiteCard
  | FallenWizardSiteCard
  | RegionCard;
