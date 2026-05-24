/**
 * @module effects
 *
 * Type definitions for the card effects DSL.
 *
 * Every card in MECCG can have context-dependent effects — an item might
 * grant +3 prowess normally but +4 against Orcs, a character might have
 * +2 direct influence but only when attempting to sway a specific faction.
 * Rather than hardcoding these interactions, each card declares its effects
 * as a JSON array using this type system.
 *
 * The DSL has three layers:
 * - **Conditions** — MongoDB-style boolean logic (`$and`, `$or`, `$not`)
 *   that determines when an effect applies, evaluated against a context object.
 * - **Value expressions** — Plain numbers or MathJS strings for computed values.
 * - **Effect types** — 12 primitives covering stat modifiers, check modifiers,
 *   triggered abilities, combat overrides, and more.
 *
 * See `docs/card-effects-dsl.md` for the full design document with examples.
 */

import type { CardDefinitionId, RegionType, SiteType } from './common.js';

// ---- Value Expressions ----

/**
 * A value that is either a literal number or a MathJS expression string.
 * Expression strings are evaluated at runtime with context variables
 * (e.g. `"bearer.baseProwess * 2"`).
 */
export type ValueExpr = number | string;

// ---- Conditions ----

/**
 * A condition that determines when an effect applies.
 *
 * Conditions are evaluated against a context object containing information
 * about the current game situation (who's fighting, what check is being made,
 * etc.). The condition language supports:
 *
 * - **Simple match** — `{ "bearer.race": "hobbit" }` checks dot-path equality.
 * - **Implicit AND** — Multiple keys in one object must all match.
 * - **`$and`** — Explicit AND: all sub-conditions must match.
 * - **`$or`** — At least one sub-condition must match.
 * - **`$not`** — The sub-condition must NOT match.
 * - **`$includes`** — The context value (an array) must contain the given element.
 */
export type Condition =
  | ConditionAnd
  | ConditionOr
  | ConditionNot
  | ConditionMatch;

/** Explicit AND — all sub-conditions must be true. */
export interface ConditionAnd {
  readonly $and: readonly Condition[];
}

/** At least one sub-condition must be true. */
export interface ConditionOr {
  readonly $or: readonly Condition[];
}

/** The sub-condition must be false. */
export interface ConditionNot {
  readonly $not: Condition;
}

/**
 * A plain object where each key is a dot-path into the context and the
 * value is either a literal to compare against or an operator object
 * like `{ "$includes": "warrior" }`.
 *
 * Multiple keys are an implicit AND — all must match.
 */
export interface ConditionMatch {
  readonly [key: string]: string | number | boolean | null | ConditionOperator;
}

/** Operators that can appear as values in a ConditionMatch. */
export interface ConditionOperator {
  /** Checks that the context value (which must be an array) includes this element. */
  readonly $includes?: string | number;
  /** Greater than. */
  readonly $gt?: number;
  /** Greater than or equal. */
  readonly $gte?: number;
  /** Less than. */
  readonly $lt?: number;
  /** Less than or equal. */
  readonly $lte?: number;
  /** Not equal. */
  readonly $ne?: string | number | boolean | null;
  /** Checks that the context value is a member of the given array. */
  readonly $in?: readonly (string | number)[];
  /**
   * Array predicate: no two consecutive elements both differ from the
   * given value. Used by Great Ship's coastal path condition
   * ("no two consecutive non-Coastal regions"). Context value must be
   * an array. An empty array satisfies the predicate trivially.
   */
  readonly $noConsecutiveOtherThan?: string | number;
}

// ---- Effect Types ----

/**
 * Base fields shared by all effect types.
 * Every effect can have an optional `when` condition that gates its application.
 */
interface EffectBase {
  /** Condition that must be true for this effect to apply. If absent, always applies. */
  readonly when?: Condition;
}

/**
 * Modifies a character stat (prowess, body, direct-influence, corruption-points).
 *
 * Supports value caps (`max`), named identifiers (`id`) for override targeting,
 * and the `overrides` field to replace a base effect when a more specific
 * condition matches.
 *
 * Example: Glamdring grants +3 prowess (max 8) normally, but max 9 vs Orcs.
 * The Orc-specific effect uses `overrides` to replace the base one.
 */
export interface StatModifierEffect extends EffectBase {
  readonly type: 'stat-modifier';
  /** Which stat to modify. */
  readonly stat: 'prowess' | 'body' | 'direct-influence' | 'corruption-points' | 'strikes';
  /** The bonus (or penalty if negative) to apply. Can be a MathJS expression. */
  readonly value: ValueExpr;
  /** Maximum resulting stat value. Can be a MathJS expression. */
  readonly max?: ValueExpr;
  /** Named identifier so other effects can reference and override this one. */
  readonly id?: string;
  /** If set, this effect replaces the named effect when its condition matches. */
  readonly overrides?: string;
  /**
   * Scope of this modifier. If absent, affects only the card's bearer.
   * - `"all-characters"` — applies to every character in play (e.g. Sun).
   * - `"all-attacks"` — applies to every automatic-attack and hazard creature.
   * - `"all-automatic-attacks"` — applies only to site automatic-attacks (not hazard creatures).
   * - `"company"` — applies to every character in the bearer's company (e.g. The One Ring).
   */
  readonly target?: 'all-characters' | 'all-attacks' | 'all-automatic-attacks' | 'company';
}

/**
 * Modifies a 2d6 check roll. The {@link CheckKind} discriminator lets
 * one effect target a specific check type (or several at once via the
 * array form, e.g. METD's Foolish Words: -4 to influence, riddling AND
 * offering attempts).
 *
 * Example: Gandalf has +1 to all corruption checks.
 * Example: Beregond has -1 to faction influence checks.
 * Example: Foolish Words (td-25) has -4 vs influence, riddling, offering.
 */
export interface CheckModifierEffect extends EffectBase {
  readonly type: 'check-modifier';
  /**
   * Which check kind(s) this modifier applies to. A bare string targets
   * one kind; an array targets each listed kind (logical OR — the
   * modifier fires if the active check matches any element).
   */
  readonly check: import('./common.js').CheckKind | readonly import('./common.js').CheckKind[];
  /** The bonus (or penalty if negative) to the roll. */
  readonly value: ValueExpr;
}

/**
 * Modifies a card's marshalling points conditionally.
 *
 * Example: Aragorn has -3 marshalling points if eliminated.
 */
export interface MpModifierEffect extends EffectBase {
  readonly type: 'mp-modifier';
  /** The marshalling point adjustment. */
  readonly value: ValueExpr;
}

/**
 * Applies a stat or check-roll modifier to every character in the company that
 * this permanent event is associated with (identified by `CardInPlay.companyId`).
 *
 * Use `stat` for prowess/body/direct-influence/corruption-points modifiers and
 * `check` for 2d6 check-roll bonuses (e.g. "+1 to all corruption checks").
 *
 * Example: Fellowship grants +1 prowess and +1 corruption-check bonus to every
 * character in the company it was played on.
 */
export interface CompanyModifierEffect extends EffectBase {
  readonly type: 'company-modifier';
  /** Which stat to modify (mutually exclusive with `check`). */
  readonly stat?: 'prowess' | 'body' | 'direct-influence' | 'corruption-points';
  /** Which check kind to modify (mutually exclusive with `stat`). */
  readonly check?: import('./common.js').CheckKind;
  /** The modifier value (positive to boost, negative to penalise). */
  readonly value: number;
}

/**
 * Modifies the enemy's stats during combat.
 *
 * Example: Éowyn halves (rounded up) a Nazgûl's body.
 * Example: Wormsbane subtracts 2 from a Dragon/Drake's body.
 */
export interface EnemyModifierEffect extends EffectBase {
  readonly type: 'enemy-modifier';
  /** Which enemy stat to modify. */
  readonly stat: 'prowess' | 'body';
  /** The operation to apply. */
  readonly op: 'halve-round-up' | 'subtract';
  /** Amount to subtract when op is 'subtract'. */
  readonly value?: number;
}

/**
 * Modifies the player's hand size.
 *
 * Example: Elrond grants +1 hand size when at Rivendell.
 */
export interface HandSizeModifierEffect extends EffectBase {
  readonly type: 'hand-size-modifier';
  /** The hand size adjustment. */
  readonly value: ValueExpr;
}

/**
 * Modifies the number of cards drawn during the movement/hazard draw step.
 *
 * Example: Alatar reduces the opponent's hazard draws by 1 for his company.
 * Example: Radagast adds +1 resource draw per Wilderness in the site path
 * via the expression `"sitePath.wildernessCount"`.
 */
export interface DrawModifierEffect extends EffectBase {
  readonly type: 'draw-modifier';
  /** Which draw pool to modify. */
  readonly draw: 'hazard' | 'resource';
  /**
   * The adjustment (negative = fewer draws). Accepts a value expression
   * evaluated against the resolver context, which exposes `sitePath`
   * counts (`wildernessCount`, `shadowCount`, `darkCount`,
   * `coastalCount`, `freeCount`, `borderCount`) derived from the
   * moving company's resolved site path.
   */
  readonly value: ValueExpr;
  /** Floor for the modified draw count. */
  readonly min?: number;
}

/**
 * Grants a new activated ability to the card's bearer.
 *
 * Example: Gandalf can tap to test a gold ring in his company.
 *
 * When `apply` is present, the reducer pays the cost and dispatches on
 * the apply's `type` — no per-action-ID branch is needed in engine
 * code. Cards without `apply` fall through to legacy per-action-ID
 * handlers (kept alive until every card migrates).
 */
export interface GrantActionEffect extends EffectBase {
  readonly type: 'grant-action';
  /** The action identifier that the engine recognizes. */
  readonly action: string;
  /** The cost to activate this ability. */
  readonly cost: ActionCost;
  /**
   * For roll-based actions, the minimum 2d6 total required for success.
   * E.g. "greater than 7" → rollThreshold: 8 (need roll >= 8).
   */
  readonly rollThreshold?: number;
  /**
   * When true, the ability may be activated during any phase of the
   * controlling player's turn (CRF rule 2.1.1). Applies to
   * discard-to-effect items like Cram and Orc-draughts. When absent
   * or false, the ability is restricted to its natural phase (site /
   * organization / end-of-turn / etc.).
   */
  readonly anyPhase?: boolean;
  /**
   * When true, the ability may additionally be activated during the
   * opposing player's site phase (the bearer is the hazard / non-active
   * player). Used by Magical Harp's "may also be so tapped during
   * opponent's site phase" clause. Independent of {@link anyPhase},
   * which covers only the bearer's own turn.
   */
  readonly opposingSitePhase?: boolean;
  /**
   * When true, the ability may additionally be activated during the
   * Free Council (endgame) corruption-checks step, by either player.
   * Used by Magical Harp's "may also be so tapped during ... the Free
   * Council" clause.
   */
  readonly freeCouncil?: boolean;
  /**
   * Generic effect produced by the action. When present, the reducer
   * pays `cost` then dispatches on `apply.type` (reusing the existing
   * TriggeredAction apply dispatch shared with `on-event` and
   * `play-option`). Supported targets for character-scoped applies
   * include `"bearer"` — the character holding the source card.
   */
  readonly apply?: TriggeredAction;
  /**
   * Optional target-enumeration descriptor. When present, the legal-action
   * generator enumerates candidate cards in the given `scope` (optionally
   * restricted by `filter`) and emits one activation per match, each
   * carrying the candidate's `instanceId` as `targetCardId`. Used by
   * per-target actions like Gandalf's gold-ring test.
   */
  readonly targets?: GrantActionTargets;
}

/**
 * Descriptor for enumerating per-target activations of a grant-action.
 *
 * `scope` names a zone relative to the action's bearer. Supported values:
 * - `"company-items"` — items borne by any character in the bearer's company.
 *
 * `filter` is a DSL condition matched against each candidate card's
 * definition; candidates that fail the filter are skipped.
 */
export interface GrantActionTargets {
  readonly scope: 'company-items';
  readonly filter?: Condition;
}

