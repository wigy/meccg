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

import type { RegionType, SiteType } from './common.js';

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
   */
  readonly target?: 'all-characters' | 'all-attacks' | 'all-automatic-attacks';
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
 * Applies a stat modifier to every character in the bearer's company.
 *
 * Example: The One Ring adds +1 corruption point to every character
 * in the bearer's company.
 */
export interface CompanyModifierEffect extends EffectBase {
  readonly type: 'company-modifier';
  /** Which stat to modify for all company members. */
  readonly stat: 'prowess' | 'body' | 'direct-influence' | 'corruption-points';
  /** The bonus (or penalty) applied to each company member. */
  readonly value: ValueExpr;
}

/**
 * Modifies the enemy's stats during combat.
 *
 * Example: Éowyn halves (rounded up) a Nazgûl's body.
 */
export interface EnemyModifierEffect extends EffectBase {
  readonly type: 'enemy-modifier';
  /** Which enemy stat to modify. */
  readonly stat: 'prowess' | 'body';
  /** The operation to apply (e.g. halve-round-up). */
  readonly op: 'halve-round-up';
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
  /** If set, the card (or "self") must be tapped to pay this cost. */
  readonly tap?: string;
  /** If set, the card (e.g. "self") must be discarded to pay this cost. */
  readonly discard?: string;
  /** If set, a check must be passed (e.g. corruption check). */
  readonly check?: string;
  /** Modifier applied to the cost check roll. */
  readonly modifier?: number;
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
  /** The type of triggered action. */
  readonly type: string;
  /**
   * Which check to force (for `force-check`) or which check's
   * modifiers to sum into a 2d6 roll (for `roll-check`).
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
   * For `add-constraint` with `constraint: "company-stat-modifier"`:
   * which stat the bonus applies to (currently `prowess` or `body`).
   */
  readonly stat?: 'prowess' | 'body';
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
 * The defending player may tap non-target characters in the defending
 * company to cancel attacks. Example: Assassin.
 */
export interface CombatCancelAttackByTapEffect extends EffectBase {
  readonly type: 'combat-cancel-attack-by-tap';
  /** Maximum number of attacks that can be canceled. */
  readonly maxCancels: number;
}

/**
 * The creature makes one strike per character in the defending company:
 * `strikesTotal = company.characters.length`. Card text is typically
 * "Each character in the company faces one strike". The card's raw
 * `strikes` value is ignored when this effect is present. Mutually
 * exclusive with `combat-multi-attack`.
 */
export interface CombatOneStrikePerCharacterEffect extends EffectBase {
  readonly type: 'combat-one-strike-per-character';
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
 */
export type PlayFlag = 'home-site-only' | 'playable-as-resource' | 'playable-as-hazard' | 'no-hazard-limit' | 'not-starting-character' | 'allow-store-eot';

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
  /** The sub-step within the phase. */
  readonly step: string;
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
   * Currently only `tap: "character"` is supported — taps the targeted
   * character (e.g. Stealth: "Tap a scout to play …").
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
  | DynamicAutoAttackSiteRule;

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
}

/**
 * Wounds the character targeted by a {@link PlayTargetEffect} on the same
 * card, without requiring a body check. Applied after the attack is
 * cancelled. Used by Escape (tw-229): the targeted unwounded character is
 * set to the `inverted` (wounded) state as the cost of cancelling the attack.
 */
export interface WoundTargetCharacterEffect extends EffectBase {
  readonly type: 'wound-target-character';
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
 * Halves the number of strikes in the current attack (rounded up).
 * Played from hand as a short event during combat before strikes are
 * assigned; the card is discarded after use.
 *
 * Example: Dark Quarrels (alternative mode) — if Gates of Morning is
 * in play, halve the strikes of any attack.
 */
export interface HalveStrikesEffect extends EffectBase {
  readonly type: 'halve-strikes';
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
  /** Cost to activate; for items this is `{ tap: "self" }`. */
  readonly cost: ActionCost;
  /** Amount added to the attack's strike prowess (usually negative). */
  readonly prowessModifier?: number;
  /** Amount added to the creature's body value for the creature body check (usually negative). */
  readonly bodyModifier?: number;
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
 * Declares a company-level rule carried by a character. While this
 * character is in play, the rule applies to their entire company.
 *
 * Rules:
 * - `healing-affects-all` — when a healing effect targets a character in
 *   this character's company, the healing extends to all wounded characters
 *   in the company. Example: Ioreth.
 */
export interface CompanyRuleEffect extends EffectBase {
  readonly type: 'company-rule';
  readonly rule: 'healing-affects-all';
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
 *
 * If the condition is not met, the card is not offered as a legal action.
 */
export interface PlayConditionEffect extends EffectBase {
  readonly type: 'play-condition';
  readonly requires: 'site-path' | 'discard-named-card' | 'combat-creature-race';
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
   */
  readonly sources?: readonly ('character-items' | 'out-of-play-pile')[];
  /**
   * For `requires: 'combat-creature-race'`: the required attacker race
   * (lowercase, e.g. `"dragon"`). When the current combat's
   * `creatureRace` does not match, the card is non-playable.
   */
  readonly race?: string;
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
 * Restricts how a character bearing this card can be controlled.
 *
 * Rules:
 * - `no-direct-influence` — the character cannot be controlled by direct
 *   influence; they must be under general influence. When the hazard is
 *   attached, any existing DI control is reverted to GI. Used by
 *   Rebel-talk (le-132).
 */
export interface ControlRestrictionEffect extends EffectBase {
  readonly type: 'control-restriction';
  readonly rule: 'no-direct-influence';
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
 * Protects the bearing card (typically an ally) from being targeted as a
 * strike recipient during combat.
 *
 * `protection: "no-attack"` — the bearer may not be assigned strikes from
 * any attack source (hazard creature, on-guard creature, automatic attack).
 * The bearer is excluded from the strike-assignment pool for both the
 * defending and attacking player. Used by Goldberry.
 */
export interface CombatProtectionEffect extends EffectBase {
  readonly type: 'combat-protection';
  readonly protection: 'no-attack';
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
  | CompanyRuleEffect
  | CallOfHomeCheckEffect
  | AhuntAttackEffect
  | DragonAtHomeEffect
  | ControlRestrictionEffect
  | CallCouncilEffect
  | WardBearerEffect
  | CombatProtectionEffect
  | MoveEffect
  | WoundTargetCharacterEffect;
