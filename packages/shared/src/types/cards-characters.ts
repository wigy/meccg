/**
 * @module cards-characters
 *
 * Character card definition types for MECCG.
 *
 * Characters are the backbone of any company -- they carry items, fight
 * creatures, make influence attempts on factions, and contribute marshalling
 * points. This module defines both hero and minion character card interfaces.
 */

import type {
  Alignment,
  CardDefinitionId,
  Keyword,
  ManifestId,
  Race,
  Skill,
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
  /** Game keywords (e.g. "environment", "weapon", "armor") that affect card interactions. */
  readonly keywords?: readonly Keyword[];
  /**
   * If this character is part of a manifestation chain, the chain id — by
   * convention the base form's definition id (see {@link ManifestId}).
   */
  readonly manifestId?: ManifestId;
  /** Declarative effects describing this character's special abilities. */
  readonly effects?: readonly CardEffect[];
  /** Flavor/rules text describing special abilities. */
  readonly text: string;
  /** Date when /certify-card confirmed all effects are engine-supported (ISO 8601). */
  readonly certified?: string;
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
  /** Game keywords (e.g. "environment", "weapon", "armor") that affect card interactions. */
  readonly keywords?: readonly Keyword[];
  /**
   * If this character is a manifestation in a chain (e.g. The Mouth
   * manifesting Mouth of Sauron), the chain id — by convention the base
   * form's definition id (see {@link ManifestId}).
   */
  readonly manifestId?: ManifestId;
  /** Declarative effects describing this character's special abilities. */
  readonly effects?: readonly CardEffect[];
  /** Flavor/rules text describing special abilities. */
  readonly text: string;
  /** Date when /certify-card confirmed all effects are engine-supported (ISO 8601). */
  readonly certified?: string;
}