/** The cost required to activate a granted action. */
export interface ActionCost {
  /**
   * The entity to tap. "self" taps the source card itself (the bearer character
   * or the attached item/ally); "bearer" taps the character carrying the source;
   * "character" taps the explicitly targeted character; "sage-in-company" taps an
   * untapped sage in the bearer's company; "sage-and-scout-in-company" taps one
   * untapped sage AND one untapped scout in the bearer's company (The Worthy Hills
   * as-142 special rule — the action carries sage as `characterId` and scout as
   * `secondCharacterId`); "self-and-bearer" taps BOTH the source item AND its
   * bearer character (used by Torque of Hues — requires both item and bearer
   * to be untapped).
   */
  readonly tap?: 'self' | 'bearer' | 'character' | 'sage-in-company' | 'sage-and-scout-in-company' | 'self-and-bearer';
  /**
   * The entity to discard. "self" discards the source card from its bearer.
   * "bearer" and "character" are reserved for future use.
   */
  readonly discard?: 'self' | 'bearer' | 'character';
  /**
   * The entity to wound (set to Inverted). "bearer" wounds the character
   * carrying the source; "character" wounds the targeted character; "self"
   * wounds the actor.
   */
  readonly wound?: 'self' | 'bearer' | 'character';
  /** If set, a check must be passed (e.g. corruption check). */
  readonly check?: 'corruption';
  /** Modifier applied to the cost check roll. */
  readonly modifier?: number;
  /**
   * Custom failure consequence for corruption-check costs. When set to
   * `'discard-ring-only'`, a failed check discards the bearer's Ring item
   * instead of the character (e.g. The Ring's Betrayal).
   */
  readonly failureMode?: 'discard-ring-only';
}

/**
 * A triggered effect that fires when a specific game event occurs.
 *
 * Example: Barrow-wight forces a corruption check (modified by -2)
 * on each character it wounds.
 */
export interface OnEventEffect extends EffectBase {
  readonly type: 'on-event';
  /** The game event that triggers this effect. */
  readonly event: string;
  /** The effect to apply when triggered. */
  readonly apply: TriggeredAction;
  /** Who the triggered effect targets. Omit for effects that target implicitly (e.g. all opposing environments). */
  readonly target?: string;
  /**
   * For `end-of-turn` events: which player(s) the effect fires for.
   *  - `'both'` — fires once per player (enqueues one pending effect per player).
   *  - `'hazard'` — fires only for the hazard (non-active) player.
   *  - `'resource'` — fires only for the resource (active) player.
   * When absent, the effect fires for the source card's owner only.
   */
  readonly actor?: 'both' | 'hazard' | 'resource';
  /**
   * For `end-of-company-mh` + `force-check` applies: restrict the
   * per-region iteration to regions whose type appears in this array.
   * When omitted the apply fires once per region in the resolved site
   * path. Used by *Lure of Nature* ("for each Wilderness in his
   * company's site path") to enqueue a corruption check only for
   * wilderness regions.
   */
  readonly regionTypeFilter?: readonly RegionType[];
}

/** An action performed by a triggered effect. */
export interface TriggeredAction {
  /**
   * The type of triggered action.
   *
   * Supported types include:
   * - `force-check` — enqueue a single corruption check on the `target` character.
   * - `force-check-all-company` — enqueue a corruption check on **every** character
   *   in the attacked company. Used by Corpse-candle under `creature-attack-begins`
   *   so that all characters make a corruption check before defenders are selected.
   *   Uses `check` (must be `"corruption"`) and optional `modifier`.
   * - `offer-char-join-attack` — offer a haven character the option to join the attack.
   * - `unlock-hoard-bounty` — under `on-event: self-enters-play`, sets
   *   `SitePhaseState.hoardBountyAvailable = true`, allowing one additional minor
   *   or major item to be played at the current tapped hoard site. Only fires during
   *   the site phase. Used by *Bounty of the Hoard* (td-101).
   * - `unlock-thorough-search` — under `on-event: self-enters-play`, sets
   *   `SitePhaseState.thoroughSearchAvailable = true`, allowing one additional
   *   minor, major, or gold ring item to be played without tapping the site.
   *   Only fires during the site phase. Used by *Thorough Search* (tw-349).
   * (Other types documented inline on their respective fields.)
   */
  readonly type: string;
  /**
   * Which check to force (for `force-check` / `force-check-all-company`) or which
   * check's modifiers to sum into a 2d6 roll (for `roll-check`).
   */
  readonly check?: string;
  /** Modifier to the forced check. */
  readonly modifier?: number;
  /**
   * Filter condition for `discard-cards-in-play` and `enqueue-pending-fetch`
   * — matches against card definitions. For fetch apply, restricts which
   * discard-pile cards the player may pick (e.g. resource or character only).
   */
  readonly filter?: Condition;
  /**
   * For `add-constraint` type: which active-constraint kind to add to
   * the target. Maps directly to {@link ActiveConstraint.kind.type}.
   */
  readonly constraint?: string;
  /**
   * For `add-constraint` type: the scope of the constraint, encoded as
   * a string. The on-event handler maps it to {@link ConstraintScope}:
   *  - `"company-site-phase"` → company-site-phase scoped to the target company
   *  - `"company-mh-phase"` → company-mh-phase scoped to the target company
   *  - `"phase: <name>"` → phase scoped
   *  - `"turn"` → turn scoped
   *  - `"until-cleared"` → never auto-swept
   */
  readonly scope?: string;
  /**
   * For `add-constraint` type with `constraint: "check-modifier"`: numeric
   * bonus (or penalty if negative) applied to the target's next check of
   * the matching type.
   *
   * Also used by `add-constraint` with `constraint: "company-stat-modifier"`
   * to carry the flat bonus applied to every character in the target
   * company (e.g. Orc-draughts: `+1`).
   */
  readonly value?: number;
  /**
   * For `add-constraint` type with `constraint: "check-modifier"`: MathJS
   * expression evaluated at play time against target character context to
   * compute a dynamic numeric bonus. The context exposes
   * `target.baseProwess` (the character's base prowess).
   * Use when the bonus depends on character attributes
   * (e.g. `"min(target.baseProwess, 5)"` for Muster). Mutually exclusive
   * with `value`.
   */
  readonly valueExpr?: string;
  /**
   * For `add-constraint` with `constraint: "company-stat-modifier"` or
   * `"character-stat-modifier"`: which stat the bonus applies to.
   */
  readonly stat?: 'prowess' | 'body' | 'direct-influence';
  /**
   * For `add-constraint` with `constraint: "creature-attack-boost"`:
   * the creature race to filter (e.g. `"undead"`).
   */
  readonly race?: string;
  /**
   * For `add-constraint` with `constraint: "creature-attack-boost"`:
   * prowess bonus applied to matching creature attacks.
   */
  readonly prowess?: number;
  /**
   * For `add-constraint` with `constraint: "creature-attack-boost"`:
   * strike bonus applied to matching creature attacks.
   */
  readonly strikes?: number;
  /**
   * For `add-constraint` with `constraint: "site-phase-do-nothing"`:
   * optional DSL condition evaluated per-character in the target company.
   * When a character's attributes satisfy the condition, that character
   * may tap to cancel the constraint. Example (River): rangers may tap
   * to cancel a do-nothing constraint via `{ "actor.skills": { "$includes":
   * "ranger" } }`.
   */
  readonly cancelWhen?: Condition;
  /**
   * For `set-character-status` type: the new status for the target
   * character (e.g. `"untapped"` to untap or heal).
   */
  readonly status?: 'untapped' | 'tapped' | 'inverted';
  /**
   * For `force-check` with `perOthersItem: true`: enqueue one corruption
   * check per item borne by other characters in the bearer's company.
   * The modifier for each check is the negative corruption-point value of
   * the item. Used by *Covetous Thoughts* (le-107).
   */
  readonly perOthersItem?: boolean;
  /**
   * Selector for which entity the apply acts on. Interpretation is
   * context-specific — for `grant-action` applies, `"bearer"` means the
   * character holding the source card. Absent selectors fall back to
   * the enclosing effect's implicit target.
   */
  readonly target?: string;
  /**
   * For `roll-then-apply` type: the 2d6 total at or above which
   * `onSuccess` fires. Otherwise `onFailure` fires (if present).
   */
  readonly threshold?: number;
  /** For `roll-then-apply` type: apply run when the roll meets `threshold`. */
  readonly onSuccess?: TriggeredAction;
  /** For `roll-then-apply` type: apply run when the roll is below `threshold`. */
  readonly onFailure?: TriggeredAction;
  /**
   * For `set-company-special-movement` type: which special-movement
   * mode to flag on the bearer's company. The engine's movement code
   * consults `Company.specialMovement` to alter planning and M/H rules
   * for Gwaihir-granted flights.
   */
  readonly specialMovement?: 'gwaihir';
  /**
   * For `increment-company-extra-region-distance` type: how much to
   * add to the bearer's company `extraRegionDistance`. Movement code
   * reads this counter when computing the maximum region path length
   * for the turn (e.g. Cram adds 1).
   */
  readonly amount?: number;
  /**
   * For `sequence` type: the ordered list of sub-applies to run. Each
   * runs on the character state produced by the previous, and all
   * side-effects (constraints, pending resolutions, dice rolls) are
   * concatenated in declaration order.
   */
  readonly apps?: readonly TriggeredAction[];
  /**
   * For `roll-check` type: human-readable label for the dice-roll
   * GameEffect. The handler appends `": ${bearerName} tests
   * ${targetCardName}"` when the action carries a target, or
   * `": ${bearerName}"` otherwise. See also {@link TriggeredAction.check}
   * for the check whose modifiers are summed into the roll.
   */
  readonly label?: string;
  /**
   * For `cancel-chain-entry` type: which chain entry to negate.
   *  - `most-recent-unresolved-hazard`: the latest unresolved hazard
   *    entry (hazard-creature or hazard-event) in the chain. Used by
   *    Great Ship.
   *  - `target`: the chain entry whose card matches the enclosing
   *    short-event's `targetInstanceId`. Used by Searching Eye — the
   *    emitter filters valid targets to entries whose source card has
   *    an effect matching {@link TriggeredAction.requiredSkill}.
   *
   * For `remove-constraint` type: which constraint(s) to remove.
   *  - `constraint-source`: remove every active constraint whose
   *    `source` matches the action's `sourceCardId` (i.e. the source
   *    card's constraints get swept). Used by River.
   */
  readonly select?:
    | 'most-recent-unresolved-hazard'
    | 'constraint-source'
    | 'self'
    | 'target'
    | 'filter-all'
    | 'named';
  /**
   * For `cancel-chain-entry` with `select: 'target'`: restrict valid
   * targets to chain entries whose source card has at least one effect
   * carrying a matching `requiredSkill` (e.g. Searching Eye matches
   * `"scout"` to cancel Concealment / A Nice Place to Hide / Stealth
   * chain entries).
   */
  readonly requiredSkill?: string;
  /**
   * For `add-constraint` with `constraint: 'granted-action'`: payload
   * describing the action to be granted by the constraint. Mirrors
   * {@link GrantActionEffect} fields plus `phase`/`window` so the
   * legal-action layer knows where to offer it.
   */
  readonly grantedAction?: GrantedActionConstraintPayload;
  /**
   * For `enqueue-pending-fetch` type: which pile to fetch from.
   * Matches the `source` field on `FetchToDeckEffect`.
   */
  readonly fetchFrom?: readonly ('discard-pile' | 'deck' | 'hand')[];
  /** For `enqueue-pending-fetch` type: how many cards to fetch. Defaults to 1. */
  readonly fetchCount?: number;
  /** For `enqueue-pending-fetch` type: reshuffle play deck after fetch. */
  readonly fetchShuffle?: boolean;
  /**
   * For `enqueue-pending-fetch` type: when true, enqueue a corruption
   * check on the bearer after the fetch completes. Used by Palantír
   * grant-actions.
   */
  readonly postCorruptionCheck?: boolean;
  /**
   * For `discard-named-card-from-company` type: the name of the card to
   * search for among the bearer's company's attached items/allies and
   * move to the owner's discard pile. Used by Stinker / Gollum to discard
   * The One Ring alongside the ally.
   */
  readonly cardName?: string;
  /**
   * For `offer-char-join-attack` type (fired under
   * `on-event: creature-attack-begins`): when true, allies attached to
   * the bearer are discarded when the bearer joins the attacked company.
   * (Alatar — "discard allies he controls".)
   */
  readonly discardOwnedAllies?: boolean;
  /**
   * For `offer-char-join-attack` type: when true, accepting the offer
   * forces the attacking creature to direct one strike at the bearer
   * regardless of the defender's normal assignment priorities.
   */
  readonly forceStrike?: boolean;
  /**
   * For `offer-char-join-attack` type: effects applied to the bearer
   * at combat finalization (win or lose). Composable — future cards
   * can toggle tap, corruption check, or both without a new apply type.
   */
  readonly postAttack?: {
    readonly tapIfUntapped?: boolean;
    readonly corruptionCheck?: { readonly modifier?: number };
  };
  /** For `move` type: source zone(s) to locate instances in. */
  readonly from?: MoveZone | readonly MoveZone[];
  /** For `move` type: destination zone. */
  readonly to?: MoveZone;
  /** For `move` type: whose destination pile to push to. */
  readonly toOwner?: 'source-owner' | 'opponent' | 'defender';
  /** For `move` type: shuffle destination pile after pushing. */
  readonly shuffleAfter?: boolean;
  /**
   * For `move` type: corruption check enqueued on the bearer after
   * resolution (bounce-hazard-events migration).
   */
  readonly corruptionCheck?: { readonly modifier: number };
  /** For `move` type with `count`: cap on how many instances to move. */
  readonly count?: number;
}

