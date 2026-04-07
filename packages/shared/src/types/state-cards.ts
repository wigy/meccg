/**
 * @module state-cards
 *
 * Runtime card instance types and in-play structures for the MECCG engine.
 * Defines how cards exist at runtime: card instances, characters in play,
 * items, allies, companies, events, and marshalling point tracking.
 */

import {
  CardInstanceId,
  CompanyId,
  CardDefinitionId,
  CardStatus,
} from './common.js';
import type { ViewCard } from './common.js';

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
  /** If this event is attached to a specific card (e.g. a corruption card on a character). */
  readonly attachedTo?: CardInstanceId;
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
  /**
   * Special movement granted by a card effect (e.g. Gwaihir).
   * When set, the company uses special movement rules during planning and M/H phase:
   * - `'gwaihir'`: Can move to any non-Shadow-land/Dark-domain/Under-deeps site.
   *   Only site-keyed hazard creatures may be played. No region path is traversed.
   */
  readonly specialMovement?: 'gwaihir' | undefined;
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

// ---- Setup-specific per-player state ----

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
