/**
 * @module state-phases
 *
 * Phase enums and phase-specific state types for the MECCG engine.
 * Each game phase has its own state interface tracking phase-specific
 * bookkeeping. The PhaseState discriminated union encompasses all phases.
 */

import {
  PlayerId,
  CardInstanceId,
  CompanyId,
  CardDefinitionId,
  TwoDiceSix,
  RegionType,
  SiteType,
  MovementType,
} from './common.js';
// ViewCard is used indirectly via SiteSelectionPlayerState
import type {
  CardInstance,
  DraftPlayerState,
  ItemDraftPlayerState,
  CharacterDeckDraftPlayerState,
  SiteSelectionPlayerState,
} from './state-cards.js';

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
      /** Cards set aside due to collisions. */
      readonly setAside: readonly CardInstance[];
    }
  | {
      readonly step: SetupStep.ItemDraft;
      /** Item assignment state for each player. */
      readonly itemDraftState: readonly [ItemDraftPlayerState, ItemDraftPlayerState];
      /** Characters remaining in each player's draft pool. */
      readonly remainingPool: readonly [readonly CardInstance[], readonly CardInstance[]];
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
 * State for the Untap phase. The resource player must explicitly untap
 * their cards, and the hazard player may access their sideboard.
 */
export interface UntapPhaseState {
  /** Phase discriminant. */
  readonly phase: Phase.Untap;
  /** Whether the resource player has executed the untap action. */
  readonly untapped: boolean;
  /**
   * Which destination the hazard player chose for sideboard access, or null
   * if not yet declared. Set by start-hazard-sideboard-to-deck/discard.
   */
  readonly hazardSideboardDestination: 'discard' | 'deck' | null;
  /**
   * How many hazard cards have been fetched from the sideboard this untap.
   * Used to enforce the limit of 5 to discard or 1 to deck.
   */
  readonly hazardSideboardFetched: number;
  /** Whether the hazard player has already accessed the sideboard this untap phase. */
  readonly hazardSideboardAccessed: boolean;
  /** Whether the active (resource) player has passed the untap phase (after untapping). */
  readonly resourcePlayerPassed: boolean;
  /** Whether the non-active (hazard) player has passed the untap phase. */
  readonly hazardPlayerPassed: boolean;
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
  /**
   * How many cards have been fetched from the sideboard this turn via
   * the avatar tap action (CoE 2.II.6). Used to enforce the limit of
   * 5 cards to discard or 1 card to deck.
   */
  readonly sideboardFetchedThisTurn: number;
  /**
   * Which destination was chosen for sideboard access this turn.
   * Once a destination is chosen, the player must continue with the
   * same destination (cannot mix discard and deck in one tap).
   * Null if no sideboard access has occurred this turn.
   */
  readonly sideboardFetchDestination: 'discard' | 'deck' | null;
  /**
   * The active sub-step within the organization phase.
   *
   * - `'play-actions'` (default): the active player is taking their
   *   normal organization actions (play character, transfer item,
   *   plan movement, etc.).
   * - `'end-of-org'`: the active player has finished their normal
   *   actions and the engine has opened a window for short-events
   *   that are explicitly tagged as end-of-organization plays
   *   (e.g. *Stealth*). Passing during this step advances to the
   *   Long-event phase.
   *
   * Older callers may omit this field; it defaults to `'play-actions'`.
   */
  readonly step?: 'play-actions' | 'end-of-org';
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
/**
 * Steps within a single company's Movement/Hazard sub-phase.
 *
 * When a company has planned movement, the new site is first revealed
 * (step 1), then the resource player declares the movement type and
 * site path (step 2 of the CoE rules). After that, the engine
 * auto-processes steps 3–6 and enters the interactive play-hazards step.
 * Non-moving companies skip straight to play-hazards.
 */
export type MHStep =
  /**
   * The resource player must choose which company resolves its
   * movement/hazard sub-phase next. Only companies that have not
   * yet been handled this turn are offered as candidates.
   * There is no pass action during this step — a company must be selected.
   */
  | 'select-company'
  /**
   * CoE step 1: the new site card is revealed (turned face-up).
   * Triggering events and under-deeps movement rolls happen here.
   * Currently auto-advances to declare-path — no player actions required.
   *
   * TODO: triggering events on site reveal
   * TODO: under-deeps movement roll (stay if roll < site number)
   */
  | 'reveal-new-site'
  /**
   * CoE step 3: the base hazard limit is computed from the company's
   * current size (max of size or 2), halved (rounded up) if the hazard
   * player accessed the sideboard during this turn's untap phase.
   * The limit is fixed for the entire company's M/H phase.
   * This is an immediate step — only a pass action is available.
   */
  | 'set-hazard-limit'
  /**
   * The hazard player must choose the order in which to apply ongoing
   * effects that trigger at the start of this company's M/H phase
   * (CoE step 4). Skipped automatically when there are zero or one
   * applicable effects.
   */
  | 'order-effects'
  /**
   * CoE step 5: both players draw cards based on the site if the company
   * is moving. The resource player draws up to the lighter box number,
   * the hazard player draws up to the darker box number (at least 1 each
   * unless an effect reduces it). This is an immediate step.
   *
   * TODO: actually draw cards based on site card box numbers
   */
  | 'draw-cards'
  /**
   * Step 6 has been auto-processed (passive conditions resolved).
   * Both players may now take actions:
   * the hazard player plays creatures/events/on-guard cards, and the
   * resource player may respond. Ends when both players pass.
   */
  | 'play-hazards'
  /**
   * CoE step 8: end of company's M/H phase. Movement is completed
   * (site of origin handled), then both players reset hands to base
   * hand size. Players with excess cards must choose which to discard.
   * Drawing up is automatic. Advances to next company or Site phase
   * once both players are at hand size.
   */
  | 'reset-hand';

export interface MovementHazardPhaseState {
  /** Phase discriminant. */
  readonly phase: Phase.MovementHazard;
  /**
   * Which sub-step of the company's M/H phase is active.
   * - `'reveal-new-site'`: new site is revealed (CoE step 1).
   * - `'declare-path'`: resource player must declare movement type and path.
   * - `'order-effects'`: hazard player orders ongoing effects (step 4).
   * - `'play-hazards'`: main interactive step where hazards are played.
   */
  readonly step: MHStep;
  /** Index of the company currently resolving movement (companies move sequentially). */
  readonly activeCompanyIndex: number;
  /**
   * IDs of companies that have already completed their M/H sub-phase this turn.
   * Used during the 'select-company' step to filter out handled companies,
   * so the resource player only chooses among those still pending.
   */
  readonly handledCompanyIds: readonly CompanyId[];
  /**
   * The movement type declared by the resource player at step 2, or null
   * if not yet declared or the company is not moving.
   */
  readonly movementType: MovementType | null;
  /**
   * For region movement: the ordered sequence of region card definition IDs
   * forming the declared travel path. Empty for starter movement or when
   * not yet declared.
   */
  readonly declaredRegionPath: readonly CardDefinitionId[];
  /**
   * Maximum number of consecutive regions this company may traverse
   * (rules-style: origin and destination both count). Computed at the
   * start of the company's M/H sub-phase from {@link BASE_MAX_REGION_DISTANCE}
   * plus any card-effect modifiers. Used to validate region paths during
   * the declare-path step.
   */
  readonly maxRegionDistance: number;
  /** Number of hazard cards the opponent has played against the current company this movement. */
  readonly hazardsPlayedThisCompany: number;
  /**
   * Maximum hazards allowed against this company.
   * Computed as max(company_size, 2), halved (rounded up) if the hazard player
   * accessed the sideboard during the current turn's untap phase.
   * Fixed for the entire company's M/H phase even if characters are eliminated.
   */
  readonly hazardLimit: number;
  /**
   * Resolved site path: the sequence of region types the company traverses.
   * Empty if the company is not moving.
   * Computed at step 2 from the site card (starter movement) or the declared
   * region path (region movement). Used to validate creature keying.
   */
  readonly resolvedSitePath: readonly RegionType[];
  /**
   * Region names in the site path, for creature keying by name.
   * For region movement, contains the names of all regions traversed.
   * For starter movement, contains the origin and destination region names.
   * Empty if not moving.
   */
  readonly resolvedSitePathNames: readonly string[];
  /**
   * Site type of the destination (or current site if not moving).
   * Used to validate creature keying to site type.
   */
  readonly destinationSiteType: SiteType | null;
  /**
   * Name of the destination site (or current site if not moving).
   * Used to validate creature keying to site name.
   */
  readonly destinationSiteName: string | null;
  /**
   * Maximum cards the resource player may draw during step 5 (draw-cards).
   * Derived from the site card's lighter box number. Zero if the company
   * is not moving or has no eligible characters (avatar or mind ≥ 3).
   */
  readonly resourceDrawMax: number;
  /**
   * Maximum cards the hazard player may draw during step 5 (draw-cards).
   * Derived from the site card's darker box number. Zero if the company
   * is not moving.
   */
  readonly hazardDrawMax: number;
  /** Number of cards the resource player has drawn so far during step 5. */
  readonly resourceDrawCount: number;
  /** Number of cards the hazard player has drawn so far during step 5. */
  readonly hazardDrawCount: number;
  /**
   * Whether the resource player has declared done with actions.
   * Resets to false if the resource player takes a new action after passing.
   */
  readonly resourcePlayerPassed: boolean;
  /**
   * Whether the hazard player has declared done with actions.
   * The hazard player may resume taking actions if the resource player
   * acts after the hazard player passed.
   */
  readonly hazardPlayerPassed: boolean;
  /**
   * Whether an on-guard card has been placed during this company's M/H phase.
   * Only one on-guard placement is allowed per company per M/H phase.
   */
  readonly onGuardPlacedThisCompany: boolean;
  /**
   * Whether the active company's destination site has been revealed
   * (turned face-up) during the reveal-new-site step. Once true, the
   * destination site identity is visible to both players for the
   * remainder of this company's M/H sub-phase. Reset when the next
   * company begins.
   */
  readonly siteRevealed: boolean;
  /**
   * Whether the company was returned to its site of origin during this
   * M/H phase. If true, the phase ends immediately and the company cannot
   * take actions during its site phase.
   */
  readonly returnedToOrigin: boolean;
}

/**
 * Steps within a single company's site phase.
 *
 * Each company resolves its site phase sequentially. The resource player
 * first decides whether to enter the site or do nothing. If entering,
 * the company proceeds through on-guard reveals, automatic attacks,
 * agent attacks, and then resource play.
 *
 * CoE rules section 2.V (lines 340–393).
 */
export type SiteStep =
  /**
   * The resource player chooses which company resolves its site phase
   * next. Only companies that have not yet been handled are offered.
   * There is no pass action — a company must be selected.
   */
  | 'select-company'
  /**
   * The resource player declares whether the company will enter its
   * current site or do nothing. Doing nothing ends the company's site
   * phase immediately (CoE lines 341–343).
   */
  | 'enter-or-skip'
  /**
   * Step 1 (CoE line 345): If the site has automatic-attacks, the hazard
   * player may reveal on-guard cards that are either creatures keyed to
   * the site or events affecting the automatic-attacks. No other actions
   * are legal. Skipped if the site has no automatic-attacks.
   */
  | 'reveal-on-guard-attacks'
  /**
   * Step 2 (CoE line 350): Automatic-attacks are initiated and resolved
   * one at a time in the order listed on the site card. Each triggers the
   * combat sub-state. Once all are faced (regardless of outcome), the
   * company has "successfully entered" the site.
   */
  | 'automatic-attacks'
  /**
   * Step 3 (CoE line 358): After automatic-attacks (or if none), the
   * hazard player may declare that an agent at the company's site will
   * attack. The agent must be revealed if not already revealed.
   */
  | 'declare-agent-attack'
  /**
   * Step 4 (CoE line 361): On-guard creature and agent attacks declared
   * earlier are resolved in an order chosen by the resource player.
   * Each triggers the combat sub-state.
   */
  | 'resolve-attacks'
  /**
   * After all entry attacks are resolved, the resource player may play
   * one resource (ally, faction, item) that taps an untapped character
   * and site. The hazard player may reveal on-guard events when a
   * resource is declared (CoE line 376). Faction plays require an
   * influence check roll.
   */
  | 'play-resources'
  /**
   * After a resource that taps the site is successfully played, one
   * additional character may tap to play a minor item (CoE line 373).
   * At Under-deeps sites, any playable item may be played instead.
   */
  | 'play-minor-item';

/**
 * State for the Site phase.
 *
 * Each company resolves its site phase sequentially. The resource player
 * chooses the order. For each company, the player decides whether to
 * enter the site (facing automatic attacks, on-guard creatures, and
 * agent attacks) or do nothing. After entering, resources may be played.
 *
 * CoE rules section 2.V (lines 340–393).
 */
export interface SitePhaseState {
  /** Phase discriminant. */
  readonly phase: Phase.Site;
  /** Which sub-step of the company's site phase is active. */
  readonly step: SiteStep;
  /** Index of the company currently resolving site actions. */
  readonly activeCompanyIndex: number;
  /**
   * IDs of companies that have already completed their site phase this turn.
   * Used during the 'select-company' step to filter out handled companies.
   */
  readonly handledCompanyIds: readonly CompanyId[];
  /** Number of automatic attacks already resolved at the current site. */
  readonly automaticAttacksResolved: number;
  /** Whether the company has successfully entered the site (past all auto-attacks). */
  readonly siteEntered: boolean;
  /** Whether a resource that taps the site has been played by the current company. */
  readonly resourcePlayed: boolean;
  /**
   * Whether an additional minor item opportunity is available.
   * Set to true after a resource that taps the site is successfully played.
   */
  readonly minorItemAvailable: boolean;
  /**
   * Agent instance ID declared as attacking in step 3, or null if no
   * agent attack was declared.
   */
  readonly declaredAgentAttack: CardInstanceId | null;
  /**
   * **Deprecated** — the on-guard reveal window is now stored as a
   * {@link PendingResolution} of kind `on-guard-window` in
   * `state.pendingResolutions`. This field is retained as `false` for
   * save-format backwards compatibility and is no longer read by the
   * engine.
   */
  readonly awaitingOnGuardReveal: false;
  /**
   * **Deprecated** — the deferred resource action is now carried on
   * the `on-guard-window` pending resolution. Retained as `null` for
   * save-format backwards compatibility.
   */
  readonly pendingResourceAction: null;
  /**
   * Tracks whether the resource player has made an opponent influence
   * attempt or company-vs-company attack this turn. At most one such
   * interaction is allowed per turn (CoE rule 10.10 bullet 3).
   * Null means no interaction has occurred yet.
   */
  readonly opponentInteractionThisTurn: 'influence' | 'attack' | null;
  /**
   * Intermediate state while awaiting the hazard player's defensive roll
   * during an opponent influence attempt. **Deprecated** — the engine
   * now stores the attempt as a {@link PendingResolution} of kind
   * `opponent-influence-defend` in `state.pendingResolutions`. This
   * field is retained as `null` for save-format backwards compatibility
   * but is no longer read by the engine.
   *
   * The full payload shape lives in {@link OpponentInfluenceAttempt}
   * (`types/pending.ts`).
   */
  readonly pendingOpponentInfluence: null;
}

/**
 * Sub-steps within the End-of-Turn phase (CoE 2.VI.i–iii):
 *
 * 1. **discard** — Either player may voluntarily discard a card from hand.
 * 2. **reset-hand** — Both players draw or discard to base hand size (8).
 * 3. **signal-end** — Resource player signals end of turn; end-of-turn
 *    passive conditions resolve. May also call the Free Council.
 */
export type EndOfTurnStep = 'discard' | 'reset-hand' | 'signal-end';

/**
 * State for the End-of-Turn phase, where both players adjust their hands
 * and the resource player may call the Free Council.
 *
 * Proceeds through three steps: discard → reset-hand → signal-end.
 */
export interface EndOfTurnPhaseState {
  /** Phase discriminant. */
  readonly phase: Phase.EndOfTurn;
  /** Current sub-step within the end-of-turn sequence. */
  readonly step: EndOfTurnStep;
  /**
   * Per-player done flags for the discard step (CoE 2.VI.1).
   * Each element is true once that player has discarded or passed.
   * Advance to reset-hand when both are true.
   */
  readonly discardDone: readonly [boolean, boolean];
  /**
   * Per-player done flags for the reset-hand step (CoE 2.VI.2).
   * Each element is true once that player has drawn/discarded to hand size or passed.
   * Advance to signal-end when both are true.
   */
  readonly resetHandDone: readonly [boolean, boolean];
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
  /** Current step within the Free Council sequence. */
  readonly step: 'corruption-checks' | 'done';
  /** Which player is currently performing corruption checks. */
  readonly currentPlayer: PlayerId;
  /** Character instance IDs that have already been checked for corruption. */
  readonly checkedCharacters: readonly string[];
  /** Whether the first player has finished their corruption checks. */
  readonly firstPlayerDone: boolean;
  /**
   * A corruption check that has been declared but not yet resolved.
   * While pending, other untapped characters in the same company may
   * tap for +1 support each (CoE rule 7.1.1). Null when no check is
   * awaiting resolution.
   */
  readonly pendingCheck: {
    readonly characterId: CardInstanceId;
    readonly corruptionPoints: number;
    readonly corruptionModifier: number;
    readonly possessions: readonly CardInstanceId[];
    readonly need: number;
    readonly explanation: string;
    /** Number of characters that have tapped for support so far. */
    readonly supportCount: number;
  } | null;
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
  /** Players who have acknowledged the result by sending 'finished'. */
  readonly finishedPlayers: readonly string[];
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