/**
 * Payload carried by a TriggeredAction that adds a `granted-action`
 * active constraint. The legal-action generator for the matching
 * phase/window evaluates `when` per candidate and emits
 * `activate-granted-action` actions; the reducer reads `apply` and
 * dispatches on its type.
 */
export interface GrantedActionConstraintPayload {
  readonly action: string;
  /**
   * Phase in which the granted action is legal. When absent, any
   * phase that calls the granted-action emitter sees this action.
   */
  readonly phase?: string;
  /** Optional sub-step / window within the phase. */
  readonly window?: string;
  /** Cost to activate. */
  readonly cost: ActionCost;
  /** Optional gating condition evaluated per candidate. */
  readonly when?: Condition;
  /** Effect executed on dispatch. */
  readonly apply: TriggeredAction;
}

/**
 * Declares one of several mutually-exclusive choices the player may make
 * when playing a card. Each option has an optional `when` condition that
 * is evaluated against the target context ({@link PlayTargetEffect}); when
 * it matches, the option is offered as a separate legal action. The
 * chosen option's `apply` is resolved generically by the reducer.
 *
 * Example: Halfling Strength declares three options — untap the tapped
 * hobbit, heal the wounded hobbit, or grant a one-shot +4 corruption
 * check boost. The first two carry a `when` on the target's status; the
 * third is always available.
 */
export interface PlayOptionEffect extends EffectBase {
  readonly type: 'play-option';
  /** Stable identifier the engine uses to dispatch the chosen option. */
  readonly id: string;
  /** The effect that resolves when this option is selected. */
  readonly apply: TriggeredAction;
}

/**
 * Allows the bearer to cancel an incoming strike by paying a cost.
 *
 * When `target` is absent or `"self"`, cancels a strike against the bearer
 * (e.g. The One Ring). When `target` is `"other-in-company"`, the character
 * taps to cancel a strike against another character in the same company
 * (e.g. Fatty Bolger protecting hobbits). A `filter` condition selects
 * which characters qualify as valid protection targets.
 */
export interface CancelStrikeEffect extends EffectBase {
  readonly type: 'cancel-strike';
  /** The cost to cancel the strike. */
  readonly cost: ActionCost;
  /** Who the cancel targets: the bearer's own strike or another character's. */
  readonly target?: 'self' | 'other-in-company';
  /** DSL condition filtering which characters can be protected (for `other-in-company`). */
  readonly filter?: Condition;
}

/**
 * The attacking player assigns strikes to defending characters, instead
 * of the defender assigning them. Example: Cave-drake.
 */
export interface CombatAttackerChoosesDefendersEffect extends EffectBase {
  readonly type: 'combat-attacker-chooses-defenders';
}

/**
 * The creature makes several separate attacks, all against the same
 * target character. Each sub-attack uses the creature's base strike
 * count. Example: Assassin — three attacks of one strike each.
 */
export interface CombatMultiAttackEffect extends EffectBase {
  readonly type: 'combat-multi-attack';
  /** How many separate attacks the creature makes. */
  readonly count: number;
}

/**
 * The defending player may tap characters in the defending company to cancel
 * attacks. By default only non-target characters may tap (Assassin: "not the
 * defending character"). When `allowTargetToCancel` is true, the target
 * character may also tap to cancel (Slayer: "any one character").
 */
export interface CombatCancelAttackByTapEffect extends EffectBase {
  readonly type: 'combat-cancel-attack-by-tap';
  /** Maximum number of attacks that can be canceled. */
  readonly maxCancels: number;
  /**
   * When true, the target character (the one assigned the strike) may also tap
   * to cancel one of the attacks. Defaults to false (Assassin restriction).
   */
  readonly allowTargetToCancel?: boolean;
}

/**
 * The creature makes one strike per character in the defending company:
 * `strikesTotal = company.characters.length`. Card text is typically
 * "Each character in the company faces one strike". The card's raw
 * `strikes` value is ignored when this effect is present. Mutually
 * exclusive with `combat-multi-attack`.
 *
 * When `excludeAvatars` is true, avatar characters (Wizards and Ringwraiths,
 * whose `mind === null`) are excluded: `strikesTotal = non-avatar characters`.
 * Card text is "Each non-Wizard/non-Ringwraith character in the company faces
 * one strike" (e.g. Neeker-breekers).
 */
export interface CombatOneStrikePerCharacterEffect extends EffectBase {
  readonly type: 'combat-one-strike-per-character';
  /** When true, avatar characters (mind === null) are excluded from strike assignment. */
  readonly excludeAvatars?: boolean;
}

/**
 * Each defending character's prowess for this attack is replaced by their
 * mind attribute value instead of their normal combat prowess. Used by
 * Neeker-breekers: "His prowess against such a strike is equal to his mind
 * attribute." Avatar characters (mind === null) are never assigned strikes
 * when this effect is paired with `combat-one-strike-per-character:
 * excludeAvatars`. Status modifiers (tapped, wounded) and support bonuses
 * still apply on top of the mind base.
 */
export interface CombatDefenderProwessFromMindEffect extends EffectBase {
  readonly type: 'combat-defender-prowess-from-mind';
}

/**
 * Marks the attack as detainment (see CoE §3.II). A detainment attack
 * taps characters instead of wounding them, suppresses the character
 * body-check, and zeros kill-MP for the defeated creature. Presence of
 * this effect is the entire payload — no fields.
 *
 * Most detainment status is computed at combat-initiation time from the
 * defending player's alignment and the attack's keying (rules 3.II.2 /
 * 3.II.4); this effect covers the residual "or depends on an effect of
 * the attack itself" clause of rule 3.II.2.
 */
export interface CombatDetainmentEffect extends EffectBase {
  readonly type: 'combat-detainment';
}

/**
 * Closed set of presence-only flags that toggle uniform play-time
 * behaviors in the engine. Each flag is a single keyword, matched
 * exactly — no card-specific dispatch, just "does the card declare
 * this flag?". Adding a new flag means extending this union in one
 * place plus the engine code that consumes it.
 *
 * - `home-site-only` — character can only be played at its own homesite
 *   (not at havens or other companies). Frodo and Sam carry this.
 *   The effect's optional `when` clause gates whether the flag is
 *   active in a given context (e.g. Frodo's flag is inactive when
 *   placed as a starting character).
 * - `playable-as-resource` — a hazard card may also be played through
 *   resource menus to cancel an environment (e.g. Twilight).
 * - `playable-as-hazard` — a resource card may also be played through
 *   hazard menus (e.g. Sudden Call, le-235).
 * - `no-hazard-limit` — playing this hazard does not consume a slot
 *   against the per-company hazard limit (e.g. Twilight, Lure).
 * - `not-starting-character` — character may not be drafted as one of
 *   the player's starting characters (e.g. Fram Framson). The character
 *   can still be shuffled into the play deck and brought into play
 *   normally.
 * - `allow-store-eot` — while this permanent event is in the owner's
 *   `cardsInPlay`, that player's characters may store eligible resources
 *   (items with `storable-at` effects) during the end-of-turn phase as
 *   though it were their organization phase (e.g. Safe from the Shadow,
 *   Tokens to Show).
 * - `tap-site-on-play` — taps the active company's current site when this
 *   permanent event resolves from the chain. Used by cards whose text
 *   explicitly says "Tap the site" as part of their play effect (e.g.
 *   The Windlord Found Me). Respects the `never-taps` site-rule.
 * - `healing-affects-all` — healing effects applied to one character in the
 *   company extend to all other wounded characters in the same company (e.g.
 *   Ioreth). Equivalent to the `healing-affects-all` site-rule but carried
 *   by a character.
 * - `no-direct-influence` — the bearing character cannot be controlled by
 *   direct influence; any existing DI control is reverted to GI when this
 *   hazard attaches (e.g. Rebel-talk).
 * - `no-attack` — the bearer (typically an ally) may not be assigned strikes
 *   from any attack source (e.g. Goldberry).
 * - `no-attack-site-keyed` — the bearer may not be assigned strikes from
 *   automatic-attacks or hazard creatures whose `keyedTo` includes the
 *   site type of the company's current or destination site (e.g. Quickbeam,
 *   Treebeard).
 * - `playable-at-tapped-site` — the ally may be played at a site that is
 *   already tapped (overrides the default "allies require untapped site" rule).
 *   Used by Noble Steed, which is explicitly playable at "tapped or untapped"
 *   non-Haven sites in its region list.
 */
export type PlayFlag = 'home-site-only' | 'playable-as-resource' | 'playable-as-hazard' | 'no-hazard-limit' | 'not-starting-character' | 'tapped-site-only' | 'untapped-site-required' | 'allow-store-eot' | 'tap-site-on-play' | 'healing-affects-all' | 'no-direct-influence' | 'no-attack' | 'no-attack-site-keyed' | 'playable-at-tapped-site';

/**
 * Declares a closed play-flag keyword on a card. See {@link PlayFlag}
 * for the set of recognized flags and their semantics. Presence of the
 * effect (optionally gated by `when`) is the entire payload — there is
 * no per-card dispatch in the engine.
 */
export interface PlayFlagEffect extends EffectBase {
  readonly type: 'play-flag';
  readonly flag: PlayFlag;
}

/**
 * When present on a resource permanent event, causes the company to
 * face an automatic attack of the given type immediately after the card
 * enters play (attaches to a character). If all characters in the
 * company are tapped after combat, the card is discarded from its
 * bearer's items. Otherwise the bearer gains a `bearer-cannot-untap`
 * constraint (scoped `until-cleared`) so they remain tapped until the
 * card is stored.
 *
 * Used by *Rescue Prisoners* (tw-315): Spider, 2 strikes, prowess 7.
 */
export interface TriggerAttackOnPlayEffect extends EffectBase {
  readonly type: 'trigger-attack-on-play';
  /** Creature type of the triggered attack (e.g. `"Spider"`). */
  readonly creatureType: string;
  /** Number of strikes the attack delivers. */
  readonly strikes: number;
  /** Prowess of each strike. */
  readonly prowess: number;
}

/**
 * Deck-search-and-attack effect for Lucky Search (tw-269).
 *
 * When this short event resolves, the engine automatically reveals cards from
 * the active player's play deck one at a time until a valid non-special item
 * is found (or the deck is exhausted). The scout (from `play-target`) then
 * faces a single uncancelable strike with prowess = `baseProwess` + number
 * of cards revealed. After combat:
 * - If the scout is not wounded: the found item is attached to the scout.
 * - If the scout is wounded: the found item is discarded.
 * - All revealed non-item cards are shuffled back into the deck.
 */
export interface DeckSearchAttackEffect extends EffectBase {
  readonly type: 'deck-search-attack';
  /** Base prowess added to the number of cards revealed. */
  readonly baseProwess: number;
  /** Number of strikes (always 1 for Lucky Search). */
  readonly strikes: number;
  /** Whether this attack cannot be canceled. */
  readonly uncancelable: boolean;
}

/**
 * Tap an agent of the specified skill at the target company's current site,
 * triggering an agent attack during the movement/hazard phase (rule 9.06).
 *
 * If the chosen agent is face-down, it must be revealed as an active
 * condition, but is treated as face-down at declaration time for prowess
 * and body modifier purposes (rule 9.06).
 *
 * Used by An Article Missing (dm-43) and Cunning Foes (dm-50).
 */
