/**
 * @module state
 *
 * Runtime game state types for the MECCG engine.
 *
 * The server maintains a single authoritative `GameState` object that is
 * updated purely via a reducer: `(state, action) -> state`. This module
 * defines the full state tree including:
 *
 * - **Card instances** -- Runtime representations of cards with unique instance IDs.
 * - **Characters & companies** -- In-play characters grouped into traveling companies.
 * - **Player state** -- Each player's hand, decks, discard piles, and board position.
 * - **Phase state** -- A discriminated union tracking which game phase is active
 *   and any phase-specific bookkeeping (e.g. combat sub-state during Movement/Hazard).
 * - **Combat state** -- The nested sub-state machine for resolving creature attacks.
 *
 * The full GameState is server-only; clients receive a projected `PlayerView`
 * with hidden information redacted (see player-view.ts).
 */

import {
  PlayerId,
  CardInstanceId,
  CompanyId,
  CardDefinitionId,
  CardStatus,
  WizardName,
  Alignment,
  TwoDiceSix,
} from './common.js';
import { CardDefinition } from './cards.js';

// ---- Card Instances (runtime, in-game) ----

/**
 * A runtime card instance, linking a unique in-game instance to its
 * static definition. Every card in every zone (hand, deck, discard, in-play)
 * is tracked as a CardInstance so the engine can distinguish between
 * multiple copies of the same card definition.
 */
export interface CardInstance {
  /** Globally unique identifier for this specific card in this game session. */
  readonly instanceId: CardInstanceId;
  /** Reference to the static card definition in `GameState.cardPool`. */
  readonly definitionId: CardDefinitionId;
}

// ---- Characters in play ----

/**
 * The full in-play state of a single character card.
 *
 * Characters exist within companies and can carry items, command allies,
 * have corruption cards attached, and control follower characters via
 * direct influence. The `controlledBy` field tracks the influence chain:
 * either under general influence or under a specific character's direct influence.
 */
/**
 * Computed effective stats for a character, including modifiers from
 * equipped items and attached corruption cards. Recomputed after every
 * action by {@link recomputeDerived}. Combat-time modifiers (tapped
 * penalty, support bonus) are NOT included — those are applied locally
 * during combat resolution.
 */
export interface EffectiveStats {
  /** Base prowess + sum of item prowess modifiers. */
  readonly prowess: number;
  /** Base body + sum of item body modifiers. */
  readonly body: number;
  /** Base direct influence (item DI modifiers not yet implemented). */
  readonly directInfluence: number;
  /** Sum of corruption points from all items and corruption cards. */
  readonly corruptionPoints: number;
}

/**
 * An item card currently in play, attached to a character.
 * Items provide stat modifiers and corruption points.
 */
export interface ItemInPlay {
  /** The card instance ID of this item. */
  readonly instanceId: CardInstanceId;
  /** Reference to the static item card definition. */
  readonly definitionId: CardDefinitionId;
  /** Current state of this item — untapped, tapped, or inverted. */
  readonly status: CardStatus;
}

/**
 * An ally card currently in play, traveling with a character.
 * Allies contribute prowess in combat and marshalling points.
 */
export interface AllyInPlay {
  /** The card instance ID of this ally. */
  readonly instanceId: CardInstanceId;
  /** Reference to the static ally card definition. */
  readonly definitionId: CardDefinitionId;
  /** Current state of this ally — untapped, tapped, or inverted. */
  readonly status: CardStatus;
}

/**
 * A card currently in play on the table, not attached to any character or company.
 * Examples include permanent resource events, factions, and other general cards
 * that persist between turns.
 */
export interface CardInPlay {
  /** The card instance ID of this card. */
  readonly instanceId: CardInstanceId;
  /** Reference to the static card definition. */
  readonly definitionId: CardDefinitionId;
  /** Current state of this card — untapped, tapped, or inverted. */
  readonly status: CardStatus;
}

