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
import type { ActionCost, Condition, TriggeredAction } from './effects.js';

// ---- Branded IDs ----

/** Unique ID minted for every pending resolution. */
export type ResolutionId = string & { readonly __brand: 'ResolutionId' };

/** Unique ID minted for every active constraint. */
export type ConstraintId = string & { readonly __brand: 'ConstraintId' };

/**
 * Closed set of attribute paths supported by the
 * `attribute-modifier` active constraint (see {@link ActiveConstraint}).
 * Each path maps to a single read site in the engine that consults
 * active modifiers to compute an effective value:
 *
 *  - `auto-attack.prowess` — one-shot prowess bonus on the next matching
 *    automatic-attack (consumed on use).
 *  - `site.type` — override the effective {@link SiteType} for a specific
 *    site (filter: `site.definitionId`). Consulted by creature keying and
 *    Haven-tests.
 *  - `region.type` — override the effective {@link RegionType} for a named
 *    region (filter: `region.name`). Consulted by creature keying.
 */
export type AttributePath =
  | 'auto-attack.prowess'
  | 'site.type'
  | 'region.type';

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
  /** Whether the target is a character, ally, or faction. */
  readonly targetKind: 'character' | 'ally' | 'faction';
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
   * Cross-alignment penalty applied to the attacker's roll per CoE
   * rules 8.W1, 8.R1, 8.F1, 8.B1 (typically -5 or 0). Subtracted from
   * the attacker's roll during resolution in addition to the other
   * modifiers — i.e. added as a negative term on the attacker side.
   */
  readonly crossAlignmentPenalty: number;
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
        /**
         * Custom failure consequence. When `'discard-ring-only'`, a failed
         * check discards only the bearer's Ring item instead of the character
         * (e.g. The Ring's Betrayal). Absent for standard checks.
         */
        readonly failureMode?: 'discard-ring-only';
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
      }
    | {
        /**
         * Muster roll: a hazard short-event (Muster Disperses) targets an
         * in-play faction. The faction's owner rolls 2d6 + unused general
         * influence; if the total is less than 11, the faction is discarded.
         */
        readonly type: 'muster-roll';
        /** The targeted faction card instance. */
        readonly factionInstanceId: CardInstanceId;
        readonly factionDefinitionId: CardDefinitionId;
        /** The player who owns the faction. */
        readonly factionOwner: PlayerId;
      }
    | {
        /**
         * Call of Home roll: a hazard short event has resolved against a
         * character. The character's player rolls 2d6; if roll + unused
         * general influence < threshold, the character returns to hand.
         */
        readonly type: 'call-of-home-roll';
        /** The targeted character instance. */
        readonly targetCharacterId: CardInstanceId;
        /** The hazard card that caused this check. */
        readonly hazardDefinitionId: CardDefinitionId;
        /** Roll + unused GI must meet or exceed this to keep the character. */
        readonly threshold: number;
      }
    | {
        /**
         * Seized by Terror roll: a hazard short event has resolved against a
         * character moving through Shadow-land or Dark-domain. The character's
         * player rolls 2d6 and adds the character's mind. If roll + mind < 12,
         * the character splits off into a new company that returns to the
         * original company's site of origin.
         */
        readonly type: 'seized-by-terror-roll';
        /** The targeted character instance. */
        readonly targetCharacterId: CardInstanceId;
        /** The hazard card that caused this check. */
        readonly hazardDefinitionId: CardDefinitionId;
        /** Roll + mind must meet or exceed this to stay in the moving company. */
        readonly threshold: number;
        /** Instance ID of the site of origin (original company's currentSite). */
        readonly originSiteInstanceId: CardInstanceId;
      }
    | {
        /**
         * Gold-ring test (Rule 9.21): a gold-ring item must be tested. The
         * ring's owner rolls 2d6 (plus any modifiers). The ring is discarded
         * regardless. Spawned by the `auto-test-gold-ring` site-rule when a
         * gold-ring item is stored at a site carrying the rule (e.g. a
         * Darkhaven with a -2 modifier).
         *
         * Rule 9.21's replacement-with-special-ring step is not yet
         * implemented; this kind currently only rolls, logs the result,
         * and discards the gold ring.
         */
        readonly type: 'gold-ring-test';
        /** The gold-ring item instance being tested. */
        readonly goldRingInstanceId: CardInstanceId;
        /** Roll modifier from the producing effect (e.g. Darkhaven -2). */
        readonly rollModifier: number;
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
         * Lost in Free-domains / River: company may do nothing during
         * its site phase. Cards that want to grant a cancel escape
         * hatch (e.g. River's ranger-tap) declare a separate
         * `granted-action` constraint alongside this one — both are
         * sourced from the same card so `remove-constraint` sweeps
         * both at once.
         */
        readonly type: 'site-phase-do-nothing';
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
      }
    | {
        /**
         * Little Snuffler: when the creature's attack is not defeated,
         * resources requiring a scout in the target company cannot be
         * played for the rest of the turn.
         */
        readonly type: 'deny-scout-resources';
      }
    | {
        /**
         * Chill Douser: when its attack is not canceled, all other attacks
         * by creatures of the given race against the target company for the
         * rest of the turn receive a bonus to both strikes and prowess.
         * The constraint source is the Chill Douser instance; when resolving
         * a creature's attack, if the creature's instance ID matches the
         * source the boost is skipped (so the card never boosts itself).
         */
        readonly type: 'creature-attack-boost';
        /** Creature race that receives the boost (e.g. "undead"). */
        readonly race: string;
        /** Strike bonus applied to matching creature attacks. */
        readonly strikes: number;
        /** Prowess bonus applied to matching creature attacks. */
        readonly prowess: number;
      }
    | {
        /**
         * Generic attribute override: a conditional `add`/`override`
         * modifier on an entity attribute. Collapses what used to be
         * three separate constraint kinds
         * (`auto-attack-prowess-boost`, `site-type-override`,
         * `region-type-override`) into one primitive the engine reads
         * via the {@link AttributeModifierFilter} dispatch.
         *
         * Consumers look up matching modifiers for an entity + attribute
         * at read time; the optional {@link filter} narrows further
         * against a per-read context (e.g. only at ruins-and-lairs).
         * Some attributes have single-use semantics (e.g.
         * `auto-attack.prowess`): consumers remove the constraint after
         * applying it.
         */
        readonly type: 'attribute-modifier';
        /**
         * Which attribute this modifier acts on. New attributes require
         * a one-line union extension plus the matching consumer.
         */
        readonly attribute: AttributePath;
        /** How the modifier combines with the base value. */
        readonly op: 'add' | 'override';
        /**
         * The adjustment. `add` expects a number; `override` expects
         * the new value (SiteType, RegionType, etc., encoded as the
         * appropriate string).
         */
        readonly value: number | string;
        /**
         * Optional DSL condition evaluated per-read against a context
         * that exposes the entity under inspection (e.g.
         * `{ site: { type, definitionId }, region: { name, type } }`).
         * When present and non-matching, the modifier is skipped.
         */
        readonly filter?: Condition;
      }
    | {
        /**
         * A card- or constraint-granted action attached to an entity
         * (usually a company). The legal-action layer iterates active
         * `granted-action` constraints in each window and emits a
         * generic `activate-granted-action` per eligible candidate.
         * The reducer reads the constraint's `apply` and dispatches on
         * its `type`. Replaces the old `cancel-hazard-by-tap`
         * (Great Ship) and River's cancel-constraint machinery.
         *
         * Fields mirror {@link GrantActionEffect} with the addition of
         * `phase` (where the action is legal) and an optional
         * `window` (sub-step identifier). The generic
         * `activate-granted-action` action type carries `actionId`,
         * `characterId`, and `sourceCardId` — the source is the
         * constraint's `source` (the card that added it).
         */
        readonly type: 'granted-action';
        /** Stable action identifier emitted by the legal-action layer. */
        readonly action: string;
        /**
         * Which phase the action is legal in. When absent, the
         * granted-action is available in any phase the emitter is
         * invoked in (used by River's ranger-cancel, which fires in
         * both M/H and Site phases).
         */
        readonly phase?: Phase;
        /**
         * Optional sub-step or window within the phase. Interpretation
         * is phase-specific (e.g. `'chain-declaring'` for M/H).
         */
        readonly window?: string;
        /** The cost to activate this ability. */
        readonly cost: ActionCost;
        /**
         * Optional DSL condition evaluated against a per-candidate
         * context including `actor` (the tapping character) and any
         * window-specific fields like `path` or `chain`. When absent,
         * every candidate is eligible.
         */
        readonly when?: Condition;
        /** The effect executed when the action is dispatched. */
        readonly apply: TriggeredAction;
      }
    | {
        /**
         * Two or Three Tribes Present: hazard creatures of the named race
         * played against the target company do not count against the
         * hazard limit for the remainder of the company's M/H phase.
         */
        readonly type: 'creature-type-no-hazard-limit';
        /** The creature race exempted from the hazard limit. */
        readonly exemptRace: string;
      }
    | {
        /**
         * Dragon's Desolation (tw-29) Mode B: one hazard creature of the
         * named race may be played on the target company ignoring its
         * normal keying. The constraint is consumed when a creature of the
         * matching race is played against this company — `remainingPlays`
         * decrements by 1, and the constraint is removed when it hits 0.
         * The Dragon played "is not considered keyed to anything" (CRF),
         * so normal keying requirements (site-type, region-type) are
         * waived for the single enabled play.
         */
        readonly type: 'creature-keying-bypass';
        /** The creature race whose keying is bypassed. */
        readonly race: string;
        /** How many more creature plays this constraint permits. */
        readonly remainingPlays: number;
      }
    | {
        /**
         * Incite Defenders: the next time automatic-attacks are resolved
         * for the target company, one automatic-attack is duplicated
         * (faced a second time immediately after the original). Consumed
         * when the duplicate attack initiates.
         */
        readonly type: 'auto-attack-duplicate';
      }
    | {
        /**
         * Many Turns and Doublings: the hazard limit for the target
         * company is modified by {@link value}. Applied after the base
         * limit calculation in `computeHazardLimit`. The "no minimum"
         * clause means the limit may drop below the standard floor of 2.
         */
        readonly type: 'hazard-limit-modifier';
        /** The adjustment to the hazard limit (negative to decrease). */
        readonly value: number;
      }
    | {
        /**
         * Promptings of Wisdom / Piercing All Shadows: cancels hazard
         * effects that force the company to return to its site of origin
         * or that tap the company's current or new site. Placed when the
         * bearer ranger taps; scoped to the rest of the turn.
         */
        readonly type: 'cancel-return-and-site-tap';
      }
    | {
        /**
         * Magical Harp: cancels effects for the rest of the turn that
         * discard a target character in the bearer's company. Placed when
         * the item is tapped; scoped to the rest of the turn. Pass-through
         * in `applyConstraint` — consumed directly by any future
         * character-discard resolver by checking for an active
         * `cancel-character-discard` constraint on the target company.
         */
        readonly type: 'cancel-character-discard';
      }
    | {
        /**
         * Rebuild the Town: the company's current site has its automatic
         * attacks removed. When a company enters this site, automatic
         * attacks are skipped entirely. Scoped `until-cleared` — persists
         * as long as the permanent event remains in play.
         */
        readonly type: 'skip-automatic-attacks';
        /** The definition ID of the site whose automatic attacks are skipped. */
        readonly siteDefinitionId: import('./common.js').CardDefinitionId;
      }
    | {
        /**
         * METD §7 / rule 10.08 — once a player attempts the no-tap
         * variant of removing a corruption card from a character, no
         * further attempts (tap or no-tap) on the same
         * character+corruption-card pair may happen for the rest of
         * the turn. Scope is `'turn'`, so this clears at next untap.
         */
        readonly type: 'corruption-removal-locked';
        /** Character that attempted the removal. */
        readonly characterId: CardInstanceId;
        /** Corruption card instance the lock applies to. */
        readonly corruptionInstanceId: CardInstanceId;
      }
    | {
        /**
         * Orc-draughts / Miruvor style: flat stat bonus to every
         * character in the target company for the constraint's scope.
         * The effect resolver synthesises an equivalent
         * {@link StatModifierEffect} for each character belonging to
         * the company when computing stats, so caps and override
         * semantics match the DSL path exactly.
         */
        readonly type: 'company-stat-modifier';
        /** Which stat receives the bonus. */
        readonly stat: 'prowess' | 'body';
        /** The bonus applied to every character in the company. */
        readonly value: number;
      }
    | {
        /**
         * Book of Mazarbul style: +N to the active player's hand size for
         * the rest of the turn. Added when the bearer (a sage) taps the
         * item during the organization phase; swept at turn-end, just
         * before the next untap phase.
         */
        readonly type: 'hand-size-modifier';
        /** The hand size adjustment (positive to increase). */
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