export interface TapAgentEffect extends EffectBase {
  readonly type: 'tap-agent-at-site';
  /**
   * Required agent skill. If omitted, any agent may be tapped.
   * Values: `"scout"`, `"warrior"`, etc.
   */
  readonly skill?: string;
  /** Prowess modifier added to the agent's base (+ any face-down modifiers). */
  readonly prowessBonus: number;
  /** Whether the attacker assigns strikes (true → attacker chooses defenders). */
  readonly attackerAssigns: boolean;
  /**
   * Special strike resolution effect.
   * `"discard-item"`: a successful strike does not wound; instead the
   * defending company must discard one item (defender's choice).
   */
  readonly strikeEffect?: 'discard-item';
}

/**
 * An agent may tap (not as an agent action) to make an influence attempt
 * against an opponent's character, ally, or faction during the M/H phase.
 *
 * CoE rule 10.14: "Agent only: may tap to make an influence check on an ally,
 * faction, or character."
 */
export interface AgentTapInfluenceEffect extends EffectBase {
  readonly type: 'agent-tap-influence';
  /**
   * Which kinds of targets this agent may influence.
   * Typically all three: character, ally, faction.
   */
  readonly targetKinds: readonly ('character' | 'ally' | 'faction')[];
}

/**
 * An agent may tap (not as an agent action) at a company's new site during
 * the M/H phase to attack that company.
 *
 * Rule 10.14 analog for attacks: "Agent only: may tap at a company's new
 * site to attack that company during its movement/hazard phase with +N prowess."
 *
 * Used by The Grimburgoth (dm-15).
 */
export interface AgentTapAttackEffect extends EffectBase {
  readonly type: 'agent-tap-attack';
  /** Prowess bonus added to the agent's base prowess (plus any face-down bonuses). */
  readonly prowessBonus: number;
  /** Whether the attacker assigns strikes (true → attacker chooses defenders). Defaults to defender assigns. */
  readonly attackerAssigns?: boolean;
}

/**
 * Played from hand as a short event during combat (pre-assignment window).
 * Applies a stat modifier to every character in the defending company
 * whose card definition satisfies the optional `filter` condition.
 * The modifier is scoped to the current attack only (cleared when the
 * attack finalizes via the `attack` {@link ConstraintScope}).
 *
 * Implemented via individual `character-stat-modifier` active constraints
 * — one per matching character — so caps and overrides work identically
 * to JSON-declared stat-modifiers.
 *
 * Example: The Dwarves Are upon You! (+2 prowess / −1 body to all Dwarves
 * in the company against the current attack).
 */
export interface CompanyCombatBoostEffect extends EffectBase {
  readonly type: 'company-combat-boost';
  /** The stat to modify (`"prowess"` or `"body"`). */
  readonly stat: 'prowess' | 'body';
  /** The modifier value (positive to boost, negative to penalise). */
  readonly value: number;
  /**
   * Optional DSL condition evaluated against `{ target: { race, name, skills } }`
   * for each character in the defending company. Only characters that satisfy
   * the condition receive the modifier. When absent, every character in the
   * company receives it.
   */
  readonly filter?: Condition;
}

/**
 * Caps how many copies of this card can exist in a given scope.
 *
 * Example: Horn of Anor — cannot be duplicated on a given character.
 */
export interface DuplicationLimitEffect extends EffectBase {
  readonly type: 'duplication-limit';
  /** The scope within which the limit applies (e.g. "character", "player"). */
  readonly scope: string;
  /** Maximum number of copies allowed in scope. */
  readonly max: number;
}

/**
 * While this card is in play, each agent owned by the hazard player may take
 * this many additional agent actions each time it normally takes an agent action.
 * The extra action(s) do not trigger further extras (only a "normal" first
 * action triggers the bonus).
 *
 * Used by Great Need or Purpose (dm-62).
 */
export interface ExtraAgentActionsEffect extends EffectBase {
  readonly type: 'extra-agent-actions';
  /** Number of additional agent actions granted per normal agent action. */
  readonly value: number;
}

/**
 * Restricts the timing window when a card may be played. The engine
 * uses this to gate the card out of normal play menus until the
 * matching window opens.
 *
 * Examples:
 * - Stealth: `{ phase: 'organization', step: 'end-of-org' }` — only
 *   playable during the end-of-organization window.
 */
export interface PlayWindowEffect extends EffectBase {
  readonly type: 'play-window';
  /** The phase in which this card may be played. */
  readonly phase: string;
  /** The sub-step within the phase. Absent when the card is playable throughout the phase. */
  readonly step?: string;
  /**
   * Optional site-type restriction: when present, the card may only be played
   * when the company's current site has one of these types. Checked alongside
   * the phase restriction; both must be satisfied. Uses {@link SiteType} values.
   */
  readonly siteTypes?: readonly string[];
}

/**
 * Declares what this card targets when played. The engine uses this to
 * generate per-target actions (e.g. one per eligible character).
 *
 * Character targeting is expressed entirely via the DSL: the coarse
 * `target: "character"` selects the scope (each character in scope is a
 * candidate) and an optional `filter` {@link Condition} refines it
 * further. The filter is evaluated against the per-candidate context
 * `{ target: { race, status, skills, name, itemKeywords }, company: { skills } }`, so conditions look like
 * `{ "target.race": "hobbit" }` or
 * `{ "target.skills": { "$includes": "scout" } }` — no card-specific
 * target keywords are needed in the engine.
 */
export interface PlayTargetEffect extends EffectBase {
  readonly type: 'play-target';
  /**
   * The coarse target category. Resource-side `character` implicitly
   * scopes to the active player's own characters; hazard-side
   * `character` scopes to the active company's characters.
   */
  readonly target: 'character' | 'company' | 'site' | 'faction';
  /**
   * Optional DSL condition refining which candidates qualify. Evaluated
   * against the per-candidate context (e.g. `target.race`,
   * `target.status`, `target.skills`). When absent every candidate in
   * scope qualifies.
   */
  readonly filter?: Condition;
  /**
   * Maximum effective company size for the target's company. When set,
   * the card is only playable if the candidate's company has effective
   * size ≤ this value (hobbits count as half).
   */
  readonly maxCompanySize?: number;
  /**
   * Cost paid by the targeted character when this card is played.
   * Supported cost shapes:
   * - `tap: "character"` — taps the targeted character (e.g. Stealth).
   * - `check: "corruption", modifier: N` — the targeted character makes a
   *   corruption check modified by N (e.g. Dragon-sickness: modifier -1).
   *   The check is enqueued by the chain resolver when the short-event entry
   *   resolves.
   */
  readonly cost?: ActionCost;
  /**
   * Declarative tag: the card's text requires a character with this skill
   * to be played. Typically mirrors a `filter` clause like
   * `{ "target.skills": { "$includes": "scout" } }` — the filter remains
   * authoritative for target selection, but this tag lets other effects
   * cross-reference the requirement without pattern-matching the filter
   * tree (e.g. Searching Eye cancels any card that "requires scout skill").
   */
  readonly requiredSkill?: string;
}

/**
 * Declares when an on-guard card may be revealed during the site phase.
 * The trigger specifies the game event that opens the reveal window.
 *
 * When `apply` is present, the reveal also runs a triggered action instead
 * of initiating a nested chain for the revealed card. Currently used by
 * Searching Eye: reveal cancels the deferred resource play whose source
 * card matches the enclosed `requiredSkill` (if any).
 */
export interface OnGuardRevealEffect extends EffectBase {
  readonly type: 'on-guard-reveal';
  /** The game event that allows the on-guard card to be revealed. */
  readonly trigger: string;
  /**
   * Optional triggered action fired when the on-guard card is revealed.
   * `cancel-chain-entry` with `select: 'target'` + `requiredSkill` cancels
   * the deferred resource play (and discards its card) when the source
   * card matches the skill filter.
   */
  readonly apply?: TriggeredAction;
}

/**
 * Restricts an item to be playable only where the company's current
 * site satisfies a constraint. Two mutually-exclusive forms:
 *
 * - `sites`: the site's name must appear in the list (e.g. Palantír of
 *   Orthanc — Isengard only).
 * - `filter`: a generic site-card condition evaluated against
 *   `{ site: <site definition> }` (e.g. hoard items: every site whose
 *   card definition has `hoard: true`).
 *
 * When present, the normal site-type check (`playableResources`) is
 * bypassed; the item is playable only if its restriction matches.
 */
export interface ItemPlaySiteEffect extends EffectBase {
  readonly type: 'item-play-site';
  /** Site names where the item can be played. Mutually exclusive with `filter`. */
  readonly sites?: readonly string[];
  /** Generic site filter, evaluated against `{ site: siteDef }`. */
  readonly filter?: Condition;
}

/**
 * Declares a site-specific rule that modifies standard game mechanics
 * when a company is at this site.
 *
 * Examples:
 * - Old Forest — healing effects affect all characters at the site.
 * - Tolfalas — any greater item other than Scroll of Isildur is denied.
 */
export type SiteRuleEffect =
  | HealingAffectsAllSiteRule
  | DenyItemSiteRule
  | DenyCharacterSiteRule
  | CancelAttacksSiteRule
  | AutoTestGoldRingSiteRule
  | AttacksNotDetainmentSiteRule
  | NeverTapsSiteRule
  | HealDuringUntapSiteRule
  | DynamicAutoAttackSiteRule
  | AlwaysReturnToDeckSiteRule
  | HazardLimitSiteRule
  | AllowCreatureByRaceSiteRule
  | CreaturesAlwaysKeyedToSiteSiteRule
  | AllowItemsWhenTappedSiteRule
  | CancelFirstAttackIfInPlaySiteRule
  | StolenKnowledgeSiteRule;

/** Wounded characters at this site heal during untap as if the site were a haven. */
export interface HealingAffectsAllSiteRule extends EffectBase {
  readonly type: 'site-rule';
  readonly rule: 'healing-affects-all';
}

/**
 * Treats this site as a haven during the untap phase only: wounded
 * characters at this site heal to tapped as they would at a haven.
 * The rest of the game treats the site normally (site-type, hazard
 * limit, attack rules, etc. are unchanged).
 *
 * Example — Barad-dûr (le-352): "Treat this site as a Darkhaven during
 * the untap phase." The only observable effect of Darkhaven-during-
 * untap is the healing of wounded characters, since the engine does
 * not already restrict sideboard access by site.
 */
export interface HealDuringUntapSiteRule extends EffectBase {
  readonly type: 'site-rule';
  readonly rule: 'heal-during-untap';
}

/**
 * Denies playing any item whose card definition matches the `when` condition
 * at this site. The condition is evaluated against the item card definition
 * using the standard DSL matcher (dot-path keys, `$and` / `$or` / `$not`).
 *
 * Example — Tolfalas denies any greater item other than Scroll of Isildur:
 *
 * ```json
 * { "type": "site-rule", "rule": "deny-item",
 *   "when": { "subtype": "greater",
 *             "name": { "$ne": "Scroll of Isildur" } } }
 * ```
 */
export interface DenyItemSiteRule extends EffectBase {
  readonly type: 'site-rule';
  readonly rule: 'deny-item';
  /** DSL condition evaluated against each item's card definition. */
  readonly when: Condition;
}

/**
 * Denies playing (from hand) any character whose card definition matches
 * the `filter` condition at this site. The filter is evaluated against
 * the character card definition using the standard DSL matcher. When
 * `exceptHomesite` is true, the rule does NOT deny a character whose
 * `homesite` equals this site's name.
 *
 * Example — Carn Dûm (le-359): "Unless this site is a character's home
 * site, a non-Orc, non-Troll character may not be brought into play at
 * this site." Encoded as a filter that matches characters whose race is
 * not Orc and not Troll, with `exceptHomesite: true`:
 *
 * ```json
 * { "type": "site-rule", "rule": "deny-character",
 *   "filter": { "$not": { "race": { "$in": ["orc", "troll"] } } },
 *   "exceptHomesite": true }
 * ```
 */
export interface DenyCharacterSiteRule extends EffectBase {
  readonly type: 'site-rule';
  readonly rule: 'deny-character';
  /** DSL condition evaluated against the character card definition. */
  readonly filter: Condition;
  /** If true, the rule is waived for a character whose homesite is this site. */
  readonly exceptHomesite?: boolean;
}