export interface CharacterInPlay {
  /** The card instance ID of this character. */
  readonly instanceId: CardInstanceId;
  /** Reference to the static character card definition. */
  readonly definitionId: CardDefinitionId;
  /** Current tap state -- affects combat prowess and available actions. */
  readonly status: CardStatus;
  /** Items attached to this character (e.g. weapons, armor, rings). */
  readonly items: readonly ItemInPlay[];
  /** Allies traveling with this character. */
  readonly allies: readonly AllyInPlay[];
  /** Corruption hazard card instance IDs attached to this character, adding to their corruption total. */
  readonly corruptionCards: readonly CardInstanceId[];
  /** Character instance IDs controlled by this character via direct influence. */
  readonly followers: readonly CardInstanceId[];
  /**
   * How this character is controlled:
   * - `'general'` -- Under the player's 20-point general influence pool.
   * - A `CardInstanceId` -- Under the direct influence of another character.
   */
  readonly controlledBy: 'general' | CardInstanceId;
  /** Computed stats including item modifiers. Recomputed after every action. */
  readonly effectiveStats: EffectiveStats;
}

// ---- Company ----

/**
 * A company is a group of characters traveling together between sites.
 *
 * Companies are the fundamental unit of movement and action in MECCG.
 * During the Organization phase, players can split, merge, and reorganize
 * companies and plan their movement to new sites. During Movement/Hazard,
 * each company faces hazards individually based on their travel path.
 */
export interface Company {
  /** Unique identifier for this company. */
  readonly id: CompanyId;
  /** Character instance IDs belonging to this company (order matters for strike assignment). */
  readonly characters: readonly CardInstanceId[];
  /** The site card instance where this company is currently located. Null during setup before site selection. */
  readonly currentSite: CardInstanceId | null;
  /**
   * The planned destination site, set during Organization phase.
   * Null if the company is staying put this turn.
   */
  readonly destinationSite: CardInstanceId | null;
  /** Region card instances defining the travel path from current site to destination. */
  readonly movementPath: readonly CardInstanceId[];
  /** Whether this company has already completed movement this turn. */
  readonly moved: boolean;
}

// ---- Events in play (long/permanent) ----

/**
 * A long-duration or permanent event card currently in play.
 *
 * Short events resolve immediately and go to the discard pile, but long
 * and permanent events persist on the table and modify the game environment.
 * Long events are discarded during the Long-event phase; permanent events
 * remain until explicitly removed.
 */
export interface EventInPlay {
  /** The card instance ID of this event. */
  readonly instanceId: CardInstanceId;
  /** Reference to the static event card definition. */
  readonly definitionId: CardDefinitionId;
  /** The player who played this event. */
  readonly owner: PlayerId;
  /** If this event is attached to a specific card (e.g. a corruption card on a character). */
  readonly attachedTo?: CardInstanceId;
}

// ---- Marshalling Points ----

/**
 * Breakdown of a player's marshalling points (victory points) by category.
 *
 * In MECCG, points are scored from characters in play, items, factions,
 * allies, and creature kills. At the Free Council, the doubling rule applies:
 * each category is capped so it cannot exceed the total of all other categories.
 */
export interface MarshallingPointTotals {
  /** Points from hero characters in play. */
  readonly character: number;
  /** Points from items controlled by characters. */
  readonly item: number;
  /** Points from successfully influenced factions. */
  readonly faction: number;
  /** Points from allies attached to characters. */
  readonly ally: number;
  /** Points from defeating enemy creatures and automatic attacks. */
  readonly kill: number;
  /** Points from miscellaneous sources (events, special abilities). */
  readonly misc: number;
}

/** Zero effective stats, used for initialization before recomputeDerived runs. */
export const ZERO_EFFECTIVE_STATS: EffectiveStats = {
  prowess: 0,
  body: 0,
  directInfluence: 0,
  corruptionPoints: 0,
};

