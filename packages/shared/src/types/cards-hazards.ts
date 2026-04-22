/**
 * @module cards-hazards
 *
 * Hazard card definition types for MECCG.
 *
 * Hazards are hostile cards (creatures, events, corruption) that the
 * opponent plays during the Movement/Hazard phase to impede the active player.
 */

import type {
  CardDefinitionId,
  Keyword,
  ManifestId,
  Race,
  RegionType,
  SiteType,
} from './common.js';
import type { CardEffect, Condition } from './effects.js';

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
  /**
   * Specific site names where this creature can be played (e.g. Smaug at
   * "The Lonely Mountain"). Matches against the company's destination site
   * name. Used for unique creatures whose lair / canonical location is a
   * single named site rather than a general region or site type.
   */
  readonly siteNames?: readonly string[];
  /**
   * Optional DSL condition gating this keying entry. When present, the
   * entry is skipped unless the condition matches a context exposing
   * `inPlay` (names of all cards in play). Used by cards whose alternate
   * keying depends on the game environment — e.g. *Elf-lord Revealed in
   * Wrath* ("If Doors of Night is not in play, may also be played keyed
   * to Shadow-lands"). Evaluated in `findCreatureKeyingMatches` in
   * `legal-actions/movement-hazard.ts`.
   */
  readonly when?: Condition;
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
  /** The creature's race (e.g. Orc, Troll, Undead), used for race-specific card interactions. */
  readonly race: Race;
  /** Terrain and site restrictions determining where this creature can legally attack. */
  readonly keyedTo: readonly CreatureKeyRestriction[];
  /** Game keywords (e.g. "environment", "weapon", "armor") that affect card interactions. */
  readonly keywords?: readonly Keyword[];
  /**
   * If this creature is a manifestation in a chain (Dragons: basic / ahunt /
   * at-home), the chain id — conventionally the basic form's definition id.
   * Used to derive cascade state without a separate top-level field.
   */
  readonly manifestId?: ManifestId;
  /** Declarative effects describing this creature's special combat abilities. */
  readonly effects?: readonly CardEffect[];
  /** Flavor/rules text describing special abilities or attack modifiers. */
  readonly text: string;
  /** Date when /certify-card confirmed all effects are engine-supported (ISO 8601). */
  readonly certified?: string;
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
  /** Game keywords (e.g. "environment") that affect card interactions. */
  readonly keywords?: readonly Keyword[];
  /**
   * If this event is a manifestation (Dragon Ahunt / Dragon At-Home), the
   * chain id pointing to the basic creature's definition id. All cards in
   * one Dragon's chain carry the same value.
   */
  readonly manifestId?: ManifestId;
  /** Declarative effects describing this event's abilities. */
  readonly effects?: readonly CardEffect[];
  /** Flavor/rules text describing the event's effect. */
  readonly text: string;
  /** Date when /certify-card confirmed all effects are engine-supported (ISO 8601). */
  readonly certified?: string;
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
  /** Date when /certify-card confirmed all effects are engine-supported (ISO 8601). */
  readonly certified?: string;
}