/**
 * Cancels any attack against a company whose effective site (destination if
 * moving, else current) carries this rule. Hazard creature plays against
 * such a company become non-viable during the play-hazards step.
 *
 * Example — Dol Guldur (le-367): "Any attack against a minion company at
 * this site is canceled." Also on Minas Morgul, Carn Dûm (minion darkhavens),
 * The White Towers (fallen-wizard haven), Moria and The Under-gates (balrog
 * darkhavens).
 */
export interface CancelAttacksSiteRule extends EffectBase {
  readonly type: 'site-rule';
  readonly rule: 'cancel-attacks';
}

/**
 * Declares that storing a gold-ring item at this site triggers an automatic
 * ring test, with the given roll modifier applied to the 2d6 result. The
 * storage itself uses the standard `storable-at` flow; the auto-test fires
 * immediately after storage, replacing the need for a separate tap-to-test
 * action.
 *
 * Example — Dol Guldur (le-367): "Any gold ring stored at this site is
 * automatically tested (modify the roll by -2)." The same rule lives on
 * Minas Morgul, Carn Dûm, Moria, and The Under-gates.
 */
export interface AutoTestGoldRingSiteRule extends EffectBase {
  readonly type: 'site-rule';
  readonly rule: 'auto-test-gold-ring';
  /** Roll modifier applied to the 2d6 auto-test (e.g. -2 for a Darkhaven). */
  readonly rollModifier: number;
}

/**
 * Overrides the default detainment rules (CoE §3.II.2.R1/R2/R3 and
 * B1/B2/B3) for attacks against a company at this site. When the optional
 * `filter` condition matches the attacking creature's context, the
 * resulting attack is forced to be treated as a normal attack, not
 * detainment — even if the Ringwraith/Balrog default rules, the site's
 * type, or the creature's keying would otherwise make it detainment.
 *
 * The filter is evaluated against the combat context exposing
 * `enemy.race` (the attacking creature's race). A missing filter makes
 * every attack at this site attack normally.
 *
 * Example — Moria (le-392): "Non-Nazgûl creatures played at this site
 * attack normally, not as detainment."
 */
export interface AttacksNotDetainmentSiteRule extends EffectBase {
  readonly type: 'site-rule';
  readonly rule: 'attacks-not-detainment';
  /** Optional condition on the attacking creature (e.g. race ≠ nazgul). */
  readonly filter?: Condition;
}

/**
 * Declares that this site never taps. Playing resources (items, allies) or
 * making influence attempts at a company's current site normally taps the
 * site, gating further resource plays and sending it to the discard pile on
 * departure. When the site carries this rule, both tap-sites are skipped —
 * the site's status stays `Untapped` no matter how many resources are played
 * or influence attempts resolved there. Used by The Worthy Hills (le-415).
 */
export interface NeverTapsSiteRule extends EffectBase {
  readonly type: 'site-rule';
  readonly rule: 'never-taps';
}

/**
 * Declares that when a company enters this site, the opponent may play one
 * hazard creature from their hand as the site's automatic-attack. The
 * creature uses its own prowess/strikes/body/race, but is treated in all
 * ways as an automatic-attack (the hazard player does not pay keying cost
 * and, regardless of outcome, the creature is discarded — the resource
 * player does not gain kill-MP).
 *
 * The `keying` filter lists the site-types and region-types that the
 * creature must be playable against. A creature is eligible iff at least
 * one of its `keyedTo` entries lists a siteType or regionType named in
 * this filter.
 *
 * Example — Framsburg (td-175): "opponent may play one creature from his
 * hand that is treated in all ways as the site's automatic-attack. It
 * must normally be playable keyed to a Ruins & Lairs [{R}], Shadow-hold
 * [{S}], single Wilderness [{w}], or Shadow-land [{s}]."
 *
 * ```json
 * { "type": "site-rule", "rule": "dynamic-auto-attack",
 *   "keying": {
 *     "siteTypes": ["ruins-and-lairs", "shadow-hold"],
 *     "regionTypes": ["wilderness", "shadow"]
 *   } }
 * ```
 */
export interface DynamicAutoAttackSiteRule extends EffectBase {
  readonly type: 'site-rule';
  readonly rule: 'dynamic-auto-attack';
  /** Site-types and region-types that satisfy the creature's keying for this attack. */
  readonly keying: {
    readonly siteTypes?: readonly SiteType[];
    readonly regionTypes?: readonly RegionType[];
  };
}

/**
 * Declares that this site is always returned to the location deck on
 * departure, even when it is tapped. Under normal CoE rules (2.IV.vii), a
 * tapped non-haven site is discarded to the site discard pile when a company
 * moves away. When this rule is present, the engine skips the discard path
 * and always pushes the site back into the player's `siteDeck`.
 *
 * Example — Buhr Widu (td-173): "This site is always returned to the location
 * deck, never to the discard pile."
 *
 * ```json
 * { "type": "site-rule", "rule": "always-return-to-deck" }
 * ```
 */
export interface AlwaysReturnToDeckSiteRule extends EffectBase {
  readonly type: 'site-rule';
  readonly rule: 'always-return-to-deck';
}

/**
 * Adjusts the hazard limit for any company moving to this site.
 * Applied during the `set-hazard-limit` step before the snapshot is taken.
 *
 * Example — Barad-dûr (tw-374): "Any company moving to this site has its
 * hazard limit increased by 2."
 *
 * ```json
 * { "type": "site-rule", "rule": "hazard-limit-modifier", "value": 2 }
 * ```
 */
export interface HazardLimitSiteRule extends EffectBase {
  readonly type: 'site-rule';
  readonly rule: 'hazard-limit-modifier';
  /** The adjustment to apply (positive increases, negative decreases). */
  readonly value: number;
}

/**
 * Declares that hazard creatures of the given race may be played at this site
 * regardless of normal keying requirements. The keying check is bypassed when
 * the attacking creature's race matches this rule's `race` field.
 *
 * Example — Geann a-Lisch (as-138): "Any Man hazard creature can be played
 * at this site."
 *
 * ```json
 * { "type": "site-rule", "rule": "allow-creature-by-race", "race": "men" }
 * ```
 */
export interface AllowCreatureByRaceSiteRule extends EffectBase {
  readonly type: 'site-rule';
  readonly rule: 'allow-creature-by-race';
  /** The creature race that bypasses keying at this site (e.g. "men"). */
  readonly race: string;
}

/**
 * Declares that any hazard creature that is keyable to this site (via site
 * type or site name in its `keyedTo` entries) may be played regardless of
 * any active `no-creature-hazards-on-company` constraint. The creature must
 * still pass normal keying; only external restrictions are bypassed.
 *
 * Example — Mount Doom (tw-414): "hazard creatures may always be played
 * keyed to the site regardless of any other cards played."
 *
 * ```json
 * { "type": "site-rule", "rule": "creatures-always-keyed-to-site" }
 * ```
 */
export interface CreaturesAlwaysKeyedToSiteSiteRule extends EffectBase {
  readonly type: 'site-rule';
  readonly rule: 'creatures-always-keyed-to-site';
}

/**
 * Items may be played at this site even when its status is Tapped.
 * The normal tapped-site gate in `legal-actions/site.ts` is bypassed for
 * item plays when this rule is present.
 *
 * Example — Tharbad (td-180): "Items may be played here even if the site
 * is tapped."
 *
 * ```json
 * { "type": "site-rule", "rule": "allow-items-when-tapped" }
 * ```
 */
export interface AllowItemsWhenTappedSiteRule extends EffectBase {
  readonly type: 'site-rule';
  readonly rule: 'allow-items-when-tapped';
}

/**
 * Cancels the first automatic attack at this site if the referenced card is
 * currently in any player's cardsInPlay as a permanent event.
 *
 * Used by The Under-gates (dm-38): "If Balrog of Moria is in play [as a
 * permanent-event] ... the first automatic attack is canceled."
 *
 * ```json
 * { "type": "site-rule", "rule": "cancel-first-attack-if-in-play",
 *   "definitionId": "tw-12" }
 * ```
 */
export interface CancelFirstAttackIfInPlaySiteRule extends EffectBase {
  readonly type: 'site-rule';
  readonly rule: 'cancel-first-attack-if-in-play';
  /** Definition ID of the card that, when in play, causes the first attack to be canceled. */
  readonly definitionId: CardDefinitionId;
}

/**
 * Declares that this site earns marshalling points when it would normally be
 * discarded to the site discard pile. Instead of going to the discard pile, the
 * site is placed in the player's out-of-play pile (marshalling points pile) and
 * counts as the specified number of miscellaneous marshalling points.
 *
 * Example — The Under-galleries (dm-37): "When Under-galleries would be placed
 * in your discard pile, place it in your marshalling points pile instead for 3
 * marshalling points — this card is considered stored."
 *
 * ```json
 * { "type": "site-rule", "rule": "stolen-knowledge", "marshallingPoints": 3 }
 * ```
 */
export interface StolenKnowledgeSiteRule extends EffectBase {
  readonly type: 'site-rule';
  readonly rule: 'stolen-knowledge';
  /** Miscellaneous marshalling points awarded when the site is stored. */
  readonly marshallingPoints: number;
}

/**
 * Fetches a card from one or more source piles into the play deck and shuffles.
 *
 * Used by short events like Smoke Rings that let the player retrieve a
 * resource or character from their sideboard or discard pile.
 */
export interface FetchToDeckEffect extends EffectBase {
  readonly type: 'fetch-to-deck';
  /** Which piles the player may fetch from (e.g. ["sideboard", "discard-pile"]). */
  readonly source: readonly string[];
  /** DSL condition evaluated against each card definition to decide eligibility. */
  readonly filter: Condition;
  /** How many cards to fetch. */
  readonly count: number;
  /** Whether to shuffle the play deck after inserting the card. */
  readonly shuffle: boolean;
}

/**
 * Cancels an entire attack against the company. Playable only during
 * combat before strikes are assigned.
 *
 * When `cost` and `requiredSkill` are present, requires tapping a
 * character with the named skill (e.g. Concealment — tap a scout).
 * When both are absent the card is simply played from hand with no
 * additional cost (e.g. Dark Quarrels — cancel one attack by Orcs,
 * Trolls, or Men).
 *
 * A `when` condition on this effect filters which attacks qualify
 * (evaluated against `{ enemy.race }` from the combat context).
 */
export interface CancelAttackEffect extends EffectBase {
  readonly type: 'cancel-attack';
  /** The cost to cancel the attack. Absent when no tap is required. */
  readonly cost?: ActionCost;
  /** The skill required on the character who pays the cost. Absent when no skill is required. */
  readonly requiredSkill?: string;
  /** The race required on the character who pays the cost (e.g. "wizard" for Vanishment). */
  readonly requiredRace?: string;
  /**
   * When true, a corruption check is enqueued on the bearer immediately after
   * the attack is cancelled. Used by in-play items like Torque of Hues
   * ("Bearer makes a corruption check").
   */
  readonly enqueueCorruptionCheck?: true;
}

/**
 * Flattery attempt: the bearer's company is facing a creature attack and
 * a character in the company makes an influence check to cancel the attack.
 *
 * Used by Flatter a Foe (td-116). The defending player selects a character
 * to make the attempt; the roll is 2d6 + unused DI (+ diplomatBonus if the
 * character has the diplomat skill). Success if total > threshold for the
 * attacker's race. On success the attack is cancelled and the hazard limit
 * is decreased by `hazardLimitReduction`.
 */
export interface FlatteryCancelAttackEffect extends EffectBase {
  readonly type: 'flattery-cancel-attack';
  /**
   * Race-to-threshold mappings. The threshold for the facing creature's
   * race is looked up at play time. Success requires roll > threshold.
   */
  readonly thresholds: ReadonlyArray<{
    readonly races: ReadonlyArray<string>;
    readonly threshold: number;
  }>;
  /** Bonus added to the roll when the making character has the diplomat skill. */
  readonly diplomatBonus: number;
  /** Amount to reduce the company's hazard limit on a successful attempt. */
  readonly hazardLimitReduction: number;
}

/**
 * Sets a character's status to one of the three standard values.
 *
 * When `target` is `"target-character"`, applies to the character targeted
 * by a {@link PlayTargetEffect} on the same card (e.g. Escape: the targeted
 * unwounded character is set to `inverted` / wounded as the cost of
 * cancelling the attack). When `target` is absent, applies to the bearer.
 *
 * Used instead of the removed `wound-target-character` type.
 */
export interface SetCharacterStatusEffect extends EffectBase {
  readonly type: 'set-character-status';
  readonly status: 'untapped' | 'tapped' | 'inverted';
  readonly target?: string;
}