/** An empty marshalling point totals object, used for initialization. */
export const ZERO_MARSHALLING_POINTS: MarshallingPointTotals = {
  character: 0,
  item: 0,
  faction: 0,
  ally: 0,
  kill: 0,
  misc: 0,
};

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
  /** Card instance IDs currently in the player's hand (hidden from opponent). */
  readonly hand: readonly CardInstanceId[];
  /** The shuffled draw pile of resource and hazard cards (hidden from both players). */
  readonly playDeck: readonly CardInstanceId[];
  /** Face-up pile of discarded play deck cards. */
  readonly discardPile: readonly CardInstanceId[];
  /** The player's available site cards (hidden from opponent). */
  readonly siteDeck: readonly CardInstanceId[];
  /** Face-up pile of used/discarded site cards. */
  readonly siteDiscardPile: readonly CardInstanceId[];
  /** Reserve cards that can be fetched under specific game conditions. */
  readonly sideboard: readonly CardInstanceId[];
  /** All companies this player controls on the map. */
  readonly companies: readonly Company[];
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
   * Number of times this player's play deck has been exhausted (reshuffled from discard).
   * The game ends via Free Council when a player exhausts their deck twice.
   */
  readonly deckExhaustionCount: number;
  /** Whether this player has called the Free Council (endgame trigger). */
  readonly freeCouncilCalled: boolean;
}

// ---- Phases ----

/**
 * Enumeration of all game phases in MECCG.
 *
 * A normal turn follows the sequence: Untap -> Organization -> Long-event ->
 * Movement/Hazard -> Site -> End-of-Turn. The CharacterDraft phase occurs
 * before the game proper. FreeCouncil and GameOver are endgame phases.
 */
export enum Phase {
  /** Pre-game setup: character draft, item assignment, deck construction. */
  Setup = 'setup',
  /** Cards are untapped (refreshed) and inverted characters at havens may heal. */
  Untap = 'untap',
  /** Players reorganize companies, recruit characters, transfer items, and plan movement. */
  Organization = 'organization',
  /** Long events from the previous turn are discarded; new long events may take effect. */
  LongEvent = 'long-event',
  /** Companies move to their destinations while the opponent plays hazards (creatures, events) against them. */
  MovementHazard = 'movement-hazard',
  /** Companies at non-haven sites resolve automatic attacks and play resource cards. */
  Site = 'site',
  /** The active player draws/discards to reach hand size and may call the Free Council. */
  EndOfTurn = 'end-of-turn',
  /** Endgame phase where all characters face corruption checks and final marshalling points are tallied. */
  FreeCouncil = 'free-council',
  /** Terminal state -- the game is finished and a winner has been determined. */
  GameOver = 'game-over',
}

// ---- Setup phase sub-state ----

/**
 * Steps within the pre-game setup phase.
 * The setup progresses through these steps in order before the first turn.
 */
export enum SetupStep {
  /** Players simultaneously draft characters from their pool. */
  CharacterDraft = 'character-draft',
  /** Players assign starting minor items to drafted characters. */
  ItemDraft = 'item-draft',
  /** Players choose which remaining pool characters go into the play deck. */
  CharacterDeckDraft = 'character-deck-draft',
  /** Players select starting sites from their site deck and form initial companies. */
  StartingSiteSelection = 'starting-site-selection',
  /** Players assign characters to starting companies (only when 2 sites selected). */
  CharacterPlacement = 'character-placement',
  /** Both players shuffle their play decks. */
  DeckShuffle = 'deck-shuffle',
  /** Both players draw their initial hand. */
  InitialDraw = 'initial-draw',
  /** Players roll 2d6 to determine who goes first. Reroll on tie. */
  InitiativeRoll = 'initiative-roll',
}

/**
 * Per-player state during the character draft step.
 *
 * Before the game begins, both players simultaneously draft characters from
 * their pool. Each round, players make a face-down pick. If both picks are
 * different, both succeed. If they collide (same character), the duplicate
 * is set aside and neither player gets it. Players may stop drafting early.
 */
export interface DraftPlayerState {
  /** The character definition IDs available to draft from (up to 10). */
  readonly pool: readonly CardDefinitionId[];
  /** Character definition IDs successfully drafted so far. */
  readonly drafted: readonly CardDefinitionId[];
  /** The face-down pick for the current draft round, or null if not yet picked. */
  readonly currentPick: CardDefinitionId | null;
  /** Whether this player has voluntarily stopped drafting (they keep what they have). */
  readonly stopped: boolean;
}

/**
 * Per-player state during the item draft step.
 */
