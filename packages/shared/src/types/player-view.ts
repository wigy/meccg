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
 * - Discard piles are discarded face-down (CoE glossary): your own is fully
 *   visible to you, but the opponent's identities are hidden (unknown
 *   instances) — except the top card, which is revealed to you while you
 *   control Pallando (tw-175, CRF 22). Deck contents are always hidden.
 * - Opponent's planned movement destination is hidden until movement resolves.
 * - Site decks are visible to their owner but hidden from the opponent.
 *
 * The projection function (server-side) transforms `GameState` into a
 * per-player `PlayerView` before sending it over WebSocket.
 */

import {
  PlayerId,
  CardDefinitionId,
  CardInstanceId,
  CompanyId,
  WizardName,
  Alignment,
  TwoDiceSix,
  ById,
} from './common.js';
// Re-export ViewCard from common so existing imports from player-view still work.
export type { ViewCard } from './common.js';
import type { ViewCard } from './common.js';
import type {
  PhaseState,
  CombatState,
  ChainState,
  Company,
  CharacterInPlay,
  CardInPlay,
  MarshallingPointTotals,
  SiteInPlay,
  PendingEffect,
} from './state.js';
import type { ActiveConstraint } from './pending.js';
import type { EvaluatedAction } from '../rules/types.js';
import type { AgentInPlay, OpponentAgentView } from './state-agents.js';
export type { OpponentAgentView } from './state-agents.js';

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
  /**
   * The opponent's discard pile: identities hidden (`UNKNOWN_CARD`) by
   * default since cards are discarded face-down, except the top card, which
   * is revealed while you control Pallando (tw-175, CRF 22).
   */
  readonly discardPile: readonly ViewCard[];
  /** The opponent's face-up site discard pile (public information). */
  readonly siteDiscardPile: readonly ViewCard[];
  /** The opponent's defeated creatures (kill MP pile, public information). */
  readonly killPile: readonly ViewCard[];
  /** The opponent's out-of-play pile: eliminated cards and items stored at sites (public information). */
  readonly outOfPlayPile: readonly ViewCard[];
  /** Cards in the opponent's sideboard (hidden — each has `UNKNOWN_CARD` definition, use `.length` for count). */
  readonly sideboard: readonly ViewCard[];
  /** The opponent's companies with destination information redacted. */
  readonly companies: readonly OpponentCompanyView[];
  /**
   * The opponent's agents in play, with identity and site stack redacted when face-down.
   * The resource player can see that an agent exists and its stack size, but not the
   * agent's character identity or exact sites until it is revealed.
   */
  readonly agents: readonly OpponentAgentView[];
  /** The opponent's characters in play (public information). */
  readonly characters: ById<CharacterInPlay>;
  /** General cards the opponent has in play (permanent resources, factions, etc.). */
  readonly cardsInPlay: readonly CardInPlay[];
  /** The opponent's current marshalling point totals (public information). */
  readonly marshallingPoints: MarshallingPointTotals;
  /**
   * The opponent's *callable* marshalling point totals — the raw, unmodified
   * figure CoE rule 10.40 compares against the calling threshold (excludes
   * Under-deeps company MPs per MEAS §6e). Public information.
   */
  readonly callableMarshallingPoints: MarshallingPointTotals;
  /** How much of the opponent's general influence is committed (public information). */
  readonly generalInfluenceUsed: number;
  /**
   * The opponent's effective general-influence pool: 20 for most players, or
   * the white-hand value of a revealed Fallen-wizard avatar (CoE 3.09), plus
   * any in-play bonus (e.g. Bade to Rule). Public information.
   */
  readonly generalInfluence: number;
  /** The opponent's Fallen-wizard stage points (MEWH); 0 for non-Fallen-wizard players. Public information. */
  readonly stagePoints: number;
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
  /** Out-of-play pile: eliminated characters and items stored at sites. */
  readonly outOfPlayPile: readonly ViewCard[];
  /** All companies this player controls, with full destination visibility. */
  readonly companies: readonly Company[];
  /** All agents this player has in play as hazards, with full state visibility. */
  readonly agents: readonly AgentInPlay[];
  /** All characters this player has in play. */
  readonly characters: ById<CharacterInPlay>;
  /** General cards in play on the table (permanent resources, factions, etc.). */
  readonly cardsInPlay: readonly CardInPlay[];
  /** Current marshalling point totals by category. */
  readonly marshallingPoints: MarshallingPointTotals;
  /**
   * Callable marshalling point totals — the raw, unmodified figure CoE rule
   * 10.40 compares against the 25-point calling threshold (excludes
   * Under-deeps company MPs per MEAS §6e).
   */
  readonly callableMarshallingPoints: MarshallingPointTotals;
  /** How much general influence is currently committed to controlling characters. */
  readonly generalInfluenceUsed: number;
  /**
   * The player's effective general-influence pool: 20 for most players, or the
   * white-hand value of a revealed Fallen-wizard avatar (CoE 3.09), plus any
   * in-play bonus (e.g. Bade to Rule).
   */
  readonly generalInfluence: number;
  /** This player's Fallen-wizard stage points (MEWH); 0 for non-Fallen-wizard players. */
  readonly stagePoints: number;
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
  /** Pending card effects awaiting player interaction. */
  readonly pendingEffects: readonly PendingEffect[];
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
  /**
   * Active constraints (Stealth, River, etc.) currently in effect.
   * Public information — both players can see which restrictions apply.
   */
  readonly activeConstraints: readonly ActiveConstraint[];
  /**
   * True once a developer-tools command has been used in this game
   * (see {@link GameState.cheated}). Lets the client skip the cheat
   * confirmation dialog once the game is already marked. Optional so
   * views built before this field existed read as not cheated.
   */
  readonly cheated?: boolean;
  /**
   * Present only in tutorial games: the active curriculum step and overall
   * progress, computed server-side by the TutorialController. The browser
   * tutorial panel renders directly from this — the client never tracks the
   * script cursor itself.
   */
  readonly tutorial?: TutorialProgress;
}