/**
 * Automatically cancels an opponent's influence check against one of the
 * player's characters, followers, factions, allies, or items. Played from
 * hand during the opponent's site phase while an
 * `opponent-influence-defend` resolution is pending.
 *
 * Modeled after {@link CancelAttackEffect}: the `requiredRace` field gates
 * who can pay the cost (e.g. "wizard" for Wizard's Laughter), and the cost
 * is typically a corruption check with a modifier.
 */
export interface CancelInfluenceEffect extends EffectBase {
  readonly type: 'cancel-influence';
  /** The cost to cancel the influence check (typically a corruption check). */
  readonly cost?: ActionCost;
  /** The race required on the character who pays the cost (e.g. "wizard"). */
  readonly requiredRace?: string;
}

/**
 * Modifies the number of strikes in the current attack. Played from hand as
 * a short event during combat before strikes are assigned; the card is
 * discarded after use.
 *
 * Two modes (selected by `op`):
 * - `"halve"` (default) — `Math.ceil(strikes / 2)` (Dark Quarrels, Orc Quarrels).
 * - `"subtract"` — `Math.max(min, strikes - value)` (Not at Home: subtract 2, min 1).
 */
export interface HalveStrikesEffect extends EffectBase {
  readonly type: 'halve-strikes';
  /** Operation mode. Default 'halve'. */
  readonly op?: 'halve' | 'subtract';
  /** Amount to subtract when op is 'subtract'. Default 2. */
  readonly value?: number;
  /** Minimum strikes after modification (subtract mode). Default 1. */
  readonly min?: number;
}

/**
 * Played from hand during strike resolution to let the target character
 * resolve the strike at full prowess without tapping (unless wounded).
 * If the character is wounded by the strike, a body penalty applies to
 * the resulting body check.
 *
 * Example: Dodge — target character does not tap against one strike
 * (unless wounded); if wounded, body is modified by -1.
 */
export interface DodgeStrikeEffect extends EffectBase {
  readonly type: 'dodge-strike';
  /** Body modifier applied if the character is wounded by the strike. */
  readonly bodyPenalty: number;
}

/**
 * Played from hand during strike resolution as a short event that
 * modifies the character's prowess and/or body for the current strike
 * only. Unlike `dodge-strike`, the character still taps normally
 * (tap-to-fight / stay-untapped is unaffected).
 *
 * Example: Risky Blow — Warrior only against one strike, +3 prowess
 * and -1 body.
 */
export interface ModifyStrikeEffect extends EffectBase {
  readonly type: 'modify-strike';
  /** Bonus added to the character's prowess for the strike roll (may be 0 or negative). */
  readonly prowessBonus?: number;
  /** Penalty applied to the character's body on the resulting body check (typically negative). */
  readonly bodyPenalty?: number;
  /** Optional skill the struck character must have (e.g. "warrior"). */
  readonly requiredSkill?: string;
}

/**
 * Played from hand during strike resolution. The strike is resolved by
 * making two 2d6 rolls and using the better result. The character taps
 * and resolves the strike like a normal tap-to-fight, but with a
 * re-roll advantage.
 *
 * The optional `filter` restricts which strike targets may play the
 * card — evaluated against a `target.*` context carrying the target
 * character's race, skills, and name.
 *
 * Example: Lucky Strike — warrior only; make two rolls against a
 * strike and choose one of the two results to use.
 */
export interface RerollStrikeEffect extends EffectBase {
  readonly type: 'reroll-strike';
  /** Constraint on the target character facing the strike. */
  readonly filter?: Condition;
}

/**
 * Activated ability carried by an in-play item that modifies the whole
 * attack (not a single strike). Available to the defending player during
 * the pre-assignment window of combat (same window as `cancel-attack`).
 * Tapping the item adds `prowessModifier` to {@link CombatState.strikeProwess}
 * and `bodyModifier` to {@link CombatState.creatureBody}, so every strike
 * in the attack and the creature's body check are affected uniformly.
 *
 * The `cost` must be `{ "tap": "self" }` — the item itself pays the cost.
 * The `when` gate restricts availability (e.g. `bearer.skills` must
 * include `"warrior"` for a Warrior-only item). Cards like Black Arrow
 * additionally specify `discardIfBearerNot`: when the bearer's race is
 * not in the listed set, tapping instead discards the item from play.
 *
 * Example: Black Arrow (tw-494) — Warrior only, tap to give -1 prowess
 * and -1 body to one attack; discard if bearer is not a Man.
 */
export interface ModifyAttackEffect extends EffectBase {
  readonly type: 'modify-attack';
  /**
   * Cost to activate. `{ tap: "self" }` taps the item (e.g. Black Arrow);
   * `{ tap: "bearer" }` taps only the item's bearer without tapping the item
   * itself (e.g. Star-glass).
   */
  readonly cost: ActionCost;
  /**
   * When true, a corruption check is enqueued on the bearer immediately after
   * the attack is modified. Used by items like Star-glass
   * ("Bearer makes a corruption check").
   */
  readonly enqueueCorruptionCheck?: true;
  /** Amount added to the attack's strike prowess (usually negative). */
  readonly prowessModifier?: number;
  /** Amount added to the creature's body value for the creature body check (usually negative). */
  readonly bodyModifier?: number;
  /**
   * Amount added to the attack's total strike count (usually negative).
   * The result is clamped to a minimum of 1.
   */
  readonly strikesModifier?: number;
  /**
   * When set, the item is discarded instead of tapped if the bearer's
   * race is NOT in `race`. The modifier still applies.
   */
  readonly discardIfBearerNot?: {
    readonly race: readonly string[];
  };
}

/**
 * Activated ability carried by an in-play item that boosts the bearer's
 * prowess for the one specific strike currently being resolved. Available
 * to the defending player during the `resolve-strike` phase. The item
 * must be untapped; tapping it adds `prowessBonus` to
 * {@link StrikeAssignment.strikeProwessBonus} for the current strike only,
 * benefiting only that one defender (unlike {@link ModifyAttackEffect},
 * which modifies the whole attack and applies to all defenders).
 *
 * The `cost` must be `{ "tap": "self" }`. The optional `when` gate is
 * evaluated against a context exposing `bearer.race`, `bearer.skills`,
 * and `bearer.name`, and `enemy.race`.
 *
 * Example: Shield of Iron-bound Ash (tw-327) — tap to gain +1 prowess
 * against one strike.
 */
export interface ItemTapStrikeBonusEffect extends EffectBase {
  readonly type: 'item-tap-strike-bonus';
  /** Cost to activate; must be `{ tap: "self" }`. */
  readonly cost: ActionCost;
  /** Amount added to the bearer's prowess for the current strike only. */
  readonly prowessBonus: number;
}

/**
 * Played from hand as a short event during combat before strikes are
 * assigned; the card is discarded after use. Modifies the current
 * attack's strike prowess and/or creature body uniformly (same windows
 * and math as {@link ModifyAttackEffect}, but the source is a hand card
 * rather than an in-play item).
 *
 * The `player` field selects who may play the effect — `attacker`
 * (hazard player) or `defender` (resource player). The `when` clause is
 * evaluated against the standard combat context
 * (`enemy.race`, `attack.source`, `attack.keying`, `inPlay`,
 * `company.size`) and gates availability per the card text.
 *
 * Example: Dragon's Desolation (tw-29, Mode A) — hazard short event;
 * attacker plays to give +2 prowess to one Dragon attack.
 */
export interface ModifyAttackFromHandEffect extends EffectBase {
  readonly type: 'modify-attack-from-hand';
  /** Which side plays the card from hand. */
  readonly player: 'attacker' | 'defender';
  /** Amount added to the attack's strike prowess. */
  readonly prowessModifier?: number;
  /** Amount added to the creature's body value for the creature body check. */
  readonly bodyModifier?: number;
}

/**
 * Declares that an item can be stored during the Organization phase when
 * the bearer's company is at a matching site. Storing moves the item from
 * the character to the player's stored-items pile, where it earns
 * marshalling points safely.
 *
 * At least one of `sites` or `siteTypes` must be present. A site matches
 * if its name is in `sites` OR its siteType is in `siteTypes`.
 *
 * Examples:
 * - Sapling of the White Tree — storable at Minas Tirith for 2 MP
 *   (`sites: ["Minas Tirith"]`).
 * - Red Book of Westmarch — storable at any Haven for 1 MP
 *   (`siteTypes: ["haven"]`).
 */
export interface StorableAtEffect extends EffectBase {
  readonly type: 'storable-at';
  /** Site names where the item can be stored. */
  readonly sites?: readonly string[];
  /** Site types where the item can be stored (e.g. any Haven). */
  readonly siteTypes?: readonly SiteType[];
  /** Override marshalling points when stored (replaces the card's base MP). */
  readonly marshallingPoints?: number;
}

/**
 * Gates playability on a game-state condition evaluated at legal-action
 * time. The `requires` field names the context source:
 *
 * - `site-path` — the company's resolved site path during M/H. The
 *   condition is evaluated against
 *   `{ sitePath: { wildernessCount, shadowCount, darkCount, coastalCount, freeCount, borderCount } }`.
 * - `combat-creature-race` — the attacking creature's race in the
 *   current combat (e.g. Dragon's Curse requires `race: "dragon"`).
 *   Only offered when combat is active; otherwise the card is
 *   non-playable.
 * - `target-company` — the company being targeted by a hazard creature.
 *   The condition is evaluated against
 *   `{ company: { homeSites: string[] } }` where `homeSites` is the flat
 *   list of all individual site names from every character's `homesite`
 *   field (comma-separated entries are split). Used for restrictions like
 *   "May not be played against a company containing a character with
 *   Edoras as a home site" (Horse-lords).
 *
 * If the condition is not met, the card is not offered as a legal action.
 */
export interface PlayConditionEffect extends EffectBase {
  readonly type: 'play-condition';
  readonly requires: 'site-path' | 'discard-named-card' | 'combat-creature-race' | 'target-company' | 'site-type' | 'card-not-in-play';
  readonly condition?: Condition;
  /**
   * For `requires: 'discard-named-card'`: the card name that must be
   * discarded as a play prerequisite. Legal-action generation searches
   * the specified {@link sources} for a card with this name.
   */
  readonly cardName?: string;
  /**
   * Where to look for the named card.
   * - `character-items` — items on characters at the current site.
   * - `out-of-play-pile` — the player's out-of-play pile (stored items).
   *
   * Also used for `requires: 'card-not-in-play'`: the card name that must
   * NOT be in play (as a character or in any player's cardsInPlay) for the
   * card to be playable.
   */
  readonly sources?: readonly ('character-items' | 'out-of-play-pile')[];
  /**
   * For `requires: 'combat-creature-race'`: the required attacker race
   * (lowercase, e.g. `"dragon"`). When the current combat's
   * `creatureRace` does not match, the card is non-playable.
   */
  readonly race?: string;
  /**
   * For `requires: 'site-type'`: the site types at which the event may be
   * played. Only offered when the active company's current site type is in
   * this list. Used by Glamour of Surpassing Excellence (as-49):
   * `["border-hold", "free-hold"]`.
   */
  readonly siteTypes?: readonly string[];
}

/**
 * Requires the player to choose a creature race when playing the card.
 * The `exclude` array lists races that may not be chosen. The `apply`
 * clause describes the constraint added for the chosen race.
 *
 * When `fixedRace` is set, no choice is offered: the card plays with the
 * given race and the apply resolves against that race directly. Used by
 * Dragon's Desolation (tw-29) Mode B — the race is always Dragon.
 *
 * Used by Two or Three Tribes Present: announce a creature type (except
 * Nazgûl, Undead, or Dragons) — creatures of that type bypass the hazard
 * limit for the target company.
 */
export interface CreatureRaceChoiceEffect extends EffectBase {
  readonly type: 'creature-race-choice';
  /** Races the player may NOT choose. */
  readonly exclude: readonly string[];
  /** Fixed race used when no choice is offered (e.g. Dragon's Desolation). */
  readonly fixedRace?: string;
  /** Constraint applied with the chosen race. */
  readonly apply: {
    readonly type: 'add-constraint';
    readonly constraint: string;
    readonly scope: string;
  };
}

/**
 * Forces a "Call of Home" style roll check on the targeted character.
 *
 * When the hazard short event resolves, the character's player rolls 2d6.
 * If the roll plus the player's unused general influence is less than
 * `threshold`, the character returns to the player's hand. One item may
 * be transferred to another character in the company; all other
 * non-follower cards the character controls are discarded.
 *
 * Used by Call of Home (tw-18).
 */
