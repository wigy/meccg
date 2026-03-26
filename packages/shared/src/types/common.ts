/**
 * Common primitive types, branded IDs, and enums shared across the entire MECCG engine.
 *
 * Branded ID types use TypeScript's intersection trick to prevent accidentally
 * passing a raw string where a specific ID type is expected (e.g. passing a
 * CardInstanceId where a CardDefinitionId is required).
 */

/** Unique identifier for a player in a game session. */
export type PlayerId = string & { readonly __brand: 'PlayerId' };

/**
 * Unique identifier for a specific card instance in a game.
 * Multiple instances can share the same CardDefinitionId (e.g. two copies
 * of Dagger of Westernesse), but each has a unique CardInstanceId.
 */
export type CardInstanceId = string & { readonly __brand: 'CardInstanceId' };

/**
 * Identifier for a card definition in the static card pool.
 * Corresponds to the card's ID in the JSON data files (e.g. "tw-120" for Aragorn II).
 */
export type CardDefinitionId = string & { readonly __brand: 'CardDefinitionId' };

/** Unique identifier for a company (a group of characters traveling together). */
export type CompanyId = string & { readonly __brand: 'CompanyId' };

/** A single die result (1-6) for a standard six-sided die. */
export type DieRoll = 1 | 2 | 3 | 4 | 5 | 6;

/** Result of rolling two six-sided dice (2d6), used in combat, corruption checks, and influence attempts. */
export interface TwoDiceSix {
  readonly die1: DieRoll;
  readonly die2: DieRoll;
}

/** Races for characters and creatures, covering all alignments and creature types. */
export enum Race {
  Hobbit = 'hobbit',
  Elf = 'elf',
  Dwarf = 'dwarf',
  Dunadan = 'dunadan',
  Man = 'man',
  Wizard = 'wizard',
  Orc = 'orc',
  Troll = 'troll',
  Ringwraith = 'ringwraith',
  Dragon = 'dragon',
  Undead = 'undead',
  Spider = 'spider',
  Wolf = 'wolf',
  Giant = 'giant',
  Animal = 'animal',
  AwakenedPlant = 'awakened-plant',
  PukelCreature = 'pukel-creature',
  Slayer = 'slayer',
}

/** Character skills that determine special abilities and card interactions. */
export enum Skill {
  Warrior = 'warrior',
  Scout = 'scout',
  Ranger = 'ranger',
  Sage = 'sage',
  Diplomat = 'diplomat',
}

/**
 * Region types represent the terrain of geographic areas on the Middle-earth map.
 * They determine which hazard creatures can be played against companies
 * moving through those regions.
 */
export enum RegionType {
  Wilderness = 'wilderness',
  Shadow = 'shadow',
  Dark = 'dark',
  Coastal = 'coastal',
  Free = 'free',
  Border = 'border',
}

/**
 * Site types classify locations on the map. Each type determines what
 * resources can be played there and what automatic attacks occur.
 * Havens are safe bases for healing and reorganization.
 */
export enum SiteType {
  Haven = 'haven',
  FreeHold = 'free-hold',
  BorderHold = 'border-hold',
  RuinsAndLairs = 'ruins-and-lairs',
  ShadowHold = 'shadow-hold',
  DarkHold = 'dark-hold',
}

/**
 * Movement types available when a company travels between sites.
 *
 * The resource player declares the movement type at step 2 of the
 * Movement/Hazard phase, which determines how the site path is computed.
 */
export enum MovementType {
  /** Path follows the route printed on the site or haven card. */
  Starter = 'starter',
  /** Path is a player-declared sequence of up to 4 consecutive regions. */
  Region = 'region',
  /** Movement through the Under-deeps network (no surface site path). */
  UnderDeeps = 'under-deeps',
  /** Movement via a special card effect; path depends on the effect. */
  Special = 'special',
}

/**
 * The six categories of marshalling points (victory points).
 * At the Free Council (endgame), the doubling and diversity rules
 * apply across these categories.
 */
export enum MarshallingCategory {
  Character = 'character',
  Item = 'item',
  Faction = 'faction',
  Ally = 'ally',
  Kill = 'kill',
  Misc = 'misc',
}

/**
 * The alignment of a player or card, determining which card pool
 * (wizard, ringwraith, fallen-wizard, or balrog) they belong to.
 * Used both as the player's chosen alignment and as a tag on each
 * card definition to indicate which alignment can include it in a deck.
 */
export enum Alignment {
  Wizard = 'wizard',
  Ringwraith = 'ringwraith',
  FallenWizard = 'fallen-wizard',
  Balrog = 'balrog',
}

/** The five Istari (Wizards) that serve as player avatars in the game. */
export enum WizardName {
  Gandalf = 'gandalf',
  Saruman = 'saruman',
  Radagast = 'radagast',
  Alatar = 'alatar',
  Pallando = 'pallando',
}

/**
 * The three possible states of a card in play.
 * Untapped cards can act freely; tapped cards are exhausted;
 * inverted (upside-down) cards represent wounded characters or
 * other special states depending on card type.
 */
export enum CardStatus {
  Untapped = 'untapped',
  Tapped = 'tapped',
  Inverted = 'inverted',
}
