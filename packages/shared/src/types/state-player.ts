/**
 * @module state-player
 *
 * Per-player state type for the MECCG engine.
 * Defines the complete state of one player including all card zones,
 * companies, characters, and scoring.
 */

import {
  PlayerId,
  WizardName,
  Alignment,
  TwoDiceSix,
} from './common.js';
import type {
  CardInstance,
  CharacterInPlay,
  CardInPlay,
  Company,
  MarshallingPointTotals,
} from './state-cards.js';
import type { CardDefinitionId, CardInstanceId } from './common.js';
import type { AgentInPlay } from './state-agents.js';

// ---- Per-player state ----

/**
 * The complete state for one player, including all card zones and board position.
 *
 * MECCG players each maintain separate card zones (hand, play deck, discard, etc.)
 * and a collection of companies with characters in play. The player's wizard
 * identity is set after the draft phase. General influence (a shared pool of 20
 * minus mind values of controlled characters) determines how many characters
 * can be in play simultaneously.
 */
export interface PlayerState {
  /** Unique player identifier for this game session. */
  readonly id: PlayerId;
  /** Display name chosen by the player. */
  readonly name: string;
  /** The alignment of this player's wizard (wizard, ringwraith, fallen-wizard, balrog). */
  readonly alignment: Alignment;
  /** The wizard (Istari) this player controls, or null before wizard selection. */
  readonly wizard: WizardName | null;
  /** Cards currently in the player's hand (hidden from opponent). */
  readonly hand: readonly CardInstance[];
  /** The shuffled draw pile of resource and hazard cards (hidden from both players). */
  readonly playDeck: readonly CardInstance[];
  /** Face-up pile of discarded play deck cards. */
  readonly discardPile: readonly CardInstance[];
  /** The player's available site cards (hidden from opponent). */
  readonly siteDeck: readonly CardInstance[];
  /** Face-up pile of used/discarded site cards. */
  readonly siteDiscardPile: readonly CardInstance[];
  /** Reserve cards that can be fetched under specific game conditions. */
  readonly sideboard: readonly CardInstance[];
  /**
   * Marshalling point pile: defeated creatures and stored items (CoE rule
   * 2.II.4.1 places successfully stored items here). Labeled "MP Pile" in the
   * UI.
   */
  readonly killPile: readonly CardInstance[];
  /**
   * Cards that are no longer in play: eliminated characters (tracked for
   * MP-modifier effects with reason "elimination") and sites stored via
   * stolen-knowledge. Stored items go to `killPile` per CoE rule 2.II.4.1.
   */
  readonly outOfPlayPile: readonly CardInstance[];
  /** All companies this player controls on the map. */
  readonly companies: readonly Company[];
  /**
   * All agents this player has in play as hazards.
   * Agent characters live here, not in `characters`, so they are excluded from
   * general-influence accounting and follower machinery.
   */
  readonly agents: readonly AgentInPlay[];
  /** All characters this player has in play, keyed by their CardInstanceId for fast lookup. */
  readonly characters: Readonly<Record<string, CharacterInPlay>>;
  /** General cards in play on the table (permanent resources, factions, etc.) not attached to characters. */
  readonly cardsInPlay: readonly CardInPlay[];
  /**
   * Current marshalling point (victory point) totals broken down by category.
   * Updated whenever cards enter or leave play. Used for display and Free Council scoring.
   */
  readonly marshallingPoints: MarshallingPointTotals;
  /**
   * How much of the player's 20-point general influence pool is currently committed
   * to controlling characters. Characters whose mind value exceeds remaining GI cannot be played.
   */
  readonly generalInfluenceUsed: number;
  /**
   * Sum of general-influence modifiers from cards currently in play (e.g. Bade to Rule: +5).
   * Recomputed by recomputeDerived. Effective GI pool = GENERAL_INFLUENCE + generalInfluenceBonus.
   */
  readonly generalInfluenceBonus: number;
  /**
   * Number of times this player's play deck has been exhausted (reshuffled from discard).
   * The game ends via Free Council when a player exhausts their deck twice.
   */
  readonly deckExhaustionCount: number;
  /** Whether this player has called the Free Council (endgame trigger). */
  readonly freeCouncilCalled: boolean;
  /** The result of this player's most recent dice roll, or null before the first roll. */
  readonly lastDiceRoll: TwoDiceSix | null;
  /**
   * Whether this player accessed the sideboard during the current turn's
   * untap phase. Used to halve the hazard limit when this player is the
   * hazard player during the opponent's M/H phase. Reset at the start of
   * each untap phase.
   */
  readonly sideboardAccessedDuringUntap: boolean;
  /**
   * Whether this player is in the deck exhaustion exchange sub-flow.
   * Set to true when deck-exhaust is executed; cleared when the player
   * passes to complete the reshuffle. During this sub-flow, only
   * exchange-sideboard and pass actions are legal.
   */
  readonly deckExhaustPending: boolean;
  /**
   * How many cards have been exchanged between discard and sideboard
   * during the current deck exhaustion. Maximum 5.
   */
  readonly deckExhaustExchangeCount: number;
  /**
   * When a Ringwraith avatar fails a body check with an unmodified roll of
   * exactly 7 or 8 (MELE §8.R1), the Ringwraith is returned to hand rather
   * than eliminated. This field records the definition ID of the Ringwraith
   * that was returned.
   *
   * While set:
   * - This player may not reveal a *different* Ringwraith.
   * - The opponent may not reveal this same Ringwraith.
   *
   * Cleared when the returned Ringwraith is re-played.
   */
  readonly ringwraithReturnedToHand?: CardDefinitionId;
  /**
   * Creatures currently reserved by Summons from Long Sleep (as-39) cards in
   * cardsInPlay. Each entry links the reserved creature instance to the
   * permanent-event card that reserved it. Reserved creatures do not reside
   * in any normal zone (hand, deck, etc.) and are exempt from the hazard
   * limit while reserved.
   */
  readonly reservedCreatures: readonly {
    readonly sourceCardInstanceId: CardInstanceId;
    readonly creature: CardInstance;
  }[];
}