export interface CallOfHomeCheckEffect extends EffectBase {
  readonly type: 'call-of-home-check';
  /** Roll + unused GI must meet or exceed this to keep the character. */
  readonly threshold: number;
}

/**
 * Forces a body or corruption check on every character in the active company
 * when this hazard short event resolves.
 *
 * For `check: "body"`:
 * Each character rolls 2d6. The check passes if roll >= (character.body +
 * modifier); it fails if roll < (character.body + modifier).
 *
 * Outcomes depend on the character's race:
 * - Orc or Troll: a failed check discards the character (returns to hand,
 *   same as Call of Home) with all attached cards discarded.
 * - All others: a failed check taps an untapped character; a tapped
 *   character suffers no further effect.
 *
 * Used by Veils Flung Away (le-146) via `{ "type": "force-check-all-company",
 * "check": "body", "modifier": -1 }`. Replaces the removed `mass-body-check` type.
 */
export interface ForceCheckAllCompanyTopEffect extends EffectBase {
  readonly type: 'force-check-all-company';
  /** Which check to force for each character in the company (e.g. `"body"`). */
  readonly check: string;
  /** Modifier applied to the check threshold (typically negative). */
  readonly modifier?: number;
}

/**
 * When this resource short-event resolves on a company, roll 2d6 for each
 * hazard permanent-event attached to characters in that company. If the roll
 * exceeds the hazard's `removalNumber` (or 8 if not set), the hazard is
 * discarded. One {@link PendingResolution} of kind `glamour-hazard-roll` is
 * enqueued per hazard permanent-event found.
 *
 * Used by Glamour of Surpassing Excellence (as-49).
 */
export interface RollRemoveHazardEventsEffect extends EffectBase {
  readonly type: 'roll-remove-hazard-events';
}

/**
 * A hazard short-event check targeting a character moving through Shadow-land
 * or Dark-domain. The character's player rolls 2d6 and adds the character's
 * mind. If the result is less than the threshold (12), the character splits
 * off into a new company that immediately returns to the original company's
 * site of origin.
 *
 * Used by Seized by Terror (dm-88).
 */
export interface SeizedByTerrorCheckEffect extends EffectBase {
  readonly type: 'seized-by-terror-check';
  /** Roll + character mind must meet or exceed this to stay in the moving company. */
  readonly threshold: number;
}

/**
 * Declares that while this long-event is in play, any company whose
 * movement path crosses the listed region names (or region types) faces
 * a creature-like Dragon attack during the order-effects step (CoE step 4).
 *
 * The `extended` clause adds extra regions when a condition is met
 * (typically Doors of Night in play).
 *
 * Used by "Ahunt" Dragon long-events (e.g. Eärcaraxë Ahunt, Itangast Ahunt).
 */
export interface AhuntAttackEffect extends EffectBase {
  readonly type: 'ahunt-attack';
  /** Region names that trigger the attack (matched against resolvedSitePathNames). */
  readonly regionNames: readonly string[];
  /** Region types that trigger the attack (matched against resolvedSitePath). */
  readonly regionTypes?: readonly string[];
  /** Number of strikes the attack delivers. */
  readonly strikes: number;
  /** Prowess of each strike. */
  readonly prowess: number;
  /** Body value for body checks after a strike. */
  readonly body: number;
  /** Race of the attacking creature (e.g. "dragon"). */
  readonly race: string;
  /** Combat rules that apply to the attack (e.g. "attacker-chooses-defenders"). */
  readonly combatRules?: readonly string[];
  /** Extended regions that apply when a condition is met. */
  readonly extended?: {
    readonly when: Condition;
    readonly regionNames?: readonly string[];
    readonly regionTypes?: readonly string[];
  };
}

/**
 * Augments a Dragon's lair with an additional automatic-attack while this
 * "At-Home" permanent-event is in play and the same Dragon's Ahunt
 * long-event is *not* in play.
 *
 * The owning card's `manifestId` identifies which lair receives the
 * augmentation (the same Dragon's lair, found via `lairOf`). The
 * Ahunt-suppression check is implicit: any other in-play card sharing
 * this card's `manifestId` whose `eventType === 'long'` (i.e. the Ahunt)
 * disables the augmentation for as long as it remains in play.
 *
 * Used by the 9 Dragon "At Home" permanent-events (METD §4).
 */
export interface DragonAtHomeEffect extends EffectBase {
  readonly type: 'dragon-at-home';
  /** Extra automatic-attack registered on the matching lair. */
  readonly attack: {
    readonly creatureType: string;
    readonly strikes: number;
    readonly prowess: number;
  };
}

/**
 * While this hazard permanent event is in play, the listed sites each gain
 * an additional automatic-attack with the given stats. Used by Spawn-type
 * events (e.g. Balrog of Moria, Monstrosity of Diverse Shape) that augment
 * specific Under-deeps sites regardless of any Dragon manifestation chain.
 *
 * When `onDefeat` is `'remove-from-play'`: defeating this augmented attack
 * removes the permanent-event card from play (it moves to the defeating
 * player's kill pile, awarding kill MPs). Used by Balrog of Moria TW-12.
 * Absent for ordinary Spawn augmentations (the event stays in play).
 */
export interface PermanentEventAutoAttackEffect extends EffectBase {
  readonly type: 'permanent-event-auto-attack';
  /** Site definition IDs whose auto-attack list is augmented while this event is in play. */
  readonly siteIds: readonly CardDefinitionId[];
  /** The attack stats contributed to those sites. */
  readonly attack: {
    readonly creatureType: string;
    readonly strikes: number;
    readonly prowess: number;
    /** Absent means no body check (e.g. Balrog of Moria "18/-"). */
    readonly body?: number;
    readonly combatRules?: readonly string[];
  };
  /**
   * When `'remove-from-play'`, defeating this auto-attack removes the
   * permanent event from play — the card moves to the defeating player's
   * kill pile and its kill MPs are awarded to them. Absent for ordinary
   * Spawn augmentations.
   */
  readonly onDefeat?: 'remove-from-play';
  /**
   * When true, after this auto-attack resolves (regardless of win or loss),
   * the permanent event card is moved from the hazard player's cardsInPlay
   * to their discard pile. No kill MPs are awarded. Used by Nazgûl
   * permanent-events (Witch-king, Khamûl, Adûnaphel) that are used as
   * additional auto-attacks at Under-deeps sites — the card text says
   * "discard after use — ignore result of defeat".
   */
  readonly discardAfterUse?: boolean;
}

/**
 * Triggers the "call the council" endgame transition — the card-based
 * equivalent of the `call-free-council` action. Sets `freeCouncilCalled`
 * on the caller, advances the turn, and marks who gets the final last
 * turn before the Free Council phase begins.
 *
 * Per CoE rule 10.41, Ringwraith and Balrog players play Sudden Call
 * (le-235) to trigger this instead of calling freely.
 *
 * - `lastTurnFor: 'opponent'` — resource-side play on the caller's own
 *   turn; their opponent gets one last turn (same as `call-free-council`).
 * - `lastTurnFor: 'self'` — hazard-side play during the opponent's
 *   turn; the card's player gets one last turn.
 */
export interface CallCouncilEffect extends EffectBase {
  readonly type: 'call-council';
  readonly lastTurnFor: 'opponent' | 'self';
}

/**
 * Declares that the bearing card (an item on a character) cancels any
 * hazard matching `filter` that either is already on bearer or tries to
 * be played on bearer while the ward is in play.
 *
 * Semantics:
 * - On entry: when the ward-bearing card attaches to a character, every
 *   hazard currently on that character whose definition matches `filter`
 *   is discarded to the hazard owner's discard pile.
 * - Continuous: while the ward-bearing card is on the character, any
 *   hazard matching `filter` that would attach to that character is
 *   discarded instead (and the character is not offered as a play
 *   target by the legal-action computer).
 *
 * The filter is a standard DSL condition evaluated against each hazard
 * card definition (dot-path keys, `$and` / `$or` / `$not`), so wards can
 * reference any data-model field — the common case is keyword-based,
 * e.g. Adamant Helmet targets `{ "keywords": { "$includes": "dark-enchantment" } }`.
 */
export interface WardBearerEffect extends EffectBase {
  readonly type: 'ward-bearer';
  /** DSL condition evaluated against hazard card definitions. */
  readonly filter: Condition;
}

/**
 * Tags a hazard long-event (environment) whose resolution causes any moving
 * company satisfying `condition` to return to its site of origin.
 *
 * This tag is consumed by the chain engine to identify which unresolved
 * chain entries an ally with `cancel-chain-return-to-origin` may target.
 * It does NOT itself enforce the return — that enforcement is handled
 * separately in the order-effects resolution path.
 *
 * Used by Snowstorm (tw-91), Foul Fumes (tw-36), Long Winter (le-117).
 */
export interface ForceReturnToOriginEffect extends EffectBase {
  readonly type: 'force-return-to-origin';
  /** Company-context condition that must hold for the effect to apply. */
  readonly condition?: Condition;
  /** If true, a company containing at least one ranger is exempt. */
  readonly rangerException?: boolean;
}

/**
 * In-play ally ability: tap this ally during the M/H chain declaring window
 * to negate an unresolved chain entry that carries a `force-return-to-origin`
 * effect and would apply to the ally's company.
 *
 * Used by Goldberry (tw-245). Modelled parallel to `cancel-attack` but fires
 * during chain declaring, not the combat pre-assignment window.
 */
export interface CancelChainReturnToOriginEffect extends EffectBase {
  readonly type: 'cancel-chain-return-to-origin';
  readonly cost: { readonly tap: 'self' };
}

/**
 * When this permanent event is in play, any site (that is not a Dragon lair)
 * with more than one automatic attack is reduced to a single attack chosen
 * by the hazard player, and any creature with more than one attack (i.e.
 * combat-multi-attack) is reduced to one attack. The remaining attack
 * cannot be canceled. The event discards itself when that isolated attack
 * is defeated (handled via `on-event: attack-defeated` with
 * `when: { "attack.isolated": true }`).
 *
 * Used by: *Forewarned Is Forearmed* (dm-132).
 */
export interface ReduceAttacksToOneEffect extends EffectBase {
  readonly type: 'reduce-attacks-to-one';
}

/**
 * When present on a resource permanent event that carries `storable-at`,
 * storing the card at a haven triggers a wizard-search window for the
 * resource player — if and only if their Wizard is not already in play.
 *
 * The player may search their play deck or discard pile for any Wizard
 * and play him at the storing Haven. This does not count toward the
 * one-character-per-turn limit.
 *
 * Example: The Windlord Found Me (dm-164).
 */
export interface FetchWizardOnStoreEffect extends EffectBase {
  readonly type: 'fetch-wizard-on-store';
}

/**
 * Zone reference for {@link MoveEffect}. Identifies where to locate
 * source card instances and where to push them after the move.
 *
 * Named-pile zones (`hand`, `deck`, `discard`, `sideboard`,
 * `out-of-play`, `kill-pile`) correspond directly to fields on
 * {@link PlayerState}. Contextual zones resolve against runtime data
 * in the move context:
 *  - `self-location` — wherever the effect's source card currently lives
 *    (owner's hand/discard/in-play/attached-to-character). Used by
 *    `discard-self` and `reshuffle-self-from-hand`.
 *  - `in-play` — any player's `cardsInPlay` or character attachments.
 *  - `items-on-target` — items attached to `ctx.targetCardId`.
 *  - `items-on-wounded` — items attached to the combat wounded character.
 *  - `attached-to-target-company` — hazards/items attached to any
 *    character in the target company.
 */
export type MoveZone =
  | 'hand'
  | 'deck'
  | 'discard'
  | 'sideboard'
  | 'out-of-play'
  | 'kill-pile'
  | 'self-location'
  | 'in-play'
  | 'items-on-target'
  | 'items-on-wounded'
  | 'attached-to-target-company';

/**
 * Generic card-movement primitive. A move picks card instance(s) by
 * selector, removes them from a source zone, and appends them to a
 * destination zone. Later phases of the card-move primitive plan
 * (`specs/2026-04-23-card-move-primitive-plan.md`) migrate the eleven
 * per-move effect types (`discard-self`, `move-target-from-discard-to-hand`,
 * `fetch-to-deck`, `bounce-hazard-events`, etc.) onto this primitive.
 *
 * Phase 1 lands the type alongside existing per-move effects; the
 * engine dispatches `move` through the shared apply path
 * ({@link applyMove}) but no card JSON uses it yet.
 */
