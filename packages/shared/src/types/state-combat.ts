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
  RegionType,
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
 * - An ahunt long-event creating a dragon attack during order-effects.
 */
export type AttackSource =
  | { readonly type: 'creature'; readonly instanceId: CardInstanceId }
  | { readonly type: 'automatic-attack'; readonly siteInstanceId: CardInstanceId; readonly attackIndex: number }
  | { readonly type: 'on-guard-creature'; readonly cardInstanceId: CardInstanceId }
  | { readonly type: 'played-auto-attack'; readonly instanceId: CardInstanceId; readonly siteInstanceId: CardInstanceId }
  | { readonly type: 'agent'; readonly instanceId: CardInstanceId }
  | { readonly type: 'company-attack'; readonly attackingCompanyId: CompanyId }
  | { readonly type: 'ahunt'; readonly longEventInstanceId: CardInstanceId }
  /**
   * Triggered by a resource permanent event carrying a
   * `trigger-attack-on-play` effect (e.g. Rescue Prisoners). The
   * attack resolves immediately after the card enters play. If all
   * characters in the company are tapped after combat, the card is
   * discarded; otherwise the bearer gains a `bearer-cannot-untap`
   * constraint until the card is stored.
   */
  | { readonly type: 'card-triggered-attack'; readonly cardInstanceId: CardInstanceId; readonly bearerCharacterId: CardInstanceId };

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
   * - `'canceled'` -- The strike was canceled before resolution (e.g. Fatty Bolger).
   */
  readonly result?: 'success' | 'wounded' | 'eliminated' | 'canceled';
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
  /**
   * Number of untapped characters/allies in the same company who have
   * tapped to support this strike (CoE rule 3.iv.4). Each adds +1 to the
   * facing character's prowess for this strike resolution only.
   */
  readonly supportCount?: number;
  /**
   * Accumulated prowess bonus contributed by played `modify-strike`
   * short events (e.g. Risky Blow's +3) targeting this strike. Applied
   * in `resolveStrikeCore` alongside base prowess.
   */
  readonly strikeProwessBonus?: number;
  /**
   * Accumulated body penalty contributed by played `modify-strike`
   * short events (e.g. Risky Blow's -1). Applied during the body check
   * when the character is wounded by this strike.
   */
  readonly strikeBodyPenalty?: number;
  /**
   * Whether a resource that requires a skill (e.g. a warrior-only
   * Risky Blow) has already been played during this strike's Step 5.
   * CoE rule 3.iv.5: only one such resource may be played per strike.
   */
  readonly requiredSkillEventPlayed?: boolean;
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
  /**
   * The region types this attack is keyed to, flattened from the creature's
   * `keyedTo` restrictions. Used to evaluate cancel-attack conditions like
   * Stinker's "keyed to Wilderness or Shadow-land". Only populated for
   * creature hazards; automatic attacks leave this empty.
   */
  readonly attackKeying?: readonly RegionType[];
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
  /**
   * CoE rule 3.iv.1 — Strike Sequence, Step 1 (Attacking Player Actions).
   * While the attacker has any playable combat hazards (e.g. Dragon's Curse)
   * this flag is false, giving the attacker an exclusive priority window to
   * declare them before the defender may resolve the strike. Flipped to true
   * when the attacker passes. Reset to false on entry to each new strike
   * sequence (nextStrikePhase / choose-strike-order → resolve-strike).
   */
  readonly attackerStep1Done?: boolean;
  /**
   * Pending haven-join offers raised when the attack began (fired by
   * `on-event: creature-attack-begins` + `apply: offer-char-join-attack`,
   * e.g. Alatar). Each offer lets a specific character in a haven company
   * opt into the attacked company during the cancel-window. Consumed when
   * the player accepts (producing a {@link HavenJumpOrigin} + post-attack
   * effects) or when the attack transitions out of cancel-window.
   */
  readonly havenJumpOffers?: readonly HavenJumpOffer[];
  /**
   * Character instance IDs that MUST each receive a strike before any
   * other defender/attacker assignment is legal. Populated when a
   * haven-join-attack is accepted with `forceStrike: true`. The
   * strike-assignment filter restricts defender assignment to these
   * targets while the list is non-empty.
   */
  readonly forcedStrikeTargets?: readonly CardInstanceId[];
  /**
   * Side-effects to apply to a specific character when combat finalizes,
   * regardless of outcome. Enqueued by accepted haven-join offers
   * (e.g. Alatar's "must tap + corruption check following the attack").
   */
  readonly postAttackEffects?: readonly PostAttackEffect[];
  /**
   * Records where a haven-jumped character came from so they can be
   * returned to their original company after combat finalizes. A
   * character may only appear once.
   */
  readonly havenJumpOrigins?: readonly HavenJumpOrigin[];
  /**
   * True when the creature carries `combat-attacker-chooses-defenders`
   * (e.g. Cave-drake). Determines the post-cancel-window transition:
   * attacker-chooses → `'attacker'` assignment; otherwise → `'defender'`
   * (used when cancel-window was opened solely for a haven-jump offer).
   */
  readonly attackerChoosesDefenders?: boolean;
}

