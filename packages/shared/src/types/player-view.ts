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
 * - Your own hand contents are visible; opponent's hand is an array of
 *   {@link UNKNOWN_INSTANCE} (size visible, identities hidden).
 * - Discard piles are public (face-up); deck contents are hidden (unknown instances).
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
  WizardName,
  Alignment,
  TwoDiceSix,
} from './common.js';
// Re-export ViewCard from common so existing imports from player-view still work.
export type { ViewCard } from './common.js';
import type { ViewCard } from './common.js';
import type {
  PhaseState,
  CombatState,
  ChainState,
  EventInPlay,
  Company,
  CharacterInPlay,
  CardInPlay,
  MarshallingPointTotals,
  SiteInPlay,
} from './state.js';
import type { EvaluatedAction } from '../rules/types.js';

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
  readonly currentSite: SiteInPlay | null;
  /** Whether this company holds the physical site card (false for split-off companies). */
  readonly siteCardOwned: boolean;
  /** Whether the company has a planned destination (true) or is staying put (false). */
  readonly hasPlannedMovement: boolean;
  /**
   * The destination site, revealed during the reveal-new-site step of this
   * company's M/H sub-phase. Stored as a full {@link SiteInPlay} so the
   * definition ID is always available. Null when the site has not yet been
   * revealed or the company is not moving.
   */
  readonly revealedDestinationSite: SiteInPlay | null;
  /** Whether this company has already moved this turn. */
  readonly moved: boolean;
  /**
   * On-guard cards placed at this company's site. For the resource player,
   * card identities are redacted (unknown sentinels); for the hazard player,
   * full card details are shown.
   */
  readonly onGuardCards: readonly ViewCard[];
}

// ---- Opponent view (hidden info redacted) ----

/**
 * The opponent's state as visible to the current player.
 *
 * Sensitive information is redacted:
 * - Hand, play deck, site deck -> arrays of {@link UNKNOWN_INSTANCE} (size is
 *   visible but card identities are hidden).
 * - Sideboard -> completely hidden (empty array).
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
  /** Cards in the opponent's hand (hidden — each has `UNKNOWN_CARD` definition, use `.length` for count). */
  readonly hand: readonly ViewCard[];
  /** Cards in the opponent's play deck (hidden — each has `UNKNOWN_CARD` definition, use `.length` for count). */
  readonly playDeck: readonly ViewCard[];
  /** Cards in the opponent's site deck (hidden — each has `UNKNOWN_SITE` definition, use `.length` for count). */
  readonly siteDeck: readonly ViewCard[];
  /** The opponent's face-up discard pile (public information). */
  readonly discardPile: readonly ViewCard[];
  /** The opponent's face-up site discard pile (public information). */
  readonly siteDiscardPile: readonly ViewCard[];
  /** The opponent's defeated creatures (kill MP pile, public information). */
  readonly killPile: readonly ViewCard[];
  /** The opponent's eliminated (removed from play) cards (public information). */
  readonly eliminatedPile: readonly ViewCard[];
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
  readonly hand: readonly ViewCard[];
  /** Cards in the play deck (hidden even from owner — each has `UNKNOWN_CARD` definition, use `.length` for count). */
  readonly playDeck: readonly ViewCard[];
  /** Face-up discard pile. */
  readonly discardPile: readonly ViewCard[];
  /** Available site cards (visible to the owning player for planning movement). */
  readonly siteDeck: readonly ViewCard[];
  /** Face-up site discard pile. */
  readonly siteDiscardPile: readonly ViewCard[];
  /** Reserve cards available for sideboard fetching. */
  readonly sideboard: readonly ViewCard[];
  /** Defeated creatures earning kill marshalling points. */
  readonly killPile: readonly ViewCard[];
  /** Cards removed from the game (eliminated characters, etc.). */
  readonly eliminatedPile: readonly ViewCard[];
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
  /**
   * Active combat sub-state, or null when no combat is in progress.
   * Combat is public information — both players see the full combat state.
   */
  readonly combat: CombatState | null;
  /**
   * Active chain of effects sub-state, or null when no chain is in progress.
   * Chain state is public information — both players see all declared cards.
   */
  readonly chain: ChainState | null;
  /** Long-duration and permanent events currently in play on the table. */
  readonly eventsInPlay: readonly EventInPlay[];
  /** Current turn number (1-based). */
  readonly turnNumber: number;
  /**
   * The self player's index in the original `state.players` array (0 or 1).
   * Phase-state arrays (draft state, site selection, etc.) are indexed by
   * this player order — use this to look up the correct entry for self.
   */
  readonly selfIndex: number;
  /** The player who won the initiative roll and took the first turn. Null during setup. */
  readonly startingPlayer: PlayerId | null;
  /** Monotonically increasing sequence number for state changes. */
  readonly stateSeq: number;
  /**
   * Complete list of candidate actions for the current phase, annotated with viability.
   * Viable actions can be submitted; non-viable actions include a human-readable reason
   * explaining why they cannot be taken (e.g. "Gimli: mind 6 would exceed limit").
   */
  readonly legalActions: readonly EvaluatedAction[];
}
