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
  WinReason,
  ById,
  ByPlayerId,
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
      /**
       * Cards set aside due to collisions, per player. On a collision both
       * players' picks are preserved: `setAside[0]` holds player 0's set-aside
       * instances, `setAside[1]` holds player 1's. Each instance must remain
       * findable in game state for the lifetime of the game.
       */
      readonly setAside: readonly [readonly CardInstance[], readonly CardInstance[]];
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
      /**
       * Character instance IDs each player has already explicitly placed into
       * their chosen company during this step, indexed by player. A character
       * may be placed at most once so that placement makes monotonic progress
       * and can never cycle: without this mark, the reversible place-character
       * moves let a player (notably an AI) shuffle characters between companies
       * forever without ever converging. Every valid starting-company partition
       * remains reachable because each unplaced character is offered every
       * company it is not currently in, and its single placement is final.
       */
      readonly placed: readonly [readonly CardInstanceId[], readonly CardInstanceId[]];
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
   * MEBA §characters: count of characters brought into play this organization
   * phase. A Balrog player may bring up to **two** characters into play per
   * organization phase (the second must be non-unique), so the engine tracks
   * the running count rather than just the one-character boolean. Optional —
   * treated as `characterPlayedThisTurn ? 1 : 0` when absent.
   */
  readonly charactersBroughtIntoPlayThisTurn?: number;
  /**
   * Definition IDs of characters belonging to a buddy-play group that has
   * been played this turn. When a character carrying the `buddy-play` flag
   * is played, all definition IDs in its `companions` list (and its own ID)
   * are added here. Other characters in that group may then be played in
   * the same turn without consuming the one-character-per-turn slot.
   *
   * Optional — absent on states created before this field was added, treated
   * as an empty array.
   */
  readonly buddyGroupPlayedThisTurn?: readonly string[];
  /**
   * The definition ID of the character played this turn, if any. Used to
   * enable the troll-triplet co-play exception: Bûrat, Tûma, and Wûluag
   * may be played on the same turn as each other without counting against
   * the one-character-per-turn limit.
   */
  readonly lastPlayedCharacterDefinitionId?: string;
  /**
   * How many cards have been fetched from the sideboard this turn via
   * the avatar tap action (CoE 2.II.6). Used to enforce the limit of
   * 5 cards to discard or 1 card to deck.
   */
  readonly sideboardFetchedThisTurn: number;
  /**
   * Instance IDs of in-play permanent-events whose optional
   * `org-phase-fetch` activation (e.g. A Strident Spawn wh-61's "take one
   * Half-orc from your discard pile to your hand") has already been used this
   * organization phase. Each source may be activated at most once per turn.
   * Optional — absent on states created before this field was added (treated
   * as empty).
   */
  readonly discardFetchUsedThisTurn?: readonly CardInstanceId[];
  /**
   * Which destination was chosen for sideboard access this turn.
   * Once a destination is chosen, the player must continue with the
   * same destination (cannot mix discard and deck in one tap).
   * Null if no sideboard access has occurred this turn.
   */
  readonly sideboardFetchDestination: 'discard' | 'deck' | null;
  /**
   * Enchanted Stream (as-27) movement tax: how many of a company's untapped
   * characters have been tapped toward the tax this organization phase, keyed
   * by company id. A company bound by a `company-movement-tax` permanent event
   * may not voluntarily declare movement or split until this reaches the
   * effect's `taxTapCharacters` (or the company has no untapped character left
   * to tap). Reset each organization phase (the phase state is rebuilt on
   * entry). Optional — absent/`{}` means no tax has been paid yet.
   */
  readonly movementTaxPaid?: Readonly<Record<string, number>>;
  /**
   * The Lidless Eye (le-203) / Sauron (ba-43): "Once during each of your
   * organization phases, you may..." — whether that dual-mode granted ability
   * (sideboard-fetch or peek-opponent-hand) has already been used this
   * organization phase. Fresh each org phase (the phase state is rebuilt on
   * entry), so no manual reset is needed. Optional — absent/false means unused.
   */
  readonly sauronOrgActionUsed?: boolean;
  /**
   * The active sub-step within the organization phase.
   *
   * - `'play-actions'` (default): the active player is taking their
   *   normal organization actions (play character, transfer item,
   *   plan movement, end-of-organization plays such as *Stealth*, etc.).
   *
   * Per CoE 2.II.7 the resource player may declare movement and otherwise
   * organize at any point during the organization phase, including after
   * playing an "end of the organization phase" card. The engine therefore
   * does not lock the player into a separate end-of-org window; such cards
   * are offered alongside all other organization actions and the phase
   * advances to Long-event only when the active player passes.
   *
   * The `'end-of-org'` value is retained for backward compatibility with
   * older serialized states; it is no longer produced by the engine and is
   * treated identically to `'play-actions'`.
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
   */
  | 'reveal-new-site'
  /**
   * Under-deeps movement roll step (CoE 2.IV.i.1): after the new
   * Under-deeps site is revealed, the resource player rolls 2d6. If the
   * result is less than the required number on the origin site card,
   * the company stays and the destination is returned to the location deck.
   * Only entered when the origin is an Under-deeps site and the required
   * roll is > 0. Advances to `set-hazard-limit` on success or back to
   * `select-company` on failure.
   */
  | 'under-deeps-roll'
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
  | 'reset-hand'
  /**
   * Gangways over the Fire (ba-60): after a moving company completes its
   * movement/hazard phase, if the active player has an
   * `extra-under-deeps-mh-phase` effect in play the company may attempt
   * another Under-deeps movement to a site it has not used this turn. The
   * active player either selects a new Under-deeps destination
   * (`gangways-extra-move`) — re-entering the phase at `reveal-new-site` with
   * a cumulative roll penalty — or passes to finish the company.
   */
  | 'gangways-offer'
  /**
   * `grant-extra-mh-phase` resources (Forced March le-185, Bridge tw-202, Leg
   * It Double Quick le-202, Ûvatha Unleashed le-248): after a company that
   * moved to the qualifying site (e.g. a Darkhaven) completes its M/H phase,
   * the active player may send it on another movement to an additional site —
   * a fresh movement/hazard phase — by choosing a new destination
   * (`extra-mh-move`), or pass to finish the company.
   */
  | 'extra-mh-move-offer';

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
   * Snapshot of the hazard limit captured when the company revealed its
   * new site / announced its movement-hazard phase (METD §5).
   *
   * Computed as `max(companySize, 2)`, halved (rounded up) if the hazard
   * player accessed the sideboard during this turn's untap phase, plus
   * any `hazard-limit-modifier` constraints that were already active at
   * snapshot time (the "pre-reveal" modifiers).
   *
   * Fixed for the entire company's M/H phase even if characters are
   * eliminated. Post-reveal hazard-limit modifiers — those whose
   * constraints land *after* this snapshot — accumulate on top via
   * {@link currentHazardLimit} for future hazard plays in the same
   * M/H phase but never retroactively cancel hazards already announced.
   */
  readonly hazardLimitAtReveal: number;
  /**
   * IDs of `hazard-limit-modifier` constraints whose values were folded
   * into {@link hazardLimitAtReveal} at snapshot time. Used by
   * `currentHazardLimit` to avoid double-counting these constraints when
   * summing the post-reveal additions.
   */
  readonly preRevealHazardLimitConstraintIds: readonly string[];
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
   * Present during the `under-deeps-roll` step only.
   * The minimum 2d6 result the resource player must roll for the company
   * to successfully complete Under-deeps movement. On failure the
   * destination is returned to the location deck and the company stays.
   */
  readonly underDeepsRollRequired?: number;
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
  /**
   * Names of hazard cards whose combat has finalized against the current
   * company during this M/H sub-phase. Used by effects that check whether
   * the company already faced a specific hazard (e.g. troll-trio).
   */
  readonly hazardsEncountered: readonly string[];
  /**
   * Instance IDs of in-play permanent-events (Monstrosity of Diverse Shape,
   * ba-21) that have already used their once-per-turn
   * `grant-replay-attacked-creature` replay against the current company this
   * M/H sub-phase. Reset alongside {@link hazardsEncountered} whenever a new
   * company's M/H phase begins. Absent is treated as an empty list.
   */
  readonly spawnReplayUsedSources?: readonly CardInstanceId[];
  /**
   * Number of ahunt-attack effects resolved during the order-effects step.
   * Tracks progress through the list of matching ahunt long-events so
   * combat is initiated one at a time.
   */
  readonly ahuntAttacksResolved: number;
  /**
   * Per-attack outcomes for ahunt attacks resolved during the current company's
   * order-effects step, keyed by the source card instance. Accumulated by
   * `finalizeCombat` and consumed by `handleOrderEffects` to evaluate ahunt
   * group rewards (e.g. Mordor in Arms dm-72 — "if all three attacks are
   * defeated, the opponent receives this card in his MP pile"). Reset when a
   * new company is selected. Optional so pre-existing initializers need not set it.
   */
  readonly ahuntGroupOutcomes?: readonly { readonly instanceId: CardInstanceId; readonly defeated: boolean }[];
  /**
   * Set of character instance IDs that have already had a corruption card played
   * on them during this turn (CoE rule 7.2.1: only one corruption card per character per turn).
   * Persists across all companies' M/H phases within the same turn.
   */
  readonly corruptionCardsPlayedPerChar: ById<true>;
  /**
   * Rule 5.24 (Sideboarding with a Nazgûl): which sub-flow is active after
   * the hazard player taps and discards a Nazgûl permanent-event, or `null`
   * when no such sub-flow is in progress. `'discard'` allows fetching up to
   * five hazards to the discard pile (see {@link nazgulSideboardFetched});
   * `'deck'` allows fetching exactly one hazard directly into the play deck
   * (then auto-exits after shuffling).
   */
  readonly nazgulSideboardDestination: 'discard' | 'deck' | null;
  /** Number of cards fetched so far during the active Nazgûl sideboard sub-flow. */
  readonly nazgulSideboardFetched: number;
  /**
   * Gangways over the Fire (ba-60): number of complete movement/hazard phases
   * each company has taken so far this turn, keyed by company id. Incremented
   * when a company finishes its M/H phase (whether or not it moved). The count
   * for a company is subtracted from that company's Under-deeps movement rolls
   * on any extra Gangways phase. Absent for games without the effect in play.
   */
  readonly gangwaysPhaseCounts?: { readonly [companyId: string]: number };
  /**
   * Gangways over the Fire (ba-60): site definition ids each company has
   * occupied so far this turn, keyed by company id. A Gangways extra move may
   * only target an Under-deeps site the company has not used yet this turn, so
   * these sites are excluded from the offered destinations. Absent for games
   * without the effect in play.
   */
  readonly gangwaysSitesUsed?: { readonly [companyId: string]: readonly CardDefinitionId[] };
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
   * Siege window (Siege tw-87). A card besieging the company's current site
   * (`site-phase-start-attack`, bound via `CardInPlay.attachedToSite`) forces
   * the company to face its attack "at the beginning of its site phase" —
   * before the enter-or-skip decision, so doing nothing at the site does not
   * avoid it. The attacks are sequenced one at a time (mirroring
   * 'automatic-attacks'); once all are faced, control passes to
   * 'enter-or-skip'. Skipped entirely when no siege binds the site.
   */
  | 'siege-attacks'
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
   * *Forewarned Is Forearmed* step: inserted between
   * `reveal-on-guard-attacks` and `automatic-attacks` when that permanent
   * event is in play and the company's site (non-Dragon-lair) has more
   * than one automatic attack. The hazard player selects which single
   * attack to retain; all others are skipped. The resource player has no
   * actions during this step.
   */
  | 'forewarned-select-attack'
  /**
   * Dynamic automatic-attack window for sites carrying a
   * `site-rule: dynamic-auto-attack` effect (e.g. Framsburg td-175). The
   * hazard player may play one creature from their hand whose keying
   * matches the site's filter; that creature is treated in all ways as
   * the site's automatic-attack. Always follows `reveal-on-guard-attacks`
   * and feeds into `automatic-attacks`. Passing skips without combat.
   */
  | 'play-site-auto-attack'
  /**
   * Step 2 (CoE line 350): Automatic-attacks are initiated and resolved
   * one at a time in the order listed on the site card. Each triggers the
   * combat sub-state. Once all are faced (regardless of outcome), the
   * company has "successfully entered" the site.
   */
  | 'automatic-attacks'
  /**
   * Troll-purse (dm-95) re-face window. When the resource player plays an
   * item at a site bearing an opponent's Troll-purse, the company must face
   * all of the site's automatic-attacks again (each with +3 prowess), with a
   * successful strike taking the character prisoner instead of wounding. The
   * re-faced attacks are sequenced one at a time (mirroring 'automatic-attacks')
   * and on completion control returns to 'play-resources'.
   */
  | 'troll-purse-attacks'
  /**
   * Prisoner-rescue window (CoE rule 8.36). When the active company attempts
   * to rescue prisoners held at its current site (e.g. by Troll-purse dm-95),
   * it must face the host's rescue-attack — the site's automatic-attacks at
   * the time of rescue — sequenced one at a time (mirroring 'automatic-attacks'
   * but with normal wound semantics; held prisoners are protected from strike
   * assignment). Once all rescue-attacks are faced, the prisoners are freed and
   * control returns to 'play-resources'.
   */
  | 'rescue-attacks'
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
  | 'play-minor-item'
  /**
   * After play-resources, the resource player may declare a Company vs
   * Company Combat (CvCC) attack against an opponent's company at the
   * same site — if no influence attempt or prior CvCC attack has occurred
   * this turn. Passing advances to the next company (advanceSiteToNextCompany).
   *
   * CoE rules 8.38–8.41.
   */
  | 'declare-company-attack';

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
  /**
   * Active Troll-purse (dm-95) re-face progress. Set when an item played at
   * the site triggers a re-facing of all the site's automatic-attacks; holds
   * the host card instance, the prowess bonus to apply to each re-faced
   * attack, and how many of the site's auto-attacks have been re-faced so far.
   * Undefined when no re-face is in progress. Cleared (and the step returns to
   * 'play-resources') once all the site's auto-attacks have been re-faced.
   */
  readonly trollPurseReface?: {
    readonly hostInstanceId: CardInstanceId;
    readonly prowessBonus: number;
    readonly resolved: number;
  };
  /**
   * Active prisoner-rescue progress (CoE rule 8.36). Set when the active
   * company attempts to rescue prisoners held at its site by `hostInstanceId`;
   * holds how many of the site's automatic-attacks (the rescue-attack) have
   * been faced so far. Undefined when no rescue is in progress. Cleared (and
   * the prisoners freed, the step returned to 'play-resources') once all the
   * site's automatic-attacks have been faced.
   */
  readonly rescueInProgress?: {
    readonly hostInstanceId: CardInstanceId;
    readonly resolved: number;
  };
  /**
   * Active siege-attack progress (Siege tw-87). Set at `select-company` when
   * one or more cards bearing a `site-phase-start-attack` effect are bound to
   * the selected company's current site; holds those cards' instance ids (in
   * the order their attacks are faced) and how many have been faced so far.
   * Undefined when no siege binds the site. Cleared (and the step advanced to
   * 'enter-or-skip') once every siege attack has been faced.
   */
  readonly siegeAttacks?: {
    readonly sourceInstanceIds: readonly CardInstanceId[];
    readonly resolved: number;
  };
  /**
   * When *Forewarned Is Forearmed* is in play and the site has multiple
   * automatic attacks, this holds the zero-based index of the single
   * attack the hazard player selected during `forewarned-select-attack`.
   * Undefined means all attacks are processed normally.
   */
  readonly selectedAutoAttackIndex?: number;
  /**
   * Set when the active company's remaining automatic-attacks are abandoned
   * rather than faced. Farmer Maggot (as-48) replaces the company's site card
   * mid-attack: the company is *placed* at the replacement site instead of
   * moving to it, so it never enters that site and faces none of its automatic
   * attacks. The `automatic-attacks` step treats the sequence as finished while
   * this is set. Absent (undefined → treated as false) for a normal site entry;
   * reset to absent when a new company's site phase begins.
   */
  readonly autoAttacksSkipped?: boolean;
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
   * Whether a "Bounty of the Hoard" event has been played this site phase,
   * allowing one additional minor or major item to be played at the tapped
   * hoard site. Cleared after the item is played.
   */
  readonly hoardBountyAvailable: boolean;
  /**
   * Whether a "Thorough Search" event has been played this site phase,
   * allowing one additional minor, major, or gold ring item to be played
   * without tapping the site. Cleared after the item is played.
   */
  readonly thoroughSearchAvailable: boolean;
  /**
   * Whether a "Come By Night Upon Them" (le-176) event has been played this
   * site phase, letting the **first item** played at the site (any subtype) be
   * played without tapping the site. Cleared after that item is played. Absent
   * (undefined → treated as false) until such an event resolves; reset to absent
   * when a new company's site phase begins (a fresh {@link SitePhaseState} is
   * built).
   */
  readonly firstItemNoTapAvailable?: boolean;
  /**
   * Whether the current company's site carries the `first-minor-item-no-tap`
   * site-rule (Framsburg, as-146) and the one free minor item it grants this
   * site phase has not yet been played. Set true at `select-company` when the
   * company's current site declares the rule; cleared once a minor item is
   * played there. Distinct from {@link firstItemNoTapAvailable}, which is the
   * event-driven, any-subtype version.
   */
  readonly firstMinorItemNoTapAvailable?: boolean;
  /**
   * Whether the current company has already played its one allowed Technology
   * item at the site this site phase via a `technology-item-unlocked` constraint
   * (Saruman's Machinery, wh-120 — "One Technology item is playable at the site
   * during your site phase whether the site is tapped or untapped"). Absent
   * (undefined) until the company plays such an item; reset to absent when a new
   * company's site phase begins (a fresh {@link SitePhaseState} is built).
   */
  readonly technologyItemPlayed?: boolean;
  /**
   * Whether the current (active) company has, this site phase, successfully
   * played a **unique hero faction at a Free-hold that is not Bag End**. Set
   * when such a faction resolves (`resolveInfluenceAttemptRoll`); consulted by
   * the `company-context` play-condition so a card can gate on "during the same
   * site phase his company plays a unique hero faction at a Free-hold [{F}] (not
   * Bag End)" (To Fealty Sworn, ba-33). Absent (undefined → treated as false)
   * until such a faction is played; reset to absent when a new company's site
   * phase begins (a fresh {@link SitePhaseState} is built).
   */
  readonly uniqueHeroFactionPlayedAtFreeHold?: boolean;
  /**
   * Whether the active company has, this site phase, successfully played **any**
   * faction (of any type) at its current site. Set when a faction resolves
   * (`resolveInfluenceAttemptRoll`); consulted by the `company-context`
   * play-condition via `company.playedFactionHere` so a card can gate on "if you
   * have played a faction there" (No Strangers at this Time, as-51). Absent
   * (undefined → false) until such a faction is played; reset to absent when a
   * new company's site phase begins (a fresh {@link SitePhaseState} is built).
   */
  readonly factionPlayedThisSitePhase?: boolean;
  /**
   * Whether the site's minion-only additional automatic-attack (No Strangers at
   * this Time, as-51 `duplicateFirstAutoAttackVsMinion`) has already been faced
   * this site phase. Set once the copied first automatic-attack has been
   * initiated in the `handleSiteAutomaticAttacks` done-branch, so it fires
   * exactly once. Absent (undefined → false) until then; reset when a new
   * company's site phase begins.
   */
  readonly siteLockMinionAttackDone?: boolean;
  /**
   * Number of characters the active company has tapped this site phase to pay
   * the Eddy in Fate's Tide (ba-57) tax — "Before a company can play any ally or
   * item at any version of this site, it must tap two characters during the site
   * phase." Incremented by each `pay-site-tax` action; the item / ally play
   * paths are gated until it reaches the bound card's `taxTapCharacters`. Absent
   * (treated as 0) until the first tax character is tapped; reset to absent when
   * a new company's site phase begins (a fresh {@link SitePhaseState} is built).
   */
  readonly eddyTaxTapped?: number;
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
  readonly finalScores: ByPlayerId<number>;
  /** Players who have acknowledged the result by sending 'finished'. */
  readonly finishedPlayers: readonly string[];
  /**
   * How the game was decided. For a One Ring win the `winner` above is
   * forced (not derived from `finalScores`); `finalScores` is still computed
   * for the result screen. See {@link WinReason}.
   */
  readonly winReason: WinReason;
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
