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
   * Site keyword tags where this creature can be played. The destination
   * site must carry at least one of the listed keywords. Used for creatures
   * whose playability is tied to a site category rather than a single type
   * or name — e.g. `["under-deeps"]` for Nameless Thing, which is playable
   * at any Under-deeps site regardless of its specific siteType.
   * Evaluated in `findCreatureKeyingMatches`.
   */
  readonly siteKeywords?: readonly Keyword[];
  /**
   * Site adjacency keyword filter. The creature is playable at any site
   * that is adjacent (in the Under-deeps movement sense) to a site that
   * carries at least one of the listed keywords. Used for Doors-of-Night
   * alternates that let a creature attack companies at surface sites
   * bordering the Under-deeps (e.g. Nameless Thing's DoN clause).
   * Evaluated in `findCreatureKeyingMatches`.
   */
  readonly adjacentToSiteKeywords?: readonly Keyword[];
  /**
   * Optional DSL condition gating this keying entry. When present, the
   * entry is skipped unless the condition matches a context exposing:
   *
   * - `inPlay` — names of all cards currently in play (both sides).
   *   Used by cards whose alternate keying depends on the game
   *   environment, e.g. *Elf-lord Revealed in Wrath* ("If Doors of
   *   Night is not in play, may also be played keyed to Shadow-lands").
   * - `destinationSite.sitePath.*Count` — per-region-type counts of
   *   the destination site card's own `sitePath` field
   *   (`wildernessCount`, `shadowCount`, `darkCount`, `coastalCount`,
   *   `freeCount`, `borderCount`). Used by cards whose alt-keying
   *   inspects site structure rather than the company's movement path,
   *   e.g. *Rain-drake* ("may also be played at a R&L that has two
   *   Wildernesses or one Coastal Sea in its site path").
   *
   * Evaluated in `findCreatureKeyingMatches` in
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
  /**
   * Whether the kill marshalling points are "starred" (printed with "*" on the card).
   * Starred MPs are only awarded to minion/Balrog players; hero/fallen-wizard players who
   * defeat a starred creature have it removed from play instead of going to the kill pile.
   * Conversely, non-starred creatures go to out-of-play when defeated by minion/Balrog players.
   * (CoE rule 8.22)
   */
  readonly starredKillMarshallingPoints?: boolean;
  /**
   * The creature's primary race — the first attack type its card text names
   * (e.g. Orc, Troll, Undead) — used for race-specific card interactions.
   * Always exactly one {@link Race}; a creature that counts as several races
   * lists the rest in {@link additionalRaces} rather than packing them into
   * this field.
   */
  readonly race: Race;
  /**
   * The further races this creature also counts as, beyond {@link race}.
   * A handful of creatures print more than one attack type — Beorning
   * Skin-changers (ba-10) "Animals. Men. Bears.", Goblin-faces (wh-13)
   * "Orcs. Men.", Durin's Bane (dm-107) Balrog/Spawn — and each entry here is
   * a single canonical {@link Race}, never a comma-joined list. Exposed to the
   * DSL as `enemy.races` (the full set including {@link race}) so a condition
   * can match any of them; `enemy.race` stays the single primary race.
   */
  readonly additionalRaces?: readonly Race[];
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
  /**
   * For hazard permanent-events that have a standard removal mechanic ("Make a
   * roll—if the result is greater than N, discard this card"), this is the
   * threshold N. Cards without this field default to 8 when targeted by effects
   * like Glamour of Surpassing Excellence that roll to remove hazard permanent-events.
   */
  readonly removalNumber?: number;
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
