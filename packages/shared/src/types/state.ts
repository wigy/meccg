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
  RegionType,
  SiteType,
  MovementType,
} from './common.js';
import type { ViewCard } from './common.js';
import { CardDefinition } from './cards.js';
import type { GameAction } from './actions.js';

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

/**
 * An on-guard card placed face-down at a company's site by the hazard player.
 * Tracks whether the card has been revealed (flipped face-up) during the site phase.
 * Revealed cards remain in the onGuardCards array with `revealed: true` until
 * they are consumed (e.g. creature attacks resolve) or returned to hand at cleanup.
 */
export interface OnGuardCard {
  /** The card instance ID of this on-guard card. */
  readonly instanceId: CardInstanceId;
  /** Reference to the static card definition. */
  readonly definitionId: CardDefinitionId;
  /** Whether this card has been revealed (flipped face-up). */
  readonly revealed: boolean;
}

/**
 * A site card currently in play, associated with a company.
 * Sites track their tapped/untapped state — a tapped site cannot
 * be used to play another resource that requires tapping.
 */
export interface SiteInPlay {
  /** The card instance ID of this site. */
  readonly instanceId: CardInstanceId;
  /** Reference to the static site card definition. */
  readonly definitionId: CardDefinitionId;
  /** Current state of this site — untapped or tapped. */
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
  /** Hazard cards attached to this character (corruption cards, Foolish Words, etc.). */
  readonly hazards: readonly CardInPlay[];
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
  /** The site card in play where this company is currently located. Null during setup before site selection. */
  readonly currentSite: SiteInPlay | null;
  /**
   * Whether this company holds the physical site card.
   * False when the company was created by a split — the original company keeps the card.
   * Companies without the physical card still display the site but with a visual indicator.
   */
  readonly siteCardOwned: boolean;
  /**
   * The planned destination site, set during Organization phase.
   * Null if the company is staying put this turn.
   */
  /**
   * The planned destination site, set during Organization phase.
   * Stored as a full {@link SiteInPlay} so the definition ID is always
   * available even after the card is removed from the site deck.
   * Null if the company is staying put this turn.
   */
  readonly destinationSite: SiteInPlay | null;
  /** Region card instances defining the travel path from current site to destination. */
  readonly movementPath: readonly CardInstanceId[];
  /** Whether this company has already completed movement this turn. */
  readonly moved: boolean;
  /**
   * The site of origin for this company during the current M/H phase.
   * Set when the company begins its M/H sub-phase (step 2).
   * Used for site disposal at step 8 and for determining which site's
   * draw boxes to use when moving to a haven. Null before M/H phase.
   */
  readonly siteOfOrigin: CardInstanceId | null;
  /**
   * On-guard cards placed face-down at this company's site by the hazard
   * player during M/H phases. Each company's own M/H phase allows at most
   * one on-guard placement, but if multiple companies move to the same site
   * and are later joined, on-guard cards accumulate. Persists into the Site
   * phase where cards may be revealed under specific conditions. The cards'
   * identities are hidden from the resource player.
   */
  readonly onGuardCards: readonly OnGuardCard[];
  /** Hazard cards targeting this company as a whole (not a specific character). */
  readonly hazards: readonly CardInPlay[];
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
  /** Defeated creature cards earning kill marshalling points. */
  readonly killPile: readonly CardInstance[];
  /** Cards removed from the game (e.g. characters eliminated by failed corruption checks). */
  readonly eliminatedPile: readonly CardInstance[];
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
  /** Cards available to draft from (up to 10). */
  readonly pool: readonly CardInstance[];
  /** Cards successfully drafted so far. */
  readonly drafted: readonly CardInstance[];
  /** The face-down pick for the current draft round, or null if not yet picked. */
  readonly currentPick: CardInstance | null;
  /** Whether this player has voluntarily stopped drafting (they keep what they have). */
  readonly stopped: boolean;
}

/**
 * Per-player state during the item draft step.
 */
export interface ItemDraftPlayerState {
  /** Minor items not yet assigned to a character. */
  readonly unassignedItems: readonly CardInstance[];
  /** Whether this player has finished assigning items (or had none). */
  readonly done: boolean;
}

/**
 * Per-player state during the character deck draft step.
 */
