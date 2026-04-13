/**
 * @module pending
 *
 * Pending resolutions and active constraints — the unified replacement
 * for the per-phase ad-hoc `pending*` fields scattered across the engine.
 *
 * Two distinct shapes share this module:
 *
 *  - **Shape A — {@link PendingResolution}.** Discrete pieces of work the
 *    engine has queued for a specific actor. While any resolution is
 *    pending for the active actor, legal actions collapse to "resolve the
 *    top item." Examples: corruption checks (transfer / wound / Lure),
 *    order-effects step in M/H, on-guard reveal window, opponent-influence
 *    defensive roll.
 *
 *  - **Shape B — {@link ActiveConstraint}.** Scoped restrictions on the
 *    legal-action menu of some target (company / character / player).
 *    They never block resolution; they filter the available actions
 *    while they live and auto-clear at a boundary. Examples: River and
 *    Lost in Free-domains (company may do nothing during its site phase),
 *    Stealth (no creature hazards on this company this turn).
 *
 * Both lists live at the **top** of `GameState` and are owned by the
 * helper module `engine/pending.ts`. Phase state must not contain any
 * `pending*` field; everything cross-cutting routes through this module.
 */

import type { CardInstanceId, CompanyId, PlayerId, CardDefinitionId } from './common.js';
import type { GameAction } from './actions.js';
import type { Phase } from './state-phases.js';
import type { Condition } from './effects.js';

// ---- Branded IDs ----

/** Unique ID minted for every pending resolution. */
export type ResolutionId = string & { readonly __brand: 'ResolutionId' };

/** Unique ID minted for every active constraint. */
export type ConstraintId = string & { readonly __brand: 'ConstraintId' };

// ---- Shape A: Pending resolutions ----

/**
 * Where a {@link PendingResolution} lives. The engine sweeps the queue at
 * boundaries that match each scope, automatically dropping any resolution
 * whose scope has expired.
 */
export type ResolutionScope =
  | { readonly kind: 'phase'; readonly phase: Phase }
  | { readonly kind: 'phase-step'; readonly phase: Phase; readonly step: string }
  | { readonly kind: 'company-mh-subphase'; readonly companyId: CompanyId }
  | { readonly kind: 'company-site-subphase'; readonly companyId: CompanyId };

/**
 * Snapshot of an opponent influence attempt awaiting the defender's roll.
 * Mirrors the old SitePhaseState.pendingOpponentInfluence shape.
 */
export interface OpponentInfluenceAttempt {
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
   * Null if no card was revealed.
   */
  readonly revealedCard: { readonly instanceId: CardInstanceId; readonly definitionId: CardDefinitionId } | null;
}

/**
 * A discrete piece of work the engine has queued for a player.
 *
 * Discriminated by `kind.type`. While any resolution exists for the
 * current actor in the current scope, only resolution actions are legal.
 * Drains FIFO per actor.
 */
export interface PendingResolution {
  /** Globally unique ID. */
  readonly id: ResolutionId;
  /**
   * The card instance whose effect produced this resolution. May be null
   * for engine-generated resolutions (e.g. order-effects step transitions)
   * that are not attributed to a single card.
   */
  readonly source: CardInstanceId | null;
  /** Player who must resolve this entry. */
  readonly actor: PlayerId;
  /** Auto-clear boundary. */
  readonly scope: ResolutionScope;
  /** Discriminated payload. */
  readonly kind:
    | {
        readonly type: 'corruption-check';
        readonly characterId: CardInstanceId;
        /** Roll modifier from the producing effect (e.g. Barrow-wight -2). */
        readonly modifier: number;
        /** Human-readable reason shown in UI: "Lure", "Barrow-wight", "Transfer", etc. */
        readonly reason: string;
        /**
         * Possessions to include in the corruption check. The legal-action
         * computer is free to add the character's currently attached items
         * if this list is empty; the field exists for the transfer case
         * where the transferred item must also be counted even though it
         * already moved to the target character.
         */
        readonly possessions: readonly CardInstanceId[];
        /**
         * For transfer corruption checks: the item that was transferred.
         * Its corruption-points must be added to the character's CP for
         * the check, even though the item is already on the target.
         * Null for non-transfer corruption checks.
         */
        readonly transferredItemId: CardInstanceId | null;
      }
    | {
        readonly type: 'order-effects';
        readonly effectIds: readonly CardInstanceId[];
      }
    | {
        readonly type: 'on-guard-window';
        /**
         * Stage of the on-guard window flow:
         *  - `'reveal-window'` — actor is the hazard player; they may
         *    reveal one on-guard card or pass. On reveal, the resolution
         *    is replaced by an `awaiting-pass` entry whose actor is the
         *    resource player; on pass, the deferred action runs.
         *  - `'awaiting-pass'` — actor is the resource player; their
         *    only legal action is `pass`, which runs the deferred
         *    action. Used after the hazard player has revealed one
         *    on-guard card and the resulting chain has resolved.
         */
        readonly stage: 'reveal-window' | 'awaiting-pass';
        /** The action that runs when the window closes. */
        readonly deferredAction: GameAction;
      }
    | {
        readonly type: 'opponent-influence-defend';
        readonly attempt: OpponentInfluenceAttempt;
      }
    | {
        /**
         * Faction influence roll: the chain has resolved, all modifiers are
         * known, and the game pauses so the UI can display a situation
         * banner (target number, DI, bonuses/penalties) before the player
         * commits to rolling.
         */
        readonly type: 'faction-influence-roll';
        /** The faction card instance (held by the now-resolved chain entry). */
        readonly factionInstanceId: CardInstanceId;
        readonly factionDefinitionId: CardDefinitionId;
        /** The character making the influence roll. */
        readonly influencingCharacterId: CardInstanceId;
      };
}

