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
  /** Starting company -- characters and minor items available for the pre-game draft. */
  readonly pool: readonly DeckListEntry[];
  /** The main deck split into characters, hazards, and resources. */
  readonly deck: DeckListCards;
  /** Site deck. Havens have qty 4, other sites have qty 1. */
  readonly sites: readonly DeckListEntry[];
  /** Sideboard -- reserve cards accessible under specific game conditions. */
  readonly sideboard: readonly DeckListEntry[];
}
