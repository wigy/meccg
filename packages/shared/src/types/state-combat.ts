/**
 * @module state-combat
 *
 * Combat, chain of effects, and pending effect state types for the MECCG engine.
 * These sub-state machines layer on top of the current game phase and take
 * priority when active.
 */

import {
  PlayerId,
  CardInstanceId,
  CompanyId,
} from './common.js';
import type { CardInstance, ItemInPlay } from './state-cards.js';
import type { CardEffect } from './effects.js';

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
  /**
   * Whether the character was already wounded before this strike was resolved.
   * Used for body check calculation: +1 if already wounded (CoE rule 3.I).
   */
  readonly wasAlreadyWounded?: boolean;
  /**
   * Whether a dodge-strike card was played for this strike. When true,
   * the character fights at full prowess but does not tap on success/tie.
   * If wounded, the character still gets wounded.
   */
  readonly dodged?: boolean;
  /**
   * Body penalty applied during the body check if the character was
   * wounded while dodging (e.g. -1 for Dodge).
   */
  readonly dodgeBodyPenalty?: number;
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
  /** The lowercase singular race of the attacking creature (e.g. "orc", "wolf"). Used to evaluate combat-conditional weapon effects like Glamdring's "max 9 against Orcs". */
  readonly creatureRace?: string;
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
  readonly phase: 'assign-strikes' | 'choose-strike-order' | 'resolve-strike' | 'body-check' | 'item-salvage';
  /**
   * During assign-strikes, tracks who is currently assigning:
   * - `'cancel-window'`: defender's pre-assignment window to cancel the attack
   *   (used when the attacker would otherwise assign first, e.g. attacker-chooses-defenders)
   * - `'defender'`: defending player assigns strikes to untapped characters
   * - `'attacker'`: attacking player assigns remaining strikes
   * - `'done'`: all strikes assigned, ready to resolve
   */
  readonly assignmentPhase: 'cancel-window' | 'defender' | 'attacker' | 'cancel-by-tap' | 'done';
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
  /**
   * When true, all strikes must be assigned to the same character.
   * Set by the `multi-attack` combat rule (e.g. Assassin).
   */
  readonly forceSingleTarget?: boolean;
  /**
   * Number of separate attacks in a multi-attack creature (e.g. Assassin = 3).
   * When present, `strikesTotal` equals `multiAttackCount × strikesPerAttack`.
   * Used by the UI to display "3 attacks of 1 strike" instead of "3 strikes".
   */
  readonly multiAttackCount?: number;
  /**
   * Number of remaining cancel-by-tap opportunities the defender has.
   * Each tap of a non-target character cancels one strike assignment.
   * Set by the `cancel-attack-by-tap` combat rule.
   */
  readonly cancelByTapRemaining?: number;
  /**
   * Items available for salvage transfer from an eliminated character.
   * Only set during the 'item-salvage' phase (CoE rule 3.I.2).
   */
  readonly salvageItems?: readonly ItemInPlay[];
  /**
   * Unwounded characters in the same company eligible to receive a salvaged item.
   * Shrinks as items are transferred (one item per recipient).
   */
  readonly salvageRecipients?: readonly CardInstanceId[];
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
  | {
      readonly type: 'permanent-event';
      readonly targetCharacterId?: CardInstanceId;
      /**
       * For site-targeting permanent events (e.g. *River*), the site
       * definition ID this card is bound to. The chain resolver places
       * the card into `cardsInPlay` with `attachedToSite` set to this
       * value, so the engine can match arrival events against the
       * specific site location.
       */
      readonly targetSiteDefinitionId?: import('./common.js').CardDefinitionId;
    }
  | { readonly type: 'long-event' }
  | { readonly type: 'corruption-card' }
  | { readonly type: 'passive-condition'; readonly trigger: string }
  | { readonly type: 'activated-ability' }
  | { readonly type: 'on-guard-reveal' }
  | { readonly type: 'body-check' }
  | { readonly type: 'influence-attempt'; readonly influencingCharacterId: CardInstanceId };

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
 * (e.g. a resource short event with a fetch-to-deck effect). Pending effects
 * are processed in order before the game continues; when the queue is non-empty,
 * only effect-resolution actions are legal.
 */
export type PendingEffect = CardEffectPendingEffect;

/**
 * A DSL card effect awaiting player interaction (e.g. fetch-to-deck).
 * The source card is in the player's cardsInPlay while this resolves.
 */
export interface CardEffectPendingEffect {
  readonly type: 'card-effect';
  /** Instance ID of the card in cardsInPlay that triggered this effect. */
  readonly cardInstanceId: CardInstanceId;
  /** The DSL effect being resolved (carries all parameters). */
  readonly effect: CardEffect;
  /**
   * For effects triggered by a play-target with tap cost (e.g. Marvels Told),
   * the character instance that was tapped to play the card. Used to enqueue
   * post-effect corruption checks on the correct character.
   */
  readonly targetCharacterId?: CardInstanceId;
}