// ---- Shape B: Active constraints ----

/**
 * Where an {@link ActiveConstraint} lives. Sweeps at the matching boundary
 * automatically clear it.
 */
export type ConstraintScope =
  | { readonly kind: 'turn' }
  | { readonly kind: 'phase'; readonly phase: Phase }
  | { readonly kind: 'company-site-phase'; readonly companyId: CompanyId }
  | { readonly kind: 'company-mh-phase'; readonly companyId: CompanyId }
  /** Cleared explicitly by another effect; never auto-swept. */
  | { readonly kind: 'until-cleared' };

/**
 * A scoped restriction on the legal actions available to some target.
 * Filters the legal-action menu; never blocks resolution.
 *
 * Cross-player constraints are supported: a constraint placed by one
 * player's card may filter the *opponent's* action computation if its
 * `kind` so dictates (e.g. Stealth — placed by the resource player but
 * filtering the hazard player's creature plays).
 */
export interface ActiveConstraint {
  /** Globally unique ID. */
  readonly id: ConstraintId;
  /** Card instance that placed this constraint (for logs / UI / cancellation). */
  readonly source: CardInstanceId;
  /** Definition ID of the source card, so the UI can display it even when the card is in a hidden pile. */
  readonly sourceDefinitionId: CardDefinitionId;
  /** Auto-clear boundary. */
  readonly scope: ConstraintScope;
  /** What the constraint applies to. */
  readonly target:
    | { readonly kind: 'company'; readonly companyId: CompanyId }
    | { readonly kind: 'character'; readonly characterId: CardInstanceId }
    | { readonly kind: 'player'; readonly playerId: PlayerId };
  /** Discriminated payload. */
  readonly kind:
    | {
        /**
         * Lost in Free-domains / River: company may do nothing during its
         * site phase. Optional {@link cancelWhen} provides an escape hatch —
         * any character in the target company whose attributes satisfy the
         * condition may tap to cancel the constraint. Evaluated against a
         * per-character context `{ actor: { skills, status, race, name } }`.
         *
         * River's cancelWhen: `{ $and: [{ "actor.skills": { "$includes":
         * "ranger" } }, { "actor.status": "untapped" }] }`.
         */
        readonly type: 'site-phase-do-nothing';
        readonly cancelWhen?: Condition;
      }
    | {
        /**
         * Stealth: opponent may not play creature hazards on this company
         * for the rest of this turn.
         */
        readonly type: 'no-creature-hazards-on-company';
      }
    | {
        /**
         * Generic one-shot check modifier attached to a character. Parallels
         * the DSL `check-modifier` effect but lives on the constraint side
         * because it is targeted, temporary, and consumed the first time
         * the character makes a check of the matching kind.
         *
         * Used by cards like Halfling Strength (+4 corruption check on a
         * chosen hobbit); any future card that grants a one-shot bonus to
         * a named check type can reuse this kind unchanged.
         */
        readonly type: 'check-modifier';
        /** Which check type this modifier applies to (e.g. `corruption`). */
        readonly check: string;
        /** The bonus (or penalty if negative) applied to the roll. */
        readonly value: number;
      };
}

// ---- Sweep boundaries ----

/**
 * Discriminated boundary identifier passed to {@link sweepExpired} so it
 * can drop matching resolutions and constraints. Each phase reducer is
 * responsible for calling sweepExpired at the appropriate transitions.
 */
export type ScopeBoundary =
  | { readonly kind: 'phase-end'; readonly phase: Phase }
  | { readonly kind: 'phase-step-end'; readonly phase: Phase; readonly step: string }
  | { readonly kind: 'company-mh-end'; readonly companyId: CompanyId }
  | { readonly kind: 'company-site-end'; readonly companyId: CompanyId }
  | { readonly kind: 'turn-end' };
