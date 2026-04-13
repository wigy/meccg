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
 * Modifies a roll for a specific check type (corruption, faction-influence, etc.).
 *
 * Example: Gandalf has +1 to all corruption checks.
 * Example: Beregond has -1 to faction influence checks.
 */
export interface CheckModifierEffect extends EffectBase {
  readonly type: 'check-modifier';
  /** Which check type this modifier applies to. */
  readonly check: string;
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
 * Grants a new activated ability to the card's bearer.
 *
 * Example: Gandalf can tap to test a gold ring in his company.
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
}

/** An action performed by a triggered effect. */
export interface TriggeredAction {
  /** The type of triggered action. */
  readonly type: string;
  /** Which check to force (for 'force-check' type). */
  readonly check?: string;
  /** Modifier to the forced check. */
  readonly modifier?: number;
  /** Filter condition for 'discard-cards-in-play' — matches against card definitions. */
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
   */
  readonly value?: number;
  /**
   * For `set-character-status` type: the new status for the target
   * character (e.g. `"untapped"` to untap or heal).
   */
  readonly status?: 'untapped' | 'tapped' | 'inverted';
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
 * Example: The One Ring lets the bearer make a corruption check (-2)
 * to cancel a strike, except against Undead and Nazgûl.
 */
export interface CancelStrikeEffect extends EffectBase {
  readonly type: 'cancel-strike';
  /** The cost to cancel the strike. */
  readonly cost: ActionCost;
}

/**
 * Overrides a combat mechanic.
 *
 * Example: Cave-drake — attacker chooses defending characters.
 */
export interface CombatRuleEffect extends EffectBase {
  readonly type: 'combat-rule';
  /** The combat rule override identifier. */
  readonly rule: string;
  /**
   * For `multi-attack`: how many separate attacks the creature makes,
   * all against the same target character. Each attack uses the creature's
   * base strike count.
   */
  readonly count?: number;
  /**
   * For `cancel-attack-by-tap`: maximum number of attacks that can be
   * canceled by tapping non-target characters in the defending company.
   */
  readonly maxCancels?: number;
}

/**
 * Constrains when or where a card can enter play.
 *
 * Example: Frodo can only be played at his home site
 * (unless he is a starting character).
 */
export interface PlayRestrictionEffect extends EffectBase {
  readonly type: 'play-restriction';
  /** The restriction rule identifier. */
  readonly rule: string;
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
 * `{ target: { race, status, skills, name } }`, so conditions look like
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
  readonly target: 'character' | 'company' | 'site';
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
}

/**
 * Declares when an on-guard card may be revealed during the site phase.
 * The trigger specifies the game event that opens the reveal window.
 */
export interface OnGuardRevealEffect extends EffectBase {
  readonly type: 'on-guard-reveal';
  /** The game event that allows the on-guard card to be revealed. */
  readonly trigger: string;
}

/**
 * Declares a site-specific rule that modifies standard game mechanics
 * when a company is at this site.
 *
 * Example: Old Forest — healing effects affect all characters at the site
 * (wounded characters heal during untap as if the site were a haven).
 */
export interface SiteRuleEffect extends EffectBase {
  readonly type: 'site-rule';
  /** The site rule identifier. */
  readonly rule: string;
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
 * Cancels an entire attack against the company by tapping a character
 * with the required skill. Playable only during combat before strikes
 * are assigned.
 *
 * Example: Concealment — tap a scout to cancel one attack against his company.
 */
export interface CancelAttackEffect extends EffectBase {
  readonly type: 'cancel-attack';
  /** The cost to cancel the attack. */
  readonly cost: ActionCost;
  /** The skill required on the character who pays the cost. */
  readonly requiredSkill: string;
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
  | GrantActionEffect
  | OnEventEffect
  | CancelStrikeEffect
  | CancelAttackEffect
  | CombatRuleEffect
  | PlayRestrictionEffect
  | DuplicationLimitEffect
  | PlayTargetEffect
  | PlayOptionEffect
  | PlayWindowEffect
  | OnGuardRevealEffect
  | FetchToDeckEffect
  | SiteRuleEffect;