export interface MoveEffect extends EffectBase {
  readonly type: 'move';
  /** How to choose which card instance(s) the primitive operates on. */
  readonly select: 'self' | 'target' | 'filter-all' | 'named';
  /** Scope(s) to locate source instances in. */
  readonly from: MoveZone | readonly MoveZone[];
  /** Destination zone. */
  readonly to: MoveZone;
  /**
   * Whose copy of the destination zone to push to. Defaults to the
   * source instance's owner. `opponent` and `defender` are used by
   * bounce and combat-wound moves respectively.
   */
  readonly toOwner?: 'source-owner' | 'opponent' | 'defender';
  /** DSL condition evaluated against candidate card definitions. */
  readonly filter?: Condition;
  /** Cap on how many instances to move; omitted = all matches. */
  readonly count?: number;
  /** Shuffle the destination pile after pushing. */
  readonly shuffleAfter?: boolean;
  /**
   * Enqueue a corruption check on the bearer after resolution.
   * Carried by bounce-hazard-events equivalents (Wizard Uncloaked).
   */
  readonly corruptionCheck?: { readonly modifier: number };
  /** For `select: 'named'`: the card name to match. */
  readonly cardName?: string;
}

/**
 * Discriminated union of all card effect types.
 * The `type` field serves as the discriminant for type narrowing.
 */
export type CardEffect =
  | StatModifierEffect
  | CheckModifierEffect
  | MpModifierEffect
  | CompanyModifierEffect
  | EnemyModifierEffect
  | HandSizeModifierEffect
  | DrawModifierEffect
  | GrantActionEffect
  | OnEventEffect
  | CancelStrikeEffect
  | CancelAttackEffect
  | FlatteryCancelAttackEffect
  | CancelInfluenceEffect
  | DodgeStrikeEffect
  | ModifyStrikeEffect
  | RerollStrikeEffect
  | ModifyAttackEffect
  | ItemTapStrikeBonusEffect
  | ModifyAttackFromHandEffect
  | HalveStrikesEffect
  | CombatAttackerChoosesDefendersEffect
  | CombatMultiAttackEffect
  | CombatCancelAttackByTapEffect
  | CombatDetainmentEffect
  | CombatOneStrikePerCharacterEffect
  | CombatDefenderProwessFromMindEffect
  | PlayFlagEffect
  | DuplicationLimitEffect
  | PlayTargetEffect
  | PlayOptionEffect
  | PlayWindowEffect
  | PlayConditionEffect
  | CreatureRaceChoiceEffect
  | OnGuardRevealEffect
  | FetchToDeckEffect
  | SiteRuleEffect
  | ItemPlaySiteEffect
  | StorableAtEffect
  | CallOfHomeCheckEffect
  | ForceCheckAllCompanyTopEffect
  | SeizedByTerrorCheckEffect
  | RollRemoveHazardEventsEffect
  | AgentTapInfluenceEffect
  | AgentTapAttackEffect
  | AhuntAttackEffect
  | DragonAtHomeEffect
  | CallCouncilEffect
  | WardBearerEffect
  | MoveEffect
  | SetCharacterStatusEffect
  | TriggerAttackOnPlayEffect
  | DeckSearchAttackEffect
  | TapAgentEffect
  | ForceReturnToOriginEffect
  | CancelChainReturnToOriginEffect
  | ReduceAttacksToOneEffect
  | FetchWizardOnStoreEffect
  | ExtraAgentActionsEffect
  | CompanyCombatBoostEffect
  | PermanentEventAutoAttackEffect
  | PassiveMovementBonusEffect
  | TakePrisonerEffect
  | StrikeShieldEffect
  | CancelPrisonerTakingEffect
  | HazardMaintenanceEffect
  | DuplicateSiteAutoAttacksEffect
  | TapForHazardLimitEffect
  | UntapByHazardLimitEffect
  | NoAutoUntapEffect
  | RingTestTableEffect
  | RingTestSearchEffect;

/**
 * Passive movement bonus carried by an ally: when every character in the
 * bearer's company controls an ally whose name is in {@link allyNames}, the
 * company may move up to {@link value} additional regions this turn.
 *
 * The bonus is applied once per company regardless of how many qualifying
 * allies are present. The engine evaluates this at movement-plan time in
 * `organization-companies.ts`.
 *
 * Used by Noble Steed: +2 regions when each character has Noble Steed,
 * Bill the Pony, or Shadowfax.
 */
export interface PassiveMovementBonusEffect extends EffectBase {
  readonly type: 'passive-movement-bonus';
  /** Additional region distance granted when the condition is met. */
  readonly value: number;
  /**
   * Each character in the company must control at least one ally whose card
   * name appears in this list for the bonus to apply.
   */
  readonly allyNames: readonly string[];
}

// ---- Rescue attack shape (used by TakePrisonerEffect) ----

/**
 * A single rescue-attack that must be faced before rescuing prisoners from
 * a hazard host. Rescue-attacks are not automatic-attacks and do not count
 * against the hazard limit.
 */
export interface RescueAttack {
  /** Race of the rescuing creature (e.g. "Spider"). */
  readonly race: string;
  /** Number of strikes in the rescue-attack. */
  readonly strikes: number;
  /** Prowess of the rescue-attack. */
  readonly prowess: number;
}

/**
 * Marks a hazard permanent-event as a **hazard host** (CoE rule 8.35).
 *
 * When the strike the host is played on succeeds (creature wins), the
 * targeted character is taken prisoner at a rescue site drawn from the
 * hazard player's location deck instead of being wounded. The host card
 * stays in play attached to the prisoner character until the prisoners are
 * rescued or the host is discarded.
 *
 * Playability gate: the hazard player must have a site of a matching type
 * in their location deck that is geographically reachable given the
 * company's movement.
 *
 * Used by Flies and Spiders (dm-58).
 */
export interface TakePrisonerEffect extends EffectBase {
  readonly type: 'take-prisoner';
  /**
   * Site types that are valid rescue sites (e.g. `["ruins-and-lairs"]`).
   * The hazard player must have a matching site available in their location
   * deck and it must be geographically reachable.
   */
  readonly rescueSiteTypes: readonly string[];
  /**
   * Rescue-attacks that must be faced before rescuing (rule 8.36).
   * These are not automatic-attacks and do not count against the hazard limit.
   */
  readonly rescueAttacks: readonly RescueAttack[];
  /**
   * Optional auto-rescue mechanic checked during the prisoner's untap phase.
   * If present, a body check (modified by `bodyCheckModifier`) is made;
   * then if the character survives, a roll + body is compared to
   * `autoRescueThreshold` — if greater, the prisoner escapes automatically.
   */
  readonly autoRescue?: {
    readonly bodyCheckModifier: number;
    readonly autoRescueThreshold: number;
  };
}

/**
 * Forces the carrier to receive at least one strike before any strike may be
 * assigned to its controlling character (CoE rule 8.35 allied protection).
 *
 * If `alwaysCountsAsUntapped` is true, the carrier is treated as untapped
 * for the purpose of being assigned strikes even when tapped or wounded
 * (so the protection is never voided by the ally's status).
 *
 * Used by Noble Hound (dm-179).
 */
export interface StrikeShieldEffect extends EffectBase {
  readonly type: 'strike-shield';
  /**
   * Which entity is shielded: `"controlling-character"` means the character
   * who controls this ally.
   */
  readonly scope: 'controlling-character';
  /**
   * When true the carrier always counts as untapped for strike assignment
   * even if it is tapped or wounded, ensuring the shield is never bypassed
   * by the ally's combat status.
   */
  readonly alwaysCountsAsUntapped?: boolean;
}

/**
 * When the bearer's controlling character would be taken prisoner, the
 * player may discard this card to cancel that prisoner-taking (the character
 * is instead resolved normally — wounded or tapped per combat result).
 *
 * Used by Noble Hound (dm-179) with `scope: "controlling-character"`.
 */
export interface CancelPrisonerTakingEffect extends EffectBase {
  readonly type: 'cancel-prisoner-taking';
  /**
   * `"controlling-character"`: only protects the character who controls
   * this ally, not other characters in the company.
   */
  readonly scope: 'controlling-character' | 'company';
}

/**
 * Hazard permanent-event maintenance cost paid at the end of the resource
 * player's long-event phase.
 *
 * The hazard player (who played the event) must pay the cost every turn:
 * either discard this card from cardsInPlay, or discard a matching card
 * from their hand. If no matching card is in hand, they must discard this
 * card.
 *
 * Used by *Thrice Outnumbered* (le-142): "Discard this card or a Man
 * hazard creature from your hand at the end of opponent's long-event phase."
 */
export interface HazardMaintenanceEffect extends EffectBase {
  readonly type: 'hazard-maintenance';
  /** When this maintenance fires. */
  readonly trigger: 'opponent-long-event-end';
  /**
   * Filter condition evaluated against card definitions in the hazard
   * player's hand. Matching cards may be discarded as payment instead
   * of discarding the source card itself.
   */
  readonly handCardFilter: Condition;
}

/**
 * Tidings of Bold Spies (le-143): when this hazard short event resolves
 * against a company moving to a site with automatic-attacks, it creates
 * one attack per auto-attack at the destination site, duplicating each
 * exactly (strikes, prowess, body, combat rules). The created attacks are
 * NOT automatic-attacks and must be faced immediately during M/H phase.
 */
export interface DuplicateSiteAutoAttacksEffect extends EffectBase {
  readonly type: 'duplicate-site-auto-attacks';
}

/**
 * Power Built by Waiting (as-34): during the hazard player's M/H phase, they
 * may tap this card (from cardsInPlay) to increase the hazard limit against
 * the current target company by {@link value}.
 */
export interface TapForHazardLimitEffect extends EffectBase {
  readonly type: 'tap-for-hazard-limit';
  /** Number of hazard limit slots to add when this card is tapped. */
  readonly value: number;
}

/**
 * Power Built by Waiting (as-34): during the hazard player's M/H phase, they
 * may spend {@link cost} hazard limit slots (incrementing
 * {@link MovementHazardPhaseState.hazardsPlayedThisCompany}) to untap this card.
 */
export interface UntapByHazardLimitEffect extends EffectBase {
  readonly type: 'untap-by-hazard-limit';
  /** Number of hazard limit slots consumed to untap this card. */
  readonly cost: number;
}

/**
 * Power Built by Waiting (as-34): prevents this card from being automatically
 * untapped during the controller's untap phase. The card only untaps via the
 * {@link UntapByHazardLimitEffect} mechanism.
 */
export interface NoAutoUntapEffect extends EffectBase {
  readonly type: 'no-auto-untap';
}

// ---- Gold ring test (Rule 9.21) ----

/**
 * The ring categories that a gold ring's test table can yield.
 * Used by {@link RingTestTableEffect} and {@link RingTestSearchEffect}.
 */
export type RingCategory =
  | 'lesser-ring'
  | 'magic-ring'
  | 'dwarven-ring'
  | 'the-one-ring'
  | 'spirit-ring';

/**
 * One row in a gold ring's test table: the roll range that makes this
 * category eligible. `null` means no bound ("any result"), which is
 * necessary for `lesser-ring` because negative roll modifiers can push
 * the total below 2.
 */
export interface RingTestTableEntry {
  readonly category: RingCategory;
  /** Inclusive lower bound on the roll total. null = no lower bound. */
  readonly min: number | null;
  /** Inclusive upper bound on the roll total. null = no upper bound. */
  readonly max: number | null;
}

/**
 * Encodes a gold ring item's test table (Rule 9.21). Each entry maps a roll
 * range to a ring category; multiple entries may match the same result.
 *
 * Used by: tw-196, tw-306, le-315, le-311.
 */
export interface RingTestTableEffect extends EffectBase {
  readonly type: 'ring-test-table';
  readonly table: readonly RingTestTableEntry[];
}

/**
 * Gleaming Gold Ring (le-311) special rule: when the test result is eligible
 * for {@link category}, the player may search their play deck and/or discard
 * pile for a matching ring card instead of being limited to their hand.
 */
export interface RingTestSearchEffect extends EffectBase {
  readonly type: 'ring-test-search';
  readonly category: RingCategory;
}
