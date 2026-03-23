/**
 * @module player-view
 *
 * Player visibility projection types for the MECCG client.
 *
 * The server maintains the full `GameState` with all hidden information,
 * but clients must only see what their player would legitimately know.
 * This module defines the types used in the projected `PlayerView` that
 * the server sends to each client, with hidden information redacted:
 *
 * - Your own hand contents are visible; opponent's hand is just a count.
 * - Discard piles are public (face-up); deck contents are hidden (just a count).
 * - Opponent's planned movement destination is hidden until movement resolves.
 * - Site decks are visible to their owner but hidden from the opponent.
 *
 * The projection function (server-side) transforms `GameState` into a
 * per-player `PlayerView` before sending it over WebSocket.
 */

import {
  PlayerId,
  CardInstanceId,
  CompanyId,
  CardDefinitionId,
  WizardName,
  Alignment,
  TwoDiceSix,
} from './common.js';
import type {
  PhaseState,
  EventInPlay,
  Company,
  CharacterInPlay,
  CardInPlay,
  MarshallingPointTotals,
} from './state.js';
import type { EvaluatedAction } from '../rules/types.js';

// ---- Card visibility ----

/**
 * A card whose identity is hidden from this player.
 *
 * The instance ID is known (so the client can track card count and
 * animate card movements), but the card's definition is not revealed.
 * Used for cards in the opponent's hand, both players' decks, etc.
 */
export interface HiddenCard {
  /** The card's instance ID (for tracking purposes). */
  readonly instanceId: CardInstanceId;
  /** Always false -- discriminant indicating the card's identity is unknown. */
  readonly known: false;
}

/**
 * A card whose identity is visible to this player.
 *
 * Used for cards in your own hand, both players' discard piles,
 * cards in play, and any other publicly known cards.
 */
export interface RevealedCard {
  /** The card's instance ID. */
  readonly instanceId: CardInstanceId;
  /** Reference to the static card definition, allowing the client to display full card details. */
  readonly definitionId: CardDefinitionId;
  /** Always true -- discriminant indicating the card's identity is known. */
  readonly known: true;
}

/**
 * A card that may or may not be visible to the viewing player.
 * Use the `known` discriminant to determine whether `definitionId` is available.
 */
export type ViewCard = HiddenCard | RevealedCard;

// ---- Opponent's company (destination hidden until movement phase) ----

/**
 * A projected view of one of the opponent's companies.
 *
 * Unlike the full `Company` type, the destination site and movement path
 * are hidden -- the viewing player only knows whether the company has
 * planned movement (boolean), not where it's going. This prevents the
 * opponent from knowing destinations before hazards are played.
 */
export interface OpponentCompanyView {
  /** The company's identifier. */
  readonly id: CompanyId;
  /** Character instance IDs in this company (characters in play are public knowledge). */
  readonly characters: readonly CardInstanceId[];
  /** The site where this company is currently located (public). Null during setup before site selection. */
  readonly currentSite: CardInstanceId | null;
  /** Whether this company holds the physical site card (false for split-off companies). */
  readonly siteCardOwned: boolean;
  /** Whether the company has a planned destination (true) or is staying put (false). */
  readonly hasPlannedMovement: boolean;
  /** Whether this company has already moved this turn. */
  readonly moved: boolean;
}

// ---- Opponent view (hidden info redacted) ----

/**
 * The opponent's state as visible to the current player.
 *
 * Sensitive information is redacted:
 * - Hand contents -> just the card count (`handSize`).
 * - Play deck contents -> just the card count (`playDeckSize`).
 * - Site deck and sideboard -> completely hidden (not exposed at all).
 * - Company destinations -> redacted to a boolean flag.
 *
 * Discard piles, characters in play, and general influence usage
 * are public information and shown in full.
 */
