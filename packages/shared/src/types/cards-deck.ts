/**
 * @module cards-deck
 *
 * Deck configuration and deck list types for MECCG.
 *
 * A player's deck has three components: a character pool for the draft,
 * a shuffled play deck of resources and hazards, and a sideboard of
 * reserve cards. Deck lists are the human-readable format used for
 * editing, planning, and sharing decks.
 */

import type { CardDefinitionId } from './common.js';

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

// ---- Deck list format (for editing and planning) ----

/**
 * Game length, determined by mutual agreement or the tournament organizer
 * (CoE rule 1.1). Governs the maximum sideboard size (rule 1.6.1): 30 cards
 * for Starter or Short, 35 for Long, 40 for Campaign.
 */
export type GameLength = 'starter' | 'short' | 'long' | 'campaign';

/**
 * A single card entry in a deck list, referencing a card by display name
 * with an optional link to the card definition ID.
 */
export interface DeckListEntry {
  /** Display name of the card (e.g. "Gandalf", "Glamdring"). */
  readonly name: string;
  /** Card definition ID if known (e.g. "tw-156"), or `null` if not yet in data. */
  readonly card: CardDefinitionId | null;
  /** Number of copies in this deck section. */
  readonly qty: number;
  /** Whether this is a favourite character (starting company pick) in the pool. */
  readonly favourite?: boolean;
}

/**
 * The main play deck portion of a deck list, split by card category.
 *
 * Characters, hazards, and resources are listed separately for readability,
 * but together they form the combined play deck used during the game.
 */
export interface DeckListCards {
  /** Character cards available for play (includes the avatar at qty 3). */
  readonly characters: readonly DeckListEntry[];
  /** Hazard cards (creatures and events played against the opponent). */
  readonly hazards: readonly DeckListEntry[];
  /** Resource cards (items, factions, allies, and events). */
  readonly resources: readonly DeckListEntry[];
}

/**
 * A complete deck list used for editing, planning, and sharing decks.
 *
 * Deck lists use display names rather than card definition IDs so they
 * remain human-readable, with an optional `card` field linking to the
 * definition ID where available. Stored as JSON in `data/decks/`.
 */
export interface DeckList {
  /** Unique deck identifier (e.g. "challenge-deck-a"). */
  readonly id: string;
  /** Deck name (e.g. "Stewards of Gondor"). */
  readonly name: string;
  /** Deck alignment: hero, minion, fallen-wizard, or balrog. */
  readonly alignment: 'hero' | 'minion' | 'fallen-wizard' | 'balrog';
  /**
   * Free-form notes about the deck in Markdown: strategy write-ups, starting
   * company suggestions, play tips. Shown in the deck browser and editable in
   * the deck editor. Optional (absent on decks without notes).
   */
  readonly notes?: string;
  /**
   * Game length declared for this deck (CoE rule 1.1), governing the maximum
   * sideboard size (rule 1.6.1). Defaults to `'short'` when absent, matching
   * decks built before this field existed.
   */
  readonly gameLength?: GameLength;
  /**
   * Whether a human has reviewed this deck and confirmed it actually plays:
   * legal, functional, and free of engine defects across a real number of
   * games. **Set by hand only** — no tool may flip it.
   *
   * Most catalog decks are not in that state. Automated probing of one deck
   * against nine opponents found five clean pairings, two that deadlocked,
   * one with an engine error, and one that failed every single game, and
   * short probes had previously passed matchups whose defects only appear
   * over longer runs. Training on an unapproved deck therefore produces
   * data from games the engine cannot finish, and evaluating on one yields
   * ratings that mean nothing.
   *
   * Absent is treated as not approved, so a new or edited deck must be
   * reviewed before it can be used for training or rated play.
   */
  readonly approved?: boolean;
  /** Starting company -- characters and minor items available for the pre-game draft. */
  readonly pool: readonly DeckListEntry[];
  /** The main deck split into characters, hazards, and resources. */
  readonly deck: DeckListCards;
  /** Site deck. Havens have qty 4, other sites have qty 1. */
  readonly sites: readonly DeckListEntry[];
  /** Sideboard -- reserve cards accessible under specific game conditions. */
  readonly sideboard: readonly DeckListEntry[];
  /**
   * Anti-Fallen-wizard sideboard (MEWH) -- up to 10 cards preselected for facing
   * a Fallen-wizard opponent. Added to the main sideboard at game start when the
   * opponent is a Fallen-wizard. Optional (absent on decks built before this
   * section existed).
   */
  readonly antiFwSideboard?: readonly DeckListEntry[];
}