/**
 * One pending "may join the attacked company" offer raised by
 * `on-event: creature-attack-begins` + `apply: offer-char-join-attack`.
 * The bearer's controller may accept via the `haven-join-attack` action
 * during the cancel-window. Composable fields let future cards reuse
 * this primitive without adding a new apply type per card.
 */
export interface HavenJumpOffer {
  /** The character who may jump into the attacked company (the bearer). */
  readonly characterId: CardInstanceId;
  /** The player who controls the bearer (must also own the attacked company). */
  readonly bearerPlayerId: PlayerId;
  /** The bearer's origin company (the haven company). Used to restore them after combat. */
  readonly originCompanyId: CompanyId;
  /** The company under attack — the destination of the jump. */
  readonly targetCompanyId: CompanyId;
  /** When true, allies attached to the bearer are discarded on accept. */
  readonly discardOwnedAllies: boolean;
  /** When true, accepting forces the attacking creature to strike the bearer. */
  readonly forceStrike: boolean;
  /** Effects to apply to the bearer at combat finalization (regardless of outcome). */
  readonly postAttackEffects: readonly PostAttackEffect[];
}

/**
 * An effect scheduled to run at {@link CombatState} finalization,
 * targeting a specific character regardless of the attack's outcome.
 * Enqueued by accepted haven-join offers and similar "following the
 * attack, do X" primitives.
 */
export interface PostAttackEffect {
  /** The character instance the effect targets. */
  readonly targetCharacterId: CardInstanceId;
  /** When true, tap the character if they are still untapped after combat. */
  readonly tapIfUntapped?: boolean;
  /** When present, enqueue a corruption check on the character (optional modifier). */
  readonly corruptionCheck?: { readonly modifier?: number };
}

/** Records where a haven-jumped character came from so they can be restored. */
export interface HavenJumpOrigin {
  /** The character who jumped. */
  readonly characterId: CardInstanceId;
  /** The company they were originally in (haven company). */
  readonly originCompanyId: CompanyId;
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
  | { readonly type: 'short-event'; readonly targetInstanceId?: CardInstanceId; readonly targetCharacterId?: CardInstanceId; readonly targetFactionInstanceId?: CardInstanceId }
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
   * The player who must resolve this effect. When absent, defaults to
   * {@link GameState.activePlayer} (backward-compatible with resource events).
   * Required for hazard events where the resolving player is the non-active player.
   */
  readonly actor?: PlayerId;
  /**
   * For effects triggered by a play-target with tap cost (e.g. Marvels Told),
   * the character instance that was tapped to play the card. Used to enqueue
   * post-effect corruption checks on the correct character.
   */
  readonly targetCharacterId?: CardInstanceId;
  /**
   * When true, the source card is NOT discarded after the effect resolves.
   * Used by grant-action fetch effects where the source is an item that
   * stays in play (tapped) rather than an event that gets discarded.
   */
  readonly skipDiscard?: boolean;
  /**
   * When set, a corruption check is enqueued on this character after
   * the effect completes. Used by Palantír grant-actions.
   */
  readonly postCorruptionCheck?: {
    readonly characterId: CardInstanceId;
    readonly modifier: number;
  };
}