export interface ItemDraftPlayerState {
  /** Minor item instance IDs not yet assigned to a character. */
  readonly unassignedItems: readonly CardInstanceId[];
  /** Whether this player has finished assigning items (or had none). */
  readonly done: boolean;
}

/**
 * Per-player state during the character deck draft step.
 */
export interface CharacterDeckDraftPlayerState {
  /** Remaining pool characters available to add to the play deck. */
  readonly remainingPool: readonly CardDefinitionId[];
  /** Whether this player has finished adding characters. */
  readonly done: boolean;
}

/**
 * Per-player state during the starting site selection step.
 */
export interface SiteSelectionPlayerState {
  /** Sites selected so far (instance IDs). */
  readonly selectedSites: readonly CardInstanceId[];
  /** Whether this player has finished selecting sites. */
  readonly done: boolean;
}

// ---- Phase-specific state ----

/**
 * Setup phase step state — discriminated by the `step` field.
 */
export type SetupStepState =
  | {
      readonly step: SetupStep.CharacterDraft;
      /** Current draft round number (1-based). */
      readonly round: number;
      /** Draft state for each player (indexed by player order). */
      readonly draftState: readonly [DraftPlayerState, DraftPlayerState];
      /** Character definition IDs set aside due to collisions. */
      readonly setAside: readonly CardDefinitionId[];
    }
  | {
      readonly step: SetupStep.ItemDraft;
      /** Item assignment state for each player. */
      readonly itemDraftState: readonly [ItemDraftPlayerState, ItemDraftPlayerState];
      /** Characters remaining in each player's draft pool. */
      readonly remainingPool: readonly [readonly CardDefinitionId[], readonly CardDefinitionId[]];
    }
  | {
      readonly step: SetupStep.CharacterDeckDraft;
      /** Deck draft state for each player. */
      readonly deckDraftState: readonly [CharacterDeckDraftPlayerState, CharacterDeckDraftPlayerState];
    }
  | {
      readonly step: SetupStep.StartingSiteSelection;
      /** Site selection state for each player. */
      readonly siteSelectionState: readonly [SiteSelectionPlayerState, SiteSelectionPlayerState];
    }
  | {
      readonly step: SetupStep.CharacterPlacement;
      /** Whether each player has finished placing characters. */
      readonly placementDone: readonly [boolean, boolean];
    }
  | {
      readonly step: SetupStep.DeckShuffle;
      /** Whether each player has shuffled their play deck. */
      readonly shuffled: readonly [boolean, boolean];
    }
  | {
      readonly step: SetupStep.InitialDraw;
      /** Whether each player has drawn their initial hand. */
      readonly drawn: readonly [boolean, boolean];
    }
  | {
      readonly step: SetupStep.InitiativeRoll;
      /** Each player's 2d6 roll result, or null if not yet rolled. */
      readonly rolls: readonly [TwoDiceSix | null, TwoDiceSix | null];
    };

/**
 * Pre-game setup phase. Contains a `step` discriminant that tracks
 * which setup step is active (character draft → item draft → deck draft).
 */
export interface SetupPhaseState {
  /** Phase discriminant. */
  readonly phase: Phase.Setup;
  /** The current setup step and its associated state. */
  readonly setupStep: SetupStepState;
}

/**
 * State for the Untap phase. Minimal bookkeeping -- the engine automatically
 * untaps all tapped cards and heals inverted (wounded) characters at havens.
 */
export interface UntapPhaseState {
  /** Phase discriminant. */
  readonly phase: Phase.Untap;
}

/**
 * State for the Organization phase, where the active player reorganizes
 * companies, recruits characters, transfers items, and plans movement.
 */
export interface OrganizationPhaseState {
  /** Phase discriminant. */
  readonly phase: Phase.Organization;
  /**
   * Whether the active player has already played (or discarded) a character
   * this turn. Per CoE rule 2.II.2, only one character play/discard is
   * allowed per organization phase.
   */
  readonly characterPlayedThisTurn: boolean;
}

/**
 * State for the Long-event phase, where previously played long events
 * are removed and new long events may activate.
 */
export interface LongEventPhaseState {
  /** Phase discriminant. */
  readonly phase: Phase.LongEvent;
}