export interface CharacterDeckDraftPlayerState {
  /** Remaining pool characters available to add to the play deck. */
  readonly remainingPool: readonly CardInstance[];
  /** Whether this player has finished adding characters. */
  readonly done: boolean;
}

/**
 * Per-player state during the starting site selection step.
 */
export interface SiteSelectionPlayerState {
  /** Sites selected so far, each carrying instance ID and definition ID. */
  readonly selectedSites: readonly ViewCard[];
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
   * When non-null, a corruption check is required for the character who
   * just gave away an item via transfer. No other organization actions
   * are legal until this check is resolved (CoE 2.II.5).
   */
  readonly pendingCorruptionCheck: {
    /** The character who must make the corruption check. */
    readonly characterId: CardInstanceId;
    /** The item that was transferred — included in possessions and CP for the check. */
    readonly transferredItemId: CardInstanceId;
  } | null;
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
  /**
   * Card instance IDs of ongoing effects that the hazard player must order
   * during the 'order-effects' step (CoE step 4). Empty outside that step.
   * The hazard player submits a permutation of these IDs to set the resolution order.
   * Hazard-limit modifications are excluded — they are ordered by the resource player.
   */
  readonly pendingEffectsToOrder: readonly CardInstanceId[];
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
   * Whether the hazard player has a window to reveal on-guard cards
   * in response to a site-tapping resource play. Set when the resource
   * player plays a resource that would tap the site and on-guard cards
   * exist. The hazard player may reveal or pass before the resource resolves.
   */
  readonly awaitingOnGuardReveal: boolean;
  /**
   * The resource action that triggered the on-guard reveal window.
   * Executed when the hazard player passes on revealing. Null when
   * no on-guard window is active.
   */
  readonly pendingResourceAction: GameAction | null;
  /**
   * Tracks whether the resource player has made an opponent influence
   * attempt or company-vs-company attack this turn. At most one such
   * interaction is allowed per turn (CoE rule 10.10 bullet 3).
   * Null means no interaction has occurred yet.
   */
  readonly opponentInteractionThisTurn: 'influence' | 'attack' | null;
  /**
   * Intermediate state while awaiting the hazard player's defensive roll
   * during an opponent influence attempt. Null when no influence attempt
   * is pending resolution.
   */
  readonly pendingOpponentInfluence: {
    /** The influencing character's instance ID. */
    readonly influencerId: CardInstanceId;
    /** The opponent's targeted card instance ID. */
    readonly targetInstanceId: CardInstanceId;
    /** Whether the target is a character or ally. */
    readonly targetKind: 'character' | 'ally';
    /** The target's player ID. */
    readonly targetPlayer: PlayerId;
    /** The attacker's 2d6 roll result. */
    readonly attackerRoll: number;
    /** The influencer's unused direct influence. */
    readonly influencerDI: number;
    /** The opponent's unused general influence. */
    readonly opponentGI: number;
    /** The target's mind value (comparison threshold). */
    readonly targetMind: number;
    /** Unused DI of the character controlling the target (0 if under GI). */
    readonly controllerDI: number;
    /**
     * The card instance revealed from hand for a comparison value of 0.
     * Null if no card was revealed. Stored so it can be discarded on failure
     * or played on success (Phase 2).
     */
    readonly revealedCard: { readonly instanceId: CardInstanceId; readonly definitionId: CardDefinitionId } | null;
  } | null;
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

// ---- Combat sub-state ----

/**
 * Identifies what initiated a combat encounter.
 *
 * Combat can be triggered by:
 * - A creature hazard card played by the opponent during Movement/Hazard phase.
 * - An automatic attack built into a site card during the Site phase.
 * - An agent hazard attacking at its site during the Site phase.
 * - A company-vs-company attack (CvCC).
 */
export type AttackSource =
  | { readonly type: 'creature'; readonly instanceId: CardInstanceId }
  | { readonly type: 'automatic-attack'; readonly siteInstanceId: CardInstanceId; readonly attackIndex: number }
  | { readonly type: 'on-guard-creature'; readonly cardInstanceId: CardInstanceId }
  | { readonly type: 'agent'; readonly instanceId: CardInstanceId }
  | { readonly type: 'company-attack'; readonly attackingCompanyId: CompanyId };

/**
 * Tracks the assignment and resolution of a single strike against a character.
 *
 * During the 'assign-strikes' sub-phase, each strike is paired with a defending
 * character. During 'resolve-strike', the 2d6 + prowess roll determines the outcome.
 */
export interface StrikeAssignment {
  /** The character instance ID assigned to receive this strike. */
  readonly characterId: CardInstanceId;
  /** Number of excess strikes allocated to this character as -1 prowess each. */
  readonly excessStrikes: number;
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
 * The combat sub-state machine, stored as a top-level field on GameState.
 *
 * Combat is a self-contained sub-system that can be triggered from multiple
 * game phases (creature hazards during Movement/Hazard, automatic attacks
 * during Site phase, on-guard creatures, agent attacks, etc.). When combat
 * is active, it takes priority over the enclosing phase — combat actions
 * (assign-strike, resolve-strike, support-strike) must be resolved before
 * the phase can continue.
 *
 * Combat proceeds through three sub-phases:
 * 1. `'assign-strikes'` -- The defending player assigns each strike to a character.
 * 2. `'resolve-strike'` -- Each strike is resolved one at a time (2d6 + prowess vs creature prowess).
 * 3. `'body-check'` -- For successful strikes, a body check determines if the character is wounded or eliminated.
 */
export interface CombatState {
  /** What initiated this combat (creature card or automatic site attack). */
  readonly attackSource: AttackSource;
  /** The company being attacked. */
  readonly companyId: CompanyId;
  /** The player who owns the defending company (resource player). */
  readonly defendingPlayerId: PlayerId;
  /** The player who initiated the attack (hazard player). */
  readonly attackingPlayerId: PlayerId;
  /** Total number of strikes the creature/attack delivers. */
  readonly strikesTotal: number;
  /** The prowess value of each strike (from the creature's stats or automatic attack). */
  readonly strikeProwess: number;
  /** The creature's body value for body checks. Null if no body check applies. */
  readonly creatureBody: number | null;
  /** The assignment of each strike to a defending character, with resolution status. */
  readonly strikeAssignments: readonly StrikeAssignment[];
  /** Index into strikeAssignments for the strike currently being resolved. */
  readonly currentStrikeIndex: number;
  /**
   * Which sub-phase of combat resolution is active.
   * - `'assign-strikes'`: players assign strikes to characters
   * - `'choose-strike-order'`: defender picks which unresolved strike resolves next
   * - `'resolve-strike'`: the chosen strike is resolved (tap/untap, support, dice roll)
   * - `'body-check'`: body check after a strike result
   */
  readonly phase: 'assign-strikes' | 'choose-strike-order' | 'resolve-strike' | 'body-check';
  /**
   * During assign-strikes, tracks who is currently assigning:
   * - `'defender'`: defending player assigns strikes to untapped characters
   * - `'attacker'`: attacking player assigns remaining strikes
   * - `'done'`: all strikes assigned, ready to resolve
   */
  readonly assignmentPhase: 'defender' | 'attacker' | 'done';
  /**
   * During body-check phase, indicates what the body check is against:
   * - `'character'`: check if a wounded character is eliminated
   * - `'creature'`: check if a successful strike defeats the creature
   */
  readonly bodyCheckTarget: 'character' | 'creature' | null;
  /**
   * Whether this is a detainment attack. Detainment attacks tap characters
   * instead of wounding/eliminating them. Any attack can be detainment —
   * it is an attribute of the attack, not a separate attack type.
   */
  readonly detainment: boolean;
}

// ---- Chain of Effects sub-state ----

/**
 * Discriminated union of chain entry payloads.
 *
 * Each variant corresponds to a kind of action that can appear on the
 * chain of effects. The `type` field identifies the variant so that the
 * resolver knows how to apply the entry when it resolves.
 */
export type ChainEntryPayload =
  | { readonly type: 'short-event'; readonly targetInstanceId?: CardInstanceId }
  | { readonly type: 'creature' }
  | { readonly type: 'permanent-event'; readonly targetCharacterId?: CardInstanceId }
  | { readonly type: 'long-event' }
  | { readonly type: 'corruption-card' }
  | { readonly type: 'passive-condition'; readonly trigger: string }
  | { readonly type: 'activated-ability' }
  | { readonly type: 'on-guard-reveal' }
  | { readonly type: 'body-check' };

/**
 * A single entry on the chain of effects stack.
 *
 * Entries are pushed in declaration order and resolved in LIFO order
 * (last declared resolves first). Each entry tracks its declaring player,
 * the card involved, and a payload describing the kind of action.
 */
export interface ChainEntry {
  /** Sequential position on the chain (0 = first declared). */
  readonly index: number;
  /** The player who declared this entry. */
  readonly declaredBy: PlayerId;
  /** The card being played, physically held by the chain until resolution. Null for non-card actions (e.g. passive conditions). */
  readonly card: CardInstance | null;
  /** What kind of action this entry represents, with variant-specific data. */
  readonly payload: ChainEntryPayload;
  /** Whether this entry has been resolved. */
  readonly resolved: boolean;
  /** Whether this entry was negated before it could resolve (e.g. target became invalid). */
  readonly negated: boolean;
}

/**
 * A passive condition triggered during chain resolution, queued for a follow-up chain.
 *
 * When a card's passive condition fires during resolution of the current chain,
 * it cannot be added to the active chain. Instead it is deferred and declared
 * in a new chain after the current one completes.
 */
export interface DeferredPassive {
  /** The card whose passive condition was triggered. */
  readonly sourceCardId: CardInstanceId;
  /** Human-readable description of the trigger condition. */
  readonly trigger: string;
  /** The payload to declare in the follow-up chain. */
  readonly payload: ChainEntryPayload;
}

/**
 * Restriction on what can be declared in a chain.
 *
 * Most chains are unrestricted (`'normal'`), but certain game situations
 * create chains where only specific kinds of actions are allowed:
 * - `'body-check'` — only actions that affect the body check
 * - `'end-of-phase'` — only "at the end of" triggered abilities
 * - `'beginning-of-phase'` — only "at the beginning of" triggered abilities
 */
export type ChainRestriction = 'normal' | 'body-check' | 'end-of-phase' | 'beginning-of-phase';

/**
 * The chain of effects sub-state machine, stored as a top-level field on GameState.
 *
 * The chain layers on top of the current phase — when `state.chain` is non-null,
 * legal action computation delegates to chain logic instead of the phase handler.
 * The underlying phase (M/H, Site, etc.) stays intact.
 *
 * The chain has two modes:
 * - `'declaring'` — players alternate declaring actions (pushing entries onto the stack)
 * - `'resolving'` — entries are resolved in LIFO order (last declared resolves first)
 *
 * Priority alternates between players during declaration. When both players pass
 * consecutively, the chain transitions from declaring to resolving.
 */
export interface ChainState {
  /** Whether players are still declaring actions or the chain is resolving. */
  readonly mode: 'declaring' | 'resolving';
  /** LIFO stack of declared entries. Index 0 = first declared, last = top of stack. */
  readonly entries: readonly ChainEntry[];
  /** The player who currently has priority to declare or pass. */
  readonly priority: PlayerId;
  /** Whether the priority player has passed (waiting for opponent's response). */
  readonly priorityPlayerPassed: boolean;
  /** Whether the non-priority player has passed. */
  readonly nonPriorityPlayerPassed: boolean;
  /** Passive conditions triggered during resolution, queued for a follow-up chain. */
  readonly deferredPassives: readonly DeferredPassive[];
  /** Saved parent chain state for nested chains (on-guard interrupts, body checks). */
  readonly parentChain: ChainState | null;
  /** What kinds of actions are allowed in this chain. */
  readonly restriction: ChainRestriction;
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
  /**
   * Active combat sub-state, or null when no combat is in progress.
   * Combat is phase-independent: it can be triggered during Movement/Hazard
   * (creature hazards) or Site phase (automatic attacks, on-guard creatures,
   * agent attacks). When non-null, combat actions take priority over the
   * enclosing phase's normal actions.
   */
  readonly combat: CombatState | null;
  /**
   * Active chain of effects sub-state, or null when no chain is in progress.
   * The chain is phase-independent: it layers on top of any phase where cards
   * can be played. When non-null, chain actions take priority over both combat
   * and the enclosing phase's normal actions.
   */
  readonly chain: ChainState | null;
  /** Long-duration and permanent event cards currently in play on the table. */
  readonly eventsInPlay: readonly EventInPlay[];
  /** The static card definition pool, keyed by CardDefinitionId. Loaded once at game start. */
  readonly cardPool: Readonly<Record<string, CardDefinition>>;
  /** Current turn number (1-based), incremented each time the active player changes. */
  readonly turnNumber: number;
  /** The player who won the initiative roll and took the first turn. Null during setup before the roll. */
  readonly startingPlayer: PlayerId | null;
  /** Queue of effects waiting to be resolved before the game can proceed. */
  readonly pendingEffects: readonly PendingEffect[];
  /** Deterministic RNG state for reproducible dice rolls and shuffles. */
  readonly rng: RngState;
  /** Monotonically increasing sequence number for state changes, used for log replay. */
  readonly stateSeq: number;
  /**
   * Reverse actions accumulated during the current phase. Each time a player
   * takes an organization action, the engine computes the action(s) that would
   * undo it and appends them here. Cleared automatically at every phase transition.
   * Used by legal-action computation to mark regressive (undo) actions.
   */
  readonly reverseActions: readonly GameAction[];
  /**
   * Tracks who gets one more turn after a player calls the Free Council.
   * Null means no call has been made. When set, the identified player gets
   * their final turn before the game transitions to the Free Council phase.
   */
  readonly lastTurnFor: PlayerId | null;
  /**
   * Dev-only: when set, the next dice roll will produce this total (2-12)
   * instead of using the RNG. The individual dice are randomly split to
   * sum to the target. Consumed (reset to null) after one roll.
   */
  readonly cheatRollTotal: number | null;
}

// ---- Instance resolution helpers ----

/** All pile names on PlayerState that store CardInstance arrays. */
const PILE_NAMES = [
  'hand', 'playDeck', 'discardPile', 'siteDeck', 'siteDiscardPile',
  'sideboard', 'killPile', 'eliminatedPile',
] as const;

/**
 * Resolves a {@link CardInstanceId} to its {@link CardDefinitionId} by
 * searching all piles, in-play cards, characters, items, allies, and events.
 *
 * This replaces the old `state.instanceMap` lookup. It searches in-play
 * structures first (O(1) character lookup) then falls through to piles.
 *
 * @returns The definition ID, or undefined if the instance ID is not found.
 */
export function resolveInstanceId(state: GameState, instanceId: CardInstanceId): CardDefinitionId | undefined {
  for (const player of state.players) {
    // Characters (Record keyed by instanceId — O(1))
    const char = player.characters[instanceId as string];
    if (char) return char.definitionId;

    // Items, allies, hazards on characters
    for (const ch of Object.values(player.characters)) {
      for (const item of ch.items) {
        if (item.instanceId === instanceId) return item.definitionId;
      }
      for (const ally of ch.allies) {
        if (ally.instanceId === instanceId) return ally.definitionId;
      }
      for (const hazard of ch.hazards) {
        if (hazard.instanceId === instanceId) return hazard.definitionId;
      }
    }

    // General cards in play
    for (const card of player.cardsInPlay) {
      if (card.instanceId === instanceId) return card.definitionId;
    }

    // Company sites and on-guard cards
    for (const company of player.companies) {
      if (company.currentSite?.instanceId === instanceId) return company.currentSite.definitionId;
      if (company.destinationSite?.instanceId === instanceId) return company.destinationSite.definitionId;
      for (const card of company.onGuardCards) {
        if (card.instanceId === instanceId) return card.definitionId;
      }
      for (const hazard of company.hazards) {
        if (hazard.instanceId === instanceId) return hazard.definitionId;
      }
    }

    // Piles
    for (const pileName of PILE_NAMES) {
      const pile = player[pileName];
      for (const card of pile) {
        if (card.instanceId === instanceId) return card.definitionId;
      }
    }
  }

  // Events in play
  for (const event of state.eventsInPlay) {
    if (event.instanceId === instanceId) return event.definitionId;
  }

  // Cards on the chain of effects
  if (state.chain) {
    for (const entry of state.chain.entries) {
      if (entry.card?.instanceId === instanceId) return entry.card.definitionId;
    }
  }

  return undefined;
}
