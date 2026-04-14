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
 * Modifies the number of cards drawn during the movement/hazard draw step.
 *
 * Example: Alatar reduces the opponent's hazard draws by 1 for his company.
 */
export interface DrawModifierEffect extends EffectBase {
  readonly type: 'draw-modifier';
  /** Which draw pool to modify. */
  readonly draw: 'hazard' | 'resource';
  /** The adjustment (negative = fewer draws). */
  readonly value: number;
  /** Floor for the modified draw count. */
  readonly min?: number;
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
 * Closed set of combat-mechanics overrides a creature card can declare.
 * Every known override is listed here; the chain reducer dispatches on
 * `rule` against this union with full type safety. Adding a new override
 * is a one-line union extension plus the matching reducer branch — no
 * opaque strings to chase through the engine.
 */
export type CombatRule =
  | 'attacker-chooses-defenders'
  | 'multi-attack'
  | 'cancel-attack-by-tap';

/**
 * Overrides a combat mechanic.
 *
 * Example: Cave-drake — attacker chooses defending characters.
 */
export interface CombatRuleEffect extends EffectBase {
  readonly type: 'combat-rule';
  /** The combat rule override. */
  readonly rule: CombatRule;
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
 * - `no-hazard-limit` — playing this hazard does not consume a slot
 *   against the per-company hazard limit (e.g. Twilight, Lure).
 */
export type PlayFlag = 'home-site-only' | 'playable-as-resource' | 'no-hazard-limit';

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
 * Restricts an item to be playable only at the named sites.
 * When present, the normal site-type check (`playableResources`) is
 * bypassed and the item is playable only if the company's current site
 * name appears in the `sites` list.
 *
 * Example: Palantír of Orthanc — playable only at Isengard.
 */
export interface ItemPlaySiteEffect extends EffectBase {
  readonly type: 'item-play-site';
  /** Site names where the item can be played. */
  readonly sites: readonly string[];
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
  | DenyItemSiteRule;

/** Wounded characters at this site heal during untap as if the site were a haven. */
export interface HealingAffectsAllSiteRule extends EffectBase {
  readonly type: 'site-rule';
  readonly rule: 'healing-affects-all';
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
 * Forces the discard of an in-play card matching a filter. The player
 * chooses which eligible card to discard. Uses the pending-effects
 * sub-flow: the event stays in cardsInPlay while the player selects
 * a target, then both the target and the event are discarded.
 *
 * Example: Marvels Told — tap a sage to discard a hazard non-environment
 * permanent-event or long-event.
 */
export interface DiscardInPlayEffect extends EffectBase {
  readonly type: 'discard-in-play';
  /** DSL condition evaluated against each card definition to decide eligibility. */
  readonly filter: Condition;
  /**
   * Corruption check enqueued on the tapped character after resolution.
   * The modifier is added to the standard corruption check roll.
   */
  readonly corruptionCheck?: {
    readonly modifier: number;
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
 * Declares that an item can be stored at specific named sites during the
 * Organization phase. Storing moves the item from the character to the
 * player's stored-items pile, where it earns marshalling points safely.
 *
 * Example: Sapling of the White Tree — storable at Minas Tirith for 2 MP.
 */
export interface StorableAtEffect extends EffectBase {
  readonly type: 'storable-at';
  /** Site names where the item can be stored. */
  readonly sites: readonly string[];
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
 *
 * If the condition is not met, the card is not offered as a legal action.
 */
export interface PlayConditionEffect extends EffectBase {
  readonly type: 'play-condition';
  readonly requires: 'site-path';
  readonly condition: Condition;
}

/**
 * Requires the player to choose a creature race when playing the card.
 * The `exclude` array lists races that may not be chosen. The `apply`
 * clause describes the constraint added for the chosen race.
 *
 * Used by Two or Three Tribes Present: announce a creature type (except
 * Nazgûl, Undead, or Dragons) — creatures of that type bypass the hazard
 * limit for the target company.
 */
export interface CreatureRaceChoiceEffect extends EffectBase {
  readonly type: 'creature-race-choice';
  /** Races the player may NOT choose. */
  readonly exclude: readonly string[];
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
  | DodgeStrikeEffect
  | HalveStrikesEffect
  | CombatRuleEffect
  | PlayFlagEffect
  | DuplicationLimitEffect
  | PlayTargetEffect
  | PlayOptionEffect
  | PlayWindowEffect
  | PlayConditionEffect
  | CreatureRaceChoiceEffect
  | OnGuardRevealEffect
  | FetchToDeckEffect
  | DiscardInPlayEffect
  | SiteRuleEffect
  | ItemPlaySiteEffect
  | StorableAtEffect
  | CompanyRuleEffect
  | CallOfHomeCheckEffect
  | AhuntAttackEffect
  | ControlRestrictionEffect;