export interface OpponentView {
  /** The opponent's player ID. */
  readonly id: PlayerId;
  /** The opponent's display name. */
  readonly name: string;
  /** The opponent's alignment (wizard, ringwraith, fallen-wizard, balrog). */
  readonly alignment: Alignment;
  /** The opponent's wizard identity, or null if not yet chosen. */
  readonly wizard: WizardName | null;
  /** Number of cards in the opponent's hand (contents hidden). */
  readonly handSize: number;
  /** Number of cards in the opponent's play deck (contents hidden). */
  readonly playDeckSize: number;
  /** Number of cards in the opponent's site deck (contents hidden). */
  readonly siteDeckSize: number;
  /** The opponent's face-up discard pile (public information). */
  readonly discardPile: readonly RevealedCard[];
  /** The opponent's face-up site discard pile (public information). */
  readonly siteDiscardPile: readonly RevealedCard[];
  /** The opponent's eliminated (removed from play) cards (public information). */
  readonly eliminatedPile: readonly RevealedCard[];
  /** The opponent's companies with destination information redacted. */
  readonly companies: readonly OpponentCompanyView[];
  /** The opponent's characters in play (public information). */
  readonly characters: Readonly<Record<string, CharacterInPlay>>;
  /** General cards the opponent has in play (permanent resources, factions, etc.). */
  readonly cardsInPlay: readonly CardInPlay[];
  /** The opponent's current marshalling point totals (public information). */
  readonly marshallingPoints: MarshallingPointTotals;
  /** How much of the opponent's general influence is committed (public information). */
  readonly generalInfluenceUsed: number;
  /** How many times the opponent has exhausted their play deck (relevant for Free Council trigger). */
  readonly deckExhaustionCount: number;
  /** The opponent's most recent dice roll (public information), or null before first roll. */
  readonly lastDiceRoll: TwoDiceSix | null;
}

// ---- Self view (full access to own info) ----

/**
 * The current player's own state with full visibility.
 *
 * The player can see their own hand contents, site deck, and sideboard.
 * Play deck contents remain hidden even to the owning player (only the
 * count is shown), preserving the surprise element of drawing cards.
 */
export interface SelfView {
  /** The player's own ID. */
  readonly id: PlayerId;
  /** The player's display name. */
  readonly name: string;
  /** The player's alignment (wizard, ringwraith, fallen-wizard, balrog). */
  readonly alignment: Alignment;
  /** The player's wizard identity, or null if not yet chosen. */
  readonly wizard: WizardName | null;
  /** Cards currently in hand (fully revealed to the owning player). */
  readonly hand: readonly RevealedCard[];
  /** Number of cards remaining in the play deck (contents hidden even from owner). */
  readonly playDeckSize: number;
  /** Face-up discard pile. */
  readonly discardPile: readonly RevealedCard[];
  /** Available site cards (visible to the owning player for planning movement). */
  readonly siteDeck: readonly RevealedCard[];
  /** Face-up site discard pile. */
  readonly siteDiscardPile: readonly RevealedCard[];
  /** Reserve cards available for sideboard fetching. */
  readonly sideboard: readonly RevealedCard[];
  /** Cards removed from the game (eliminated characters, etc.). */
  readonly eliminatedPile: readonly RevealedCard[];
  /** All companies this player controls, with full destination visibility. */
  readonly companies: readonly Company[];
  /** All characters this player has in play. */
  readonly characters: Readonly<Record<string, CharacterInPlay>>;
  /** General cards in play on the table (permanent resources, factions, etc.). */
  readonly cardsInPlay: readonly CardInPlay[];
  /** Current marshalling point totals by category. */
  readonly marshallingPoints: MarshallingPointTotals;
  /** How much general influence is currently committed to controlling characters. */
  readonly generalInfluenceUsed: number;
  /** How many times this player's play deck has been exhausted. */
  readonly deckExhaustionCount: number;
  /** This player's most recent dice roll, or null before the first roll. */
  readonly lastDiceRoll: TwoDiceSix | null;
}

// ---- Combined player view ----

/**
 * The complete view sent to a specific player each time the game state changes.
 *
 * This is the primary data structure the client receives over WebSocket.
 * It combines the player's own full state, a redacted view of the opponent,
 * shared game state (current phase, events in play, turn number), and the
 * list of action types currently legal for this player to submit.
 */
export interface PlayerView {
  /** The player's own state with full visibility. */
  readonly self: SelfView;
  /** The opponent's state with hidden information redacted. */
  readonly opponent: OpponentView;
  /** Which player's turn it currently is. */
  /** The player whose turn it currently is, or null during simultaneous phases. */
  readonly activePlayer: PlayerId | null;
  /** The current phase and its associated bookkeeping state. */
  readonly phaseState: PhaseState;
  /** Long-duration and permanent events currently in play on the table. */
  readonly eventsInPlay: readonly EventInPlay[];
  /** Current turn number (1-based). */
  readonly turnNumber: number;
  /**
   * Complete list of candidate actions for the current phase, annotated with viability.
   * Viable actions can be submitted; non-viable actions include a human-readable reason
   * explaining why they cannot be taken (e.g. "Gimli: mind 6 would exceed limit").
   */
  readonly legalActions: readonly EvaluatedAction[];
  /**
   * Map from CardInstanceId to CardDefinitionId for all cards visible to this player.
   * Includes own hand, discard piles, characters, items, sites, and public opponent cards.
   * Used by the formatter to resolve instance IDs to card names.
   */
  readonly visibleInstances: Readonly<Record<string, CardDefinitionId>>;
}