/**
 * Well-known UI element a tutorial pointer bubble attaches to. Abstract names
 * keep the shared script independent of the browser's DOM: the tutorial panel
 * maps each anchor to a concrete element id and skips anchors whose element
 * is absent or hidden in the current layout.
 */
export type TutorialAnchorId =
  | 'general-influence'
  | 'marshalling-points'
  | 'score-box'
  | 'phase-meter'
  | 'hand'
  | 'play-deck'
  | 'discard-pile'
  | 'sideboard'
  | 'site-deck'
  | 'dice'
  | 'opponent-dice'
  | 'hazard-limit'
  | 'player-name'
  | 'map'
  | 'text-log'
  | 'view-toggle';

/**
 * A short game-term explanation rendered under a tutorial step's
 * instruction — the glossary entry for a concept the step introduces.
 */
export interface TutorialConcept {
  /** The game term being explained (e.g. "General influence"). */
  readonly term: string;
  /** One- or two-sentence plain-language explanation of the term. */
  readonly explanation: string;
}

/**
 * A card shown beside a tutorial step's instruction, optionally with a
 * highlight circle drawn over the card image to call out one attribute
 * (e.g. the mind icon). Coordinates are fractions of the card image's
 * width/height so the circle scales with the rendered size.
 */
export interface TutorialCardIllustration {
  /** Card definition whose image is shown. */
  readonly cardDefId: CardDefinitionId;
  /** Highlight circle: center and radius as fractions of the image size (radius of width). */
  readonly highlight?: { readonly x: number; readonly y: number; readonly r: number };
}

/**
 * A callout bubble pointing at the UI element where a concept the step
 * introduces lives on screen (e.g. the general-influence counter).
 */
export interface TutorialPointer {
  /** Which UI element the bubble attaches to (omit when using `cardDefId`). */
  readonly anchor?: TutorialAnchorId;
  /**
   * Anchor to the on-screen card image with this definition id instead of a
   * fixed UI element — e.g. point at a character in the company view. The
   * bubble hides when no such card is visible.
   */
  readonly cardDefId?: CardDefinitionId;
  /** Short bubble text naming what the element shows. */
  readonly label: string;
  /**
   * Placement hint overriding the default above-the-anchor position:
   * `'right'`/`'left'` put the bubble beside the anchor (used when the
   * anchor also opens a hover tooltip above itself, e.g. the GI box, or
   * hugs a screen edge, e.g. the map radar); `'below'` forces the bubble
   * under the anchor (used for tall top-anchored elements like the text
   * log).
   */
  readonly side?: 'right' | 'left' | 'below';
}

/**
 * Snapshot of the guided tutorial's progress attached to the human player's
 * view (see specs/2026-07-30-tutorial-plan.md).
 */
export interface TutorialProgress {
  /** Curriculum step id (see the shared tutorial script). */
  readonly stepId: string;
  /** Panel heading. */
  readonly title: string;
  /** Panel body: the rule explanation and what to do. */
  readonly body: string;
  /** Zero-based index of the step in the curriculum. */
  readonly stepIndex: number;
  /** Total number of curriculum steps. */
  readonly stepCount: number;
  /** True when the current beat is the human's to perform (vs. watch-only). */
  readonly yourTurn: boolean;
  /** True once every beat has been performed — the tutorial is complete. */
  readonly done: boolean;
  /** Game-term explanations rendered under the step's instruction. */
  readonly concepts?: readonly TutorialConcept[];
  /** Callout bubbles pointing at UI elements related to the step. */
  readonly pointers?: readonly TutorialPointer[];
  /** Card illustrated beside the instruction, with an optional attribute highlight. */
  readonly card?: TutorialCardIllustration;
  /** Emphasized closing line rendered under the step content (e.g. "TO BE CONTINUED…"). */
  readonly footer?: string;
}