/**
 * State for the Movement/Hazard phase.
 *
 * Companies move one at a time. For each moving company, the opponent may
 * play hazard cards (up to the hazard limit, which equals the company size).
 * Creature hazards trigger the combat sub-state machine.
 */
export interface MovementHazardPhaseState {
  /** Phase discriminant. */
  readonly phase: Phase.MovementHazard;
  /** Index of the company currently resolving movement (companies move sequentially). */
  readonly activeCompanyIndex: number;
  /** Number of hazard cards the opponent has played against the current company this movement. */
  readonly hazardsPlayedThisCompany: number;
  /** Maximum hazards allowed against this company (equal to the number of characters in the company). */
  readonly hazardLimit: number;
  /** Active combat sub-state, or null when no combat is in progress. */
  readonly combat: CombatState | null;
}

/**
 * State for the Site phase.
 *
 * Each company at a non-haven site may attempt to play resources after
 * resolving automatic attacks. Only one resource (item, faction, ally)
 * can typically be played per company per site phase.
 */
export interface SitePhaseState {
  /** Phase discriminant. */
  readonly phase: Phase.Site;
  /** Index of the company currently resolving site actions. */
  readonly activeCompanyIndex: number;
  /** Number of automatic attacks already resolved at the current site. */
  readonly automaticAttacksResolved: number;
  /** Whether a resource has already been played by the current company this phase. */
  readonly resourcePlayed: boolean;
  /** Active combat sub-state (from automatic attacks), or null when no combat is in progress. */
  readonly combat: CombatState | null;
}

/**
 * State for the End-of-Turn phase, where the active player draws or
 * discards to reach their hand limit and may call the Free Council.
 */
export interface EndOfTurnPhaseState {
  /** Phase discriminant. */
  readonly phase: Phase.EndOfTurn;
}

/**
 * State for the Free Council (endgame) phase.
 *
 * All characters must make corruption checks. Final marshalling points
 * are tallied across all categories. If scores are tied, a tiebreaker
 * round may occur.
 */
export interface FreeCouncilPhaseState {
  /** Phase discriminant. */
  readonly phase: Phase.FreeCouncil;
  /** Whether the Free Council is in a tiebreaker round. */
  readonly tiebreaker: boolean;
}

/**
 * Terminal state after the game has ended.
 * Contains the final scores and the winner (or null for a draw).
 */
export interface GameOverPhaseState {
  /** Phase discriminant. */
  readonly phase: Phase.GameOver;
  /** The winning player's ID, or null if the game ended in a draw. */
  readonly winner: PlayerId | null;
  /** Final marshalling point totals for each player, keyed by PlayerId. */
  readonly finalScores: Readonly<Record<string, number>>;
}

/**
 * Discriminated union of all phase-specific state objects.
 * The `phase` field serves as the discriminant for type narrowing.
 */
export type PhaseState =
  | SetupPhaseState
  | UntapPhaseState
  | OrganizationPhaseState
  | LongEventPhaseState
  | MovementHazardPhaseState
  | SitePhaseState
  | EndOfTurnPhaseState
  | FreeCouncilPhaseState
  | GameOverPhaseState;

// ---- Combat sub-state ----

/**
 * Identifies what initiated a combat encounter.
 *
 * Combat can be triggered by:
 * - A creature hazard card played by the opponent during Movement/Hazard phase.
 * - An automatic attack built into a site card during the Site phase.
 */
export type AttackSource =
  | { readonly type: 'creature'; readonly instanceId: CardInstanceId }
  | { readonly type: 'automatic-attack'; readonly siteInstanceId: CardInstanceId; readonly attackIndex: number };

/**
 * Tracks the assignment and resolution of a single strike against a character.
 *
 * During the 'assign-strikes' sub-phase, each strike is paired with a defending
 * character. During 'resolve-strike', the 2d6 + prowess roll determines the outcome.
 */
export interface StrikeAssignment {
  /** The character instance ID assigned to receive this strike. */
  readonly characterId: CardInstanceId;
  /** Whether this strike has been resolved via dice roll. */
  readonly resolved: boolean;
  /**
   * The outcome of the strike resolution:
   * - `'success'` -- The character defeated the strike (no damage).
   * - `'wounded'` -- The character survived but is wounded (reduced capability).
   * - `'eliminated'` -- The character was killed and removed from play.
   */
  readonly result?: 'success' | 'wounded' | 'eliminated';
}

/**
 * The combat sub-state machine, nested within MovementHazardPhaseState
 * or SitePhaseState when a creature attack or automatic attack is being resolved.
 *
 * Combat proceeds through three sub-phases:
 * 1. `'assign-strikes'` -- The defending player assigns each strike to a character.
 * 2. `'resolve-strike'` -- Each strike is resolved one at a time (2d6 + prowess vs creature prowess).
 * 3. `'body-check'` -- For successful strikes, a body check determines if the character is wounded or eliminated.
 */
export interface CombatState {
  /** What initiated this combat (creature card or automatic site attack). */
  readonly attackSource: AttackSource;
  /** Total number of strikes the creature/attack delivers. */
  readonly strikesTotal: number;
  /** The prowess value of each strike (from the creature's stats or automatic attack). */
  readonly strikeProwess: number;
  /** The assignment of each strike to a defending character, with resolution status. */
  readonly strikeAssignments: readonly StrikeAssignment[];
  /** Index into strikeAssignments for the strike currently being resolved. */
  readonly currentStrikeIndex: number;
  /** Which sub-phase of combat resolution is active. */
  readonly phase: 'assign-strikes' | 'resolve-strike' | 'body-check';
}

// ---- Pending effects ----

/**
 * A queued game effect waiting to be resolved.
 *
 * Some actions trigger effects that require additional input or sequencing
 * (e.g. a card ability that triggers after combat). Pending effects are
 * processed in order before the game continues.
 */
export interface PendingEffect {
  /** Discriminant identifying the type of effect to resolve. */
  readonly type: string;
  /** Effect-specific payload data. */
  readonly data: unknown;
}

// ---- RNG ----

/**
 * Deterministic random number generator state.
 *
 * Using a seeded PRNG ensures that dice rolls and shuffles are reproducible
 * for replays, debugging, and testing. The counter increments with each
 * random number consumed.
 */
export interface RngState {
  /** The initial seed value for the PRNG algorithm. */
  readonly seed: number;
  /** Number of random values consumed so far (used to advance the PRNG sequence). */
  readonly counter: number;
}

// ---- Full Game State ----

/**
 * The complete, authoritative game state maintained by the server.
 *
 * This is the single source of truth for the entire game. The engine is a
 * pure reducer: `(GameState, GameAction) -> GameState`. The state includes
 * all hidden information (both players' hands, deck contents, etc.) and is
 * never sent directly to clients -- instead, a projection function produces
 * a per-player `PlayerView` with hidden information redacted.
 */
export interface GameState {
  /** Unique identifier for this game session, shared with all clients. */
  readonly gameId: string;
  /** Both players' complete state, as a fixed-size tuple. */
  readonly players: readonly [PlayerState, PlayerState];
  /** The player whose turn it currently is, or null during simultaneous phases (e.g. character draft). */
  readonly activePlayer: PlayerId | null;
  /** The current phase and its phase-specific bookkeeping state. */
  readonly phaseState: PhaseState;
  /** Long-duration and permanent event cards currently in play on the table. */
  readonly eventsInPlay: readonly EventInPlay[];
  /** The static card definition pool, keyed by CardDefinitionId. Loaded once at game start. */
  readonly cardPool: Readonly<Record<string, CardDefinition>>;
  /** Map from CardInstanceId to CardInstance, for resolving instance IDs to definitions. */
  readonly instanceMap: Readonly<Record<string, CardInstance>>;
  /** Current turn number (1-based), incremented each time the active player changes. */
  readonly turnNumber: number;
  /** Queue of effects waiting to be resolved before the game can proceed. */
  readonly pendingEffects: readonly PendingEffect[];
  /** Deterministic RNG state for reproducible dice rolls and shuffles. */
  readonly rng: RngState;
  /** Monotonically increasing sequence number for state changes, used for log replay. */
  readonly stateSeq: number;
}
