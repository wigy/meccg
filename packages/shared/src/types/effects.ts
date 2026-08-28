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

import type { CardDefinitionId, CompanyId, Keyword, MarshallingCategory, PlayerId, Race, RegionType, SiteType, Skill } from './common.js';
import type { SiteRuleEffect } from './effects/site-rules.js';

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
  /**
   * The four comparison operators accept either a number literal or a
   * context-path string that is resolved against the same context at match
   * time — both sides must then be numbers. This backs card text that
   * compares two stats, e.g. Whip (le-348) "prowess less than the bearer's":
   * `{ "target.prowess": { "$lt": "bearer.prowess" } }`.
   */
  /** Greater than. */
  readonly $gt?: number | string;
  /** Greater than or equal. */
  readonly $gte?: number | string;
  /** Less than. */
  readonly $lt?: number | string;
  /** Less than or equal. */
  readonly $lte?: number | string;
  /** Not equal. */
  readonly $ne?: string | number | boolean | null;
  /** Checks that the context value is a member of the given array. */
  readonly $in?: readonly (string | number)[];
  /**
   * Presence test. `{ $exists: true }` matches when the context value is
   * present (not `undefined`); `{ $exists: false }` matches when it is
   * absent. Used to gate on optional card-definition fields — e.g. a
   * site filter excluding Dragon's lairs (`lairOf` present) and
   * Under-deeps sites (`adjacentSites` present):
   * `{ "lairOf": { "$exists": false } }`.
   */
  readonly $exists?: boolean;
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
export interface EffectBase {
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
  /**
   * Which stat to modify.
   *
   * `'untap-penalty'` is not a printed character attribute but the prowess
   * penalty the bearer suffers when he chooses **not** to tap to face a strike
   * (CoE rule 3.iv.3: normally 3, 1 for The Balrog avatar). It is resolved
   * only by {@link computeStayUntappedPenalty} and never folded into
   * `effectiveStats`. Used by Thong of Fire (as-132): "if bearer chooses not
   * to tap against a strike, he receives no prowess penalty" —
   * `{ stat: "untap-penalty", op: "set", value: 0, when: { "bearer.skills":
   * { "$includes": "warrior" } } }`.
   */
  readonly stat: 'prowess' | 'body' | 'direct-influence' | 'corruption-points' | 'strikes' | 'general-influence' | 'mind' | 'untap-penalty';
  /** The bonus (or penalty if negative) to apply. Can be a MathJS expression. */
  readonly value: ValueExpr;
  /**
   * How `value` combines with the running stat total.
   * - `"add"` (default) — `result += value` (the common +N / -N modifier).
   * - `"multiply"` — `result *= value`, applied **after** all additive
   *   modifiers. Used for "doubled"-style effects, e.g. Plague of Wights
   *   (le-130) doubles the number of strikes of each Undead attack when
   *   Doors of Night is in play (`op: "multiply", value: 2`).
   * - `"set"` — `result = value`, an **absolute override** of the printed
   *   base, applied **before** every additive and multiplicative modifier so
   *   that ordinary +N/-N bonuses still stack on top of the new base. Used by
   *   the Radagast Shapeshifter forms (Master of Shapes wh-112, Shifter of
   *   Hues wh-115, Winged Change-master wh-116), whose "adopting the given
   *   attributes" replaces Radagast's printed prowess/body/DI/GI rather than
   *   adjusting them — Winged Change-master's prowess 3 is *lower* than
   *   Radagast's printed 6, which is what rules out a delta reading. When more
   *   than one `set` for the same stat is collected, the last one wins.
   */
  readonly op?: 'add' | 'multiply' | 'set';
  /** Maximum resulting stat value. Can be a MathJS expression. */
  readonly max?: ValueExpr;
  /** Minimum resulting stat value (floor). Can be a MathJS expression. E.g. `0` prevents negative DI. */
  readonly min?: ValueExpr;
  /**
   * When true this modifier applies **only while the source card is stored**
   * in its controller's marshalling-point pile (a `killPile` entry carrying
   * `storedAtSite`), never while the card merely sits in play. Pass the Doors
   * of Dol Guldur (dm-154): "*If stored*, all automatic-attacks at all
   * Dark-holds and all Shadow-holds are with one less prowess and one less
   * strike." {@link collectGlobalEffects} skips such effects on `cardsInPlay`
   * entries and picks them up from the stored-card scan instead.
   */
  readonly activeWhileStored?: boolean;
  /**
   * When true this modifier applies **only while the source card is bound to
   * an item via `attachedToItem`** (the Barrow-blade dm-119 shape), never
   * while the card is a plain item sitting in a character's `items` (its own
   * bearer would otherwise pick up the bonus directly). Map to Mithril
   * (td-133): "the bearer may tap himself and place this card with a
   * non-unique weapon in his company. This gives the weapon a +3 prowess
   * bonus" — the card starts as a Dwarf's own item (no bonus) and only grants
   * +3 prowess once re-parented onto a weapon via the `reattach-to-item`
   * grant-action. {@link collectCharacterEffects} skips such effects in the
   * character's own `items` loop and picks them up only from the
   * `attachedToItem` scan.
   */
  readonly activeWhileAttachedToItem?: boolean;
  /** Named identifier so other effects can reference and override this one. */
  readonly id?: string;
  /** If set, this effect replaces the named effect when its condition matches. */
  readonly overrides?: string;
  /**
   * Scope of this modifier. If absent, affects only the card's bearer.
   * - `"all-characters"` — applies to every character in play (e.g. Sun).
   * - `"own-characters"` — applies to every character controlled by the
   *   player who controls the card carrying this effect (e.g. A Strident
   *   Spawn wh-61: "Each of your Half-orcs requires one less point of
   *   influence to control"). Unlike `"all-characters"`, the opponent's
   *   matching characters are unaffected.
   * - `"all-attacks"` — applies to every automatic-attack and hazard creature.
   * - `"all-automatic-attacks"` — applies only to site automatic-attacks (not hazard creatures).
   * - `"attacker-chooses-defenders-attacks"` — `stat: "strikes"` only. Applies
   *   to an attack only once its final `attackerChoosesDefenders` flag
   *   (printed rule OR'd with any global grant) is known, at combat creation —
   *   kept separate from `"all-attacks"` so this later pass never double-counts
   *   an unrelated all-attacks strikes modifier already folded into the base
   *   total by {@link resolveAttackStrikes}. Used by More Alert than Most
   *   (dm-150): "-1 strike (-2 if Gates of Morning is in play), minimum 1, to
   *   any attack that chooses defending characters."
   * - `"company"` — applies to every character in the bearer's company (e.g. The One Ring).
   * - `"company-others"` — applies to every *other* character in the bearer's
   *   company, excluding the bearer itself (e.g. So You've Come Back le-138:
   *   "the mind of each **other** … character in his company increases by one").
   *   Collected from a company member's attached hazards/items for every *other*
   *   member; the effect's `when` gates the modified character (via `bearer.*`).
   */
  readonly target?: 'all-characters' | 'own-characters' | 'all-attacks' | 'all-automatic-attacks' | 'attacker-chooses-defenders-attacks' | 'company' | 'company-others';
  /**
   * Only meaningful for `stat: 'general-influence'`. Caps how many of the
   * `value` points added to the general-influence pool may be spent to control
   * characters; the remainder (`value - controlLimit`) still counts toward the
   * player's *unused* general influence (defensive hazard subtraction, CoE
   * step 1338) but can never control characters — mirroring the Ringwraith /
   * Balrog +5 bonus (CoE 1.12.R1 / 1.12.B1). Used by Truths of Doom (wh-108):
   * "+6 general influence; you may only use 2 of these 6 points to control
   * characters" (`value: 6, controlLimit: 2`). Absent = all `value` points may
   * control characters (the ordinary Bade to Rule / Great Shadow behaviour).
   */
  readonly controlLimit?: number;
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
  /**
   * Scope of the modifier. Absent (default) applies only to the bearer of the
   * card carrying the effect. `'company'` applies to every character in the
   * bearer's company — collected once per company (from items / attached
   * permanent-events on any company member) and folded into each member's
   * check via {@link resolveCheckModifier}. Used by I'll Be At Your Heels
   * (le-195): "+1 to all corruption checks by characters in his company."
   *
   * `'player-in-play'` is a **player-scoped, ongoing** modifier carried by a
   * bare permanent-event in the influencing player's `cardsInPlay` (not
   * attached to any character/item/site). It is collected directly from that
   * player's in-play permanent resource events at each faction-influence check
   * and applies to **every** such check by any of the player's characters, for
   * as long as the card stays in play (gated by the effect's `when` against the
   * faction-influence resolver context). Used by Great Army of the North
   * (ba-38): "As a permanent-event, +1 to your influence attempts against Orc
   * and Troll factions."
   *
   * `'all-in-play'` is a **game-wide, ongoing** modifier carried by a bare
   * in-play event (permanent- or long-event) in *either* player's `cardsInPlay`
   * (not attached to any character/item/site/company). Unlike `'player-in-play'`
   * (which benefits only its owner), an `'all-in-play'` modifier applies to
   * **every** matching check by **either** player, for as long as the card stays
   * in play (gated by the effect's `when` against the check resolver context).
   * Used by Times Are Evil (td-76), a hazard long-event: "All offering attempts
   * and influence attempts are modified by -3."
   */
  readonly target?: 'company' | 'player-in-play' | 'all-in-play';
}

/**
 * Modifies the 2d6 body-check roll made against the bearer during combat
 * (CoE rule 2.V.2.2). A body check is distinct from the influence/corruption
 * {@link CheckModifierEffect} family — it is rolled inside combat resolution,
 * not through the scoring pipeline — so it has its own effect type. A negative
 * value protects the bearer (lowers the roll, making it less likely to exceed
 * the bearer's body and eliminate them).
 *
 * Example: Helm of Fear (as-126) — "All body checks against the bearer are
 * modified by -1." Collected from items attached to the body-check target in
 * `reducer-combat.ts` and applied to the effective roll.
 *
 * A `scope: 'all-attacks'` modifier is instead a **global** effect carried by
 * an in-play permanent-event: it applies to every body check in combat, gated
 * by `when` against a context exposing `attack.creatureRace` (the attacking
 * creature's normalized race) and `target.race` (the body-checked character's
 * race). Used by Spawn of Ungoliant (ba-24) — "+1 to all body checks for
 * Elves, Dwarves, Hobbits, Dúnedain, and Men resulting from Spider attacks."
 *
 * A `scope: 'bearer-combat'` modifier is carried by an item / attached
 * permanent-event on a **participating character** and applies to body checks
 * that arise from that bearer's combat, gated by `when` against a context
 * exposing `bodyCheck.target` (`'creature' | 'character' | 'attacker-character'`),
 * `bodyCheck.fromFailedStrike` (true when a strike against the bearer failed and
 * the striker now body-checks), and `combat.isCvCC`. The relevant bearer is the
 * parrying defender (for `creature` / `attacker-character` checks) or the
 * successful CvCC attacker (for a `character` check). Used by Flame of Udûn
 * (ba-58) — "+1 to all body checks resulting from failed strikes against The
 * Balrog" and, in CvCC where The Balrog attacks successfully, "+1 to defending
 * character's body check."
 */
export interface BodyCheckModifierEffect extends EffectBase {
  readonly type: 'body-check-modifier';
  /** The modifier added to the body-check roll (negative protects the bearer). */
  readonly value: number;
  /**
   * Where the modifier is sourced from and what it applies to:
   * - absent / `'bearer'` (default): a static effect on an item attached to the
   *   body-check target; applies only to that bearer (Helm of Fear as-126).
   * - `'all-attacks'`: a global effect on an in-play permanent-event; applies to
   *   every combat body check, gated by `when` against `attack.creatureRace` /
   *   `target.race` (Spawn of Ungoliant ba-24).
   * - `'bearer-combat'`: an item / attached permanent-event on a participating
   *   character; applies to body checks arising from that bearer's combat, gated
   *   by `when` against `bodyCheck.target` / `bodyCheck.fromFailedStrike` /
   *   `combat.isCvCC` (Flame of Udûn ba-58).
   */
  readonly scope?: 'bearer' | 'all-attacks' | 'bearer-combat';
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
 * A game-wide modifier to the corruption points and/or marshalling points of
 * every in-play item that matches an item filter, sourced from an in-play
 * permanent-event (in either player's `cardsInPlay`). Unlike {@link MpModifierEffect}
 * (which rides the item being scored and is gated on the *bearer*), this effect
 * lives on a *separate* card and reaches out to every matching item borne by any
 * character of any player.
 *
 * `itemFilter` is evaluated against a per-item context `{ item: { keywords,
 * name, cardType, subtype } }` (an absent filter matches every item). The `corruptionPoints`
 * delta is folded into each matching item's bearer corruption total (in
 * `computeEffectiveStats`, respecting the same Balrog-avatar exclusion as the
 * item's printed corruption); the `marshallingPoints` delta is added flat to the
 * item's marshalling category in the MP tally.
 *
 * Used by Rumor of the One (le-224): "+1 to the corruption points and the
 * marshalling points for all ring items." — `itemFilter`
 * `{ "item.keywords": { "$includes": "ring" } }`, `corruptionPoints: 1`,
 * `marshallingPoints: 1`. And by Scorba at Home (td-65): "each major item
 * gives an additional corruption point." — `itemFilter`
 * `{ "item.subtype": "major" }`, `corruptionPoints: 1`. Also by Itangast at
 * Home (td-38): "each greater item gives an additional corruption point" —
 * `itemFilter` `{ "item.subtype": "greater" }`, `corruptionPoints: 1`.
 *
 * {@link corruptionMultiplier} scales the matching item's corruption instead of
 * (well: after) shifting it, and {@link bearerFilter} restricts the whole
 * modifier to items borne by characters of a player matching a player-context
 * condition. Together they back Bane of the Ithil-stone (tw-13): "Corruption
 * points for Palantíri are doubled. … This card has no effect on a minion
 * player." — `itemFilter` `{ "item.keywords": { "$includes": "palantir" } }`,
 * `corruptionMultiplier: 2`, `bearerFilter` `{ "bearer.minion": false }`.
 */
export interface InPlayItemModifierEffect extends EffectBase {
  readonly type: 'in-play-item-modifier';
  /** Item-context condition selecting which items are affected (absent → all items). */
  readonly itemFilter?: Condition;
  /** Corruption-point delta added to each matching item (default 0). */
  readonly corruptionPoints?: number;
  /** Marshalling-point delta added to each matching item's category (default 0). */
  readonly marshallingPoints?: number;
  /**
   * Factor applied to each matching item's corruption points *after* the
   * {@link corruptionPoints} delta (default 1 — no scaling). Multipliers from
   * several in-play copies/cards compound.
   */
  readonly corruptionMultiplier?: number;
  /**
   * Condition on the item's **bearer's controlling player**, evaluated against
   * `{ bearer: { alignment, minion } }` (`minion` is true for the Ringwraith
   * and Balrog alignments). Absent → every player's items are affected.
   */
  readonly bearerFilter?: Condition;
}

/**
 * Game-wide effect that multiplies the corruption points of **one** of each
 * character's corruption sources, with the controlling player choosing which
 * source. Carried by a permanent/long event in either player's `cardsInPlay`;
 * while in play, every character in the game (both players) has one of its
 * corruption sources scaled by {@link multiplier}.
 *
 * The controlling player always minimises the corruption they suffer, so the
 * engine doubles the character's **smallest** corruption source — the only
 * rational choice, since scaling any larger source would add strictly more
 * corruption. With N copies of the effect in play, the N smallest distinct
 * sources are scaled (the minimising assignment).
 *
 * A "corruption source" is a corruption-bearing card the character holds: a
 * borne item worth corruption points (its printed value plus any in-play item
 * modifier, e.g. Rumor of the One), an attached `hazard-corruption` card, or a
 * card contributing corruption via a `stat-modifier` on `corruption-points`
 * (e.g. The One Ring). Characters with no corruption source are unaffected.
 *
 * Used by The Balance of Things (tw-93): "Each character has the corruption
 * points doubled for one of his sources of corruption (the player controlling
 * the character chooses)."
 */
export interface CorruptionSourceMultiplierEffect extends EffectBase {
  readonly type: 'corruption-source-multiplier';
  /** Factor applied to the chosen source's corruption points (default 2 — "doubled"). */
  readonly multiplier?: number;
}

/**
 * Grants a fixed marshalling-point value while the carrying card sits in a
 * player's marshalling-point (kill) pile.
 *
 * Some hazard events place *themselves* into a marshalling-point pile and then
 * score marshalling points from there (rather than being stored items or
 * defeated creatures). This effect declares the flat value the card is worth
 * whenever it is found in a `killPile`, in the given category.
 *
 * Used by Neither so Ancient Nor so Potent (dm-73): after returning an
 * opponent's stored item to hand, the card is placed in the opponent's
 * marshalling-point pile where "It gives 2 item marshalling points."
 */
export interface MpInPileEffect extends EffectBase {
  readonly type: 'mp-in-pile';
  /** The marshalling-point category the card scores while in the pile. */
  readonly category: MarshallingCategory;
  /** The flat marshalling-point value awarded while in the pile. */
  readonly value: number;
}

/**
 * Resolution effect for a hazard played on an opponent's stored item: the
 * targeted stored item is removed from the marshalling-point pile it sits in
 * and the carrying card takes its place.
 *
 * On resolution the engine:
 * 1. removes the targeted stored item from its owner's marshalling-point pile
 *    and returns it to that owner's hand (per {@link returnItemTo}), discarding
 *    any cards attached to the item; and
 * 2. places the resolving card itself into that same owner's marshalling-point
 *    pile (per {@link selfTo}), where an accompanying {@link MpInPileEffect}
 *    determines how many marshalling points it grants.
 *
 * "Owner" is the stored item's owner — i.e. the opponent of the hazard player.
 *
 * Used by Neither so Ancient Nor so Potent (dm-73): "Return item to opponent's
 * hand (discarding all attached cards). Place this card in opponent's
 * marshalling point pile."
 */
export interface DisplaceStoredItemEffect extends EffectBase {
  readonly type: 'displace-stored-item';
  /** Where the displaced stored item goes. Currently the item owner's hand. */
  readonly returnItemTo: 'owner-hand';
  /** Where the resolving card goes. Currently the item owner's MP pile. */
  readonly selfTo: 'owner-mp-pile';
}

/**
 * Fallen-wizard marshalling-point exemption (MEWH §4 exception).
 *
 * MEWH §4 normally clamps every non-stage card a Fallen-wizard controls to a
 * flat **1** marshalling point, regardless of its printed value — including
 * his characters, which normally score their printed character MP. A card
 * carrying this effect *exempts* a subset of the player's cards from that
 * clamp, so they score their full printed MP instead. {@link cards} selects
 * the kind of card the exemption reaches (characters, items, or allies); the
 * optional {@link filter} is matched against each such card's definition (via
 * `matchesDefinition`), and an absent filter exempts every card of the kind.
 * Cards that do not match remain clamped to 1.
 *
 * The effect may be carried by a character (Saruman wh-9 is a character) or
 * by a stage permanent-event in `cardsInPlay` (Join the Hunt wh-93). When
 * {@link inAvatarCompany} is set, only cards borne by characters in the same
 * company as the player's revealed avatar qualify ("items in Alatar's
 * company").
 *
 * Uses:
 * - Saruman (wh-9): "Your non-weapon/non-armor/non-shield/non-helmet items
 *   are each worth full marshalling points." — `cards: "items"`, filter
 *   excluding items keyworded `weapon`/`armor`/`shield`/`helmet`.
 * - Fallen-wizard Gandalf (wh-4): "Your characters and hero allies are each
 *   worth full marshalling points." — an unfiltered `cards: "characters"`
 *   entry paired with a `cards: "allies"` entry filtered to
 *   `hero-resource-ally`.
 * - Join the Hunt (wh-93): weapon/armor/shield/helmet items and allies with a
 *   prowess attribute, both restricted to Alatar's company
 *   (`inAvatarCompany`). Oromë's Warders (wh-94) repeats both player-wide.
 * - Radagast (wh-8): hero allies player-wide.
 *
 * ```json
 * { "type": "fw-mp-full", "cards": "items",
 *   "filter": { "$not": { "$or": [
 *     { "keywords": { "$includes": "weapon" } },
 *     { "keywords": { "$includes": "armor" } },
 *     { "keywords": { "$includes": "shield" } },
 *     { "keywords": { "$includes": "helmet" } } ] } } }
 * { "type": "fw-mp-full", "cards": "characters" }
 * ```
 */
export interface FallenWizardMpFullEffect extends EffectBase {
  readonly type: 'fw-mp-full';
  /** Which kind of the player's cards the exemption reaches. */
  readonly cards: 'characters' | 'items' | 'allies';
  /**
   * Condition matched against a card's definition. Cards of the {@link cards}
   * kind that match score full printed MP for the Fallen-wizard; omit to
   * exempt every card of the kind.
   */
  readonly filter?: Condition;
  /**
   * When `true`, the exemption applies only to cards borne by characters in
   * the same company as the player's revealed avatar (e.g. "your … items in
   * Alatar's company", Join the Hunt wh-93). Omit for a player-wide exemption
   * (Saruman wh-9, Gandalf wh-4).
   */
  readonly inAvatarCompany?: boolean;
}

/**
 * Fallen-wizard marshalling-point denial — the mirror of
 * {@link FallenWizardMpFullEffect}.
 *
 * A card carrying this effect gives its controller **no** marshalling points at
 * all while that controller is a Fallen-wizard, and no other card can change
 * that: the denial is checked before the MEWH §4 clamp, before any
 * `fw-mp-full` exemption, and before every MP override/pin
 * (`noncharacter-mp-override`, `nonhaven-company-mp-pin`, the global
 * `in-play-item-modifier` MP delta). Players of any other alignment score the
 * card normally.
 *
 * Used by the minion Palantír of Elostirion (le-332) and its siblings
 * (Palantír of Orthanc tw-300 / le-334): "This item does not give MPs to a
 * Fallen-wizard regardless of other cards in play."
 *
 * ```json
 * { "type": "fw-mp-none" }
 * ```
 */
export interface FallenWizardNoMpEffect extends EffectBase {
  readonly type: 'fw-mp-none';
}

/**
 * Exempts matching allies the source's controller has in play from their
 * printed "discard if the company moves to …" movement restriction (a
 * `bearer-company-moves` self-discard, e.g. Mistress Lobelia dm-178). CRF 22:
 * an ally's "movement restriction" is exactly its "Discard if he/she moves to"
 * clause; this effect makes those clauses not fire for the matching allies.
 *
 * Collected during the end-of-movement discard sweep (`mh-hazard-play.ts`) from
 * the moving player's in-play characters and `cardsInPlay`. When a matching
 * ally would be discarded by a `bearer-company-moves` self-discard, the discard
 * is skipped.
 *
 * Used by Radagast (wh-8): "Hero allies Radagast controls have no movement
 * restrictions." — `filter` `{ cardType: "hero-resource-ally" }`.
 *
 * ```json
 * { "type": "ally-movement-restriction-exemption",
 *   "filter": { "cardType": "hero-resource-ally" } }
 * ```
 */
export interface AllyMovementRestrictionExemptionEffect extends EffectBase {
  readonly type: 'ally-movement-restriction-exemption';
  /**
   * Condition matched against an ally's card definition. Matching allies are
   * exempt from their `bearer-company-moves` self-discard; omit to exempt every
   * ally the controller has in play.
   */
  readonly filter?: Condition;
}

/**
 * Fallen-wizard character/ally marshalling-point floor (MEWH §4 exception).
 *
 * MEWH §4 clamps every non-stage card a Fallen-wizard controls to a flat **1**
 * marshalling point. A stage permanent-event may carry this effect to let the
 * player's **characters and allies** whose *printed* MP is at least
 * {@link threshold} each score {@link value} MP instead of the clamped 1. Cards
 * printed below the threshold remain at their normal value (1 under the §4
 * clamp). Only characters and allies are affected — factions, items, and other
 * cards in play keep the §4 clamp.
 *
 * Used by Great Patron (wh-72): "Your characters and allies that normally give 2
 * or more marshalling points are each worth 2 marshalling points." Here
 * `threshold` and `value` are both 2.
 *
 * ```json
 * { "type": "fw-character-ally-mp", "threshold": 2, "value": 2 }
 * ```
 */
export interface FallenWizardCharacterAllyMpEffect extends EffectBase {
  readonly type: 'fw-character-ally-mp';
  /**
   * Minimum *printed* marshalling points a character/ally must normally give for
   * the override to apply.
   */
  readonly threshold: number;
  /** MP each qualifying character/ally is worth, overriding the §4 1-MP clamp. */
  readonly value: number;
}

/**
 * Fallen-wizard kill marshalling-point exemption (MEWH §4 exception).
 *
 * MEWH §4 clamps every defeated creature a Fallen-wizard's companies kill to a
 * flat **1** kill marshalling point. A character carrying this effect exempts
 * the player from that clamp: hazard creatures his companies defeat score their
 * *full* printed kill marshalling points instead. In addition, a defeated
 * **detainment** creature — which normally awards 0 kill MP because it is
 * discarded rather than routed to the kill pile (CoE rule 3.II.3) — is instead
 * placed in the defending player's kill pile and scores its full kill MP too
 * (the "even with *" clause; `*` marks a detainment attack). Both consequences
 * are player-wide ("your companies"), not limited to the carrier's company.
 *
 * Used by Alatar (wh-1): "Hazards your companies defeat (even with *) are worth
 * full kill marshalling points."
 *
 * ```json
 * { "type": "fw-kill-mp-full" }
 * ```
 */
export interface FallenWizardKillMpEffect extends EffectBase {
  readonly type: 'fw-kill-mp-full';
}

/**
 * Converts every detainment attack against the carrier's player's companies
 * into a normal attack (CoE §3.II — a detainment attack taps rather than
 * wounds, suppresses the body check, and awards no kill MP; a normal attack
 * does none of those). While a character carrying this effect is in play and
 * the player's stage-point total is strictly greater than
 * {@link stagePointsAbove}, any attack the engine would otherwise treat as
 * detainment — whether from a `combat-detainment` effect, a site-forced
 * detainment rule, or the alignment-based §3.II keying rules — is resolved as a
 * normal attack instead.
 *
 * Used by Alatar (wh-1): "If you have more than 7 stage points, all detainment
 * attacks against your companies attack normally instead." Here
 * `stagePointsAbove` is 7.
 *
 * ```json
 * { "type": "detainment-attacks-normal", "stagePointsAbove": 7 }
 * ```
 */
export interface DetainmentAttacksNormalEffect extends EffectBase {
  readonly type: 'detainment-attacks-normal';
  /**
   * The player's stage-point total must be strictly greater than this for the
   * conversion to apply. Defaults to 0 (always active while in play) when
   * omitted.
   */
  readonly stagePointsAbove?: number;
}

/**
 * Global (in-play, either player's `cardsInPlay`) rule: every automatic-attack
 * at a site whose effective {@link SiteType} is in {@link siteTypes} resolves as
 * a **normal** attack rather than a detainment attack (CoE §3.II — detainment
 * taps rather than wounds and awards no kill MP; a normal attack does neither).
 *
 * Unlike {@link DetainmentAttacksNormalEffect} — which a *defending* character
 * carries and which converts detainment for that player's companies regardless
 * of site — this is a site-type-scoped global carried by a long hazard-event and
 * applies to any company entering a matching site. It short-circuits the
 * detainment computation to `false` for that attack (see `isDetainmentAttack`'s
 * `defenderForcesNormalAttacks`, fed via `siteTypeForcesAutoAttacksNormal`).
 *
 * Used by Awaken Defenders (le-103): "each detainment automatic-attack at a
 * Free-hold or Border-hold becomes a normal automatic-attack" —
 * `{ "type": "auto-attacks-normal", "siteTypes": ["free-hold", "border-hold"] }`.
 */
export interface AutoAttacksNormalEffect extends EffectBase {
  readonly type: 'auto-attacks-normal';
  /** Effective site types at which automatic-attacks become normal. */
  readonly siteTypes: readonly SiteType[];
}

/**
 * Contributes stage points to the Fallen-wizard who controls this card (MEWH).
 *
 * Stage points reflect how far a Fallen-wizard has deviated from his original
 * mission. Most *stage resource* permanent-events (`alignment: 'stage'`) give
 * stage points; a Fallen-wizard must start with cards totalling exactly 3, and
 * various rules key off the running total (e.g. the optional company-vs-company
 * combat rule unlocks above 10). The total is **derived** in
 * `recompute-derived.ts` by summing this effect's `value` across the player's
 * in-play cards, so it stays a single source of truth (like the marshalling
 * point tally) — never a free-floating counter.
 *
 * A negative `value` is permitted so a card can reduce the contribution of
 * another effect when the total is summed.
 *
 * Example: a stage card printed with "(3)" carries `{ type: 'stage-points',
 * value: 3 }`.
 */
export interface StagePointsEffect extends EffectBase {
  readonly type: 'stage-points';
  /** Stage points this card contributes to its controller's running total. */
  readonly value: number;
  /**
   * When true, this card is a **site** that grants its stage points only while
   * one of the controlling Fallen-wizard's companies occupies it — the points
   * are not tallied from `cardsInPlay`/items but from a distinct occupied
   * `currentSite` (deduplicated per site instance, so two companies at the same
   * site do not double it). Used by Deep Mines (wh-55, "You receive the three
   * stage points if any of your companies are at the site") and Rhosgobel
   * (wh-57). Absent/false on ordinary stage cards, whose points are summed
   * from in-play cards regardless of company location.
   */
  readonly whileCompanyAtSite?: boolean;
}

/**
 * Overrides who, and at what cost, may control the bearing character (CoE
 * "influence to control"). Carried by a resource permanent-event played on one
 * of your own characters (e.g. Wizard's Myrmidon wh-84, The Forge-master
 * wh-117) or by an item.
 *
 * - {@link cost} replaces the printed `mind` as the influence-to-control value
 *   in every control context: the general-influence cost to keep the character,
 *   the direct-influence a controller spends to hold it as a follower, the
 *   move-to-influence reassignment checks, and the threshold an opponent must
 *   beat to influence it away.
 * - {@link sources} restricts *which* control sources may hold the character
 *   under direct influence. General influence is always permitted; a non-general
 *   (direct-influence) controller is allowed only when `'fallen-wizard'` is
 *   listed and that controller is the player's Fallen-wizard avatar. With no
 *   `sources`, any normal direct-influence controller is allowed.
 *
 * Both fields are read through `engine/control-cost.ts`; neither touches the
 * character's `mind` for combat/setup purposes (defender-prowess-from-mind,
 * tap-low-mind, the Fallen-wizard mind≤5 setup gate).
 */
export interface ControlRestrictionEffect extends EffectBase {
  readonly type: 'control-restriction';
  /** Influence-to-control cost override (replaces the bearer's printed mind). */
  readonly cost?: number;
  /** Allowed control sources; `'general'` is always permitted regardless. */
  readonly sources?: readonly ('general' | 'fallen-wizard')[];
}

/**
 * Marker carried by a permanent-event attached to a character (stored in the
 * host character's `items`). While it is attached, the host character's mind is
 * **not** subtracted from the controller's general influence — the character
 * "does not count against general influence". Collected in `recompute-derived.ts`
 * (the general-influence-used accumulator skips a character bearing this effect).
 *
 * Used by *Await the Advent of Allies* (dm-117): a low-mind non-Wizard character
 * parked at a non-Haven site costs no general influence while it awaits the
 * play of an ally/faction there.
 */
export interface GeneralInfluenceExemptEffect extends EffectBase {
  readonly type: 'general-influence-exempt';
}

/**
 * Marker granting automatic influence of a specific named faction: an influence
 * attempt against that faction by the character carrying this effect succeeds
 * with no 2d6 check (guaranteed success). The site still taps as usual.
 *
 * Carried by an item on the influencing character (or printed on the character
 * itself); it flows to the influencer through `collectCharacterEffects` in the
 * `faction-influence-check` context, so an item's grant reaches its bearer. The
 * faction-influence legal-action generator surfaces the attempt with `need: 0`,
 * and `resolveInfluenceAttemptRoll` skips the roll when the grant matches the
 * faction being influenced.
 *
 * Used by Red Arrow (tw-312): "Bearer may automatically influence the Riders of
 * Rohan."
 */
export interface AutoInfluenceFactionEffect extends EffectBase {
  readonly type: 'auto-influence-faction';
  /** Exact name of the faction that may be influenced automatically. */
  readonly faction: string;
}

/**
 * Marker carried by a bare permanent-event in `cardsInPlay` declaring that its
 * controller "is Sauron, not a Ringwraith" (The Lidless Eye le-203; its sibling
 * manifestation Sauron ba-43). While such a card is in play the player counts as
 * Sauron and therefore **may not reveal a Ringwraith avatar** nor **play any
 * Ringwraith follower** (CoE: "You are Sauron, not a Ringwraith. You may not
 * reveal a Ringwraith or play Ringwraith followers.").
 *
 * The marker carries no data — the two enforcement hooks live in the
 * legal-action layer (`organization-characters.ts`) and detect the marker via
 * the {@link playerPlaysAsSauron} helper (by effect type, not card id, so any
 * future card carrying it works unchanged). All the card's other continuous
 * effects (+7 general influence, +1 hand size, etc.) are separate bare effects
 * collected from `cardsInPlay` by the usual recompute paths.
 */
export interface PlayAsSauronEffect extends EffectBase {
  readonly type: 'play-as-sauron';
}

/**
 * Marker carried by a bare permanent-event in `cardsInPlay` lifting the
 * one-character-play-per-turn limit for its controller ("there is no limit to
 * the number of characters you may bring into play", Sauron ba-43). While such
 * a card is in play, the `one-character-per-turn` gate in
 * `organization-characters.ts` is skipped entirely — every character play that
 * passes the remaining gates (influence, sites, uniqueness, …) stays viable no
 * matter how many characters were already brought into play this turn.
 *
 * The marker carries no data — detection is by effect type via the
 * {@link playerHasNoCharacterPlayLimit} helper (`reducer-utils.ts`), so any
 * future card carrying it works unchanged.
 */
export interface NoCharacterPlayLimitEffect extends EffectBase {
  readonly type: 'no-character-play-limit';
}

/**
 * Marker carried by a permanent-event attached to a character (stored in the
 * host character's `items`). While it is attached, the host character's own
 * printed marshalling points do not count toward the controller's MP tally
 * ("its marshalling points do not count"). Only the character's *own* MP is
 * nullified — items/allies it bears still score normally. Collected in the
 * character-MP branch of `recompute-derived.ts`.
 *
 * Used by *Await the Advent of Allies* (dm-117).
 */
export interface OwnMpNotCountedEffect extends EffectBase {
  readonly type: 'own-mp-not-counted';
}

/**
 * Overrides the marshalling-point value of the controlling player's factions
 * (MEWH Fallen-wizard stage cards). Carried by a stage resource permanent-event;
 * while it is in play, each faction the player controls is re-valued according
 * to the matching {@link rules} entry, replacing both the faction's printed MP
 * and the Fallen-wizard §4 flat-1 clamp.
 *
 * Rules are evaluated in array order against a per-faction context
 * `{ faction: { unique, race, normalMp, name }, player: { avatar } }`, where
 * `faction.normalMp` is the faction's printed MP and `player.avatar` is the
 * name of the controller's revealed avatar (e.g. `"Alatar"`). The **last**
 * matching rule wins, so order entries from least to most specific (base rule
 * first, avatar-specific overrides after). A faction matching no rule keeps its
 * normal scoring. Collected and consumed in `recompute-derived.ts`.
 *
 * Used by Gatherer of Loyalties (wh-70): unique factions worth 2 MP each, with
 * Alatar's unique Dragon factions worth 4 and Pallando's unique factions
 * normally worth 3+ worth 3.
 */
export interface FactionMpOverrideEffect extends EffectBase {
  readonly type: 'faction-mp-override';
  /** Ordered override rules; the last matching rule sets the faction's MP. */
  readonly rules: readonly {
    /** Condition matched against the per-faction override context. */
    readonly when: Condition;
    /** Marshalling points the faction is worth when this rule matches. */
    readonly value: number;
  }[];
}

/**
 * Overrides the marshalling-point value of the controller's in-play
 * permanent-events that "require a site where [a resource category] is
 * playable".
 *
 * A permanent-event "requires a site where X is playable" iff it carries a
 * `play-condition` with `requires: 'site-has-resource'` and `subtype: X` — the
 * same prerequisite the legal-action layer reports as "requires a site where X
 * is playable". While the card carrying this effect is in play, every such
 * permanent-event the player controls scores exactly {@link value} marshalling
 * points (in its own marshalling category), overriding its printed value and,
 * for a Fallen-wizard, the MEWH §4 flat-1-MP clamp.
 *
 * Used by Man of Skill (wh-119): "Your permanent-events that require a site
 * where Information is playable are each worth 2 marshalling points."
 *
 * ```json
 * { "type": "permanent-event-mp", "value": 2, "requiresResource": "information" }
 * ```
 */
export interface PermanentEventMpEffect extends EffectBase {
  readonly type: 'permanent-event-mp';
  /** Marshalling points each matching permanent-event is worth. */
  readonly value: number;
  /**
   * The resource subtype whose playability the permanent-event requires
   * (matched against a `site-has-resource` play-condition's `subtype`), e.g.
   * `"information"`.
   */
  readonly requiresResource: string;
}

/**
 * Re-values the controller's **non-character** cards in play that match a
 * per-card {@link when} condition, overriding their printed marshalling points
 * (and, for a Fallen-wizard, the MEWH §4 flat-1-MP clamp).
 *
 * The override is applied to every MP-scoring non-character card the player
 * controls — items and allies borne by his characters, and factions / misc
 * permanent-events in his `cardsInPlay` — but never to characters (which are
 * scored by their own {@link FallenWizardCharacterAllyMpEffect} / §4 path).
 * Each candidate is matched against the context
 * `{ card: { unique, normalMp, cardType, name, race } }`, where `normalMp` is
 * the card's *printed* marshalling points; a match scores exactly {@link value}.
 *
 * The carrying card is typically a stage permanent-event placed on the avatar
 * (collected from both `cardsInPlay` and the avatar's `items`, so it counts
 * while attached), so "if on Gandalf" is satisfied by the card being in play.
 *
 * Used by Give Welcome to the Unexpected (wh-99): "your unique non-character
 * cards normally worth 1 marshalling point are each worth 2 marshalling points."
 *
 * ```json
 * { "type": "noncharacter-mp-override", "when": { "card.unique": true, "card.normalMp": 1 }, "value": 2 }
 * ```
 */
export interface NonCharacterMpOverrideEffect extends EffectBase {
  readonly type: 'noncharacter-mp-override';
  /**
   * Condition matched against the per-card context
   * `{ card: { unique, normalMp, cardType, name, race } }`. Every matching
   * non-character MP-scoring card the player controls scores {@link value}.
   */
  readonly when: Condition;
  /** MP each matching card is worth, overriding its printed value and the §4 clamp. */
  readonly value: number;
}

/**
 * Re-values the controller's **characters** that match a per-card {@link when}
 * condition, overriding their printed marshalling points and every other
 * character-MP rule in play (the MEWH §4 flat-1-MP clamp, a Great Patron wh-72
 * cap, a wh-4 full-MP exemption, an Await the Onset wh-96 pin) — the
 * character-scoring sibling of {@link NonCharacterMpOverrideEffect}.
 *
 * Each of the player's in-play characters is matched against the context
 * `{ card: { unique, normalMp, cardType, name, race } }`, where `normalMp` is
 * the character's *printed* marshalling points; a match scores exactly
 * {@link value}. Characters with no printed MP are unaffected either way.
 *
 * The carrying card may be a card in the player's `cardsInPlay`, an item on one
 * of his characters, or a **hazard attached to one of his characters** — the
 * last is how an opponent's hazard re-values the cards of the player it is
 * played on.
 *
 * Used by Fool's Bane (wh-19): "his Elf characters … are each worth 0
 * marshalling points in all cases."
 *
 * ```json
 * { "type": "character-mp-override", "when": { "card.race": "elf" }, "value": 0 }
 * ```
 */
export interface CharacterMpOverrideEffect extends EffectBase {
  readonly type: 'character-mp-override';
  /**
   * Condition matched against the per-character context
   * `{ card: { unique, normalMp, cardType, name, race } }`. Every matching
   * character the player controls scores {@link value}.
   */
  readonly when: Condition;
  /** MP each matching character is worth, overriding every other MP rule. */
  readonly value: number;
}

/**
 * Pins every MP-scoring card **held by a company that is not at one of the
 * controller's Wizardhavens** to a flat {@link value} marshalling points,
 * overriding all other MP computation for those cards ("regardless of other
 * cards in play"). Applies to characters and the items / allies they bear;
 * factions and other `cardsInPlay` entries are unaffected because they are not
 * "in a company" (a Fallen-wizard never stores factions at a site). A company
 * counts as being at a Wizardhaven via {@link isHavenForPlayer} for the
 * controller's alignment (his own Wizardhaven sites plus any Hidden-Haven
 * conversion); every other site — and a company with no current site — is
 * treated as outside a Wizardhaven.
 *
 * The card's *"when the game ends"* qualifier is modelled as a continuous
 * override of the running marshalling-point total (the engine has no separate
 * end-of-game scoring pass). For a Fallen-wizard this is normally a no-op — the
 * MEWH §4 clamp already values each company-held card at 1 — so the pin only
 * changes a total when another card in play (Great Patron wh-72, a `*-mp-full`
 * exemption, …) would otherwise value the card above {@link value}.
 *
 * Used by Await the Onset (wh-96): "Each of your marshalling point cards in a
 * company not in one of your Wizardhavens [{H}] when the game ends is worth 1
 * marshalling point regardless of other cards in play."
 *
 * ```json
 * { "type": "nonhaven-company-mp-pin", "value": 1 }
 * ```
 */
export interface NonHavenCompanyMpPinEffect extends EffectBase {
  readonly type: 'nonhaven-company-mp-pin';
  /** MP each qualifying company-held card is worth, overriding all other computation. */
  readonly value: number;
}

/**
 * Pins every faction the controller plays **after** this card comes into play to
 * a flat {@link value} marshalling points, overriding its printed value, the MEWH
 * §4 clamp, and every faction-MP modifier ("regardless of other cards in play").
 * The pin is stamped on the faction instance ({@link CardInPlay.mpPinned}) when it
 * is influenced into play, so factions played *before* the carrier keep their
 * normal value — exactly the "place these factions under Await the Onset"
 * bookkeeping the card describes. A Fallen-wizard never stores factions at a site,
 * so no location is tracked; the tag alone records which factions the clause
 * covers.
 *
 * Used by Await the Onset (wh-96): "Each faction you play after Await the Onset is
 * worth 1 marshalling point regardless of other cards in play (place these
 * factions under Await the Onset)."
 *
 * ```json
 * { "type": "played-after-faction-mp-pin", "value": 1 }
 * ```
 */
export interface PlayedAfterFactionMpPinEffect extends EffectBase {
  readonly type: 'played-after-faction-mp-pin';
  /** MP each faction played after this card comes into play is worth. */
  readonly value: number;
}

/**
 * Recruitment-vehicle effect — Thrall of the Voice (wh-82).
 *
 * Marks a permanent resource-event as a "recruitment vehicle": during the
 * organization phase its Fallen-wizard controller may bring **one** otherwise
 * ineligible character into play "instead of a normal character" (it consumes
 * the one-character-per-turn slot), placing this card with that character. The
 * character's printed mind may be up to {@link maxMind} — above the standard
 * Fallen-wizard maximum of 5 — and it may be a minion **agent**, which a
 * Fallen-wizard normally could not field. Per the CRF, it may **not** bring an
 * Orc or Troll character into play (that needs an appropriate other card).
 *
 * The card's separate `stat-modifier` (stat `mind`) supplies the "-1 to his
 * mind, to a minimum of 1" once it is placed with the recruit. The same card,
 * placed in a starting company with such a character, satisfies "such a
 * character may also be in your starting company".
 *
 * Consumed by `playCharacterActions` (legal-action emission) and
 * `handlePlayCharacter` (attaches the vehicle to the recruit).
 */
export interface RecruitmentVehicleEffect extends EffectBase {
  readonly type: 'recruitment-vehicle';
  /** Maximum printed mind of a character this vehicle may bring into play. */
  readonly maxMind: number;
  /**
   * Agent-summons variant — Open to the Summons (wh-46). When true the vehicle
   * brings **one agent** character into the controller's own company at a
   * **Darkhaven** [{DH}] (rather than the agent's home site), and may be used by
   * a Ringwraith **or** Fallen-wizard player (Thrall of the Voice, the plain
   * variant, is Fallen-wizard-only and covers any character up to {@link maxMind}).
   *
   * Unlike Thrall it does **not** lift the Fallen-wizard mind-5 cap: a
   * Fallen-wizard may only summon an agent of mind ≤ 5 (CRF: "Does not allow a
   * Fallen-wizard to play a 6-mind character"). The `-1 to his mind` reduction
   * and the "may also be in your starting company" clause are shared with the
   * plain variant (via the `stat-modifier` and `starting-company-placement`
   * effects). During the character draft, one such enabler sitting in the
   * player's play deck lifts the agent draft-gate for one agent (rules 1.41/1.42).
   */
  readonly agentRecruit?: boolean;
}

/**
 * Marks a short resource-event as a "character recruitment" event — A Chance
 * Meeting (tw-188) and We Have Come to Kill (le-252). Playing the event brings
 * one character from hand into play in an existing company, relaxing the normal
 * organization-phase recruitment rules:
 *
 * - **Where.** The recruit enters play at a company whose current site is one
 *   of {@link siteTypes} (e.g. Free-hold / Border-hold / Ruins & Lairs), not
 *   only at a haven or the character's home site.
 * - **When.** The event "may be played on your turn during any phase the
 *   company is at a site", so the recruit action is emitted in the
 *   organization, movement/hazard, and site phases (the helper self-gates on a
 *   company being present at a qualifying site).
 * - **One per turn.** When {@link bypassOneCharacterLimit} is set the play does
 *   **not** consume the one-character-per-turn slot.
 * - **Influence.** {@link controlledBy} selects which influence may pay for the
 *   recruit: `"direct-influence"` (a character already in that company with
 *   enough unused direct influence controls it as a follower — A Chance
 *   Meeting), `"general-influence"`, or `"either"` (We Have Come to Kill
 *   le-252: "under general or direct influence (if you have enough unused)").
 *   The general-influence branch overrides rule 2.II.2.2's "only at the
 *   avatar's site" restriction, exactly as the site list overrides the normal
 *   haven / home-site restriction.
 * - **Who.** The optional {@link filter} (matched against the recruit's card
 *   definition) restricts which characters may be brought in — e.g. A Chance
 *   Meeting excludes Wizard avatars with `{ "$not": { "race": "wizard" } }`.
 *   Avatars (`mind === null`) are never ordinary recruits; the only avatar an
 *   event may bring in is a Ringwraith follower (see
 *   {@link allowRingwraithFollowers}).
 *
 * Consumed by `recruitViaEventActions` (legal-action emission, one
 * `play-character` per eligible recruit/site/controller, carrying
 * `viaEventInstanceId`) and `handlePlayCharacter` (discards the event and skips
 * the one-character-per-turn bookkeeping).
 */
export interface RecruitCharacterEffect extends EffectBase {
  readonly type: 'recruit-character';
  /** Which influence pays for the recruit (see the interface docs). */
  readonly controlledBy: 'direct-influence' | 'general-influence' | 'either';
  /** Site types ({@link import('./common.js').SiteType}) where the recruit may enter play. */
  readonly siteTypes: readonly string[];
  /** Optional filter on the recruit's card definition (e.g. exclude Wizards). */
  readonly filter?: Condition;
  /**
   * When true, an *agent* character may be recruited, overriding rule
   * 2.II.2.2.5 (an agent played as a character otherwise enters play only at
   * its own home site). Alignment gating is unchanged: only Ringwraith and
   * Fallen-wizard players may play agents as characters at all (rule
   * 1.3.W2/1.3.B2). We Have Come to Kill (le-252): "May be used to bring in …
   * agents".
   */
  readonly allowAgents?: boolean;
  /**
   * When true, the event is "a card or ability that allows a Ringwraith
   * follower to be played" (rule 2.II.2.1.R4): a Ringwraith avatar card in
   * hand may be brought in as a follower of the player's revealed Ringwraith,
   * whose company must be at one of {@link siteTypes} (in place of the usual
   * Darkhaven / home-site condition). Per rule 2.II.2.1.R5 the follower costs
   * one point of the revealed Ringwraith's direct influence, unless a
   * no-influence ability covers it (a free `ringwraith-follower-slots` slot on
   * the revealed Ringwraith, or `ringwraith-self-follower` on the card played).
   * We Have Come to Kill (le-252): "May be used to bring in Ringwraith
   * followers".
   */
  readonly allowRingwraithFollowers?: boolean;
  /** When true, the play does not count against the one-character-per-turn limit. */
  readonly bypassOneCharacterLimit?: boolean;
}

/**
 * Lifts the Fallen-wizard Orc/Troll character-play restriction (CoE
 * 2.II.2.2.F2: "A Fallen-wizard player cannot play Orc or Troll characters
 * unless they have a Stage resource in play that specifically allows them to
 * play Orc or Troll characters"). Carried by a stage permanent-event the
 * Fallen-wizard controls; while in play, any character the player would
 * otherwise be barred from playing (because it is an Orc or Troll) becomes
 * playable iff its card definition matches {@link filter}.
 *
 * - Bad Company (wh-63): `filter: { "race": { "$in": ["orc", "troll"] } }` —
 *   permits all Orc and Troll characters.
 * - A Strident Spawn (wh-61): `filter: { "keywords": { "$includes": "half-orc" } }`,
 *   `atOwnWizardhavens: true` — permits only Half-orcs, and additionally lets
 *   them be played at the controller's Wizardhavens even when the
 *   Fallen-wizard avatar is not at that site (relaxing CoE 2.II.2.2's
 *   avatar-site restriction for those characters).
 *
 * Consumed by `playCharacterActions` (legal-action emission).
 */
export interface AllowCharacterPlayEffect extends EffectBase {
  readonly type: 'allow-character-play';
  /** DSL condition matched against the candidate character's card definition. */
  readonly filter: Condition;
  /**
   * When true, matching characters may also be played at the controller's
   * Wizardhavens even if the Fallen-wizard avatar is not at that site.
   */
  readonly atOwnWizardhavens?: boolean;
}

/**
 * Grants the controlling player an optional once-per-organization-phase action
 * to take one card matching {@link filter} from a pile into their hand.
 * Carried by a permanent-event the player controls (e.g. A Strident Spawn
 * wh-61: "During your organization phase, you may take one Half-orc character
 * from your discard pile to your hand").
 *
 * Emitted by `organizationActions` (one `activate-org-fetch` per source card
 * that still has its activation available this turn and has at least one
 * matching candidate). Activating enqueues the shared `fetch-to-deck` pending
 * effect (`to: 'hand'`), which drives the existing pick-one-or-pass sub-flow.
 */
export interface OrgPhaseFetchEffect extends EffectBase {
  readonly type: 'org-phase-fetch';
  /** Which piles to fetch from (e.g. ["discard-pile"]). */
  readonly from: readonly ('discard-pile' | 'sideboard' | 'deck')[];
  /** DSL condition matched against each candidate card's definition. */
  readonly filter: Condition;
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
 * Example: A Short Rest (td-95) — a resource long-event in the moving
 * player's `cardsInPlay` — grants `"4 - sitePath.regionCount"` extra
 * resource draws, gated on an actual region site path (`movementType`
 * in `region`/`starter`, `sitePath.regionCount` in 1..3).
 *
 * Draw-modifiers are collected both from a moving company's characters and
 * from the active player's own in-play events/environments, so a long-event
 * (not carried by any character) can contribute.
 *
 * Example: Smaug at Home (td-71) — a hazard permanent-event: "each moving
 * company draws one less card to a minimum of one", which needs
 * `appliesTo: 'any-company'` so the opponent's copy reduces the moving
 * player's draws.
 */
export interface DrawModifierEffect extends EffectBase {
  readonly type: 'draw-modifier';
  /** Which draw pool to modify. */
  readonly draw: 'hazard' | 'resource';
  /**
   * Whose moving companies the modifier reaches. Defaults to
   * `own-companies`: the effect is only collected from the *active* (moving)
   * player's characters and `cardsInPlay`, so a lingering long-event never
   * touches the opponent's draws. `any-company` opts the modifier into being
   * collected from the opponent's `cardsInPlay` as well — for cards worded
   * "each moving company …" (Smaug at Home td-71), where the hazard player
   * holds the card but the moving player's draws shrink.
   */
  readonly appliesTo?: 'own-companies' | 'any-company';
  /**
   * The adjustment (negative = fewer draws). Accepts a value expression
   * evaluated against the resolver context, which exposes `sitePath`
   * counts (`wildernessCount`, `shadowCount`, `darkCount`,
   * `coastalCount`, `freeCount`, `borderCount`, and `regionCount` — the
   * total path length) derived from the moving company's resolved site
   * path, plus the top-level `movementType`
   * (`starter`/`region`/`special`/`under-deeps`).
   */
  readonly value: ValueExpr;
  /** Floor for the modified draw count. */
  readonly min?: number;
}

/**
 * Draws cards from the top of the playing player's play deck into their
 * hand when the carrying resource event is played.
 *
 * Used by Dark Tryst (as-80): "Draw three cards and remove this card
 * from the game." The `removeFromGame` flag routes the spent event card
 * to the player's out-of-play pile instead of the discard pile, so it
 * can never be recurred.
 *
 * Doubles as a {@link TriggeredAction} verb, so a `grant-action` `apply`
 * can draw as well (Palantír of Elostirion le-332: "tap Palantír of
 * Elostirion to draw a card"). In that role there is no spent event card,
 * so `removeFromGame` is meaningless and ignored; drawing still stops at
 * deck exhaustion.
 */
export interface DrawCardsEffect extends EffectBase {
  readonly type: 'draw-cards';
  /** Number of cards to draw from the top of the play deck. */
  readonly count: number;
  /**
   * When true, the played event card is removed from the game (placed
   * in the out-of-play pile) rather than discarded after resolution.
   */
  readonly removeFromGame?: boolean;
}

/**
 * Moves every card matching `filter` from a discard pile back into the
 * owner's play deck, then shuffles that deck.
 *
 * Carried by a resource short-event and resolved when the event is played.
 * The `scope` selects whose piles are affected: `'all-players'` (the
 * default) walks every player's discard pile — used by *Horns, Horns,
 * Horns* (dm-140): "Each player removes all factions from his discard pile
 * and shuffles them into his play deck." — while `'self'` touches only the
 * playing player's piles. The `filter` is a DSL {@link Condition} matched
 * against each candidate card's definition (e.g. the faction card types),
 * so no card-specific category code is needed.
 */
export interface ReshuffleFromDiscardEffect extends EffectBase {
  readonly type: 'reshuffle-from-discard';
  /**
   * DSL filter matched against each candidate card's definition. Cards in a
   * discard pile that match are pulled out and shuffled into that owner's
   * play deck.
   */
  readonly filter: Condition;
  /**
   * Whose discard piles are processed. `'all-players'` (default) affects
   * every player; `'self'` affects only the playing player.
   */
  readonly scope?: 'self' | 'all-players';
  /**
   * When true, this reshuffle is the **alternative short-event mode** of an
   * otherwise `eventType: "permanent"` resource card (a "Permanent-event/
   * Short-event" card). The card is offered both as a permanent-event (its
   * ongoing effects) and — via this effect — as a resource short-event that
   * resolves the reshuffle and discards the card. Used by Great Army of the
   * North (ba-38): "Alternatively, as a short-event, you may choose any Orc
   * and Troll factions from your discard pile and shuffle them into your play
   * deck."
   */
  readonly altShortEventMode?: boolean;
}

/**
 * Shuffles the playing player's entire hand and discard pile into their play
 * deck, then draws a fresh hand of `handSize` cards from the top.
 *
 * Carried by a resource short-event and resolved on the chain of effects
 * (CoE 9.4/9.5) once both players pass priority, like {@link DrawCardsEffect}.
 * Site cards are unaffected structurally: they live in the separate
 * `siteDeck`/`siteDiscardPile` zones, never in the play-deck discard pile, so
 * "site cards remain in the discard pile" needs no filter. Drawing stops at
 * deck exhaustion (no card instance is conjured or lost), and the reshuffle
 * does not count as a rule-1.31 deck exhaustion (`deckExhaustionCount` is
 * untouched — only the deck-exhaust action increments it).
 *
 * The spent event card lands in the discard pile *after* the shuffle, so it is
 * never swept into the deck; pair with `play-flag: "remove-from-game"` when
 * the card text also removes it from the game (Favor of the Valar tw-239:
 * "Shuffle your hand and your discard pile into your play deck (site cards
 * remain in the discard pile). Draw a new hand of 8 cards. Remove Favor of
 * the Valar from the game.").
 */
export interface NewHandEffect extends EffectBase {
  readonly type: 'new-hand';
  /** Number of cards drawn from the top of the reshuffled deck as the new hand. */
  readonly handSize: number;
}

/**
 * Forces the card-player's opponent to discard one or more cards of a named
 * category, chosen by the opponent, or — if none is available — reveal their
 * hand.
 *
 * Carried by a hazard short-event and resolved when the event resolves on the
 * chain. The opponent (the resource player, in a hazard-play context) is the
 * discarding player. Candidate cards are gathered from the sources named in
 * `sources`: `'hand'` (cards in the opponent's hand) and/or `'carried'` (cards
 * held by the opponent's in-play characters). If at least one candidate exists,
 * a {@link PendingResolution} of kind `force-discard-card` is enqueued so the
 * opponent picks the required number to discard (mandatory). If none exists and
 * `fallbackRevealHand` is set, the opponent's current hand identities are
 * revealed to the card-player instead (recorded in
 * {@link GameState.revealedInstances}).
 *
 * The `match` category is a generic, data-driven matcher so other "opponent
 * discards an X" cards can reuse it. `'ring'` matches any card carrying the
 * `ring` keyword or the `gold-ring` subtype (the MECCG definition of a ring);
 * `'any'` matches any hand card (used when the count is what matters, not the
 * category).
 *
 * Used by *Rolled down to the Sea* (wh-29): "Opponent must discard a ring from
 * his hand or from one of his companies if available. If no rings are available
 * as such, he must reveal his hand to you." (match `'ring'`, count 1.)
 *
 * Used by *Khamûl the Easterling* (tw-47): when its permanent-event mode is
 * tapped it "becomes a short-event and forces opponent to discard one card of
 * his choice for every Nazgûl permanent-event in play (including this one) at
 * the time of declaration." (match `'any'`, dynamic `count`.)
 */
export interface ForceOpponentDiscardEffect extends EffectBase {
  readonly type: 'force-opponent-discard';
  /**
   * Named card-category matcher:
   * - `'ring'` — cards carrying the `ring` keyword or the `gold-ring` subtype.
   * - `'any'` — any card (used when the discard count, not the category, is the
   *   point). Only the `'hand'` source is supported for `'any'`.
   */
  readonly match: 'ring' | 'any';
  /**
   * Where to look for candidate cards to discard:
   * - `'hand'` — the opponent's hand.
   * - `'carried'` — items/cards held by the opponent's in-play characters.
   */
  readonly sources: readonly ('hand' | 'carried')[];
  /** When true and no candidate exists, reveal the opponent's hand instead. */
  readonly fallbackRevealHand?: boolean;
  /**
   * How many cards the opponent must discard. Absent = one card (the `'ring'`
   * case). A `countCardsInPlay` descriptor makes the number equal to the count
   * of cards in play (across both players) whose definition matches the filter.
   *
   * This dynamic count is evaluated at **declaration time** — the moment the
   * source permanent event is tapped to become the short-event (see
   * `handleTapAltPermanentEvent`), while the source card is still in play — and
   * threaded to the chain resolution via
   * {@link ChainEntryPayload}.`forcedDiscardCount`. Evaluating before the source
   * card leaves play is what makes "including this one" fall out naturally and
   * matches the CRF ruling that "the number of cards discarded is set at the
   * time of declaration".
   */
  readonly count?: {
    readonly countCardsInPlay: {
      /** Only count in-play cards whose definition carries this keyword. */
      readonly keyword: string;
    };
  };
}

/**
 * Reveals the playing player's hand, keeps the cards matching `keepInHand`,
 * sets the rest aside, refills the hand to the player's effective hand size by
 * drawing from the play deck, and then places the set-aside cards face-down on
 * top of the play deck in an order the player chooses.
 *
 * Carried by a (hazard) short-event and resolved when the event resolves on
 * the chain. The playing player is `entry.declaredBy` — for a hazard event
 * this is the hazard player, who manipulates their **own** hand and deck. The
 * flow is:
 *
 * 1. If `revealHand` is set, the playing player's hand identities are revealed
 *    to their opponent (recorded in {@link GameState.revealedInstances}).
 * 2. The hand is partitioned: cards whose definition matches `keepInHand` stay
 *    in hand; the rest are set aside.
 * 3. If `drawToHandSize` is set (default true), cards are drawn from the top of
 *    the play deck until the hand reaches the player's effective hand size
 *    (stopping early if the deck runs out — no card disappears).
 * 4. The set-aside cards are placed face-down on top of the play deck. When
 *    two or more were set aside, an {@link PendingResolution} of kind
 *    `arrange-deck-top` is enqueued so the player chooses their order.
 *
 * The set-aside cards are always physically on top of the deck between steps
 * 3 and 4 (the ordering resolution only permutes them), so no card instance
 * ever floats outside a pile.
 *
 * Used by *Revealed to all Watchers* (dm-85): "Reveal your hand to opponent.
 * Place all non-hazard cards from your hand off to the side. Draw cards from
 * your play deck until your hand size is reached. Place the non-hazard cards
 * from off to the side face down on top of your play deck in any order you
 * choose." Here `keepInHand` matches the hazard card types (so non-hazards are
 * the ones set aside).
 */
export interface CycleHandEffect extends EffectBase {
  readonly type: 'cycle-hand';
  /** When true, reveal the playing player's hand to their opponent first. */
  readonly revealHand?: boolean;
  /**
   * DSL {@link Condition} matched against each hand card's definition. Cards
   * that MATCH are kept in hand; non-matching cards are set aside and placed on
   * top of the play deck after the draw.
   */
  readonly keepInHand: Condition;
  /**
   * When true (the default), draw from the top of the play deck until the hand
   * reaches the player's effective hand size after the set-aside cards are
   * removed. When false, no cards are drawn.
   */
  readonly drawToHandSize?: boolean;
  /**
   * Where the set-aside (non-matching) cards go after the draw. Currently only
   * `'deck-top'`: face-down on top of the play deck, in a player-chosen order.
   */
  readonly setAsideTo: 'deck-top';
}

/**
 * Reveals up to `count` cards from the top of the playing player's play deck,
 * lets them choose exactly one to put into their hand, and shuffles the
 * remaining revealed cards back into the play deck.
 *
 * Carried by a resource short-event and resolved when the event is played
 * (after any `play-target` tap cost is paid). The flow is:
 *
 * 1. The top `min(count, deckSize)` cards are revealed to the opponent
 *    (recorded in {@link GameState.revealedInstances}). They remain physically
 *    on top of the play deck the entire time, so no instance ever floats.
 * 2. When at least one card is revealed, a {@link PendingResolution} of kind
 *    `reveal-choose-to-hand` is enqueued (actor = the playing player). The
 *    choice is mandatory: the player picks one revealed card via a
 *    `choose-revealed-card` action; it moves to their hand and the whole
 *    remaining play deck is shuffled (folding the un-chosen revealed cards back
 *    in). If the deck is empty nothing is revealed and the event simply fizzles.
 *
 * Used by *Eyes of Mandos* (dm-126): "Tap Pallando and reveal up to 8 cards
 * from the top of your play deck. Choose one to put into your hand and shuffle
 * the remaining ones into your play deck."
 */
export interface RevealChooseShuffleEffect extends EffectBase {
  readonly type: 'reveal-choose-shuffle';
  /** Maximum number of cards revealed from the top of the play deck. */
  readonly count: number;
}

/**
 * Lets the playing player look at the opponent's hand and then pick **one**
 * play deck whose top `count` cards they look at and shuffle back on top.
 *
 * Carried by a resource short-event and resolved when the event is played. The
 * flow is:
 *
 * 1. If `revealOpponentHand` is set, every card in the opponent's hand is
 *    recorded as revealed ({@link GameState.revealedInstances}) — the cards
 *    stay in the opponent's hand, exactly as `peek-opponent-hand` does for The
 *    Lidless Eye (le-203). This is a "may" with no cost or downside for the
 *    playing player, so the engine always takes it.
 * 2. A {@link PendingResolution} of kind `choose-peek-deck` is enqueued (actor
 *    = the playing player), so the deck is chosen **after** the hand has been
 *    seen — the ordering the card text prescribes. The player answers with a
 *    `choose-peek-deck` action naming `'self'` or `'opponent'`, or declines
 *    with `pass` ("You **may** … choose to look at …"). Only decks with at
 *    least one card are offered; when neither deck has any, no resolution is
 *    enqueued at all.
 * 3. On resolution the top `min(count, deckSize)` cards of the chosen deck are
 *    shuffled in place and stay on top of that deck — the same modelling the
 *    certified Palantír of Minas Tirith (tw-299 / le-333) uses for "look at the
 *    top five cards …; shuffle these 5 cards and return them to the top". The
 *    look itself is deliberately **not** recorded in `revealedInstances`:
 *    that map is public to both players, so recording it would leak the cards
 *    to the player who is not allowed to see them.
 *
 * Used by *Mirror of Galadriel* (tw-282): "You may look at your opponent's hand
 * and then choose to look at the top five cards of any one play deck. Shuffle
 * those 5 cards and return them to the top of their play deck."
 */
export interface PeekShuffleDeckTopEffect extends EffectBase {
  readonly type: 'peek-shuffle-deck-top';
  /** How many top cards of the chosen deck are looked at and shuffled (default 5). */
  readonly count?: number;
  /** When true, the opponent's whole hand is revealed to the playing player first. */
  readonly revealOpponentHand?: boolean;
  /**
   * Which play decks may be chosen: `'any'` (default — either player's, "any
   * one play deck"), `'self'`, or `'opponent'`.
   */
  readonly deckChoice?: 'any' | 'self' | 'opponent';
}

/**
 * Reveals `count` cards chosen **at random** from the opponent's discard pile,
 * then lets the card-player pick at most one **non-unique** revealed card and
 * remove it from the game (to the owner's out-of-play pile). The remaining
 * revealed cards stay in the discard pile.
 *
 * Carried by a hazard short-event and resolved when the event resolves on the
 * chain. If the opponent's discard pile is empty the effect fizzles; if fewer
 * than `count` cards are present, all of them are revealed. The random subset
 * is drawn with the seeded RNG so replays stay deterministic.
 *
 * Per the French errata, **sites are treated as unique** (never removable),
 * so `removableFilter` defaults to "non-unique, non-site". A choice is only
 * offered when at least one revealed card is removable; the player may still
 * decline ("You may choose…").
 *
 * Used by *Aware of their Ways* (dm-46): "Opponent reveals four cards at random
 * from his discard pile. You may choose a non-unique one and remove it from
 * play. Opponent discards the other three."
 */
export interface RevealRemoveFromDiscardEffect extends EffectBase {
  readonly type: 'reveal-remove-from-discard';
  /** How many cards are revealed at random from the opponent's discard pile. */
  readonly count: number;
}

/**
 * Reveal the top cards of the opponent's play deck (count = the number of the
 * controller's in-play cards matching `countInPlayMatching`), let the
 * card-player choose one and show it to the opponent, who must then choose
 * between removing that card from the game or permanently reducing his hand
 * size by one; the remaining revealed cards are shuffled back on top of the
 * deck. The event card itself is removed from the game.
 *
 * Carried by a hazard short-event and resolved when the event resolves on the
 * chain. If the reveal count is zero (no matching in-play cards, or the deck is
 * empty) the effect fizzles — the event card is still removed from the game.
 * The count is measured against `cardsInPlay` (both players), so "eliminated
 * spawn do not count" falls out naturally: an eliminated card is no longer in
 * `cardsInPlay`.
 *
 * The interaction is a two-step pending resolution: first a
 * `desire-belly-choose-card` (actor = card-player) to pick the shown card, then
 * a `desire-belly-choose-penalty` (actor = opponent) to pick the penalty.
 *
 * Used by *Desire All for Thy Belly* (ba-16): "Reveal to yourself a number of
 * cards from the top of opponent's play deck equal to the number of Spawn cards
 * in play. Eliminated spawn do not count. Choose one card and show it to your
 * opponent. He must choose to either: remove the card from the game or decrease
 * the number of cards he may hold in his hand by one for the rest of the game.
 * Shuffle and replace all remaining cards back on top of his play deck."
 * (Paired with a `play-discard-cost` for the "discard a Spawn card" play cost.)
 */
export interface RevealDeckChoosePenaltyEffect extends EffectBase {
  readonly type: 'reveal-deck-choose-penalty';
  /**
   * How many top cards of the opponent's deck are revealed = the number of
   * cards in play (either player's `cardsInPlay`) whose definition matches this
   * condition. For ba-16 this is `{ keywords: { $includes: 'spawn' } }`.
   */
  readonly countInPlayMatching: Condition;
}

/**
 * Great Secrets Buried There (dm-63). Reveals the top `count` cards of the
 * **active player's** play deck (see {@link PlayConditionEffect.minDeckSize}
 * for why `GameState.activePlayer` is always the correct target regardless of
 * hazard-mode vs. `playable-as-resource` self-cast mode).
 *
 * If at least one revealed card matches `itemFilter` (a non-special,
 * non-hoard item — CoE errata: "the item must be normally playable at the
 * Under-deeps site"), the deck owner (not the card-player) must choose exactly
 * one to place "off to the side" under this card ({@link
 * module:engine/set-aside}): it scores no marshalling points and counts as out
 * of play. The deck owner may later play it as though it were in hand, but
 * only at an Under-deeps site where it would normally be playable (see
 * {@link PlayHeroResourceAction.fromSetAside}). If no revealed card is
 * eligible, the reveal already showed the cards (recorded in {@link
 * GameState.revealedInstances}) and nothing more happens. Either way, every
 * revealed card except the one set aside is shuffled back into the deck.
 *
 * Resolved via a `great-secrets-choose-item` pending resolution (actor = the
 * deck owner) when at least one eligible item is revealed; resolves
 * synchronously (no pending resolution) when none is.
 */
export interface RevealDeckChooseSetAsideEffect extends EffectBase {
  readonly type: 'reveal-deck-choose-set-aside';
  /** Number of cards revealed from the top of the active player's play deck. */
  readonly count: number;
  /** Card-definition condition an item must match to be eligible for set-aside. */
  readonly itemFilter: Condition;
}

/**
 * Carried by a hazard short-event. When the event resolves un-negated on the
 * chain, the card-player reveals the top `count` cards of **their own** play
 * deck (unlike `reveal-deck-choose-penalty`, which reveals the *opponent's*
 * deck) and, if at least one revealed card is an eligible hazard-creature,
 * must immediately name one to attack the target company — bypassing the
 * creature's normal keying/playability check entirely, and without counting
 * against the hazard limit (the attack is spawned directly by chain
 * resolution, never through the ordinary hazard-limit-charging play path).
 *
 * A revealed card is eligible when it is a hazard-creature whose race is one
 * of `alwaysEligibleRaces`, or any non-unique creature of any race, AND (when
 * `requireNonCoastalKeying` is set) its printed `keyedTo` offers at least one
 * non-Coastal-Sea region (`creatureHasNonCoastalRegionKeying`, the same
 * helper A Pack at the Door tw-497 uses for its own "must be playable in a
 * non-Coastal Sea region" clause).
 *
 * The choice is mandatory once at least one candidate exists ("must
 * immediately attack") — mirrors `reveal-deck-choose-penalty`'s
 * `desire-belly-choose-card` mandatory, no-pass shape. With no eligible
 * candidate the reveal fizzles and every revealed card is immediately
 * shuffled back to the top of the deck (no pending resolution).
 *
 * Whether the chosen creature *could* normally have been played on the
 * company (its printed keying actually matches the company's site path/
 * destination) is still evaluated — via `creatureIsNormallyPlayableOnCompany`,
 * the same keying-match logic the ordinary M/H hazard-play path uses — purely
 * to decide `unplayableProwessPenalty`; legality itself is never gated on it.
 *
 * The chosen creature attacks in place — never moved out of the deck before
 * combat, exactly like The Hunt (dm-143) / The Great Hunt (wh-91) — so no
 * instance ever floats; see `engine/long-dark-reach.ts`. The unused revealed
 * cards are shuffled among themselves and returned to the top of the deck
 * once the choice resolves; the chosen card is left resting directly beneath
 * them until combat disposes of it.
 *
 * Used by *Long Dark Reach* (dm-70): "Playable on a moving company with at
 * least one Wilderness [{w}] in its site path if you have at least 10 cards
 * in your play deck. Reveal the top seven cards of your play deck. One
 * revealed Nazgûl, Dragon, or a non-unique creature of your choice must
 * immediately attack the company regardless of its playability requirements
 * (not count against the hazard limit). The creature must be playable in a
 * region besides Coastal Sea [{c}]. If the creature could not normally be
 * played on the company, modify its prowess by -4. Shuffle all unused cards
 * and return them to the top of your play deck." (Paired with a
 * `play-condition` `site-path` for the Wilderness requirement and a
 * `play-condition` `card-player-deck-size` for the 10-card gate.)
 */
export interface RevealDeckChooseAttackerEffect extends EffectBase {
  readonly type: 'reveal-deck-choose-attacker';
  /** Number of cards revealed from the top of the card-player's own play deck. */
  readonly count: number;
  /** Races always eligible regardless of uniqueness (e.g. Nazgûl, Dragon). */
  readonly alwaysEligibleRaces: readonly Race[];
  /** When true, a candidate must be playable in a non-Coastal-Sea region. */
  readonly requireNonCoastalKeying: boolean;
  /** Prowess modifier applied when the chosen creature could not normally have been played on the company. */
  readonly unplayableProwessPenalty: number;
}

/**
 * Carried by a hazard short-event playable on an untapped character. When the
 * event resolves un-negated on the chain, the **defending** player (the
 * targeted character's controller — "your opponent" from the card-player's
 * perspective) is forced to choose one of three responses:
 *
 * - Tap the targeted character.
 * - Tap one untapped ally the character controls (offered only when such an
 *   ally exists).
 * - Let the card-player roll 2d6: if the total is strictly greater than the
 *   character's effective mind plus `rollAddend`, the character is discarded
 *   to their owner's discard pile (their non-follower possessions go with
 *   them; followers are freed to general influence per the standard
 *   `discard-character` verb).
 *
 * Resolved via a two-stage {@link PendingResolution}: `tap-or-roll-choice`
 * (the defender's pick) and, only if "roll" is picked, a generic `dice-check`
 * (the card-player's roll). Used by *A Lie in Your Eyes* (as-23): "Your
 * opponent may either: tap the character, tap an ally the character
 * controls, or choose for you to make a roll. If the result is greater than
 * the character's mind plus 6, the character is discarded (along with all
 * non-follower cards he controls)."
 */
export interface OpponentChooseTapOrRollEffect extends EffectBase {
  readonly type: 'opponent-choose-tap-or-roll';
  /** Added to the character's effective mind to form the discard threshold. */
  readonly rollAddend: number;
}

/**
 * Removes an opponent's face-up agent from play, or (as an alternative mode)
 * discards one of the opponent's unrevealed on-guard cards.
 *
 * Carried by a resource short-event and resolved when the event is played.
 * The two modes are chosen by which target the play action carries:
 *
 * - **Agent mode** (`targetAgentId`): the targeted face-up agent is judged by
 *   its printed mind. An agent whose mind is **below** {@link returnMindThreshold}
 *   is discarded to its owner's discard pile; an agent whose mind is
 *   {@link returnMindThreshold} **or greater** is returned to its owner's hand.
 * - **On-guard mode** (`discardTargetInstanceId`): when
 *   {@link alternativeDiscardOnGuard} is set, an unrevealed on-guard card is
 *   discarded to its owner's discard pile instead. Per CRF 22 the on-guard
 *   card must be discarded *before* it is revealed, and the primary
 *   "playable on a face-up agent" condition does not gate this mode.
 *
 * Used by *Withdrawn to Mordor* (dm-165): "Playable on a face-up agent. If the
 * agent has a mind of 5 or less, it is discarded. If its mind is 6 or greater,
 * return the agent to its owner's hand. Alternatively, an on-guard card is
 * discarded."
 */
export interface WithdrawAgentEffect extends EffectBase {
  readonly type: 'withdraw-agent';
  /**
   * Printed-mind boundary between the two agent outcomes: an agent whose mind
   * is at least this value is returned to hand; a lower-mind agent is discarded.
   * For Withdrawn to Mordor this is `6` (mind ≤5 discarded, mind ≥6 returned).
   */
  readonly returnMindThreshold: number;
  /**
   * When true, the card may alternatively be played to discard one of the
   * opponent's unrevealed on-guard cards (the second paragraph of the text).
   */
  readonly alternativeDiscardOnGuard: boolean;
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
   * When true, the ability may be activated by the active (resource)
   * player during the *enter-or-skip* step of their own site phase —
   * the decision window immediately before a company commits to facing
   * a site's automatic-attacks. Used by *Blasting Fire* (wh-51), which
   * is discarded at this moment to cancel all of the site's
   * automatic-attacks against the bearer's company. Distinct from
   * {@link anyPhase} (which would also expose the ability during
   * organization / M-H) because canceling automatic-attacks is only
   * meaningful at this one point in the site phase.
   */
  readonly activeSitePhase?: boolean;
  /**
   * When true, the ability is activatable **only** during the
   * controller's end-of-turn phase — unlike {@link anyPhase} and its
   * siblings (which *extend* the ability's availability beyond its
   * organization-phase default), this flag *restricts* it, removing it
   * from the generic per-phase scanner's organization-phase default scan
   * (`extractGrantActions`) entirely. Emitted only by the dedicated
   * end-of-turn discard-pile fetch scanner (`legal-actions/end-of-turn.ts`
   * `endOfTurnGrantActions`), which recognizes `enqueue-pending-fetch` /
   * discard-to-hand `move` applies independently of this flag. Used by
   * *Great Shadow* (ba-62): "During your end-of-turn phase, you may take
   * one non-short-event resource or character from your discard pile ...
   * and shuffle it into your play deck" — contrast with *The Mouth*
   * (le-24)'s structurally identical `recall-to-deck` ability, which is
   * organization-phase-only and does NOT set this flag.
   */
  readonly endOfTurnOnly?: boolean;
  /**
   * When true, the ability may be activated at most **once per turn** by
   * this source card. On the first activation the reducer records a
   * turn-scoped `granted-action-used` constraint keyed by the source
   * instance and `action`; the legal-action scanner then suppresses the
   * ability for the rest of the turn (the constraint is cleared at
   * turn-end). Independent of the phase-window flags. Used by *Strangling
   * Coils* (ba-76): "Once during his movement/hazard phase, you may untap
   * all tapped characters in The Balrog's company."
   */
  readonly oncePerTurn?: boolean;
  /**
   * When true, the ability is activatable **only** while a corruption
   * check by a character in the bearer's company is awaiting its roll —
   * i.e. during a unified `corruption-check` pending resolution or the
   * Free Council support window. It is emitted by the dedicated
   * corruption-check-window emitters (`modifyCorruptionCheckGrantActions`),
   * never by the generic per-phase grant-action scanner, so the generic
   * scanner skips it (see `extractGrantActions`). The activation carries
   * the resolving character's instance id on `targetCardId`. Used by
   * *When I Know Anything* (td-166): "Tap sage to modify one corruption
   * check by a character in his company by +3."
   */
  readonly corruptionCheckWindow?: boolean;
  /**
   * When true, this ability is granted while its source card sits **stored**
   * in the controller's marshalling-point pile (`killPile`, a `storedAtSite`
   * entry) rather than while attached to a bearer in `cardsInPlay` — the
   * `grant-action` counterpart to a `stat-modifier`'s {@link
   * EffectBase.activeWhileStored}. A stored card has no bearer, so the
   * ability is scanned by a dedicated stored-card scanner
   * (`storedCardGrantActions`, `legal-actions/organization.ts`) instead of
   * the generic attached-card scan, and `cost.discard: "self"` discards the
   * stored card straight out of `killPile` (the `applyDiscardSelf` fallback
   * in `cost-evaluator.ts`) rather than detaching it from a bearer. Typically
   * paired with `cost.tap: "sage-at-haven"`, since the activating character
   * cannot be inferred from a bearer that no longer exists. Used by
   * Reforging (tw-314): "During your organization phase, you may tap a sage
   * at a Haven [{H}] and discard a stored Reforging to retrieve any minor or
   * major weapon, armor, or shield … from your discard pile."
   */
  readonly fromStored?: boolean;
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
  /**
   * For `action: "untap-companion-at-site"`: the definition IDs of characters
   * that may be untapped by this ability. One activation is emitted per tapped
   * companion in the bearer's company whose definition ID is in this list.
   */
  readonly companionIds?: readonly string[];
  /**
   * When true, activating this ability claims a **game-wide, permanent lock
   * keyed by the source card's name**: no other copy of the same card — in
   * either player's play area, for the rest of the game — may ever activate
   * it. Pass the Doors of Dol Guldur (dm-154): "Once tapped, no other copy of
   * this card can be tapped." The lock is recorded in
   * {@link GameState.singletonTapLocks} rather than derived from the tapped
   * copy's status, because the tapped copy leaves `cardsInPlay` when it is
   * later stored and the lock must survive that.
   */
  readonly singletonLock?: boolean;
}

/**
 * Descriptor for enumerating per-target activations of a grant-action.
 *
 * `scope` names a zone relative to the action's bearer. Supported values:
 * - `"company-items"` — items borne by any character in the bearer's company.
 * - `"characters-at-site"` — characters at the same site as the bearer.
 *   Optionally restricted to specific definition IDs via `definitionIds`.
 * - `"company-characters"` — characters in the bearer's own company
 *   (including the bearer). Excludes already-untapped characters, since
 *   untapping one is pointless — mirroring `"characters-at-site"`. Used by
 *   The Arkenstone (tw-341): "tapped to untap a Dwarf character in the same
 *   company" (`filter: { "race": "dwarf" }`).
 * - `"player-companies"` — all companies owned by the bearer's player.
 *   Each company produces one activation carrying `targetCompanyId`.
 * - `"opponent-cards-in-play"` — cards in the opponent's `cardsInPlay`
 *   (permanent events, factions, …). Backs "discard <card> if in play by
 *   another player" abilities (Keys to the White Towers wh-89).
 * - `"own-hazard-corruption-cards"` — every `hazard-corruption` card attached
 *   to any of the activating player's own characters (scanning all
 *   companies, not just the bearer's). Unlike the other scopes, `filter` here
 *   is matched against the **bearer character's** definition, not the
 *   corruption card's own (corruption cards carry little distinguishing
 *   data — what varies card to card is who they're attached to). Backs
 *   "remove one corruption card from an Elf or a Wizard under your control"
 *   (Palantír of Amon Sûl tw-296, borrowing Palantír of Elostirion's ability).
 * - `"company-hazard-corruption-cards"` — the company-scoped counterpart of
 *   `"own-hazard-corruption-cards"`: every `hazard-corruption` card attached
 *   to a character in the bearer's own company only. `filter` is likewise
 *   matched against the bearer character's definition. Backs "remove a
 *   corruption card from a character in his company" (Athelas tw-195,
 *   Aragorn II's ability).
 * - `"own-hand-factions"` — faction cards (`hero-resource-faction` /
 *   `minion-resource-faction`, matching the activating player's own
 *   alignment) sitting in the activating player's hand. Backs Roäc the Raven
 *   (tw-320): "tap and discard … to attempt to bring any faction into play."
 *
 * `filter` is a DSL condition matched against each candidate card's
 * definition; candidates that fail the filter are skipped.
 */
export interface GrantActionTargets {
  readonly scope: 'company-items' | 'characters-at-site' | 'company-characters' | 'player-companies' | 'opponent-cards-in-play' | 'own-hazard-corruption-cards' | 'company-hazard-corruption-cards' | 'own-hand-factions';
  readonly filter?: Condition;
  /** For scope `'characters-at-site'`: definition IDs of eligible characters. */
  readonly definitionIds?: readonly string[];
  /**
   * For scope `'company-characters'`: excludes the bearer from the enumerated
   * candidates, leaving only the bearer's company-mates. Used by Waybread
   * (td-165) — "untap bearer and one other character in his company" pairs
   * this with a `sequence` apply that separately untaps `"bearer"`, so the
   * target-selection loop must offer only the *other* company members.
   */
  readonly excludeBearer?: boolean;
  /**
   * For scope `'player-companies'`: restrict the enumerated companies to those
   * that have declared movement this organization phase **and** whose declared
   * destination's printed site path contains at least one region of this type.
   *
   * Shifter of Hues (wh-115) uses `"wilderness"` — "this company must be moving
   * with at least one Wilderness [{w}] in their site path". Because movement is
   * planned during the organization phase, the destination (and therefore the
   * site path) is already known when the ability is offered.
   */
  readonly movingThroughRegionType?: string;
  /**
   * For scope `'player-companies'`: restrict the enumerated companies to those
   * that have declared movement this organization phase **and** whose declared
   * destination site's own named `region` is one of these.
   *
   * Wild Horses (wh-39): "any company with one of the regions listed above
   * [Rohan, Khand, Dorwinion, Horse Plains, Southern Rhovanion, Harondor] in
   * its site path" — unlike {@link movingThroughRegionType} (an abstract
   * terrain type), this matches the destination's printed named region.
   * Mutually exclusive with `movingThroughRegionType` in practice, but both
   * fields may be checked independently.
   */
  readonly movingThroughRegionNames?: readonly string[];
}

/** The cost required to activate a granted action. */
export interface ActionCost {
  /**
   * The entity to tap. "self" taps the source card itself (the bearer character
   * or the attached item/ally); "bearer" taps the character carrying the source;
   * "character" taps the explicitly targeted character; "sage-in-company" taps an
   * untapped sage in the bearer's company; "sage-in-company-excluding-bearer"
   * is the same but excludes the bearer character itself from the eligible
   * sages (Pale Dream-maker dm-78: "a sage in target character's company
   * (other than character) may tap"); "sage-and-scout-in-company" taps one
   * untapped sage AND one untapped scout in the bearer's company (The Worthy Hills
   * as-142 special rule — the action carries sage as `characterId` and scout as
   * `secondCharacterId`); "self-and-bearer" taps BOTH the source item AND its
   * bearer character (used by Torque of Hues — requires both item and bearer
   * to be untapped); "sage-at-haven" taps any one of the acting player's own
   * untapped sage characters currently at a Haven [{H}], independent of any
   * bearer or company — used by a `fromStored` grant-action (see
   * {@link GrantActionEffect.fromStored}), where the source card has no
   * bearer to begin with (it sits in the marshalling-point pile). The chosen
   * sage becomes the action's `characterId`, and (for a `place-item-on-character`
   * apply with `recipientScope: "bearer-company"`) also supplies the company
   * whose members are offered as recipients. Used by Reforging (tw-314).
   * "skilled-character-in-company" is a `play-target: "company"` cost (not a
   * grant-action bearer cost, unlike the others above): taps an untapped
   * character bearing {@link skill} in the target company, chosen by the
   * player from every eligible candidate — one legal action per candidate,
   * carrying the chosen character as `targetScoutInstanceId`, exactly like a
   * bare `"character"` tap cost. Generalizes `"sage-in-company"` to an
   * arbitrary skill. Used by Anduin River (tw-191): "tap the ranger".
   */
  readonly tap?: 'self' | 'bearer' | 'character' | 'sage-in-company' | 'sage-in-company-excluding-bearer'
    | 'sage-and-scout-in-company' | 'self-and-bearer' | 'sage-at-haven' | 'skilled-character-in-company';
  /**
   * For `tap: "skilled-character-in-company"`: the skill the tapped
   * character must carry (printed or item-granted), e.g. `"ranger"`.
   */
  readonly skill?: string;
  /**
   * The entity to discard. "self" discards the source card from its bearer.
   * "bearer" and "character" are reserved for future use. "named-card"
   * discards a card matching {@link discardCardName} from the acting
   * player's hand — no character actor is tapped or otherwise required
   * (Fifteen Birds in Five Firtrees dm-129: "or you discard Eagle-mounts
   * from your hand"). "named-stored-card" discards a *different* card
   * matching {@link discardCardName} out of the acting player's own
   * marshalling-point pile (`killPile`, a `storedAtSite` entry) — unlike
   * `discard: "self"`'s `killPile` fallback (which discards the source card
   * itself), this leaves the source in place. On a `fromStored` grant-action
   * (the source itself has no bearer) it is paired with a
   * `place-source-with-item` apply that relocates the source — Andúril, the
   * Flame of the West (tw-192): "you may discard a stored Reforging and place
   * Andúril with Narsil." On an ordinary bearer-owned grant-action (declared
   * on an in-play item) it instead leaves the source item where it is and
   * pairs with a `restore-item` apply — the Reforging family of hoard items
   * (Horn of Defiance td-183 et al.): "A stored Reforging may be placed with
   * this item to 'restore' it." Both variants resolve through the generic
   * {@link ActionCost} payment path (`cost-evaluator.ts`), keyed off the
   * activation's `targetCardId` naming the chosen stored card.
   */
  readonly discard?: 'self' | 'bearer' | 'character' | 'named-card' | 'named-stored-card';
  /**
   * For `discard: "named-card"` / `discard: "named-stored-card"` — the card
   * definition name to find and discard from the acting player's hand (or,
   * for the stored variant, their `killPile`).
   */
  readonly discardCardName?: string;
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
   * instead of the character (e.g. The Ring's Betrayal). When set to
   * `'discard-instead-of-eliminate'`, an outcome that would normally
   * eliminate the character (roll ≥2 below CP, or a Wizard avatar on any
   * failure) instead merely discards him along with his non-follower
   * possessions (e.g. The Roving Eye le-135).
   */
  readonly failureMode?: 'discard-ring-only' | 'discard-instead-of-eliminate';
  /**
   * For `check: "corruption"` costs on a character-targeting hazard
   * short-event: on a **failed** check, also discard the named item
   * wherever it is borne within the target character's own company (not
   * necessarily on the target himself) — The Precious (tw-98): "discard The
   * One Ring along with the target character." Resolved to a concrete
   * instance at chain-resolution time (`resolveAlsoDiscardItemId`,
   * `chain-reducer.ts`) and carried on the pending `corruption-check` as
   * `alsoDiscardItemId`; on failure the item is pulled off its real bearer
   * and folded into the same discard-pile routing as the target's own
   * possessions (`pending-reducers.ts`).
   */
  readonly alsoDiscardItemName?: string;
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

/**
 * The closed set of triggered-action verbs. Replaces the former open
 * `type: string` discriminant on {@link TriggeredAction}, so the compiler
 * catches typo'd or unhandled action verbs at every construction and
 * dispatch site and the recognised set is documented in one place. Each
 * verb's relevant fields are documented on {@link TriggeredAction}; full
 * per-verb field discrimination is deferred to the apply-dispatcher
 * unification (see `specs/2026-04-23-chain-effect-dispatch-plan.md`).
 */
export type TriggeredActionType =
  | 'sequence'
  | 'force-check'
  | 'force-check-all-company'
  | 'force-discard-stage-card'
  | 'offer-char-join-attack'
  | 'offer-resource-play'
  | 'offer-restore-character'
  | 'tap-one-character'
  | 'roll-discard-opponent-non-unique-ally'
  | 'set-site-phase-flag'
  | 'set-character-status'
  | 'set-company-special-movement'
  | 'shuffle-deck-top'
  | 'add-constraint'
  | 'remove-constraint'
  | 'cancel-chain-entry'
  | 'company-tap-characters'
  | 'reveal-hand-cards-per-character'
  | 'company-return-to-origin'
  | 'counter-cancel-attack'
  | 'discard-character'
  | 'eliminate-character'
  | 'eliminate-captured-character'
  | 'enqueue-opponent-elimination-roll'
  | 'discard-target-character'
  | 'force-discard-one-company-item'
  | 'random-discard-hand'
  | 'enqueue-corruption-check'
  | 'enqueue-body-check'
  | 'whip-discipline'
  | 'enqueue-site-wound-rolls'
  | 'malady-without-healing'
  | 'mount-slain'
  | 'enqueue-pending-fetch'
  | 'enqueue-ring-play-offer'
  | 'enqueue-gold-ring-test'
  | 'enqueue-reveal-hazards-choice'
  | 'heal-target-character'
  | 'return-character-to-hand'
  | 'increment-company-extra-region-distance'
  | 'modify-current-strike-prowess'
  | 'move'
  | 'place-item-on-character'
  | 'place-source-with-item'
  | 'discard-named-in-play'
  | 'discard-target-in-play'
  | 'discard-bearer-corruption'
  | 'draw-cards'
  | 'sauron-sideboard-fetch'
  | 'peek-opponent-hand'
  | 'reveal-opponent-hand'
  | 'discard-target-corruption-card'
  | 'offer-corruption-removal-at-site'
  | 'roll-check'
  | 'roll-then-apply'
  | 'faction-influence-untethered'
  | 'un-eliminate-creature'
  | 'transform-site'
  | 'untap-site'
  | 'lock-company-movement'
  | 'split-into-own-company'
  | 'cancel-current-attack'
  | 'traitor-attack'
  | 'site-entry-attack'
  | 'win-condition-roll'
  | 'win-game'
  | 'transfer-item-free'
  | 'reattach-to-item';

/**
 * One threshold band of a {@link WinConditionRollAction.bands} roll table.
 * Lives with the card-effect schema (the engine reducer imports it from here).
 */
export interface RollBand {
  /** Match when the modified total is strictly less than this. */
  readonly lt?: number;
  /** Match when the modified total is ≤ this. */
  readonly lte?: number;
  /** Match when the modified total is strictly greater than this. */
  readonly gt?: number;
  /** Match when the modified total is ≥ this. */
  readonly gte?: number;
  /**
   * What happens when this band matches.
   * - `gain-mp` keeps the card in play (like `keep`) and additionally awards
   *   the owner `mp` marshalling points and marks "The One Ring affects The
   *   Balrog" (Challenge the Power ba-52, 9–10 band).
   */
  readonly outcome: 'eliminate-avatar' | 'discard-self' | 'keep' | 'win-game' | 'gain-mp';
  /** Marshalling points awarded by a `gain-mp` outcome (default 0). */
  readonly mp?: number;
}

/** Dynamic roll modifiers summed into a {@link WinConditionRollAction} 2d6 total. */
export type RollModifier = 'sages-in-company' | 'copies-in-play' | 'other-copies-in-play';

/**
 * Common base for every discriminated {@link TriggeredAction} member. Mirrors
 * the already-migrated {@link MoveEffect} (which extends {@link EffectBase}) so
 * every member shares the optional `when` guard. The `type` discriminant is a
 * string literal declared on each member — never here — so narrowing works.
 */
export type TriggeredActionBase = EffectBase;

/** `force-check` — enqueue one corruption check on the event-context character. */
export interface ForceCheckAction extends TriggeredActionBase {
  readonly type: 'force-check';
  /** Which check to force; handlers guard `=== 'corruption'`. */
  readonly check: string;
  /** Modifier to the forced check (read as `?? 0`). */
  readonly modifier?: number;
  /** Covetous Thoughts: one check per item borne by other company characters. */
  readonly perOthersItem?: boolean;
  /** @deprecated Documented historically but never read; kept for data-compat. */
  readonly target?: string;
}

/**
 * `force-discard-stage-card` — the card-player's opponent must discard one of
 * their in-play Fallen-wizard **Stage** cards, of their own choice.
 *
 * A Stage card is any card whose definition carries `alignment: "stage"`
 * (MEWH §1) — stage permanent-events in `cardsInPlay`, stage permanent-events
 * played on a character (which live in the bearer's `items`), stage items, and
 * stage allies. Every such card the opponent controls is offered as a
 * candidate; the opponent picks one and it goes to their discard pile, which
 * re-derives their stage-point total.
 *
 * Resolution raises a `force-discard-card` pending resolution with the
 * candidate set pre-computed, so the *opponent* makes the choice.
 *
 * Used by Echoes of the Song (wh-17): "If your opponent has more than one
 * stage card and 4 or more stage points, he must discard one stage card of his
 * choice." — the gate itself is expressed as the play-option's `when`
 * (`opponent.stageCardCount` / `opponent.stagePoints`), not here.
 */
export interface ForceDiscardStageCardAction extends TriggeredActionBase {
  readonly type: 'force-discard-stage-card';
}

/** `force-check-all-company` — a corruption/body check for every company character. */
export interface ForceCheckAllCompanyAction extends TriggeredActionBase {
  readonly type: 'force-check-all-company';
  /** Which check to force (corruption for Corpse-candle, body for Veils Flung Away). */
  readonly check: string;
  readonly modifier?: number;
}

/** `enqueue-corruption-check` — single corruption check on the bearer/attached character. */
export interface EnqueueCorruptionCheckAction extends TriggeredActionBase {
  readonly type: 'enqueue-corruption-check';
  readonly modifier?: number;
  /**
   * `'company-member'` — the check is made by the first member of the attached
   * character's company whose definition matches `filter` (no match → no
   * check). Omitted — the attached character makes the check. (Well-preserved
   * as-108 targets the company's non-Ringwraith shadow-magic user this way.)
   *
   * `'target-character'` — as a `grant-action` apply, the check is made by
   * the activation's chosen `targetCardId` rather than the activating
   * (bearer) character. Used by The Arkenstone (tw-341): untapping a
   * Dwarf company-mate forces *that* Dwarf's corruption check, not the
   * item bearer's.
   */
  readonly target?: string;
  /**
   * DSL condition selecting the company member for `target: 'company-member'`,
   * evaluated against each member's card definition (fields like `race`,
   * `skills`).
   */
  readonly filter?: Condition;
  /** Apply run if the check succeeds (Cracks of Doom: succeed → win-game). Recursive. */
  readonly onSuccess?: TriggeredAction;
}

/**
 * `enqueue-body-check` — an `onSuccess` follow-up on a target's corruption
 * check (A Malady Without Healing le-159: "…followed by a body check (modified
 * by +1 if tapped)"). When the corruption check passes and the target survives,
 * this enqueues a standalone (out-of-combat) body check on that same character:
 * the `rollerPlayerId` rolls 2d6, +1 if the target is tapped (or wounded); if
 * the modified roll exceeds the target's body the character is eliminated
 * (CoE 3.I.2.1 — a failed body check on any character eliminates it). Modelled
 * as a generic `dice-check` resolution enqueued by the corruption-check
 * resolver, with `onPass: eliminate-character` carrying `awardKillMpTo`.
 */
export interface EnqueueBodyCheckAction extends TriggeredActionBase {
  readonly type: 'enqueue-body-check';
  /** Player who rolls the body check (the caster / non-controller). */
  readonly rollerPlayerId: PlayerId;
  /** Add +1 to the roll when the target is tapped or wounded (not untapped). */
  readonly plusOneIfTapped?: boolean;
  /** Credit this player with the hero target's kill MP if the body check eliminates it. */
  readonly awardKillMpTo?: PlayerId;
  /** UI/log banner for the enqueued check. */
  readonly reason?: string;
}

/**
 * `whip-discipline` -- Where There's a Whip (le-254): the resolution-context
 * target (an untapped Orc/Troll bearing a Whip) disciplines his own company.
 * Every OTHER character in his company that is currently **tapped**, has a
 * printed mind greater than 0, and has a lower effective prowess than the
 * bearer makes a body check with `modifier` added to the roll (CoE 3.I.1),
 * comparing to the character's body (or, for an Orc/Troll, the lowest value
 * in its `discardBodyCheck` array, mirroring the approximation used by
 * `force-check-all-company`). Per CoE 3.I.3 an Orc/Troll who fails is
 * discarded instead of wounded; every other race is wounded instead of
 * eliminated (the card's own "does not eliminate" override — moot in
 * practice since only *tapped*, i.e. never-already-wounded, characters are
 * checked). Company members not required to check (including the bearer
 * himself, and anyone excluded by status/mind/prowess) are untapped
 * immediately since their outcome never depended on a roll; a checked member
 * who passes is untapped too — so every unwounded character in the company
 * ends up untapped. Implemented in `applyShortEventOnEntersPlay`
 * (`reducer-events.ts`).
 */
export interface WhipDisciplineAction extends TriggeredActionBase {
  readonly type: 'whip-discipline';
  /** Added directly to each disciplined character's 2d6 roll (e.g. -2). */
  readonly modifier: number;
}

/**
 * `enqueue-goodwill-attempt` — `onSuccess` follow-up on a diplomat's
 * corruption check (Token of Goodwill dm-160): the diplomat discards a
 * company item of `itemSubtype` to make an influence roll (2d6 + unused DI)
 * against `threshold`. Success cancels the attack and offers a play-deck/
 * discard-pile resource fetch.
 */
export interface EnqueueGoodwillAttemptAction extends TriggeredActionBase {
  readonly type: 'enqueue-goodwill-attempt';
  /** The diplomat's company — item must come from here. */
  readonly companyId: CompanyId;
  /** Item rank the diplomat must discard to make the roll. */
  readonly itemSubtype: 'minor' | 'major' | 'greater';
  /** Roll (2d6 + unused DI) must exceed this for the attack to be cancelled. */
  readonly threshold: number;
}

/**
 * `enqueue-site-wound-rolls` — an `end-of-turn` on-event apply carried by a
 * permanent hazard **attached to a character**, modelling a plague-style
 * contagion that afflicts everybody standing at the bearer's site rather than
 * just the bearer.
 *
 * The scan (`fireEndOfTurnSiteWoundRolls`, `reducer-site.ts`) runs when the
 * bearer's controller is the active player — i.e. at the end of *that* player's
 * turn, which is "the end of your opponent's turn" from the hazard player's
 * seat. For every character standing at the same site as the bearer (either
 * player's companies, the bearer included) whose definition matches the
 * optional {@link filter}, it enqueues one generic `dice-check`: the
 * character's own controller rolls 2d6, adds {@link modifier}, and on a total
 * strictly greater than the character's **effective** body the
 * `wound-or-eliminate` verb (ba-54) wounds him — or eliminates him if he was
 * already wounded.
 *
 * Used by Plague (le-129): "At the end of your opponent's turn, each
 * non-Ringwraith, non-Wizard, non-Elf character at the same site as the target
 * must make a roll modified by -2. If the result is greater than the
 * character's body, he is wounded or he is eliminated if he is already
 * wounded."
 */
export interface EnqueueSiteWoundRollsAction extends TriggeredActionBase {
  readonly type: 'enqueue-site-wound-rolls';
  /** Constant added to each character's 2d6 roll (Plague le-129: `-2`). */
  readonly modifier: number;
  /**
   * DSL condition evaluated against each candidate character's card
   * definition (bare definition fields such as `race`, `cardType`). Characters
   * that fail it are skipped. Omit to afflict every character at the site.
   */
  readonly filter?: Condition;
}

/**
 * `malady-without-healing` — the bespoke `self-enters-play` orchestrator for
 * A Malady Without Healing (le-159). On resolution it: (1) enqueues a
 * corruption check (`targetCorruptionModifier`, default -1) on the target
 * character — which may be an opponent's, rolled by the target's controller —
 * carrying `awardKillMpTo` (caster) and an `enqueue-body-check` `onSuccess`
 * follow-up; and (2) unless the acting player's chosen shadow-magic user at the
 * target's site is a Ringwraith, enqueues a corruption check
 * (`casterCorruptionModifier`, default -5) on that user.
 */
export interface MaladyWithoutHealingAction extends TriggeredActionBase {
  readonly type: 'malady-without-healing';
  /** Roll modifier for the target's corruption check (le-159: -1). */
  readonly targetCorruptionModifier: number;
  /** Roll modifier for the non-Ringwraith shadow-magic user's corruption check (le-159: -5). */
  readonly casterCorruptionModifier: number;
}

/**
 * `mount-slain` — the bespoke `self-enters-play` orchestrator for Mount Slain
 * (as-50). Fires from the `after-attack` combat play window once a strike
 * from a Ringwraith-race attacker has failed against the defending company.
 * No explicit target is chosen by the player — "the Ringwraith" is the
 * opponent's own revealed Ringwraith avatar (mind === null, race
 * `ringwraith`; {@link findPlayerAvatar}), found programmatically. If no such
 * avatar is in play, the card fizzles. Otherwise it enqueues a standalone
 * body check (2d6 vs the avatar's effective body, rolled by its own
 * controller): `onPass` (roll exceeds body, CoE 3.I.2.1) eliminates the
 * avatar; `onFail` (survives) discards it anyway per the card's forced
 * "discard the Ringwraith". The Mount Slain card itself is discarded
 * immediately — it never remains in play.
 */
export interface MountSlainAction extends TriggeredActionBase {
  readonly type: 'mount-slain';
}

/** `roll-check` — roll 2d6, sum check modifiers, emit a labelled dice GameEffect. */
export interface RollCheckAction extends TriggeredActionBase {
  readonly type: 'roll-check';
  /** Which check's modifiers are summed into the roll. */
  readonly check: string;
  /** Human-readable dice label; defaults to the check name. */
  readonly label?: string;
}

/**
 * `roll-then-apply` — roll 2d6; run `onSuccess` when the total ≥ `threshold`,
 * else `onFailure`. Recursive (the branches are themselves triggered actions).
 */
export interface RollThenApplyAction extends TriggeredActionBase {
  readonly type: 'roll-then-apply';
  /** The 2d6 total at or above which `onSuccess` fires. */
  readonly threshold: number;
  /** Apply run when the roll meets `threshold`. */
  readonly onSuccess?: TriggeredAction;
  /** Apply run when the roll is below `threshold`. */
  readonly onFailure?: TriggeredAction;
}

/**
 * `faction-influence-untethered` — declare and immediately resolve an
 * influence attempt to bring a faction card from hand into play, without any
 * tie to the activating company's current site: the site need not match the
 * faction's printed `playableAt`, need not be untapped, and — win or lose —
 * is never tapped by the attempt. Used by Roäc the Raven (tw-320): "tap and
 * discard Roäc … to attempt to bring any faction into play — treat this
 * influence check as if it was made by a diplomat at any site where the
 * faction could be played. Using Roäc … does not tap a site, and may be done
 * if his company is at a tapped site."
 *
 * The grant-action's `targets` descriptor (scope `"own-hand-factions"`)
 * supplies the chosen faction on `action.targetCardId`. Resolution mirrors
 * the ally branch of {@link resolveInfluenceAttemptRoll} (Radagast's Black
 * Bird wh-114) — the source ally's printed `directInfluence` (0 if unprinted)
 * plus player-wide `check-modifier` constraints and the game-wide influence
 * check-modifier — but omits every *site*-tied modifier (region-based
 * faction-influence-restriction, site-bound influence modifiers), since the
 * card text detaches the check from any real site. No on-guard/chain window
 * is opened: CoE 2.V.6 only opens on-guard for a resource "that would tap
 * the site if successfully played", and this one never does. Resolves
 * synchronously — no chain — moving the faction card straight from hand into
 * `cardsInPlay` (untapped, no site touched) on success or to the discard
 * pile on failure.
 */
export interface FactionInfluenceUntetheredAction extends TriggeredActionBase {
  readonly type: 'faction-influence-untethered';
}

/**
 * `un-eliminate-creature` — "make a roll—if the result is greater than 8, bring
 * an eliminated hazard creature to its owner's discard pile **and** place this
 * card in your opponent's marshalling point pile, otherwise, discard this card."
 * (Returned Beyond All Hope, as-35, mode 3.)
 *
 * An *eliminated* creature is one sitting in a terminal off-board pile: the
 * opponent's marshalling-point pile (`killPile` — a defeated creature kept as a
 * trophy, explicitly allowed by the CRF 22 ruling "This card may target
 * creatures still in play as trophies") or either player's `outOfPlayPile` (a
 * creature routed out of the game, e.g. by the CoE 8.22 starred/non-starred
 * rule). Recovering it to its owner's discard pile un-eliminates it, so
 * {@link isManifestationDefeated} stops reporting the chain as defeated and any
 * manifestation of that character becomes playable again.
 *
 * The card carrying this apply rides the chain as a permanent-event and never
 * enters `cardsInPlay`: on a successful roll it is placed into the opponent's
 * marshalling-point pile (where an accompanying `mp-in-pile` effect scores it),
 * on a failed roll into its own player's discard pile.
 */
export interface UnEliminateCreatureAction extends TriggeredActionBase {
  readonly type: 'un-eliminate-creature';
  /** The 2d6 total at or above which the recovery succeeds (9 = "greater than 8"). */
  readonly threshold: number;
  /** DSL condition every candidate creature definition must match. */
  readonly filter: Condition;
  /** Where the resolving card goes on success. */
  readonly selfTo: 'opponent-mp-pile';
}

/** `win-condition-roll` — CoE 10.39 dice-roll win cards (A New Ringlord, Challenge the Power). */
export interface WinConditionRollAction extends TriggeredActionBase {
  readonly type: 'win-condition-roll';
  /** Ordered threshold table; the first band the modified 2d6 total satisfies decides the outcome. */
  readonly bands: readonly RollBand[];
  /** Dynamic modifiers summed into the 2d6 total. */
  readonly rollModifiers?: readonly RollModifier[];
}

/** `win-game` — immediate One Ring win (CoE 10.39). */
export interface WinGameAction extends TriggeredActionBase {
  readonly type: 'win-game';
  /** @deprecated Documented historically but never read in the engine. */
  readonly via?: 'one-ring';
  /**
   * When true, The One Ring is *destroyed* as part of the win: every in-play
   * item the winner's characters bear that carries the `the-one-ring` keyword
   * is removed from the game (to the owner's out-of-play pile) before final
   * scores are computed, so the destroyed Ring scores no marshalling points.
   *
   * Only the two cards that print "The One Ring is destroyed" set this —
   * Cracks of Doom (tw-205) and Gollum's Fate (tw-247). A New Ringlord
   * (wh-60) and Challenge the Power (ba-52) win *with* the Ring, not by
   * destroying it, so they leave it unset.
   */
  readonly destroysOneRing?: boolean;
}

/**
 * `add-constraint` — add an {@link ActiveConstraint} of the named kind to the
 * target. `constraint` is the kind name; `scope` encodes the auto-clear
 * boundary; the remaining fields are the per-kind payload read by the
 * constraint-kind builders.
 */
export interface AddConstraintAction extends TriggeredActionBase {
  readonly type: 'add-constraint';
  /** The active-constraint kind name (maps to {@link ActiveConstraint}.kind.type). */
  readonly constraint?: string;
  /** The constraint scope, encoded as a string the on-event handler maps to {@link ConstraintScope}. */
  readonly scope?: string;
  /** Selector for the constrained entity (e.g. `'action-target-character'`, `'bearer'`) on grant-action applies. */
  readonly target?: string;
  /** Numeric payload (check-modifier, *-stat-modifier, hazard-limit-modifier, hand-size-modifier, …). */
  readonly value?: number;
  /**
   * For a `check-modifier` payload: when true the modifier is not consumed by
   * the first matching check but keeps applying until its `scope` sweeps it
   * (Shifter of Hues wh-115: "+2 to the corruption checks of the characters in
   * one company through your next organization phase"). Omit for the ordinary
   * one-shot "add +N to one check" behaviour.
   */
  readonly lasting?: boolean;
  /**
   * For a `check-modifier` payload: when true, the targeted character's next
   * matching check (e.g. corruption) succeeds unconditionally, regardless of
   * the roll, instead of being adjusted by {@link value}. Used by Ancient
   * Black Axe (as-122): "tap this item to make a character at the same site
   * automatically pass a corruption check."
   */
  readonly autoPass?: boolean;
  /** MathJS expression computing a dynamic numeric payload at play time (check-modifier). */
  readonly valueExpr?: string;
  /** Which check a check-modifier applies to. */
  readonly check?: string;
  /**
   * For an influence `check-modifier` payload: what happens to the faction card
   * when the boosted influence check fails. `'shuffle-faction-into-deck'` sends
   * the faction back into its player's play deck (reshuffled) instead of the
   * discard pile. The Dark Power (as-79): "+3 to an influence check against a
   * faction. If the check is not successful, shuffle the faction into your play
   * deck." Carried onto the constraint kind and honoured by
   * `resolveInfluenceAttemptRoll` when the consuming check fails.
   */
  readonly onFailure?: 'shuffle-faction-into-deck';
  /**
   * For an influence `check-modifier` payload: what happens when the boosted
   * check succeeds. `'draw-card'` draws one card for the influencer's
   * controller. Lordly Presence (tw-267): "+5 to an influence check against a
   * faction. If the influence check is successful, draw a card." Carried onto
   * the constraint kind and honoured by `resolveInfluenceAttemptRoll` when the
   * consuming check succeeds.
   */
  readonly onSuccess?: 'draw-card';
  /**
   * For an influence `check-modifier` payload: replace the influencer's unused
   * direct influence with `min(effective prowess, max)` when the constraint is
   * consumed by a faction-influence check. The prowess is read at resolution
   * time, not at play time (CRF 22 on Threats le-244: "your prowess is
   * calculated when it resolves"). Threats (le-244): "Warrior does not use his
   * unused direct influence for the attempt. Instead he uses his prowess, to a
   * maximum modifier of +6."
   */
  readonly prowessSubstitution?: { readonly max: number };
  /** Which stat a company/character-stat-modifier applies to. */
  readonly stat?: 'prowess' | 'body' | 'direct-influence';
  /** Creature race filter for creature-attack-boost. */
  readonly race?: Race;
  /** Excluded creature races for `defeat-attack-strikes` (Liquid Fire wh-52). */
  readonly excludeRaces?: readonly Race[];
  /** Prowess bonus for creature-attack-boost. */
  readonly prowess?: number;
  /** Strike bonus for creature-attack-boost. */
  readonly strikes?: number;
  /** Site type for site-type-override / site-resource-unlocked / auto-attack-prowess-boost. */
  readonly siteType?: string;
  /**
   * For an `auto-attack-prowess-boost` add-constraint (Come By Night Upon Them
   * le-176: "-1 to the prowess of all automatic-attacks at the site, -2 if Doors
   * of Night is in play"): when true, the effect's {@link value} is doubled at
   * play time if Doors of Night is in play. The doubled amount is baked into the
   * constraint when it is created, since the card is played immediately before
   * the site's automatic-attacks resolve.
   */
  readonly doublesWithDoorsOfNight?: boolean;
  /**
   * Compound site selector for a `site-resource-unlocked` add-constraint whose
   * "such a site" is not a single site type — evaluated against the site
   * context (A Panoply of Wings wh-37: "any non-Haven, non-Shadow-hold,
   * non-Dark-hold site in a Wilderness"). Mutually exclusive with {@link siteType}.
   */
  readonly siteCondition?: Condition;
  /** Resource category for site-resource-unlocked. */
  readonly subtype?: string;
  /** Override target type for site-type-override / region-type-override. */
  readonly overrideType?: string;
  /**
   * Overrides how a site-bound add-constraint resolves its site, for a
   * character-targeted permanent event whose site is not the active
   * company's current site. `'dragon-at-home-victory'` resolves the bound
   * site from the play-target character's own `dragonAtHomeVictorySiteId`
   * (King under the Mountain td-126: "The site where the Dragon was
   * defeated becomes a Border-hold …" — the site is determined by the
   * targeted Dwarf's recorded history, not by where the card is played).
   * Omit for the default resolution (active company's current site, or the
   * card's own `targetSiteDefinitionId` play target).
   */
  readonly siteFrom?: 'dragon-at-home-victory';
  /**
   * For a `site-type-override` add-constraint: restricts the override to a
   * subset of game purposes.
   * - `'healing'` — the site counts as the overridden type (a Haven) **only**
   *   for the untap-phase healing check; every other purpose (hazard keying,
   *   movement, bring-into-play, item/faction/ally playability, character
   *   recruiting) still sees the printed site type. Houses of Healing
   *   (td-125): "Site becomes a Haven [{H}] for the purposes of healing."
   * - `'healing-and-hazards'` — the override applies everywhere *except*
   *   character recruiting (`getEffectiveSiteType`'s
   *   `excludeCharacterPlayOverrides` callers skip it). The White Tree
   *   (tw-348): "Minas Tirith becomes a Haven [{H}] for the purposes of
   *   healing and playing hazards" — not for playing characters.
   *
   * Omit for a full type override that changes the effective site type
   * everywhere, including character recruiting (Hold Rebuilt and Repaired
   * as-88).
   */
  readonly purpose?: string;
  /**
   * For a `site-type-override` add-constraint: apply the override to **all
   * versions** of the bound site — every printing of the same named location
   * (hero / minion / Fallen-wizard / Balrog), which are distinct definitions
   * sharing one name — instead of only the definition the card was played on.
   * Nature's Revenge (wh-27): "All versions of the site become Ruins & Lairs
   * [{R}]." Emits a `site.name`-scoped constraint filter (see
   * {@link import('../engine/effective.js').siteConstraintFilterMatches}).
   */
  readonly allVersions?: boolean;
  /** Region name for region-type-override (token `"destination"` = active company's destination region). */
  readonly regionName?: string;
  /**
   * For a `no-creatures-keyed-to-site` constraint: region type that exempts
   * the destination from the restriction — when the target company's new site
   * sits in a region of this type, the constraint imposes nothing. Crack in
   * the Wall (le-177): "Unless the site is in a Free-domain [{f}]" → `"free"`.
   */
  readonly unlessSiteRegionType?: string;
  /**
   * For an `extra-mh-phase` constraint (Master of Esgaroth td-135): the
   * {@link import('./common.js').SiteType} the target company must actually
   * move to for the extra movement/hazard phase to be granted. The check runs
   * when the company's M/H phase ends (`advanceAfterCompanyMH`), not when the
   * card is played — td-135 is playable on *any* moving company at the end of
   * the organization phase and is simply inert if that company ends up
   * somewhere other than a Border-hold. Omit for an unconditional grant.
   */
  readonly requiresDestinationSiteType?: string;
  /**
   * For a `haven-return-option` constraint (Ancient Stair dm-115): only offer
   * the end-of-turn return option when the target company's site at end of
   * turn carries this keyword — "If company moved to an Under-deeps site, at
   * the end of the turn the company may replace its site card with the site
   * card at which it began the turn" → `"under-deeps"`. Checked when the
   * option is offered (`havenReturnActions`, `legal-actions/end-of-turn.ts`),
   * not at play time, since the company's final site for the turn is not yet
   * known when an end-of-org card is played. Omit for an unconditional offer
   * (Great-road tw-249, always offered regardless of where the company went).
   */
  readonly requiresMovedToKeyword?: string;
  /** Payload describing the action granted by a `granted-action` constraint. */
  readonly grantedAction?: GrantedActionConstraintPayload;
  /**
   * For a `site-path-reduction` constraint (Roam the Waste ba-73): region type →
   * count of tokens removed from each of the player's companies' site paths this
   * turn (e.g. `{ "wilderness": 1, "shadow": 1 }`).
   */
  readonly regionReductions?: Record<string, number>;
  /**
   * For a `character-stat-modifier` constraint that is only active *while* a
   * named card remains in play (Heart of Dark Fire ba-63: "The Balrog receives
   * +5 direct influence this turn **while Strangling Coils is in play**"). The
   * effect resolver re-checks this each time it synthesises the stat modifier,
   * so the bonus lapses immediately if the named card leaves play mid-turn.
   */
  readonly requiresCardInPlay?: string;
  /**
   * For a `check-modifier` constraint: an optional condition evaluated against
   * the check's resolver context at the moment the check resolves. When present,
   * the modifier is only applied (and consumed) if the condition matches. Used
   * by boosters that are specific to one flavour of influence attempt, e.g.
   * Mine or No One's (ba-68): a +10 that applies only to an *opponent-influence*
   * attempt (`reason: "opponent-influence-check"`) against an item, ally, or
   * Orc/Troll faction. A check-modifier constraint with no `constraintWhen`
   * keeps its legacy behaviour (consumed by the faction-influence roll).
   *
   * On a **company**-targeted corruption check-modifier it instead narrows
   * which of the company's characters benefit, evaluated against a
   * `{ target: { cardType, race, name } }` context describing the character
   * making the check: Ren the Ringwraith (le-56) modifies checks "by minions
   * in any one of your companies" and carries
   * `{ "target.cardType": "minion-character" }`, while Shifter of Hues
   * (wh-115) aids "the characters in one company" wholesale and omits it.
   */
  readonly constraintWhen?: Condition;
  /**
   * For a `hazard-limit-region-count` constraint (Fair Sailing tw-232): the
   * region type counted in the target company's resolved site path.
   */
  readonly regionType?: RegionType;
  /**
   * For a `hazard-limit-region-count` constraint: the floor the hazard
   * limit is never reduced below ("to a minimum of two"). {@link value}
   * carries the per-region delta.
   *
   * Also doubles as the floor for a `hazard-limit-region-name-match`
   * constraint (Anduin River tw-191 and the "mountain-crossing" family).
   */
  readonly floor?: number;
  /**
   * For a `hazard-limit-region-name-match` constraint (Anduin River tw-191
   * and the "mountain-crossing" family): the region names that trigger the
   * flat {@link value} reduction when the target company's destination lies
   * within one of them.
   */
  readonly regionNames?: readonly string[];
  /**
   * For a `region-adjacency-shortcut` constraint (Anduin River tw-191 and the
   * "mountain-crossing" family): bidirectional region-name pairs treated as
   * adjacent for the target company's region movement this turn.
   */
  readonly regionPairs?: readonly (readonly [string, string])[];
  /**
   * For a `region-shortcut` constraint (Ash Mountains tw-194): region-name
   * pairs treated as adjacent for region-movement path-finding purposes.
   */
  readonly pairs?: readonly (readonly [string, string])[];
  /**
   * For a `region-shortcut` constraint: the skill an untapped company member
   * must have to use the granted shortcut (tapped as its cost).
   */
  readonly requiredSkill?: Skill;
  /**
   * For a `nazgul-boost-pending` constraint (Fell Beast tw-33): the strikes
   * delta applied to the next matching hazard-creature card played against
   * the target company (e.g. `1` for "increased by one").
   */
  readonly strikesModifier?: number;
  /**
   * For a `nazgul-boost-pending` constraint: the prowess delta applied to the
   * next matching hazard-creature card played against the target company
   * (e.g. `-2` for "decreased by 2").
   */
  readonly prowessModifier?: number;
  /**
   * For a `nazgul-boost-pending` constraint: when true, the boosted creature's
   * resulting attack gets "attacker chooses defending characters".
   */
  readonly grantAttackerChoosesDefenders?: true;
  /**
   * For a `nazgul-boost-pending` constraint: region types the next matching
   * creature may additionally be keyed to, on top of its own printed
   * `keyedTo` (Fell Beast tw-33: "may also be played keyed to a Shadow-land").
   */
  readonly keyingRegionTypes?: readonly RegionType[];
  /**
   * For a `nazgul-boost-pending` constraint: site types the next matching
   * creature may additionally be keyed to, on top of its own printed
   * `keyedTo` (Fell Beast tw-33: "...or Shadow-hold").
   */
  readonly keyingSiteTypes?: readonly SiteType[];
}

/**
 * `remove-constraint` — sweep active constraints. `select: 'constraint-source'`
 * removes every constraint whose `source` matches the action's source card.
 */
export interface RemoveConstraintAction extends TriggeredActionBase {
  readonly type: 'remove-constraint';
  /**
   * Which constraints to remove. Only `'constraint-source'` is supported (the
   * handler rejects any other value from card data); typed as the full selector
   * union so that runtime validation stays meaningful.
   */
  readonly select?: 'most-recent-unresolved-hazard' | 'constraint-source' | 'self' | 'target' | 'filter-all' | 'named';
}

/**
 * `set-site-phase-flag` — under `on-event: self-enters-play`, set a named
 * `SitePhaseState` boolean to `true` (fires only during the site phase).
 */
export interface SetSitePhaseFlagAction extends TriggeredActionBase {
  readonly type: 'set-site-phase-flag';
  /** The `SitePhaseState` boolean key to set. */
  readonly flag?: 'hoardBountyAvailable' | 'thoroughSearchAvailable' | 'firstItemNoTapAvailable' | 'hoardKeywordGranted';
}

/** `discard-character` — discard the wound/body-check-context character (type-only marker). */
export interface DiscardCharacterAction extends TriggeredActionBase {
  readonly type: 'discard-character';
}

/**
 * `eliminate-character` — eliminate the resolution-context target character
 * (remove it from its company and send the character card to its owner's
 * out-of-play pile; its non-hazard possessions are discarded, its hazards go to
 * the hazard owner, and its followers revert to general influence). Distinct
 * from `discard-character` (which sends the character card to the discard pile).
 * Used as the `onPass` branch of the dice-check enqueued by Evil Things
 * Lingering (ba-45): the controlling character is *eliminated* if the opponent's
 * organization-phase roll beats his mind.
 */
export interface EliminateCharacterAction extends TriggeredActionBase {
  readonly type: 'eliminate-character';
  /**
   * When set, and the eliminated character is a **hero**, the named player is
   * credited with the character's marshalling points as *kill* MP (added to
   * `player.bonusKillMarshallingPoints`). Used by A Malady Without Healing
   * (le-159) whose standalone body check "if target character is a hero and is
   * eliminated by these checks, you receive his kill marshalling points."
   */
  readonly awardKillMpTo?: PlayerId;
}

/**
 * `eliminate-captured-character` — a `grant-action` apply for No Better Use
 * (ba-41): eliminate the character currently held "off to the side" by the
 * activating source card (found via its `character-pressed` constraint) and
 * award its kill marshalling points to the activating player. Used for
 * ba-41's Shelob's Lair finisher: "tap and discard this card to eliminate
 * opponent's character — whom you then receive as kill marshalling points."
 * Implemented in `grant-action-apply.ts`, using `no-better-use.ts` helpers.
 */
export interface EliminateCapturedCharacterAction extends TriggeredActionBase {
  readonly type: 'eliminate-captured-character';
}

/**
 * `wound-or-eliminate` — the dice-check onPass verb for "he is wounded or, if
 * already wounded, eliminated" (Crowned with Storm ba-54). Acts on the
 * resolution-context target, which may be **either** a character
 * (`targetCharacterId`) or an ally (`targetInstanceId`), and always locates the
 * target's actual owner (the roller may control the *other* company), so it is
 * roller-agnostic:
 *
 * - target not yet wounded (untapped/tapped) → set its status to `inverted`
 *   (a wound);
 * - target already wounded (`inverted`) → eliminate it: a character is removed
 *   to its owner's out-of-play pile (its possessions handled like any
 *   elimination); an ally is removed from its host and sent to its owner's
 *   discard pile.
 *
 * Self-contained: it encodes the "already wounded → eliminate" branch itself
 * rather than relying on `when`-guarded sibling verbs, so it needs no
 * roller-owned-target assumption.
 */
export interface WoundOrEliminateAction extends TriggeredActionBase {
  readonly type: 'wound-or-eliminate';
}

/**
 * `enqueue-opponent-elimination-roll` — an `organization-phase-start` on-event
 * apply (carried by an attached ally) that enqueues a generic `dice-check`
 * resolution for the *opponent* (the bearer's controller's opponent): the
 * opponent rolls 2d6, adds `modifier` (negative), and the bearer's controlling
 * character is eliminated (`onPass`) when the modified total is strictly greater
 * than that character's mind. Used by Evil Things Lingering (ba-45): "If this
 * ally's controlling character is not The Balrog, your opponent makes a roll
 * during your organization phase and subtracts four. The controlling character
 * is eliminated if the result is greater than his mind." (The `not The Balrog`
 * gate is expressed by the effect's `when: { "bearer.name": { "$ne": … } }`.)
 */
export interface EnqueueOpponentEliminationRollAction extends TriggeredActionBase {
  readonly type: 'enqueue-opponent-elimination-roll';
  /** Constant added to the opponent's 2d6 roll (e.g. `-4` = "subtracts four"). */
  readonly modifier: number;
}

/** `discard-target-character` — discard the grant-action's target character (type-only marker). */
export interface DiscardTargetCharacterAction extends TriggeredActionBase {
  readonly type: 'discard-target-character';
}

/** `force-discard-one-company-item` — force the wounded character's company to discard one item. */
export interface ForceDiscardOneCompanyItemAction extends TriggeredActionBase {
  readonly type: 'force-discard-one-company-item';
  /**
   * Who picks the item to discard. Defaults to `'defender'` (Brigands
   * tw-17/le-64, Pirates le-88: "the company must … discard one item").
   * Were-worm (td-80) is `'attacker'`: "the defending company must discard
   * one item of attacker's choice".
   */
  readonly chooser?: 'attacker' | 'defender';
}

/**
 * `random-discard-hand` — the target player discards `count` cards drawn at
 * random from their hand (capped at hand size). Used by hazard short-events
 * that force a company's controller to "randomly discard" cards, as opposed
 * to `force-opponent-discard`'s player-chosen discard.
 */
export interface RandomDiscardHandAction extends TriggeredActionBase {
  readonly type: 'random-discard-hand';
  /** How many cards to discard at random (capped at hand size). */
  readonly count: number;
}

/**
 * `set-character-status` — set the target character's status. Distinct from
 * the {@link SetCharacterStatusEffect} card-effect (which requires `status`):
 * as a triggered apply, `status` may be omitted (some handlers default to
 * `inverted` / error per their context).
 */
export interface SetCharacterStatusAction extends TriggeredActionBase {
  readonly type: 'set-character-status';
  /** New status; omitted at some sites (default/error is context-specific). */
  readonly status?: 'untapped' | 'tapped' | 'inverted';
  /** Selector for which character (`'bearer'` / `'target-character'` / `'target-instance'`). */
  readonly target?: string;
}

/** `heal-target-character` — heal the target character one step (wounded → tapped); type-only marker. */
export interface HealTargetCharacterAction extends TriggeredActionBase {
  readonly type: 'heal-target-character';
}

/** `return-character-to-hand` — return the target character to its owner's hand (Call of Home onFail). */
export interface ReturnCharacterToHandAction extends TriggeredActionBase {
  readonly type: 'return-character-to-hand';
  /**
   * When true, the returning character's owner may transfer one of its items to
   * another character in the same company before the rest are discarded (Pilfer
   * Anything Unwatched as-33). Omitted/false discards every item (Call of Home).
   */
  readonly allowItemTransfer?: boolean;
}

/** `tap-one-character` — enqueue a "tap one character in the company" resolution; type-only marker. */
export interface TapOneCharacterAction extends TriggeredActionBase {
  readonly type: 'tap-one-character';
}

/** `place-item-on-character` — tap the bearer to place a fetched item on a chosen character (The Forge-master). */
export interface PlaceItemOnCharacterAction extends TriggeredActionBase {
  readonly type: 'place-item-on-character';
  /** Piles the item may be fetched from (default discard-pile/sideboard/hand). */
  readonly fetchFrom?: readonly ('discard-pile' | 'deck' | 'hand' | 'sideboard')[];
  /**
   * Restricts which items qualify. Recipients (who the item may be placed
   * with) are scoped by *how* the grant-action is sourced, not by a data
   * field: an attached-card `place-item-on-character` (The Forge-master
   * wh-117) offers every character in any of the controller's companies at
   * the acting character's site (`grantedActionActivations`'s item scan);
   * a `fromStored` `place-item-on-character` (Reforging tw-314) instead
   * offers only the acting (tapped) character's own company members
   * (`storedCardGrantActions`) — there is no bearer/site to anchor a
   * site-wide search since the source card sits in the marshalling-point
   * pile, and the card text itself says "a character in the sage's company".
   */
  readonly filter?: Condition;
}

/**
 * `place-source-with-item` — a `fromStored` grant-action apply that relocates
 * the *source* card itself (not a fetched item) out of the marshalling-point
 * pile (`killPile`) onto whichever of the controller's characters currently
 * bears an item named {@link itemName}, untapped, alongside that item. Unlike
 * `place-item-on-character` (which fetches a *different* card into play),
 * this moves the grant-action's own source. Scanned by the dedicated
 * `storedCombineGrantActions` legal-action emitter, which enumerates one
 * activation per (eligible `discard: "named-stored-card"` cost card ×
 * qualifying recipient) pair, and applied by
 * `handleStoredCardGrantAction` — the source has no bearer, so it is routed
 * there rather than through the generic attached-card apply dispatch. Used
 * by Andúril, the Flame of the West (tw-192): "Once stored, you may discard
 * a stored Reforging and place Andúril with Narsil." Narsil's stat bonuses
 * once combined are not yet certified — see the card's data comment.
 */
export interface PlaceSourceWithItemAction extends TriggeredActionBase {
  readonly type: 'place-source-with-item';
  /** Exact name of the item the source is placed alongside on its bearer. */
  readonly itemName: string;
}

/**
 * `discard-named-in-play` — on `self-enters-play`, find every in-play card with
 * the given name (scanning both players' `cardsInPlay` plus every character's
 * attached `items`/`hazards`) and move each instance to its owner's discard
 * pile. Used by The Lidless Eye (le-203) / Sauron (ba-43): "Discards and
 * prevents the subsequent play of Bade to Rule." (The *prevents subsequent play*
 * half is data — `card-not-in-play` play-conditions on Bade to Rule le-167.)
 */
export interface DiscardNamedInPlayAction extends TriggeredActionBase {
  readonly type: 'discard-named-in-play';
  /** Exact card name whose in-play instances are discarded. */
  readonly cardName: string;
}

/**
 * `discard-target-in-play` — discard the grant-action's chosen target card
 * (carried on `activate-granted-action.targetCardId`) from whichever player's
 * `cardsInPlay` holds it, clearing every active constraint that instance
 * sourced. Which cards may be targeted is governed by the grant-action's
 * `targets` descriptor (typically scope `"opponent-cards-in-play"` with a
 * name filter). Backs "discard the <card> if in play by another player"
 * (Keys to the White Towers wh-89 / Keys of Orthanc wh-88).
 */
export interface DiscardTargetInPlayAction extends TriggeredActionBase {
  readonly type: 'discard-target-in-play';
}

/**
 * `discard-bearer-corruption` — on `self-enters-play` for a permanent-event
 * played onto a character (the `targetCharacterId` on the chain entry), moves
 * every attached hazard-corruption card (`cardType: "hazard-corruption"`,
 * scanning the bearer's `hazards`) to its owner's discard pile. Used by Three
 * Golden Hairs (td-157): "All corruption cards on the bearer are discarded
 * when this card comes into play."
 */
export interface DiscardBearerCorruptionAction extends TriggeredActionBase {
  readonly type: 'discard-bearer-corruption';
}

/**
 * `sauron-sideboard-fetch` — the first mode of The Lidless Eye's (le-203)
 * once-per-organization-phase granted ability: "bring a resource or character
 * from your sideboard into your play deck and shuffle." The chosen sideboard
 * instance travels via `activate-granted-action.targetCardId`. Type-only marker;
 * the once-per-phase lock is `OrganizationPhaseState.sauronOrgActionUsed`.
 */
export interface SauronSideboardFetchAction extends TriggeredActionBase {
  readonly type: 'sauron-sideboard-fetch';
}

/**
 * `peek-opponent-hand` — the second mode of The Lidless Eye's (le-203)
 * once-per-organization-phase granted ability: "choose and discard a card from
 * your hand to look at up to N random cards at once from your opponent's hand."
 * The hand card discarded as cost travels via `activate-granted-action.targetCardId`.
 * The engine reveals `min(count, oppHandSize)` random opponent-hand instances via
 * `revealInstances` (they stay in the opponent's hand). Once-per-phase lock is
 * `OrganizationPhaseState.sauronOrgActionUsed`.
 */
export interface PeekOpponentHandAction extends TriggeredActionBase {
  readonly type: 'peek-opponent-hand';
  /** Maximum number of random opponent-hand cards revealed (le-203: 5). */
  readonly count: number;
}

/**
 * `reveal-opponent-hand` — reveal every card currently in the opponent's
 * hand to the activating player via `revealInstances` (the cards stay in
 * the opponent's hand; this only affects visibility, matching the same
 * mechanism `peek-shuffle-deck-top`'s `revealOpponentHand` flag uses for
 * Mirror of Galadriel tw-282). Unlike `peek-opponent-hand`, there is no
 * random subset and no cost beyond the granting card's own tap — "look at
 * your opponent's hand" means the whole hand, every time. Used by Palantír
 * of Amon Sûl (tw-296): "tap Palantír of Amon Sûl to look at your
 * opponent's hand." Type-only marker.
 */
export interface RevealOpponentHandAction extends TriggeredActionBase {
  readonly type: 'reveal-opponent-hand';
}

/**
 * `discard-target-corruption-card` — discard the hazard-corruption card
 * identified by `activate-granted-action.targetCardId` from whichever of the
 * activating player's own characters bears it, moving it to that
 * corruption card's owner's discard pile (corruption cards are hazards, so
 * they are typically owned by the opponent). Candidates are enumerated by a
 * `targets: { scope: "own-hazard-corruption-cards" }` grant-action descriptor.
 * Used by Palantír of Amon Sûl (tw-296), borrowing Palantír of Elostirion's
 * "remove one corruption card from an Elf or a Wizard under your control."
 */
export interface DiscardTargetCorruptionCardAction extends TriggeredActionBase {
  readonly type: 'discard-target-corruption-card';
}

/**
 * `offer-corruption-removal-at-site` — on entering play, offer each
 * character (either player's) currently standing at a site whose effective
 * type is in `siteTypes` and bearing at least one corruption card the
 * one-time option to remove one of them (their choice which, if more than
 * one; may decline). Enqueues one `remove-corruption-offer` pending
 * resolution per eligible character (`chain-reducer.ts`,
 * `resolvePermanentEvent`'s self-enters-play dispatch).
 *
 * Used by Elf-song (tw-223): "When Elf-song comes into play, each character
 * at a Haven [{H}] may immediately remove one corruption card."
 */
export interface OfferCorruptionRemovalAtSiteAction extends TriggeredActionBase {
  readonly type: 'offer-corruption-removal-at-site';
  /** Site types (e.g. `"haven"`) a character must occupy to be offered the removal. */
  readonly siteTypes: readonly SiteType[];
}

/** `roll-discard-opponent-non-unique-ally` — roll 2d6 ≥ threshold to discard a non-unique ally (CvCC pre-strike). */
export interface RollDiscardOpponentNonUniqueAllyAction extends TriggeredActionBase {
  readonly type: 'roll-discard-opponent-non-unique-ally';
  /** 2d6 total at or above which the discard happens (default 5). */
  readonly threshold?: number;
}

/** `offer-char-join-attack` — offer a haven character the option to join the attack (Alatar). */
export interface OfferCharJoinAttackAction extends TriggeredActionBase {
  readonly type: 'offer-char-join-attack';
  /** When true, allies the bearer controls are discarded on joining. */
  readonly discardOwnedAllies?: boolean;
  /** When true, the attacking creature directs one strike at the bearer. */
  readonly forceStrike?: boolean;
  /** Effects applied to the bearer at combat finalization. */
  readonly postAttack?: {
    readonly tapIfUntapped?: boolean;
    readonly corruptionCheck?: { readonly modifier?: number };
  };
}

/**
 * `offer-resource-play` — enqueue a resource-play offer linked to the entering
 * card (Crown of Flowers dm-121: "You can play one resource from your hand
 * with this card"). The paired resource enters `cardsInPlay` with
 * `linkedInstanceId` back-references in both directions, so either card
 * leaving play cascade-discards the other.
 */
export interface OfferResourcePlayAction extends TriggeredActionBase {
  readonly type: 'offer-resource-play';
  /**
   * Card names the paired resource is interpreted under as though they were
   * in play, copied onto the paired `CardInPlay.assumeInPlay`. Crown of
   * Flowers: `["Gates of Morning"]` — "The resource is considered to be
   * played and to be in play as though Gates of Morning were in play…".
   */
  readonly assumeInPlay?: readonly string[];
  /**
   * Card names the paired resource is interpreted under as though they were
   * NOT in play, copied onto the paired `CardInPlay.assumeNotInPlay`. Crown
   * of Flowers: `["Doors of Night"]` — "…and Doors of Night were not".
   */
  readonly assumeNotInPlay?: readonly string[];
}

/** `offer-restore-character` — offer to untap/heal one company character at a haven; type-only marker. */
export interface OfferRestoreCharacterAction extends TriggeredActionBase {
  readonly type: 'offer-restore-character';
}

/** `enqueue-pending-fetch` — schedule a fetch (from pile to deck/hand) as a pending effect. */
export interface EnqueuePendingFetchAction extends TriggeredActionBase {
  readonly type: 'enqueue-pending-fetch';
  /** Which pile(s) to fetch from. */
  readonly fetchFrom?: readonly ('discard-pile' | 'deck' | 'hand' | 'sideboard')[];
  /** How many cards to fetch (default 1). */
  readonly fetchCount?: number;
  /** Reshuffle the play deck after the fetch. */
  readonly fetchShuffle?: boolean;
  /** Where to place the fetched card (default `'deck'`). */
  readonly fetchTo?: 'deck' | 'hand';
  /**
   * When true, only cards playable at the bearer's company's current site
   * qualify (item categories printed on the site card, allies/factions whose
   * `playableAt` names the site). The site is captured when the fetch is
   * enqueued. Used by Strider (ba-1): "search your discard pile for any one
   * item, ally, or faction playable at his current site".
   */
  readonly playableAtBearerSite?: boolean;
  /** Enqueue a corruption check on the bearer after the fetch completes. */
  readonly postCorruptionCheck?: boolean;
  /** Modifier for the post-fetch corruption check (default 0). */
  readonly postCorruptionCheckModifier?: number;
  /** Restricts which cards may be fetched. */
  readonly filter?: Condition;
  /**
   * When true and `fetchTo` is `'hand'`, the fetched card is allowed to be
   * played despite its target site being tapped — bypassing the normal
   * "site is already tapped" item-play gate for that one card instance only.
   * Used by Dragon-lore (td-108): fetched at an already-tapped Dragon's
   * lair, the found item "may be immediately played with bearer's company".
   */
  readonly unlockTappedSitePlay?: boolean;
}

/** `enqueue-ring-play-offer` — bypass the gold-ring roll and offer ring categories from the test table. */
export interface EnqueueRingPlayOfferAction extends TriggeredActionBase {
  readonly type: 'enqueue-ring-play-offer';
  /** Ring categories to exclude from the offered set. */
  readonly excludeCategories?: readonly string[];
}

/**
 * `enqueue-gold-ring-test` — run the full Rule 6.2 gold-ring test on a chosen
 * gold-ring item borne by a character in a sage's company. Enqueues the shared
 * `gold-ring-test` pending resolution: the ring's owner rolls 2d6 (plus this
 * `rollModifier`), the gold ring's own `ring-test-table` maps the total to the
 * eligible ring categories, the gold ring is discarded, and a `ring-play-offer`
 * follows so the player may play a matching special ring from hand. Used by the
 * "Test of X" short-event ring-test cards (e.g. Test of Fire le-239, whose
 * `rollModifier` is 0; Test of Lore tw-340 uses -1).
 */
export interface EnqueueGoldRingTestAction extends TriggeredActionBase {
  readonly type: 'enqueue-gold-ring-test';
  /** Modifier applied to the 2d6 ring-test roll (default 0). */
  readonly rollModifier?: number;
  /**
   * How many 2d6 rolls the test makes (default 1). With more than one roll the
   * player rolls each in turn and then *chooses* which total the test uses
   * (Wizard's Test tw-365: "make two rolls and choose one result to use for the
   * test"). Higher is not automatically better — a ring-test table maps low
   * totals to Magic Rings and high totals to Dwarven Rings — so the choice is a
   * real decision, resolved by a `choose-gold-ring-test-roll` action.
   */
  readonly rollCount?: number;
}

/**
 * `enqueue-reveal-hazards-choice` — Here Is a Snake! (dm-137): enqueues the
 * `reveal-hazards-choice` pending resolution (actor = the opponent of the
 * playing player) on the `play-target: "company"` target, scoped
 * `company-mh-subphase` to that company. See the resolution's own doc comment
 * ({@link import('./pending.js').PendingResolution}) for the full flow — the
 * opponent reveals any number of hazard cards from hand (or taps and reveals
 * a face-down agent instead), and on `pass` an `only-revealed-hazards-on-company`
 * constraint restricts them to the revealed set for the rest of the company's
 * movement/hazard phase.
 */
export interface EnqueueRevealHazardsChoiceAction extends TriggeredActionBase {
  readonly type: 'enqueue-reveal-hazards-choice';
}

/** `sequence` — run an ordered list of sub-applies on the state each produces. Recursive. */
export interface SequenceAction extends TriggeredActionBase {
  readonly type: 'sequence';
  /** The ordered sub-applies. */
  readonly apps?: readonly TriggeredAction[];
}

/** `cancel-chain-entry` — negate a chain entry (most-recent unresolved hazard, or a skill-matched target). */
export interface CancelChainEntryAction extends TriggeredActionBase {
  readonly type: 'cancel-chain-entry';
  /** Which entry to negate. */
  readonly select?: 'most-recent-unresolved-hazard' | 'target';
  /** For `select: 'target'`: restrict to entries whose source has a matching skill effect. */
  readonly requiredSkill?: string;
  /**
   * For `select: 'target'`: generic filter over the target chain entry,
   * evaluated against `{ target: { cardType, eventType, name }, declaredBy:
   * { alignment } }`. Used by Ire of the East (wh-24) to target "one minion
   * short-event played by a Fallen-wizard earlier in the same chain".
   */
  readonly filter?: Condition;
  /**
   * When true, the spent event card is removed from the game (moved from its
   * player's discard pile to their out-of-play pile) as its own chain entry
   * resolves un-negated — "Remove this card from the game" (wh-24).
   */
  readonly removeFromGame?: boolean;
  /**
   * For `select: 'target'`: gate the cancel on a 2d6 roll instead of applying
   * it unconditionally. When set, `resolveEntry` rolls 2d6 as this card's own
   * chain entry resolves and only negates the target entry when the total is
   * ≥ `threshold` (a failed roll still discards this card normally — the
   * target is untouched). Used by Wrath of the West (le-151): "Make a
   * roll—if the result is greater than 6, the event is canceled and
   * discarded" (threshold 7 = "greater than 6").
   */
  readonly threshold?: number;
}

/**
 * `company-tap-characters` — on-guard-reveal apply verb (Heedless Revelry
 * le-114). When the revealed card's chain entry resolves during the site
 * phase, taps every untapped character in the active company matching
 * `filter` (context `{ target: { race, mind, name, skills, cardType } }`).
 * No mind threshold applies.
 */
export interface CompanyTapCharactersTriggeredAction extends TriggeredActionBase {
  readonly type: 'company-tap-characters';
  /** Optional per-character filter; only matching characters are tapped. */
  readonly filter?: Condition;
}

/**
 * `reveal-hand-cards-per-character` — `on-event: "attack-not-canceled"` apply
 * verb (Crebain tw-25). At combat finalization, `min(defending company's
 * character count, defender's hand size)` random cards are picked from the
 * defending player's hand (seeded shuffle, same pattern as
 * `reveal-remove-from-discard`) and revealed via `revealInstances` — the
 * cards stay in the defender's hand, only their identity becomes public.
 * Zero defending characters (a lone-avatar company already eliminated, or
 * some other edge case) reveals nothing. Used by Crebain (tw-25): "After the
 * attack, the defender must reveal one random card from his hand for each
 * character in the defending company."
 */
export interface RevealHandCardsPerCharacterAction extends TriggeredActionBase {
  readonly type: 'reveal-hand-cards-per-character';
}

/**
 * `company-return-to-origin` — `on-event: "attack-strike-successful"` apply
 * verb (Fell Turtle tw-34). Fires in `finalizeCombat` when at least one of
 * this creature's own strikes wounded or eliminated a defender during the
 * defending company's movement/hazard phase: forces the company back to its
 * site of origin (CoE rule 2.IV.4 — same mechanism as the short-event
 * `company-return-to-origin` card effect and `agent-discard-return-to-origin`).
 * Type-only marker; no fields beyond `type`.
 */
export interface CompanyReturnToOriginTriggeredAction extends TriggeredActionBase {
  readonly type: 'company-return-to-origin';
}

/**
 * `counter-cancel-attack` — dice-check onPass verb for Black Vapour (ba-14).
 * Negates the chain entry named by the resolution's `targetInstanceId` (the
 * opponent's cancel-attack) so the attack survives, and adds {@link prowessBonus}
 * to the current attack's prowess (`combat.strikeProwess`). Runs only in the
 * dice-check resolution context ({@link applyDiceCheckBranch}).
 */
export interface CounterCancelAttackTriggeredAction extends TriggeredActionBase {
  readonly type: 'counter-cancel-attack';
  /** Prowess added to the surviving attack on success. */
  readonly prowessBonus?: number;
}

/**
 * `site-entry-attack` — dice-check onFail verb for a
 * {@link SiteEntryRollAttackEffect} (Doubled Vigilance dm-51). Initiates the
 * effect's attack against the company currently resolving its site phase,
 * while the site step sits at `site-entry-attack` — i.e. before any of the
 * site's automatic-attacks. The attack is not an automatic-attack: it carries
 * no site keying, so automatic-attack modifiers and the §3.II site-type
 * detainment branch do not apply to it.
 */
export interface SiteEntryAttackAction extends TriggeredActionBase {
  readonly type: 'site-entry-attack';
  /** The attack to initiate. */
  readonly attack: SiteEntryAttackSpec;
}

/** `set-company-special-movement` — flag a special-movement mode (Gwaihir flight, Eagle-mounts flight, Paths of the Dead, Belegaer sea-crossing) on the target company. */
export interface SetCompanySpecialMovementAction extends TriggeredActionBase {
  readonly type: 'set-company-special-movement';
  /** The special-movement mode. */
  readonly specialMovement?: 'gwaihir' | 'eagle-mounts' | 'paths-of-the-dead' | 'belegaer';
}

/** `shuffle-deck-top` — shuffle the top `count` cards of a player's play deck in place. */
export interface ShuffleDeckTopAction extends TriggeredActionBase {
  readonly type: 'shuffle-deck-top';
  /** How many top cards to shuffle (default 5). */
  readonly count?: number;
  /** Whose deck — `'source-owner'` (default) or `'opponent'`. */
  readonly toOwner?: 'source-owner' | 'opponent' | 'defender';
}

/** `increment-company-extra-region-distance` — add to the bearer's company `extraRegionDistance` (Cram). */
export interface IncrementCompanyExtraRegionDistanceAction extends TriggeredActionBase {
  readonly type: 'increment-company-extra-region-distance';
  /** How much to add. */
  readonly amount?: number;
}

/** `modify-current-strike-prowess` — apply a numeric bonus to the current strike's prowess. */
export interface ModifyCurrentStrikeProwessAction extends TriggeredActionBase {
  readonly type: 'modify-current-strike-prowess';
  /** Prowess bonus. */
  readonly value?: number;
}

/** `transform-site` — override all versions of the bearer's current site's type, optionally with a bespoke attack (Vile Fumes). */
export interface TransformSiteAction extends TriggeredActionBase {
  readonly type: 'transform-site';
  /** The {@link SiteType} all versions of the site are overridden to. */
  readonly overrideType?: string;
  /** The bespoke automatic-attack replacing the site's printed attacks. */
  readonly attack?: import('./cards-sites.js').BespokeAutoAttack;
}

/** `untap-site` — untap the bearer's company's current site; type-only marker. */
export interface UntapSiteAction extends TriggeredActionBase {
  readonly type: 'untap-site';
}

/**
 * `lock-company-movement` — the company named by the enclosing `dice-check`
 * resolution's `targetCompanyId` may not move this turn: its planned
 * destination (if any) is cancelled and returned to the location deck, and a
 * turn-scoped `company-cannot-move` constraint is installed. Used as the
 * `onFail` verb of the {@link CompanyMovementRollEffect} roll (Siege tw-87).
 * Type-only marker.
 */
export interface LockCompanyMovementAction extends TriggeredActionBase {
  readonly type: 'lock-company-movement';
}

/**
 * `split-into-own-company` — the `onFail` verb of a per-character mind-roll
 * `dice-check` (Turning Hope to Despair as-41). Peels `ctx.targetCharacterId`
 * off `ctx.targetCompanyId` into his own new company sharing the same site
 * path (or, if he was alone, flags his own company for one extra separate
 * M/H phase) via the shared `splitCharacterOffCompany` helper
 * (`reducer-utils.ts`) — the generalized, auto-rejoining sibling of Left
 * Behind's `applyLeftBehindSplit`. Type-only marker.
 */
export interface SplitIntoOwnCompanyAction extends TriggeredActionBase {
  readonly type: 'split-into-own-company';
}

/**
 * `cancel-current-attack` — cancel the combat currently in `state.combat`
 * (delegates to the shared `resolveCancelAttackEntry`). Used as the `onPass`
 * verb of a `dice-check` enqueued by a roll-to-cancel ability (Going Ever
 * Under Dark ba-37). Type-only marker.
 */
export interface CancelCurrentAttackAction extends TriggeredActionBase {
  readonly type: 'cancel-current-attack';
}

/**
 * `traitor-attack` — the apply of an `on-event: corruption-check-failed`
 * trigger (Traitor tw-105). When any character fails a corruption check, the
 * failed character "becomes a traitor": an attack is immediately made against
 * a character in the traitor's company, chosen by the player who does NOT
 * control that company (`attacker-chooses-defenders` machinery). The attack's
 * prowess is the traitor's printed prowess plus `prowessBonus`, its race is
 * the traitor's race (CRF), it has no body (no creature body check), and any
 * resulting character body check is modified by `bodyCheckModifier`.
 *
 * Firing consumes the source card: every copy carrying this trigger (both
 * players' `cardsInPlay`) is discarded on the one failed check, and duplicates
 * have no extra effect (CRF: "Two instances in play of Traitor have no extra
 * effect and are both discarded with the next failed corruption check").
 *
 * If a combat is already active when the check fails (e.g. a Corpse-candle
 * pre-defense check), the attack is queued as a `traitor-attack-queued`
 * constraint and initiated by `finalizeCombat` right after the current attack
 * — matching the CRF timing ("the first declared action in a chain of effects
 * immediately following the chain of effects that contains the corruption
 * check").
 */
export interface TraitorAttackAction extends TriggeredActionBase {
  readonly type: 'traitor-attack';
  /** Added to the traitor's printed prowess to form the attack prowess (default 10). */
  readonly prowessBonus?: number;
  /** Number of strikes the attack delivers (default 1). */
  readonly strikes?: number;
  /** Modifier applied to any character body check the attack produces (default 0). */
  readonly bodyCheckModifier?: number;
}

/**
 * `transfer-item-free` — a reactive `play-option` apply (Pledge of Conduct,
 * td-144) available while a corruption check is pending against a character
 * in a diplomat's company. Moves one item the checked character bears to
 * another character in the same company with no follow-up corruption check
 * for the transfer itself — unlike the ordinary organization-phase
 * `transfer-item` action (CoE 2.II.5), which always enqueues one.
 *
 * The option itself names no item or destination: `reactiveCorruptionCheckPlays`
 * (legal-actions/pending.ts) enumerates one `play-short-event` action per
 * (borne item, other company member) pair, carrying the choice on the
 * action's `transferItemInstanceId` / `transferToCharacterId` fields. The
 * reducer reads those fields directly; this apply payload carries no data of
 * its own.
 */
export interface TransferItemFreeAction extends TriggeredActionBase {
  readonly type: 'transfer-item-free';
}

/**
 * Re-parents the source card (a resource permanent-event currently sitting
 * as a plain item in its bearer's `CharacterInPlay.items`) onto a chosen
 * item, using the `targetCardId` carried by the granting action — the same
 * `attachedToItem` binding Barrow-blade (dm-119) gets at play time, but
 * applied mid-game via a `grant-action` instead. The source card is removed
 * from the bearer's `items` and appended to the controller's `cardsInPlay`
 * with `attachedToItem` set, keeping its current tapped/untapped status (no
 * card instance is lost — it simply changes zones). Any `stat-modifier`
 * flagged `activeWhileAttachedToItem` on its definition then flows to the
 * target item's bearer via the existing item-attached-events collection path
 * (`effects/resolver.ts`).
 *
 * Used by Map to Mithril (td-133): "the bearer may tap himself and place
 * this card with a non-unique weapon in his company. This gives the weapon
 * a +3 prowess bonus."
 */
export interface ReattachToItemAction extends TriggeredActionBase {
  readonly type: 'reattach-to-item';
}

/**
 * Marks the grant-action's source item `restored` (a persistent flag on its
 * {@link ItemInPlay} entry, cleared only if the item leaves play). Used by the
 * Reforging family of hoard items — Horn of Defiance (td-183), Ringil
 * (td-184), Belegennon (td-185) — whose text reads "A stored Reforging may be
 * placed with this item to 'restore' it." The grant-action's own cost
 * (`discard: "named-stored-card"`, `discardCardName: "Reforging"`) consumes
 * the stored Reforging; this apply flips the flag. A `restored-item-stats`
 * effect on the same item then reads the flag to override its printed
 * marshalling/corruption points once restored (`recompute-derived.ts`).
 */
export interface RestoreItemAction extends TriggeredActionBase {
  readonly type: 'restore-item';
}

/**
 * A triggered effect's apply payload — a fully discriminated, recursive union.
 * Every verb has its own member interface keyed by the `type` discriminant, so
 * reading any payload field forces an `apply.type === '<verb>'` narrow. (P05
 * completed: the former all-optional `LegacyTriggeredAction` catch-all is gone.)
 */
export type TriggeredAction =
  | ForceCheckAction
  | ForceDiscardStageCardAction
  | ForceCheckAllCompanyAction
  | EnqueueCorruptionCheckAction
  | EnqueueBodyCheckAction
  | WhipDisciplineAction
  | EnqueueGoodwillAttemptAction
  | EnqueueSiteWoundRollsAction
  | MaladyWithoutHealingAction
  | MountSlainAction
  | RollCheckAction
  | RollThenApplyAction
  | FactionInfluenceUntetheredAction
  | UnEliminateCreatureAction
  | WinConditionRollAction
  | WinGameAction
  | AddConstraintAction
  | RemoveConstraintAction
  | SetSitePhaseFlagAction
  | MoveEffect
  | DiscardCharacterAction
  | EliminateCharacterAction
  | EliminateCapturedCharacterAction
  | WoundOrEliminateAction
  | EnqueueOpponentEliminationRollAction
  | DiscardTargetCharacterAction
  | ForceDiscardOneCompanyItemAction
  | RandomDiscardHandAction
  | SetCharacterStatusAction
  | HealTargetCharacterAction
  | ReturnCharacterToHandAction
  | TapOneCharacterAction
  | PlaceItemOnCharacterAction
  | PlaceSourceWithItemAction
  | DiscardNamedInPlayAction
  | DiscardTargetInPlayAction
  | DiscardBearerCorruptionAction
  | DrawCardsEffect
  | SauronSideboardFetchAction
  | PeekOpponentHandAction
  | RevealOpponentHandAction
  | DiscardTargetCorruptionCardAction
  | OfferCorruptionRemovalAtSiteAction
  | RollDiscardOpponentNonUniqueAllyAction
  | OfferCharJoinAttackAction
  | OfferResourcePlayAction
  | OfferRestoreCharacterAction
  | EnqueuePendingFetchAction
  | EnqueueRingPlayOfferAction
  | EnqueueGoldRingTestAction
  | EnqueueRevealHazardsChoiceAction
  | SequenceAction
  | CancelChainEntryAction
  | CompanyTapCharactersTriggeredAction
  | RevealHandCardsPerCharacterAction
  | CompanyReturnToOriginTriggeredAction
  | CounterCancelAttackTriggeredAction
  | SiteEntryAttackAction
  | SetCompanySpecialMovementAction
  | ShuffleDeckTopAction
  | IncrementCompanyExtraRegionDistanceAction
  | ModifyCurrentStrikeProwessAction
  | TransformSiteAction
  | UntapSiteAction
  | LockCompanyMovementAction
  | SplitIntoOwnCompanyAction
  | CancelCurrentAttackAction
  | TraitorAttackAction
  | TransferItemFreeAction
  | ReattachToItemAction
  | RestoreItemAction;

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
  /**
   * When true this option needs **no** target, even though the card also
   * carries a {@link PlayTargetEffect} for its other options. The hazard
   * short-event emitter offers it exactly once (no `targetCharacterId` on the
   * action) instead of once per candidate target, and its `when` is evaluated
   * against a card-level context (`{ opponent: { stagePoints, stageCardCount },
   * inPlay }`) rather than a per-target one.
   *
   * Used by Echoes of the Song (wh-17): the "opponent discards a stage card"
   * mode is untargeted while the "Alternatively, force a target character to
   * make a corruption check" mode is played on a character.
   */
  readonly untargeted?: boolean;
  /**
   * For an {@link untargeted} option whose `apply` acts on one specific card
   * instance (rather than on a character or on nothing), the pool the candidate
   * instance is drawn from. The hazard short-event emitter enumerates that pool,
   * filters it by the apply's own `filter`, and emits one `play-hazard` action
   * per candidate carrying `optionTargetInstanceId` — so the target is declared
   * when the card is played, as MECCG requires, not after it resolves.
   *
   * - `own-discard` — the playing player's discard pile.
   * - `own-in-play` — the playing player's `cardsInPlay` (e.g. a hazard creature
   *   currently in play in its permanent-event mode).
   * - `opponent-in-play` — the opponent's `cardsInPlay` (e.g. a resource
   *   long-event the hazard player forces to be discarded).
   * - `eliminated` — every terminal off-board pile of both players: each
   *   player's marshalling-point pile (`killPile`, i.e. trophies) and
   *   `outOfPlayPile`.
   */
  readonly candidates?: 'own-discard' | 'own-in-play' | 'opponent-in-play' | 'eliminated';
  /**
   * The event mode this option is played as, when it differs from the card's
   * printed `eventType`. Returned Beyond All Hope (as-35) is a short-event whose
   * third mode is played "as a permanent-event"; setting this to
   * `permanent-event` makes the emitter stamp `altEventMode` on the action so
   * the reducer routes the play down the permanent-event chain path (the card
   * rides the chain instead of being pre-discarded).
   */
  readonly eventMode?: 'short-event' | 'permanent-event';
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
 * A from-hand combat event (permanent-event) the defender plays to make a
 * named character "flee" from a strike he would likely lose. Playable during
 * the strike sequence when the current strike is assigned to a character with
 * {@link characterName} (owned by the defender) and the strike's prowess is
 * strictly higher than that character's effective prowess.
 *
 * On play the current strike is canceled, the named character taps (if
 * untapped), and the card enters play carrying a one-shot `skip-next-untap`
 * constraint on that character. The next time the character would untap during
 * the untap phase he stays tapped instead, the constraint is consumed, and this
 * card is discarded. Pair with a `duplication-limit` to model "Cannot be
 * duplicated".
 *
 * Used by Fled into Darkness (ba-18): "Playable before the strike sequence on
 * The Balrog facing a strike with a prowess higher than his. The strike is
 * canceled and The Balrog taps, if untapped. The next time The Balrog would
 * otherwise untap, make him tapped instead and discard this card."
 */
export interface FleeFromStrikeEffect extends EffectBase {
  readonly type: 'flee-from-strike';
  /** Name of the character that must be facing the current strike (e.g. "The Balrog"). */
  readonly characterName: string;
}

/**
 * A from-hand Wizard-only permanent-event spell played after strikes are
 * assigned against the Wizard's company (not company-vs-company combat): all
 * strikes of the attack automatically fail (as if the character defeated
 * each), with a `+3` modifier to any resulting creature body checks. The
 * Wizard is then discarded ("becomes unrevealed") along with any non-item,
 * non-follower cards he controls (allies, attached hazards); his followers
 * disperse to general influence as normal; his items are placed off to the
 * side with this card (MEAS §1) and still count as in play.
 *
 * If the Wizard is later put back into play by any other means, his items
 * return to him and this card is placed with him, granting +1 prowess, body,
 * and direct influence for as long as it remains attached. Cannot be
 * duplicated on a given Wizard (enforced by tracking the sacrificed Wizard's
 * instance ID on the host `CardInPlay` entry — see `sacrifice-of-form.ts`).
 * After being played, the controller may not reveal a different Wizard
 * avatar (`PlayerState.wizardSacrificed`, mirroring the Ringwraith
 * `ringwraithReturnedToHand` restriction) — the opponent-may-not-play-it
 * clause needs no code since a player can never play a card from an
 * opponent's discard pile.
 *
 * Mechanically reuses `CombatState.forcedStrikeDefeat` /
 * `forcedDefeatBodyCheckModifier` (Liquid Fire wh-52's mechanism) for the
 * strike-failure + body-check-bonus half, and `set-aside.ts` (MEAS §1) for
 * holding the Wizard's items. Used by Sacrifice of Form (tw-321).
 */
export interface SacrificeOfFormEffect extends EffectBase {
  readonly type: 'sacrifice-of-form';
}

/**
 * On-play roll that untaps the target character's company's current site.
 *
 * Carried by a resource permanent-event played on a character at a site. When
 * the card enters play (`resolvePermanentEvent`), a generic {@link
 * PendingResolution} `dice-check` is enqueued: the card player rolls 2d6, adds
 * the target character's effective mind, plus {@link wizardBonus} when the
 * character is a Wizard. If the modified total is strictly greater than {@link
 * threshold}, the `untap-site` onPass verb untaps the site the character's
 * company occupies. The roll surfaces as its own explicit `resolve-dice-check`
 * action so the die roll is a distinct, replayable step.
 *
 * Used by Fireworks (dm-130): "Make a roll and add the mind of the sage (+10 if
 * a Wizard) — if the result is greater than 12, the site untaps."
 */
export interface RollUntapSiteEffect extends EffectBase {
  readonly type: 'roll-untap-site';
  /** The modified 2d6 total must be strictly greater than this to untap the site. */
  readonly threshold: number;
  /** Bonus added to the roll when the target character is a Wizard. */
  readonly wizardBonus: number;
}

/**
 * Global untap-phase restriction, carried by a hazard long-event while it sits
 * in either player's `cardsInPlay`. Every character of the untapping (active)
 * player whose race is not Wizard, and whose company's current site is not
 * one of {@link exemptSiteTypes}, does not untap normally: instead of the
 * plain tapped→untapped transition in `performUntap`, a generic `dice-check`
 * is enqueued per such character — 2d6 + the character's effective mind,
 * strictly greater than {@link threshold} untaps him via the `set-character-
 * status` onPass verb. Rolling has no downside (no `onFail` penalty), so the
 * printed "may instead make a roll" is modeled as an always-taken roll rather
 * than an interactive decline.
 *
 * When {@link noEffectOnMinion} is set, the whole restriction is skipped for
 * an untapping player whose alignment is Ringwraith (CoE "minion player" —
 * the `ahunt-attack`/`faction-influence-restriction` precedent).
 *
 * Used by Worn and Famished (td-89): "Each non-Wizard character that is not
 * in a Haven [{H}], Free-hold [{F}], or Border-hold [{B}] does not untap
 * normally during his untap phase. Character's player may instead make a
 * roll adding his mind. If the result is greater than 12, he untaps. This
 * card has no effect on a minion player."
 */
export interface UntapMindRollEffect extends EffectBase {
  readonly type: 'untap-mind-roll';
  /** The modified 2d6 total must be strictly greater than this to untap. */
  readonly threshold: number;
  /** Site types where an affected character's company being present exempts him from the restriction. */
  readonly exemptSiteTypes: readonly SiteType[];
  /** When true, the restriction has no effect for an untapping player with alignment `ringwraith`. */
  readonly noEffectOnMinion?: boolean;
}

/**
 * On-play marker that installs a one-shot `skip-next-untap` active constraint on
 * the target character (the same constraint kind Fled into Darkness ba-18 uses):
 * the next time the character would otherwise untap he stays tapped once, then
 * the source card is discarded and the constraint is cleared (`performUntap` in
 * `reducer-untap.ts`, which also scans character-borne cards). The source card
 * may sit either in the owner's `cardsInPlay` (ba-18) or attached to the target
 * character's items (a resource permanent-event, dm-130).
 *
 * Used by Fireworks (dm-130): "The next time the sage would otherwise become
 * untapped make him tapped instead and discard this card."
 */
export interface SkipNextUntapOnPlayEffect extends EffectBase {
  readonly type: 'skip-next-untap-on-play';
}

/**
 * An attached resource (currently an ally) that its controller "may return to
 * hand" under listed triggers, instead of being discarded.
 *
 * Two triggers are supported:
 * - `organization` — during the owning player's organization phase, the player
 *   may voluntarily return the card to hand (a legal action emitted by the
 *   organization-phase computer; the reducer detaches it and moves it to the
 *   owner's hand).
 * - `controller-leaves-play` — when the controlling character leaves active
 *   play (elimination/discard), the card returns to its owner's hand rather
 *   than to the discard pile (`discardCharacter` routes it accordingly).
 *
 * Used by Radagast's Black Bird (wh-114): "You may return … to your hand:
 * during your organization phase or if its controlling character leaves active
 * play."
 */
export interface ReturnToHandEffect extends EffectBase {
  readonly type: 'return-to-hand';
  /**
   * The triggers under which the card may/should return to hand.
   *
   * - `organization` — offered as a `return-attached-to-hand` action during
   *   the owner's organization phase (optional; the player chooses).
   * - `controller-leaves-play` — automatic, when the controlling character
   *   leaves active play the card goes to hand rather than the discard pile.
   * - `replaced-by-keyword` — automatic, when another card carrying
   *   {@link replacedByKeyword} is placed on the same character. Models the
   *   Radagast Shapeshifter forms (wh-112/115/116): "Return this card to your
   *   hand when you play another Shapeshifter card" — taking a new shape sheds
   *   the old one instead of stacking forms.
   */
  readonly during: readonly ('organization' | 'controller-leaves-play' | 'replaced-by-keyword')[];
  /**
   * For the `replaced-by-keyword` trigger: the keyword whose arrival on the
   * same character displaces this card (e.g. `"shapeshifter"`). The most
   * recently placed carrier of the keyword stays; every earlier one that
   * declares this trigger returns to its owner's hand.
   */
  readonly replacedByKeyword?: string;
}

/**
 * The attacking player assigns strikes to defending characters, instead
 * of the defender assigning them. Example: Cave-drake.
 *
 * Without {@link scope} the rule is **self-bound**: it belongs to the creature
 * card carrying it and applies only when that creature attacks.
 *
 * With `scope: "all-attacks"` the rule instead becomes **global** while the
 * carrying card sits in either player's `cardsInPlay`: every attack — hazard
 * creature *and* site automatic-attack — whose race satisfies {@link when}
 * hands strike assignment to the attacker. Backs the permanent-event half of
 * Alatar the Hunter (as-7): "As a permanent-event, all Maia attacks: … and
 * attacker chooses defending characters." The `when` condition is matched
 * against a context exposing `attack.creatureRace` (the attacking creature's
 * normalized {@link Race}), the same vocabulary used by the global
 * `body-check-modifier` (`scope: "all-attacks"`).
 */
export interface CombatAttackerChoosesDefendersEffect extends EffectBase {
  readonly type: 'combat-attacker-chooses-defenders';
  /**
   * `"all-attacks"` turns the self-bound creature rule into a game-wide one
   * carried by an in-play permanent-event. Absent → the printed creature rule.
   */
  readonly scope?: 'all-attacks';
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
  /**
   * When true, only **wounded** (inverted) characters face a strike:
   * `strikesTotal = wounded characters` and one strike is pre-assigned to each
   * wounded character. Unwounded characters are never assigned a strike. Card
   * text is "Each wounded character faces one strike" (e.g. Carrion Feeders
   * ba-11). Mutually exclusive with `excludeAvatars`.
   */
  readonly onlyWounded?: boolean;
}

/**
 * Attack-wide body-check modifier carried by a hazard creature: `value` is
 * added to every character body-check roll this attack produces (on top of
 * the already-wounded +1 and any item modifiers). Positive values make
 * elimination more likely. Threaded into `CombatState.bodyCheckModifier` at
 * combat initiation and consumed in `handleBodyCheckRoll`. Card text is
 * "All body checks resulting from successful strikes are modified by an
 * additional +1" (e.g. Carrion Feeders ba-11). (implemented in
 * `chain-reducer.ts`, `combat-actions.ts`)
 */
export interface CombatBodyCheckModifierEffect extends EffectBase {
  readonly type: 'combat-body-check-modifier';
  /** Amount added to every character body-check roll from this attack. */
  readonly value: number;
}

/**
 * The creature's own body is adjusted by `value` for each defending company
 * member with the given {@link skill} (their effective skills, including
 * `grant-skill`/`override-skills` contributions — see
 * {@link getEffectiveSkills}). Self-bound: it belongs to the creature card
 * carrying it and is resolved once at combat initiation from the printed
 * `body`, floored at 0. Card text is "Each ranger in attacked company lowers
 * [creature]'s body by 2" (e.g. Little Snuffler dm-108). (implemented in
 * `chain-reducer.ts`)
 */
export interface CombatBodyPerDefenderSkillEffect extends EffectBase {
  readonly type: 'combat-body-per-defender-skill';
  /** The skill to count among defending company members (e.g. `"ranger"`). */
  readonly skill: string;
  /** Amount added to the creature's body per matching company member (negative to lower). */
  readonly value: number;
}

/**
 * The defending company may tap an untapped character to cancel one of this
 * attack's strikes against a wounded character. Pairs with
 * `combat-one-strike-per-character: onlyWounded` (every strike is against a
 * wounded character). On combat initiation the engine opens a `cancel-by-tap`
 * sub-phase (`CombatState.cancelStrikeAgainstWounded`): each untapped company
 * character may tap to remove one pre-assigned strike (defender chooses which
 * wounded character to protect), or pass to proceed to resolution. Card text
 * is "Each untapped character in the company may tap to cancel a strike
 * against a wounded character" (e.g. Carrion Feeders ba-11). Presence of this
 * effect is the entire payload. (implemented in `chain-reducer.ts`,
 * `legal-actions/combat.ts`, `combat-cancel.ts`)
 */
export interface CombatTapToCancelStrikeEffect extends EffectBase {
  readonly type: 'combat-tap-to-cancel-strike';
}

/**
 * Each defending character's prowess for this attack is replaced by their
 * mind attribute value instead of their normal combat prowess. Used by
 * Neeker-breekers: "His prowess against such a strike is equal to his mind
 * attribute." Avatar characters (mind === null) are never assigned strikes
 * when this effect is paired with `combat-one-strike-per-character:
 * excludeAvatars`. Status modifiers (tapped, wounded) and support bonuses
 * still apply on top of the mind base.
 * Use `play-flag: 'combat-defender-prowess-from-mind'` on creature cards.
 */

/**
 * Marks the attack as detainment (see CoE §3.II). A detainment attack
 * taps characters instead of wounding them and suppresses the character
 * body-check. Presence of this effect is the entire payload beyond
 * {@link awardsKillMp} below.
 *
 * Most detainment status is computed at combat-initiation time from the
 * defending player's alignment and the attack's keying (rules 3.II.2 /
 * 3.II.4); this effect covers the residual "or depends on an effect of
 * the attack itself" clause of rule 3.II.2.
 */
export interface CombatDetainmentEffect extends EffectBase {
  readonly type: 'combat-detainment';
  /**
   * When `true`, a defeated creature attack still awards its printed
   * kill-MP instead of being zeroed by rule 3.II.3. Used by creatures
   * whose own printed text produces the "tap instead of wound, no body
   * check" outcome without the card actually carrying the "detainment"
   * keyword (per the glossary, "detainment" is a keyword that must
   * appear on the card) — e.g. Neeker-breekers (tw-493), whose text reads
   * "...is only tapped instead—no body checks are made" without ever
   * using the word "detainment". Omit (or set `false`) for attacks that
   * are detainment per the keyword/§3.II rules, where 3.II.3 applies
   * normally.
   */
  readonly awardsKillMp?: boolean;
}

/**
 * After each strike of this attack resolves, every facing character whose
 * mind attribute is less than or equal to the strike's prowess must tap if
 * it is still untapped. Wounded characters (now inverted) and avatar
 * characters (mind === null) are unaffected; a strike that is canceled never
 * resolves, so it never triggers the tap. Card text is "Any character facing
 * a strike whose mind is equal to or lower than the strike's prowess must tap
 * if untapped following the strike (unless the strike is canceled)"
 * (e.g. Wisp of Pale Sheen, dm-113). Presence of this effect is the entire
 * payload — the threshold is the attack's strike prowess, read at resolution
 * time. (implemented in `reducer-combat.ts`)
 */
export interface CombatTapLowMindEffect extends EffectBase {
  readonly type: 'combat-tap-low-mind';
}

/**
 * A successful strike of this attack does not wound the defending character;
 * instead an item must be discarded (defender's choice). Self-bound to the
 * creature — threaded onto `CombatState.strikeEffect` at combat initiation
 * and resolved by the generic `strikeEffect` path in `combat-strike.ts`
 * shared with the agent-attack precedent (Taladhan dm-25, An Article Missing
 * dm-43): the strike still "hits" (cancelable, countable) but its result is
 * replaced with an item discard via the `discard-item-from-company` combat
 * phase; detainment attacks never trigger it.
 *
 * - `'discard-item'`: the discard pool is every item held anywhere in the
 *   defending **company**. Card text is "For each successful strike, an item
 *   held by the defending company must be discarded (defender's choice); the
 *   defending character is not harmed" (e.g. Thief tw-102).
 * - `'discard-item-character'`: the discard pool is scoped to items borne by
 *   the **struck character** only. Card text is "For each successful strike,
 *   an item the defending character bears must be discarded (defender's
 *   choice); he is not harmed" (e.g. Pick-pocket tw-79/tw-80).
 */
export interface CombatStrikeEffectEffect extends EffectBase {
  readonly type: 'combat-strike-effect';
  readonly strikeEffect: 'discard-item' | 'discard-item-character';
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
 * - `playable-as-event` — a hazard creature that may alternatively be
 *   played as an event, or an event that may alternatively be played as
 *   a creature (e.g. the Nazgûl, the "manifestation" hunter creatures,
 *   Mouth of Sauron). Such dual creature/event hazards count as half a
 *   creature for the 12-creature deck-construction requirement
 *   (CoE rule 1.5.1 / CRF 22).
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
 * - `tap-bearer-on-play` — for an item-targeting permanent event
 *   (`play-target` target `item`), taps the character bearing the targeted
 *   item when the card resolves from the chain (e.g. Barrow-blade dm-119:
 *   "Tap the bearer of a Dagger of Westernesse … and play this with the
 *   Dagger").
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
 * - `playable-at-tapped-site` — the card (ally or faction) may be played at a
 *   site that is already tapped (overrides the default "allies/factions require
 *   an untapped site" rule). Used by Noble Steed, which is playable at "tapped
 *   or untapped" non-Haven sites in its region list, and by Snaga-hai (le-286),
 *   which is playable at "any tapped or untapped Shadow-hold".
 * - `no-tap-on-play` — playing this ally taps neither the controlling character
 *   nor the site (overrides the default "an ally taps its controller and the
 *   site"). Combined with a wizard-specific keyword, models "X may play this
 *   ally … and need not tap himself or the site to do so." Used by Radagast's
 *   Black Bird (wh-114). A controlling character may therefore be tapped when
 *   it plays the ally (it does not need to be untapped, since it never taps).
 * - `influences-factions` — this ally "may attempt to influence factions as if
 *   he were a character" (CoE: allies are normally not influencers). A company
 *   ally carrying this flag with a printed `directInfluence` is offered as a
 *   faction-influence source alongside untapped characters; it taps for the
 *   attempt exactly as a character would. Used by Radagast's Black Bird (wh-114).
 * - `block-company-joins` — while this permanent event is in play bound to a
 *   company (`CardInPlay.companyId`), no ally and no direct-influence follower
 *   may join that company. On play the company's existing allies and follower
 *   characters are discarded. Used by Fell Rider (le-183).
 * - `no-allies-in-company` — while an item / attached permanent-event carrying
 *   this flag is on a character in a company, no ally may be played to that
 *   company. (Allies are only ever played during the site phase, so this
 *   realizes "no allies in his company outside the organization phase" without a
 *   phase gate.) Used by Flame of Udûn (ba-58).
 * - `bearer-cannot-untap-until-stored` — when this storable permanent event is
 *   attached to a character on play (taps the character via a play-target tap
 *   cost or a direct storable-at attachment, or is assigned a bearer after a
 *   triggered attack), the bearer may not untap during the untap phase until
 *   the card is stored. Without this flag the character taps on play but
 *   untaps normally next turn. Card text gate: "the character may not untap
 *   until this card is stored." Carried by To Satisfy the Questioner (le-246),
 *   That's Been Heard Before Tonight (le-241), Rescue Prisoners (tw-315), and
 *   The Windlord Found Me (dm-164); deliberately ABSENT on That Ain't No
 *   Secret (le-240), whose text omits the untap lock.
 * - `rescues-prisoners` — this card *is* the rescue: successfully playing and
 *   keeping it frees the characters its company came for. Carried by Rescue
 *   Prisoners (tw-315). Cards that key on a rescue having happened read this
 *   flag rather than naming tw-315 — Pass the Doors of Dol Guldur (dm-154)
 *   opens its tap window "during the same site phase the company successfully
 *   plays Rescue Prisoners at Dol Guldur". Marked when a bearer is assigned
 *   (the card is kept), never on the declined/discarded branch.
 * - `no-transfer` — this item may never be offered by `transferItemActions`
 *   (CoE 2.II.5, organization-phase item transfer between characters at the
 *   same site). Used by Ent-draughts (tw-227): "This item may not be …
 *   transferred".
 * - `no-store` — this item may never be offered by `storeItemActions` (CoE
 *   2.II.4, storing an item at a Haven for marshalling points), overriding
 *   the default "any regular/special item is storable at a Haven" rule. Used
 *   by Ent-draughts (tw-227): "This item may not be … stored" and The One
 *   Ring (tw-347, le-326 — rule g.sto.1: "The One Ring cannot be stored").
 */
export type PlayFlag = 'home-site-only' | 'playable-as-resource' | 'playable-as-hazard' | 'playable-as-event' | 'no-hazard-limit' | 'not-starting-character' | 'no-starting-company' | 'tapped-site-only' | 'untapped-site-required' | 'allow-store-eot' | 'tap-site-on-play' | 'tap-character-on-play' | 'tap-bearer-on-play' | 'healing-affects-all' | 'no-direct-influence' | 'no-attack' | 'no-attack-site-keyed' | 'playable-at-tapped-site' | 'no-auto-untap' | 'reduce-attacks-to-one' | 'combat-defender-prowess-from-mind' | 'can-use-palantir' | 'buddy-play' | 'block-company-joins' | 'no-allies-in-company' | 'bearer-cannot-untap-until-stored' | 'grants-followers' | 'hazard-agent-only' | 'no-tap-on-play' | 'influences-factions' | 'bearer-cannot-use-items' | 'bearer-cannot-move' | 'agent-may-move-to-haven' | 'remove-from-game' | 'rescues-prisoners' | 'no-transfer' | 'no-store';

/**
 * Declares a closed play-flag keyword on a card. See {@link PlayFlag}
 * for the set of recognized flags and their semantics. Presence of the
 * effect (optionally gated by `when`) is the entire payload — there is
 * no per-card dispatch in the engine.
 */
export interface PlayFlagEffect extends EffectBase {
  readonly type: 'play-flag';
  readonly flag: PlayFlag;
  /**
   * For `buddy-play` flag: definition IDs of the companion characters in the
   * buddy group. When any of these companions is played in the same turn, this
   * character may also be played without counting against the one-character-per-turn limit.
   */
  readonly companions?: readonly string[];
}

/**
 * Faction "control by a leader" mechanic (CoE — LE "Orcs of Udûn"-style
 * factions: le-262, le-275, le-279, le-281, le-282, le-291).
 *
 * When a character whose race is in {@link races} and which carries the
 * {@link requiresKeyword} keyword successfully makes the influence attempt for
 * this faction, the player **may** place the faction under that character's
 * control. Doing so:
 *
 * - records `controlledBy` = the controlling character's instance ID on the
 *   faction's {@link CardInPlay} entry,
 * - leaves the influence site **untapped** (the attempt does not tap it),
 * - discards the faction if the controlling leader later **moves** (its company
 *   completes movement) or **leaves play** (eliminated / influenced away), and
 * - contributes to the {@link groupBonus}: a leader controlling `count` or more
 *   such factions grants `mp` extra marshalling points (counted once per
 *   leader, regardless of how many factions over the threshold it controls).
 *
 * Taking control is optional ("you may"): the legal-action generator emits both
 * a normal influence attempt and a "place under control" variant for an
 * eligible leader, and the player chooses.
 */
export interface LeaderControlEffect extends EffectBase {
  readonly type: 'leader-control';
  /** Races of character eligible to take control (e.g. `["orc", "troll"]`). */
  readonly races: readonly Race[];
  /** Keyword the controlling character must carry (e.g. `"leader"`). */
  readonly requiresKeyword: string;
  /** Group marshalling-point bonus for a leader controlling `count`+ factions. */
  readonly groupBonus: {
    /** Minimum factions a single leader must control to earn the bonus. */
    readonly count: number;
    /** Extra marshalling points granted (once) when the threshold is met. */
    readonly mp: number;
  };
}

/**
 * One attack entry for the `trigger-attack-on-play` multi-attack form.
 */
export interface TriggerAttackEntry {
  /** Creature type (e.g. `"Men"`). */
  readonly creatureType: string;
  /** Number of strikes. */
  readonly strikes: number;
  /** Prowess of each strike. */
  readonly prowess: number;
}

/**
 * When present on a resource permanent event, causes the company to
 * face one or more automatic attacks of the given type(s) immediately
 * after the card enters play.
 *
 * **Single-attack form** (backward-compatible, used by Rescue Prisoners):
 * `creatureType` + `strikes` + `prowess` at the top level. After combat,
 * if no characters are untapped the card is discarded; otherwise a
 * `select-card-bearer` pending resolution is queued — the chosen character
 * taps, the card is attached to their items, and a `bearer-cannot-untap`
 * constraint is added.
 *
 * **Multi-attack form**: provide an `attacks` array instead of the top-level
 * fields. Each entry triggers in order; after all attacks resolve the same
 * untapped-character check applies. The `afterAttack` field controls
 * post-attack card placement:
 * - `"attach-with-constraint"` (default) — existing Rescue Prisoners
 *   behaviour: attach to bearer with `bearer-cannot-untap` constraint.
 * - `"move-to-mp-pile"` — tap the chosen character but leave the card in
 *   `cardsInPlay` (it already earns MPs there); no untap constraint.
 *
 * When `discardFactionsAtSite` is true, after bearer selection any faction
 * cards in play belonging to the resource player that are playable at the
 * company's current site are discarded to their owner's discard pile.
 *
 * Used by *Rescue Prisoners* (tw-315): single-attack form.
 * Used by *Burning Rick, Cot, and Tree* (le-173): multi-attack form.
 */
export interface TriggerAttackOnPlayEffect extends EffectBase {
  readonly type: 'trigger-attack-on-play';
  /** Creature type of the triggered attack (single-attack form). */
  readonly creatureType?: string;
  /** Number of strikes the attack delivers (single-attack form). */
  readonly strikes?: number;
  /** Prowess of each strike (single-attack form). */
  readonly prowess?: number;
  /**
   * Multi-attack form: array of attacks to trigger in sequence. When
   * present, the top-level `creatureType`/`strikes`/`prowess` fields are
   * ignored.
   */
  readonly attacks?: readonly TriggerAttackEntry[];
  /**
   * Post-attack card placement mode.
   * - `"attach-with-constraint"` (default): attach to bearer's items,
   *   add `bearer-cannot-untap` constraint (Rescue Prisoners behaviour).
   * - `"move-to-mp-pile"`: tap bearer, leave card in `cardsInPlay` with
   *   no untap constraint (Burning Rick behaviour).
   */
  readonly afterAttack?: 'attach-with-constraint' | 'move-to-mp-pile';
  /**
   * When true, after bearer selection discard any faction cards in play
   * belonging to the active player that are playable at the company's
   * current site.
   */
  readonly discardFactionsAtSite?: boolean;
  /**
   * When true, after bearer selection (the `move-to-mp-pile` keep branch)
   * return every **unique** faction card in play — belonging to *either*
   * player — that is playable at the company's current site to its owner's
   * hand (Tempest of Fire ba-77). Distinct from `discardFactionsAtSite`,
   * which discards only the active player's factions.
   */
  readonly returnFactionsAtSite?: boolean;
  /**
   * When present, the creature type of every triggered attack is resolved
   * at play time from the active company's current site type instead of the
   * fixed `creatureType` on each attack entry. Keyed by site type (e.g.
   * `{ "border-hold": "Men", "shadow-hold": "Orcs" }`) — Tempest of Fire
   * ba-77's "Men at a Border-hold, Orcs at a Shadow-hold". A site type absent
   * from the map falls back to the attack entry's printed `creatureType`.
   */
  readonly creatureTypeBySiteType?: Readonly<Record<string, string>>;
  /**
   * When true, after bearer selection (the `move-to-mp-pile` keep branch)
   * discard every **unique** faction card in play — belonging to *either*
   * player — that is playable at the company's current site (Invade Their
   * Domain ba-64, Lord and Usurper ba-65: "discard all unique factions
   * playable at the site"). Distinct from `discardFactionsAtSite` (which
   * discards *all* of the active player's factions regardless of uniqueness)
   * and `returnFactionsAtSite` (which returns unique factions to hand rather
   * than discarding).
   */
  readonly discardUniqueFactionsAtSite?: boolean;
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
 * The Great Hunt (wh-91) — Alatar's signature stage permanent-event. Carried
 * by a resource permanent-event; fires when the card enters play and then
 * establishes a persistent "discards attack" effect while it stays in play.
 *
 * On play (the reveal-and-attack process):
 *  - The controller chooses whether the opponent reveals from their play deck
 *    or their discard pile (a `great-hunt-source` pending resolution).
 *  - Cards are revealed from the top of the chosen pile one at a time. Each
 *    revealed hazard-creature immediately attacks the controller's Alatar
 *    company (a `great-hunt-attack` combat). The process stops once
 *    `maxCreatures` creatures have attacked or the pile is exhausted.
 *  - The revealed cards never leave their pile (they are only revealed, exactly
 *    like Lucky Search tw-269). If the play deck was used, it is reshuffled
 *    when the process completes.
 *
 * Ongoing (the `great-hunt-active` tracker constraint added on play):
 *  - "Whenever your opponent discards a creature during your turn, you may
 *    choose to have it attack Alatar's company instead." Each hazard-creature
 *    the opponent discards during the controller's own turn (while this card is
 *    in play) offers a `great-hunt-discard-attack` resolution. Ruling: each
 *    discarded creature instance is offered at most once per turn — after it
 *    attacks (or is passed) it stays in the discard pile and is not re-offered,
 *    even if it re-enters the discard pile — so the unbounded printed wording
 *    cannot loop forever.
 */
export interface RevealAndAttackEffect extends EffectBase {
  readonly type: 'reveal-and-attack';
  /** Max number of revealed creatures that attack before the process stops. */
  readonly maxCreatures: number;
  /**
   * The avatar whose company is attacked (both by the reveal process and by
   * the ongoing discard trigger). Matched against the controller's in-play
   * avatar character by name, e.g. `"Alatar"`.
   */
  readonly attackAvatar: string;
}

/**
 * The Hunt (dm-143) — Alatar's short-event resource event. Playable on Alatar
 * during the organization phase: the controller names one hazard-creature
 * instance the opponent's game state has already revealed to them (its
 * identity present in `GameState.handRevealedInstances`) that currently sits
 * in the opponent's play deck or discard pile ("Unless eliminated or
 * prevented from being in play" — a creature no longer in either pile simply
 * offers no candidate). The named creature immediately attacks the bearer as
 * a `hunt-attack` combat:
 *
 * - The bearer defends alone, "as though he were a one-character company"
 *   (`CombatState.soloDefenderInstanceId`), regardless of his actual company.
 * - "Cannot use or benefit from spells against the attack" —
 *   `CombatState.spellsIneffective` suppresses spell-keyword `cancel-attack`
 *   plays (Vanishment tw-356, Wizard's River-horses tw-364) and spell-sourced
 *   `creature-attack-boost` constraints (Wizard's Flame tw-361) for this
 *   combat only.
 * - The creature card is never moved out of its pile — attacked in place,
 *   exactly like The Great Hunt (wh-91) / Lucky Search (tw-269) — so
 *   finalization neither discards nor awards it. If the creature was found in
 *   the play deck (not the discard pile), the deck is reshuffled once it is
 *   named ("reshuffling his play deck if it was searched").
 * - "If untapped, tap [the bearer] afterwards" — applied once the forced
 *   attack concludes (finalized or canceled).
 */
export interface NamedCreatureHuntEffect extends EffectBase {
  readonly type: 'named-creature-hunt';
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
 * Modifies how the agent's own standard site-phase attack (rule 2.V.iii,
 * the `declare-agent-attack` step) is declared and resolved. Unlike
 * `agent-tap-attack` (a special M/H-phase attack granted by card text), this
 * effect alters the normal agent-hazard attack every agent already has.
 *
 * Used by Taladhan (dm-25): "Agent only: chooses defending characters; for
 * each successful strike, the company must discard one item (of defender's
 * choice), but the defending character is not harmed."
 */
export interface AgentAttackModifierEffect extends EffectBase {
  readonly type: 'agent-attack-modifier';
  /**
   * The attacking player assigns strikes regardless of the agent's
   * face-down/at-home state (overrides rule 3.ii.4, which otherwise grants
   * attacker assignment only to a face-down agent at its home site).
   */
  readonly attackerAssigns?: boolean;
  /**
   * Special strike resolution effect.
   * `"discard-item"`: a successful strike does not wound; instead the
   * defending company must discard one item (defender's choice). Detainment
   * attacks (vs Ringwraith/Balrog defenders) tap as usual and never trigger
   * the discard, matching the `tap-agent-at-site` precedent (dm-43).
   */
  readonly strikeEffect?: 'discard-item';
  /**
   * "Agent only: may tap for an extra strike" (Elerína dm-7). When the agent
   * is untapped, the hazard player may declare the standard site-phase attack
   * with an additional strike (2 instead of 1) at the cost of tapping the
   * agent. Offered as an alternative `declare-agent-attack` legal action
   * carrying `tapForExtraStrike: true`; declining leaves the normal 1-strike
   * attack (and the agent untapped).
   */
  readonly tapForExtraStrike?: boolean;
}

/**
 * An agent at the target company's new site may be discarded (by its
 * controller's choice, not as an agent action, not against the hazard limit)
 * to force the moving company to return to its site of origin. The return
 * follows CoE rule 2.IV.4: the company's movement/hazard phase immediately
 * ends, the company is no longer considered to have a site path nor to have
 * moved this turn, and its player cannot initiate any actions during that
 * company's site phase.
 *
 * Used by Baduila (dm-2): "Agent only: if you choose to discard Baduila at
 * target company's new site, company must return to its site of origin."
 * (CRF: read "If Baduila is discarded" as "If you choose to discard Baduila.")
 */
export interface AgentDiscardReturnToOriginEffect extends EffectBase {
  readonly type: 'agent-discard-return-to-origin';
}

/**
 * Restricts the site types an agent (acting as a hazard moving around the map)
 * may move to. When the bearer takes an `agent-move` action, any destination
 * whose {@link SiteType} appears in `siteTypes` is excluded from the legal
 * destinations.
 *
 * Models text such as "Agent only: Cannot move to Free-holds [{F}] and
 * Border-holds [{B}]." Used by Baugúr (dm-181).
 */
export interface AgentMoveRestrictionEffect extends EffectBase {
  readonly type: 'agent-move-restriction';
  /** Site types the agent may NOT move to (deny-list, e.g. Baugúr dm-181). */
  readonly siteTypes?: readonly SiteType[];
  /**
   * Allow-list of site names the agent may move to. When either allow-list is
   * present, the agent may move ONLY to a destination whose name is in
   * `allowedSiteNames` or whose region is in `allowedRegionNames`. Used by
   * Lobelia (dm-28): "may not move to any site other than Bree, Old Forest, The
   * White Towers, or a site in The Shire."
   */
  readonly allowedSiteNames?: readonly string[];
  /** Allow-list of region names the agent may move to (see `allowedSiteNames`). */
  readonly allowedRegionNames?: readonly string[];
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
  /**
   * The stat to modify: `"prowess"` or `"body"` (the character's own —
   * installs a `character-stat-modifier` constraint), or `"creature-body"`
   * (installs a `character-creature-body-modifier` constraint reducing the
   * *attacking creature's* body-check target for strikes the character
   * faces — only meaningful for attacks against a body-checkable creature;
   * see Biter and Beater! as-46).
   */
  readonly stat: 'prowess' | 'body' | 'creature-body';
  /**
   * The modifier value (positive to boost, negative to penalise). Ignored
   * (and may be omitted) when `costDiscard` is present — the boost value is
   * then computed from the discarded cost cards instead.
   */
  readonly value?: number;
  /**
   * Optional DSL condition evaluated against
   * `{ target: { race, name, skills, keywords } }` for each character in the
   * defending company. Only characters that satisfy the condition receive the
   * modifier. When absent (and no `companyFilter` is set), every character in
   * the company receives it.
   */
  readonly filter?: Condition;
  /**
   * Optional company-level eligibility gate. When present, the event may be
   * played (and the boost applied to *every* character in the defending
   * company) only if at least one character in that company satisfies the
   * condition — evaluated with the same per-character context as `filter`.
   * Unlike `filter`, which restricts *which* characters receive the boost,
   * `companyFilter` gates the *whole* company on the presence of a qualifying
   * member and then boosts all of them.
   *
   * Used by Foe Dismayed (ba-59): "+1 prowess against an attack for all
   * characters in a leader's or The Balrog's company" — the company must
   * contain a Leader or The Balrog, and then every character is boosted.
   */
  readonly companyFilter?: Condition;
  /**
   * Optional gate restricting which attack the card may be played against.
   * Evaluated against `{ enemy: { race, name, overt } }`, where `race` is the
   * current attack's creature race (set for hazard creatures, on-guard
   * reveals, played-auto-attacks, and site automatic-attacks alike), `name`
   * is the specific creature card's printed name (empty string when the
   * attack has no individual creature card, e.g. a generic automatic-attack),
   * and `overt` is the attacking company's overt status — present (`true`/
   * `false`) only for a CvCC attack, absent for a creature/automatic-attack.
   * When absent, the card may be played against any attack.
   *
   * Used by Alert the Folk (td-97): "Playable on a company facing a Dragon
   * or Drake attack (not Eärcaraxë)" — `{ "$and": [{ "enemy.race": { "$in":
   * ["dragon", "drake"] } }, { "enemy.name": { "$ne": "Eärcaraxë" } }] }`.
   * Used by Biter and Beater! (as-46): "facing an Orc attack or in combat
   * with an overt company" — `{ "$or": [{ "enemy.race": "orc" },
   * { "enemy.overt": true }] }`.
   */
  readonly when?: Condition;
  /**
   * Optional per-item DSL condition evaluated against `{ item: { name,
   * keywords, cardType, subtype } }` for every item borne by every character
   * in the defending company (same context shape as {@link
   * InPlayItemModifierEffect.itemFilter}). When present, the boost `value` is
   * applied **once per matching item** — a character bearing two qualifying
   * items receives the boost twice (stacking) — instead of once per matching
   * character. `filter`/`companyFilter` are ignored when `itemFilter` is set.
   *
   * Used by Biter and Beater! (as-46): "Every Sword of Gondolin, Orcrist, and
   * Glamdring in target company give an additional +2 prowess bonus …" —
   * `{ "item.name": { "$in": ["Sword of Gondolin", "Orcrist", "Glamdring"] } }`.
   */
  readonly itemFilter?: Condition;
  /**
   * Replaces the fixed `value` with a variable one, computed at play time
   * from cards the controller chooses to discard from `source` as part of
   * playing the event. The player picks between `minCount` and `maxCount`
   * cards matching `filter` (evaluated against each candidate card's
   * definition, extended with `faction.playableRegions` — see
   * {@link buildFactionPlayableRegions} — for faction candidates); the
   * chosen cards move to their owner's discard pile and the boost `value`
   * becomes the sum of their printed `marshallingPoints`.
   *
   * Used by Alert the Folk (td-97): "Discard from your hand any one or two
   * factions playable at sites in Northern Rhovanion, Iron Hills, Woodland
   * Realm, or Anduin Vales. All characters facing the attack gain a bonus to
   * their prowess equal to the total marshalling point values … of the
   * factions discarded" — `minCount: 1, maxCount: 2`.
   */
  readonly costDiscard?: CompanyCombatBoostDiscardCost;
  /**
   * The skill required on the character who both pays `cost` and receives
   * the boost. Only meaningful alongside `cost` — presence of `cost` (with
   * or without `requiredSkill`) switches the effect to single-target mode:
   * one action is offered per qualifying character in the defending
   * company, and only the chosen character (not every `filter`-matching
   * character) receives the boost. Used by Some Secret Art of Flame
   * (le-232): "Playable on a sorcery-using character facing an attack. +4
   * prowess for the character against the attack."
   */
  readonly requiredSkill?: string;
  /**
   * The race required on the character who both pays `cost` and receives
   * the boost — alternative to {@link requiredSkill} for race-gated spells.
   * Only meaningful alongside `cost` (see `requiredSkill`). Used by
   * Wizard's Fire (tw-360): "Wizard only. +5 prowess for the Wizard against
   * one attack." — `requiredRace: "wizard"`.
   */
  readonly requiredRace?: Race;
  /**
   * The cost the chosen character pays to receive the boost (e.g. a
   * corruption check). Presence of `cost` switches the effect to
   * single-target mode — see {@link requiredSkill} / {@link requiredRace}.
   */
  readonly cost?: ActionCost;
  /**
   * When set, a cost-paying character whose race matches this value pays no
   * cost. Backs clauses like "Unless he is a Ringwraith, character makes a
   * corruption check modified by -4" (Some Secret Art of Flame, le-232).
   */
  readonly costExemptRace?: Race;
}

/** Discard-cost payload for {@link CompanyCombatBoostEffect.costDiscard}. */
export interface CompanyCombatBoostDiscardCost {
  /** Pile the cost cards are discarded from. Currently only `"hand"`. */
  readonly source: 'hand';
  /** DSL condition matched against candidate card definitions in `source`. */
  readonly filter: Condition;
  /** Minimum number of matching cards the player must discard. */
  readonly minCount: number;
  /** Maximum number of matching cards the player may discard. */
  readonly maxCount: number;
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
 * `agent-home-site-faction-lock` — a permanent-event kept attached to an agent
 * character (in `char.items`) whose ongoing effect switches on only while the
 * bearer is **unwounded and standing at one of his home sites** of a type in
 * {@link homeSiteTypes}. While active it does two things:
 *
 * 1. Bars **every** faction play at any version of that site — matched by the
 *    site's printed *name*, so all in-play copies of the same site card are
 *    covered ("any version of that site"). Enforced in the site-phase faction
 *    legal-action gate (`legal-actions/site.ts`), alongside the
 *    `site-instance-transform` `noFactions` branch.
 * 2. Credits the carrying card's printed marshalling points to its controller
 *    ("you receive this card's marshalling points"). The MP is therefore
 *    **conditional**: the card's own printed MP is suppressed in the normal
 *    item-MP tally (`recompute-derived.ts`) and added back only while the lock
 *    is active.
 *
 * When the bearer is wounded, moves off its home site, or the home site is not
 * of a qualifying type, the lock (and its MP) simply switch off — the card
 * stays attached and re-activates dynamically. The card is only discarded when
 * the bearer leaves play (orphaned-attachment sweep).
 *
 * Used by Faithless Steward (as-83): "Playable on an agent character at a
 * Darkhaven who has a Border-hold or Free-hold as a home site. If target
 * character is unwounded and at one of his Border-hold or Free-hold home sites,
 * no factions can be played at any version of that site and you receive this
 * card's marshalling points."
 */
export interface AgentHomeSiteFactionLockEffect extends EffectBase {
  readonly type: 'agent-home-site-faction-lock';
  /**
   * Home-site types (printed {@link SiteType}) that qualify. The lock is active
   * only when the bearer's current site is one of his home sites of one of
   * these types. Faithless Steward uses `["border-hold", "free-hold"]`.
   */
  readonly homeSiteTypes: readonly SiteType[];
}

/**
 * Movement/hazard restrictions imposed on the company a permanent-event is
 * bound to (`CardInPlay.companyId`). Consulted at the movement legal-action
 * sites (organization plan-movement, M/H select-company / declare-path) and at
 * the hazard-limit snapshot. Multiple restriction cards on one company stack
 * (strictest wins for the region cap; hazard modifiers sum).
 *
 * Used by Going Ever Under Dark (ba-37): "The company cannot use starter
 * movement. In addition, if they move with region movement, they are limited
 * in all cases to 3 regions maximum and their hazard limit is reduced by one
 * (to a minimum of two)."
 */
export interface CompanyMovementRestrictionEffect extends EffectBase {
  readonly type: 'company-movement-restriction';
  /** When true, the bound company may not use starter movement. */
  readonly noStarterMovement?: true;
  /**
   * When true, the bound company may not move to an Under-deeps site (keyword
   * `under-deeps`). Used by Crept Along Carefully (ba-29): "The company cannot
   * use starter movement or move to an Under-deeps site."
   */
  readonly noUnderDeepsMovement?: true;
  /** Hard cap on the number of regions the bound company may span in region movement. */
  readonly regionMovementMax?: number;
  /**
   * Amount added to the bound company's hazard limit when it moves with region
   * movement (negative reduces it). Applied only for a region-moving company
   * (CRF 22: "The hazard limit reduction only works if the company is moving").
   */
  readonly hazardLimitModifier?: number;
  /** Floor the hazard limit is never reduced below by {@link hazardLimitModifier}. */
  readonly hazardLimitFloor?: number;
}

/**
 * A permanent event bound to a company (`CardInPlay.companyId`) that taxes the
 * company's *voluntary* movement and splitting during the organization phase:
 * before the bound company may declare movement (`plan-movement`) or split
 * (`split-company`), the controlling player must first tap up to
 * {@link taxTapCharacters} of its untapped characters ("tap all of its untapped
 * characters to a maximum of two"). The tax is satisfied when that many have
 * been tapped toward it this org phase **or** the company has no untapped
 * character left to tap. The running count lives on
 * `OrganizationPhaseState.movementTaxPaid` keyed by company id and is paid one
 * character at a time via the `pay-movement-tax` action.
 *
 * Unlike {@link CompanyMovementRestrictionEffect} (Going Ever Under Dark ba-37,
 * a same-player resource event), this is a *hazard* played by the opponent onto
 * the resource player's company, so the reader
 * ({@link companyMovementTax}) scans **both** players' `cardsInPlay`.
 *
 * Used by Enchanted Stream (as-27): "The company cannot voluntarily split or
 * move to a new site unless it taps all of its untapped characters to a maximum
 * of two during its organization phase."
 */
export interface CompanyMovementTaxEffect extends EffectBase {
  readonly type: 'company-movement-tax';
  /** Maximum number of untapped characters that must be tapped before the company may move/split. */
  readonly taxTapCharacters: number;
}

/**
 * Lets the controller voluntarily discard the carrying in-play permanent-event
 * during their own organization phase ("Discard during your organization phase
 * if you choose"). Offered as a `voluntary-discard-in-play` action in the
 * organization aggregator. Used by Going Ever Under Dark (ba-37).
 */
export interface VoluntaryDiscardEffect extends EffectBase {
  readonly type: 'voluntary-discard';
  /** The phase during which the discard may be chosen (currently "organization"). */
  readonly phase: 'organization';
}

/**
 * Makes a card count as another named card for the purpose of `inPlay`
 * condition checks. While the bearer is in play, the alias name is added to
 * the in-play names list, so any DSL `when` clause that tests
 * `{ "inPlay": "<alias>" }` is satisfied.
 *
 * Used by Skies of Fire (le-228), the minion environment that "acts as Gates
 * of Morning for the purposes of interpreting hazards": with `{ as: "Gates of
 * Morning" }` every existing Gates-of-Morning-gated hazard interpretation
 * (region keying, halve-strikes, attack modifiers, etc.) fires while Skies of
 * Fire is in play, without naming Skies of Fire anywhere in the engine.
 */
export interface NameAliasEffect extends EffectBase {
  readonly type: 'name-alias';
  /** The card name this card additionally counts as while in play. */
  readonly as: string;
}

/**
 * A game-wide override of which named environment cards are *considered* in or
 * out of play, applied while the bearer is itself in play. Unlike
 * {@link NameAliasEffect} (which only *adds* the bearer's alias), this can both
 * add names to the in-play set (`considerInPlay`) and remove names from it
 * (`considerNotInPlay`), reshaping the global environment that every
 * `{ "inPlay": "<name>" }` DSL condition reads.
 *
 * Used by Peril Returned (td-54): "If Gates of Morning is not in play, Doors of
 * Night is considered to be in play. If Gates of Morning is in play, it is
 * considered to be out of play while Peril Returned is in play." Both branches
 * net to the same unconditional state — Doors of Night considered in, Gates of
 * Morning considered out — so the card carries `considerInPlay: ["Doors of
 * Night"]` and `considerNotInPlay: ["Gates of Morning"]`. The Gates of Morning
 * *card* itself stays in `cardsInPlay` (it may still be removed normally by
 * Twilight, Doors of Night, etc.); only its interpretation is suppressed.
 *
 * Removals are applied before additions, so a name in both lists ends up
 * considered in play.
 */
export interface EnvironmentOverrideEffect extends EffectBase {
  readonly type: 'environment-override';
  /** Card names to treat as in play while the bearer is in play. */
  readonly considerInPlay?: readonly string[];
  /** Card names to treat as out of play while the bearer is in play. */
  readonly considerNotInPlay?: readonly string[];
}

/**
 * Carried by a character that is a manifestation of another character
 * (e.g. Strider ba-1, "Manifestation of Aragorn II"): while this
 * character is in play, its controller may play the named manifestation
 * from hand into this character's company, removing this character from
 * the game and automatically transferring all cards on it (items,
 * allies, hazards, trophies) — plus its control relationships (its
 * controller and any followers) — to the new manifestation. Per CRF 22
 * (Strider) the swap may be performed at any time a normal resource
 * could be played; the engine offers it during the controller's
 * organization, movement/hazard, and site phases.
 *
 * The manifestation *relationship* itself (glossary rule g.man.1 — only
 * one manifestation of an entity in play, draft collisions per rule 1.9)
 * is declared by the character card's `manifestId` field, not by this
 * effect.
 */
export interface ManifestationSwapEffect extends EffectBase {
  readonly type: 'manifestation-swap';
  /** Name of the character card that may replace this one (e.g. "Aragorn II"). */
  readonly cardName: string;
}

/**
 * "You may discard <bearer> at a Haven to play any Hobbit from your hand with
 * his company." — Folco Boffin (dm-180).
 *
 * A resource-style replacement play: while the bearer is in a company, the
 * controller may discard the bearer to bring a matching character from hand
 * into the bearer's company at the bearer's position, untapped. The incoming
 * character inherits every card and control relationship attached to the
 * bearer (identical to {@link ManifestationSwapEffect}), preserving the
 * no-card-disappears invariant. Unlike a manifestation swap the discarded
 * bearer goes to its owner's discard pile (recyclable), not out-of-play.
 *
 * Per CRF 22 (Folco Boffin) the ability "can be done at any time that a normal
 * resource could be played", so the emitter is wired into the organization,
 * movement/hazard, and site phase aggregators.
 */
export interface DiscardToRecruitEffect extends EffectBase {
  readonly type: 'discard-to-recruit';
  /** If true, the bearer's company must currently be at a Haven. */
  readonly requireHaven?: boolean;
  /**
   * Condition matched against the incoming hand character's definition
   * (exposed as `target`, e.g. `{ "target.race": "hobbit" }`). Only character
   * cards satisfying this filter may be brought into play.
   */
  readonly filter?: Condition;
}

/**
 * One alternative region treatment offered by a {@link RegionKeyingBoostEffect}:
 * for creature-keying purposes, a single region of type {@link from} in a
 * company's site path is treated as {@link count} regions of type {@link asType}
 * (e.g. `{ from: "shadow", asType: "wilderness", count: 2 }` = "treat one
 * Shadow-land as two Wildernesses").
 */
export interface RegionKeyingBoost {
  /** The region type consumed from the path (e.g. "shadow"). */
  readonly from: RegionType;
  /** The region type the consumed region is counted as (e.g. "wilderness"). */
  readonly asType: RegionType;
  /** How many regions of {@link asType} the consumed region counts as. */
  readonly count: number;
}

/**
 * A turn-scoped environment effect (Withered Lands, td-85) that softens creature
 * keying by letting one region in a company's site path count as additional
 * regions of another type. Each {@link RegionKeyingBoost} entry is an independent
 * alternative ("one Wilderness as two Wildernesses OR one Shadow-land as two
 * Wildernesses OR one Border-land as two Wildernesses"); at most one boost is
 * applied per keying check — the boosts are never combined.
 *
 * On play the short-event adds a `region-keying-boost` active constraint
 * carrying these boosts (scope: turn). The creature-keying matchers
 * (`findCreatureKeyingMatches`, `checkCreatureKeying`) consult the constraint
 * and test each boosted variant of the path; the underlying path is never
 * mutated.
 */
export interface RegionKeyingBoostEffect extends EffectBase {
  readonly type: 'region-keying-boost';
  /** The alternative region treatments this environment enables. */
  readonly boosts: readonly RegionKeyingBoost[];
}

/**
 * One region-type substitution offered by a {@link RegionTypeRemapEffect}: for
 * creature-keying purposes, every region of type {@link from} in a company's
 * traversed site path is treated as a region of type {@link to} (e.g.
 * `{ from: "border", to: "wilderness" }` = "treat all Border-lands as
 * Wildernesses").
 */
export interface RegionTypeRemap {
  /** The printed region type being reinterpreted. */
  readonly from: RegionType;
  /** The region type it is treated as. */
  readonly to: RegionType;
}

/**
 * An environment effect (Fell Winter, le-111) that reinterprets whole classes
 * of region for creature-keying purposes: "treat all Free-domains as
 * Border-lands and all Border-lands as Wildernesses". Unlike
 * {@link RegionKeyingBoostEffect} (an additive alternative applied to one
 * region), this is a wholesale **replacement** applied to every matching region
 * of the traversed site path simultaneously — each region is mapped from its
 * printed type, so listing both `border→wilderness` and `free→border` never
 * cascades a Free-domain all the way to a Wilderness.
 *
 * The optional {@link when} clause (evaluated against `{ inPlay }`) gates the
 * remap dynamically while the carrying card is in play — Fell Winter's remap is
 * active only while Doors of Night is also in play. The creature-keying matchers
 * (`findCreatureKeyingMatches`, `checkCreatureKeying`) consult the remap live
 * and transform the effective region-type path before matching; the underlying
 * path is never mutated.
 */
export interface RegionTypeRemapEffect extends EffectBase {
  readonly type: 'region-type-remap';
  /** The region-type substitutions applied to the traversed site path. */
  readonly remap: readonly RegionTypeRemap[];
  /**
   * Optional gate evaluated against `{ inPlay }`. When present, the remap is
   * active only while the condition holds (e.g. Doors of Night in play). Absent
   * means the remap is active whenever the carrying card is in play.
   */
  readonly when?: Condition;
}

/**
 * Retype a whole **class of sites** at once: every site whose *printed*
 * {@link SiteType} is {@link from} counts as a {@link to} everywhere the
 * engine asks for a site's effective type — hazard keying, item / ally /
 * faction playability, haven tests, movement. The site-type sibling of
 * {@link RegionTypeRemapEffect}.
 *
 * Unlike the bound `site-type-override` add-constraint (Hold Rebuilt and
 * Repaired as-88, Nature's Revenge wh-27), which retypes *one* site — the one
 * the carrying card was played on, or every printing of it — this remap is
 * bound to no site at all. It installs a single `site.type` `override`
 * `attribute-modifier` whose filter is `{ 'site.printedType': from }`, so it
 * needs neither an active company nor a destination to resolve, and it
 * survives the card leaving play.
 *
 * Resolved as a top-level effect when the carrying card resolves as a
 * short-event on the chain (`applySiteTypeRemap`, `chain-reducer.ts`) — which
 * includes the on-tap "becomes a short-event" conversion of a
 * {@link CreatureAltEventEffect} permanent-event.
 *
 * Used by Witch-king of Angmar (tw-113): "When tapped, Witch-king of Angmar
 * becomes a long-event and causes all Shadow-holds [{S}] to become Dark-holds
 * [{D}]. When resolved, the long-event effect will remain and this card is
 * discarded."
 *
 * ```json
 * { "type": "site-type-remap", "from": "shadow-hold", "to": "dark-hold",
 *   "duration": "long-event" }
 * ```
 */
export interface SiteTypeRemapEffect extends EffectBase {
  readonly type: 'site-type-remap';
  /** The printed site type being reinterpreted. */
  readonly from: SiteType;
  /** The site type every site of type {@link from} is treated as. */
  readonly to: SiteType;
  /**
   * How long the remap lasts.
   *
   * - `"long-event"` — exactly as long as a hazard long-event owned by the
   *   declaring player would ([2.III.3]), via the `next-long-event-phase`
   *   constraint scope. This is what "becomes a long-event … the long-event
   *   effect will remain and this card is discarded" means: the card goes to
   *   the discard pile immediately, so only the constraint carries the
   *   duration (CRF 22 on tw-113).
   * - `"turn"` (default) — swept at end of turn.
   */
  readonly duration?: 'turn' | 'long-event';
}

/**
 * A persistent environment effect (Girdle of Radagast, wh-110) that converts a
 * specific set of **named regions** — the region of the Wizardhaven the carrying
 * card is bound to (`attachedToSite`) and, when {@link includeAdjacent} is set,
 * every region adjacent to it — to the region type {@link to} for
 * creature-keying purposes. Unlike {@link RegionTypeRemapEffect} (which
 * reinterprets whole *type classes* along a path), this replaces specific
 * regions by **name**, so it depends on the card being anchored to a site whose
 * `region` names the origin region.
 *
 * The conversion is active for exactly as long as the carrying card is in play
 * with its `attachedToSite` set. The creature-keying matchers
 * (`findCreatureKeyingMatches`, `checkCreatureKeying`) consult it live via
 * `collectRegionTypeConversions` / `applyRegionTypeConversions`
 * (`engine/region-keying.ts`) and replace each matching region in the effective
 * region-type path; the underlying path is never mutated.
 */
export interface RegionTypeConversionEffect extends EffectBase {
  readonly type: 'region-type-conversion';
  /** The region type the anchored regions are converted to (e.g. wilderness). */
  readonly to: RegionType;
  /**
   * When `true`, the regions adjacent to the anchor region (per the region
   * card's `adjacentRegions`) are converted as well, not just the anchor.
   */
  readonly includeAdjacent?: boolean;
}

/**
 * Greed (le-113 / tw-42): a hazard short-event played on a site. Until the
 * end of the turn, every character at the bound site (except the one playing
 * the item) must make a corruption check each time an item is played at the
 * site, the check modified by subtracting the item's printed corruption
 * points. Characters matching {@link exemptFilter} (Hobbits, Wizards, and
 * Ringwraiths for Greed) never make the check.
 *
 * On resolution the short-event installs a turn-scoped
 * `item-play-corruption-check` {@link import('./pending.js').ActiveConstraint}
 * bound to the target site (via the chain payload's `targetSiteDefinitionId`);
 * the site-phase item-play handler fires the checks. Per CRF 22, a special
 * ring item being *played* triggers the checks, but transferring an item does
 * not — the trigger rides only the item-play path, never the transfer path.
 */
export interface ItemPlayCorruptionCheckEffect extends EffectBase {
  readonly type: 'item-play-corruption-check';
  /**
   * Characters whose `target.*` context matches this condition are exempt
   * from the corruption check (for Greed: Hobbits, Wizards, Ringwraiths).
   * When absent, every character at the site (other than the item-player) checks.
   */
  readonly exemptFilter?: Condition;
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
  /**
   * When true, the effect is carried by an agent itself and grants the extra
   * action(s) only while that agent is face-up (revealed) — e.g. My Precious
   * (dm-29): "If face-up, may take an extra agent action …". When absent, the
   * effect is a global in-play card (e.g. Great Need or Purpose dm-62) granting
   * extra actions unconditionally.
   */
  readonly whileRevealed?: boolean;
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
  /**
   * Optional attack filter for a `phase: "combat"` window. Evaluated against
   * the just-faced attack's context — `{ enemy: { race }, attack: { source } }`
   * — using the same discriminators as a `cancel-attack` `when` clause.
   *
   * Used with `step: "after-attack"` by resource permanent-events whose text
   * reads "Playable … immediately after his company faces a <race> hazard
   * creature" (No News of Our Riding le-211): the card is offered only while
   * the ended attack matches.
   */
  readonly when?: Condition;
  /**
   * When `true`, this window is an *addition* to — not a replacement of —
   * the CoE 2.1.1 default ("any phase of the resource player's own turn").
   * On the owner's own turn `phase` is ignored entirely (any phase remains
   * legal, matching a card with no `play-window` at all); the restriction
   * only bites when the card is offered to its owner during the
   * **opponent's** turn, where it may be played solely during the named
   * `phase`. Used by Sated Beast (td-149): "This card may also be played
   * during opponent's movement/hazard phase" — `{ phase:
   * "movement-hazard", crossTurn: true }`. Consulted by
   * `heroResourceShortEventActions` (`legal-actions/long-event.ts`), whose
   * one cross-turn call site is the hazard-side branch of the M/H
   * `play-hazards` step (`legal-actions/movement-hazard.ts`); every other
   * call site only ever runs for the resource player's own turn, so
   * `crossTurn` is a no-op there.
   */
  readonly crossTurn?: boolean;
}

/**
 * Passively taps the source card the moment its bearer's company sits at one
 * of the named sites — a level-triggered check re-evaluated by the
 * `sweepTapAtSiteItems` postReduce sweep after every action, so it fires on
 * arrival, on staying put, and even if the company was already there when the
 * card was played. Meaningful only on a card that also carries
 * `play-flag: "no-auto-untap"`, since without it the next untap phase would
 * immediately undo the tap.
 *
 * Used by Map to Mithril (td-133): "Tap Map to Mithril if bearer is ever at
 * Moria; this card never untaps." — `siteNames: ["Moria"]`.
 */
export interface TapAtSiteEffect extends EffectBase {
  readonly type: 'tap-at-site';
  /** Site names (matched against the bearer company's current site) that trigger the tap. */
  readonly siteNames: readonly string[];
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
   * `character` scopes to the active company's characters. Hazard-side
   * `stored-item` scopes to the opponent's stored items (items sitting in
   * the opponent's marshalling-point pile). Resource-side `item` scopes to
   * items borne by the active player's own characters (e.g. Barrow-blade
   * dm-119, played "with the Dagger" — a permanent event attached to an
   * item whose `stat-modifier` effects flow to the item's bearer).
   * `long-event` scopes to the active player's own in-play resource
   * long-events (Echo of All Joy td-110, played "on a resource long-event" —
   * a permanent event attached via `CardInPlay.attachedToLongEvent` that
   * exempts the target from the beginning-of-long-event-phase discard sweep).
   * `agent` scopes to a hazard player's own agents (Never Seen Him dm-74,
   * played "on an agent" — a permanent event attached via
   * `CardInPlay.attachedToAgentId`).
   * `nazgul-permanent-event` scopes to the hazard player's own in-play Nazgûl
   * permanent-events (dual creature/event cards played in permanent-event
   * mode, or a plain Nazgûl-keyword hazard-event) — one `play-hazard` action
   * per candidate, riding on `targetNazgulInstanceId`. Used by Helms of Iron
   * (dm-64): "Playable only if you have a Nazgûl permanent-event in play."
   */
  readonly target: 'character' | 'company' | 'site' | 'faction' | 'ally' | 'stored-item' | 'item' | 'long-event' | 'agent' | 'nazgul-permanent-event';
  /**
   * Per-mode phase gate: when set, the *targeted* play mode is only offered
   * while the current phase is one of these values (e.g. `["organization"]`).
   * Unlike `play-condition requires:phase` — which gates the whole card —
   * this leaves any untargeted `play-option` fallback on the same card with
   * its rule-2.1.1 any-phase allowance. Used by Bade to Rule (le-167):
   * "Playable at a Darkhaven during the organization phase on your
   * Ringwraith. … Alternatively, playable if your Ringwraith is not in play."
   * — the targeted Darkhaven/Ringwraith mode is organization-phase-only while
   * the alternative mode may be played during any phase of the turn.
   */
  readonly phases?: readonly string[];
  /**
   * Widens a `character` target beyond the default own-characters scope. When
   * `'any-player'`, candidates are drawn from **both** players' characters so a
   * resource event may target an opponent's character (A Malady Without Healing
   * le-159: "May target an opponent's character"). Absent = own characters only.
   */
  readonly targetScope?: 'any-player';
  /**
   * Play-condition for A Malady Without Healing (le-159): the card is only
   * playable on a target character sitting at the **same site** as a
   * shadow-magic-using character the **acting player controls** (a Ringwraith,
   * or any character with the `shadow-magic` skill, incl. item-granted). The
   * enabler must be a different character than the target. Evaluated per
   * candidate by the legal-action generator and re-derived by the reducer.
   */
  readonly requiresControlledShadowMagicUserAtSite?: boolean;
  /**
   * Optional DSL condition refining which candidates qualify. Evaluated
   * against the per-candidate context (e.g. `target.race`,
   * `target.status`, `target.skills`). When absent every candidate in
   * scope qualifies.
   */
  readonly filter?: Condition;
  /**
   * When `target` is `"site"` and this is `false`, the card may be played at
   * both tapped and untapped sites, overriding the default untapped-only
   * restriction for allies. Absent or `true` means the normal tapped check
   * applies. Used by cards like Noble Hound: "any tapped or untapped
   * Border-hold".
   */
  readonly requireTapped?: boolean;
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
  /**
   * MEAS §1: when true, this card *specifically affects cards placed "off to
   * the side"* — its target collector reaches cards carrying `setAsideHost`,
   * which are otherwise untargetable. Ordinary targeting cards omit this flag
   * and never see set-aside cards.
   */
  readonly targetsSetAside?: boolean;
  /**
   * Restricts a `target: "character"` play-target to a character bearing at
   * least one item matching this condition, AND designates which of that
   * character's items the played card resolves against when he bears more
   * than one qualifying item (Use Palantír tw-355: "tap sage to enable him
   * to use **one** Palantír he bears" — a sage bearing two Palantíri must
   * pick one, not both). Evaluated per-item against the item's own card
   * definition (`matchesDefinition`, e.g. `{ "keywords": { "$includes":
   * "palantir" } }`), unlike `filter`, which is evaluated against the
   * candidate *character's* aggregate context (`target.itemKeywords`). One
   * legal action is emitted per (character, item) pair; the chosen item's
   * instance flows into the resulting action as `targetItemInstanceId` so
   * an `apply` can bind a constraint's `source` to that specific item
   * instead of the playing card itself.
   */
  readonly itemFilter?: Condition;
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
   * Optional condition on the card whose play opened the reveal window,
   * matched directly against that card's definition (like a
   * `play-discard-cost` filter). Only meaningful for the `resource-play`
   * trigger: when present, the reveal is legal only if the deferred played
   * card matches — e.g. Heedless Revelry (le-114) restricts its reveal to
   * item and ally plays via a `cardType $in` condition (faction plays go
   * through its separate `influence-attempt` trigger).
   */
  readonly playedFilter?: Condition;
  /**
   * Optional triggered action fired when the on-guard card is revealed.
   * `cancel-chain-entry` with `select: 'target'` + `requiredSkill` cancels
   * the deferred resource play (and discards its card) when the source
   * card matches the skill filter. `company-tap-characters` taps every
   * untapped character in the company matching its filter when the revealed
   * card's chain entry resolves (Heedless Revelry le-114).
   */
  readonly apply?: TriggeredAction;
}

/**
 * Restricts an item to be playable only where the company's current
 * site satisfies a constraint. Two forms, combined with **OR** when both
 * are present (either satisfies):
 *
 * - `sites`: the site's name must appear in the list (e.g. Palantír of
 *   Orthanc — Isengard only).
 * - `filter`: a generic site-card condition evaluated against
 *   `{ site: <site definition> }` (e.g. hoard items: every site whose
 *   card definition has `hoard: true`).
 *
 * Most cards use exactly one form, but a card whose printed restriction is
 * "at <named site> or <site type>" uses both — e.g. Gold Ring that Sauron
 * Fancies (le-312): playable at Bag End **or** any Ruins & Lairs where gold
 * rings are playable.
 *
 * When present, the normal site-type check (`playableResources`) is
 * bypassed; the item is playable only if its restriction matches.
 */
export interface ItemPlaySiteEffect extends EffectBase {
  readonly type: 'item-play-site';
  /** Site names where the item can be played. Combined with `filter` via OR when both are set. */
  readonly sites?: readonly string[];
  /**
   * Generic site filter, evaluated against `{ site: siteDef }`. The site
   * context is augmented with `autoAttackRaces` — the normalized races of
   * the site's automatic-attacks — so a filter can match "a site with a
   * Dwarf automatic-attack" via `{ "site.autoAttackRaces": { "$includes": "dwarf" } }`.
   */
  readonly filter?: Condition;
  /**
   * When true, the item may be played even when its company's current
   * site is Tapped (the normal tapped-site gate is bypassed). The
   * site-restriction (`sites` / `filter`) must still match. Used by
   * *Blasting Fire* (wh-51) and *Vile Fumes* (wh-54): "Playable at a tapped
   * or untapped Shadow-hold, Dark-hold, or a site with a Dwarf automatic-attack."
   */
  readonly allowTapped?: boolean;
  /**
   * When true, playing this item leaves its company's current site untapped
   * (the normal "playing a resource taps the site" rule is suppressed for
   * this play). Used by *Helm of Fear* (as-126): "Playable at a tapped or
   * untapped Barad-dûr … (does not tap the site)."
   */
  readonly doesNotTapSite?: boolean;
}

/**
 * Replacement effect on an item: when another card *in the bearer's company*
 * is required to be discarded by a hazard or resource effect, the owner may
 * discard **this** card instead to fulfil that requirement — the protected
 * card stays in play.
 *
 * The engine models this as a `discard-substitute-offer` pending resolution
 * enqueued in place of the forced discard: the owner either names one of the
 * doomed cards to save (`use-discard-substitute`) — which discards this item —
 * or declines, and the original discard goes through unchanged. A player
 * holding two substitutes may save two cards from the same requirement; the
 * offer re-queues itself until the substitutes or the doomed cards run out.
 *
 * Used by *Leaf Brooch* (dm-171): "If a non-special item must be discarded from
 * the company of Leaf Brooch's bearer (according to any hazard or resource
 * effect), you may discard Leaf Brooch instead to fulfill this requirement."
 */
export interface DiscardSubstituteEffect extends EffectBase {
  /** Effect discriminant. */
  readonly type: 'discard-substitute';
  /**
   * Which cards this item may stand in for. Only `"company"` — every card
   * borne by any character in the bearer's own company — is supported.
   */
  readonly scope: 'company';
  /**
   * Card-definition filter the replaced card must match, evaluated with
   * `matchesDefinition` against the doomed card's definition (e.g. Leaf
   * Brooch's `{ "subtype": { "$ne": "special" } }`). Omit to substitute for
   * any card.
   */
  readonly filter?: Condition;
}

/**
 * Site-rule effects live in `./effects/site-rules.ts` for cohesion; they are
 * re-exported here so the public `types/effects.js` path is unchanged.
 */
export * from './effects/site-rules.js';


/**
 * Fetches a card from one or more source piles into the play deck (or hand) and optionally shuffles.
 *
 * Used by short events like Smoke Rings that let the player retrieve a
 * resource or character from their sideboard or discard pile.
 * When `to` is `'hand'`, the card is moved into the player's hand instead of the deck.
 */
export interface FetchToDeckEffect extends EffectBase {
  readonly type: 'fetch-to-deck';
  /** Which piles the player may fetch from (e.g. ["sideboard", "discard-pile", "deck"]). */
  readonly source: readonly string[];
  /** DSL condition evaluated against each card definition to decide eligibility. */
  readonly filter: Condition;
  /** How many cards to fetch. */
  readonly count: number;
  /** Whether to shuffle the play deck after fetching. */
  readonly shuffle: boolean;
  /**
   * Destination pile for the fetched card. Defaults to 'deck'.
   * When 'hand', the card is placed directly in the player's hand instead.
   */
  readonly to?: 'deck' | 'hand';
  /**
   * When set, only cards playable at this site qualify (in addition to
   * `filter`). Captured from the bearer's company's current site when an
   * `enqueue-pending-fetch` apply with `playableAtBearerSite` resolves.
   */
  readonly playableAtSite?: CardDefinitionId;
  /**
   * When true, the spent event card is removed from the game (routed to the
   * owner's out-of-play pile) instead of being discarded once the last pick
   * resolves. Backs "Remove this card from the game." on fetch short-events
   * such as Longbottom Leaf (ba-30).
   */
  readonly removeFromGame?: boolean;
  /**
   * When set, an additional eligibility gate on top of `filter`: the fetched
   * card must be an *agent* character (carries the `agent` keyword) whose
   * printed home site is a site whose {@link SiteType} appears in this list.
   * Home-site type cannot be expressed with the plain definition `filter`
   * (the `homesite` field is a comma-separated list of site *names*), so this
   * bespoke gate resolves each home-site name to its site definition and
   * checks the type. Used by Inner Cunning (dm-68) mode 2: "take any agent
   * whose home site is a Shadow-hold or Dark-hold from your play deck".
   */
  readonly homeSiteTypes?: readonly SiteType[];
  /**
   * When true, the fetched card's identity is revealed to the opponent as it
   * is taken to hand (recorded in {@link GameState.revealedInstances}). Used by
   * Inner Cunning (dm-68) mode 2: "reveal it to your opponent".
   */
  readonly revealToOpponent?: boolean;
  /**
   * When true and `to` is `'hand'`, the fetched card's game instance is
   * recorded as {@link SitePhaseState.tappedSiteItemUnlock} once it lands in
   * hand, letting it be played at the (already tapped) site that gated the
   * fetch despite the normal "site is already tapped" item-play restriction.
   * Set from `enqueue-pending-fetch`'s `unlockTappedSitePlay` flag. Used by
   * Dragon-lore (td-108).
   */
  readonly unlockTappedSitePlay?: boolean;
}

/**
 * `agent-reveal-site-override` — a hazard permanent-event played on one of the
 * hazard player's own face-down agents (Inner Cunning dm-68, mode 1).
 *
 * While this event is attached to a face-down agent (via
 * {@link CardInPlay.attachedToAgentId}) whose *printed* home site is a site of
 * one of `homeSiteTypes`, the agent may be revealed at **any** site in the
 * hazard player's location deck of one of those types — not only at a site
 * matching the agent's printed home-site name. Models "the site where he came
 * into play (which is not represented by a card) may legally be any Shadow-hold
 * or Dark-hold." The card is discarded when the agent is revealed (handled by
 * the orphaned-agent-attached-event sweep, since a revealed agent is no longer
 * face-down).
 */
export interface AgentRevealSiteOverrideEffect extends EffectBase {
  readonly type: 'agent-reveal-site-override';
  /** Site types the reveal site may be broadened to (e.g. shadow-hold, dark-hold). */
  readonly homeSiteTypes: readonly SiteType[];
}

/**
 * `fetch-agent-to-hand` — a hazard short-event that tutors an agent from the
 * playing player's own play deck into hand (Inner Cunning dm-68, mode 2).
 *
 * On resolution the engine enqueues a `fetch-to-deck` pending effect with
 * `source: ['deck']`, `to: 'hand'`, `shuffle: true`, `revealToOpponent: true`,
 * a `filter` requiring the `agent` keyword, and `homeSiteTypes` restricting to
 * agents whose printed home site is of one of those types. The player then
 * picks one matching agent via a `fetch-from-pile` pending resolution; the deck
 * is reshuffled and the fetched card is revealed to the opponent.
 */
export interface FetchAgentToHandEffect extends EffectBase {
  readonly type: 'fetch-agent-to-hand';
  /** Home-site types an eligible agent's printed home site must be one of. */
  readonly homeSiteTypes: readonly SiteType[];
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
  readonly requiredRace?: Race;
  /**
   * When true, a corruption check is enqueued on the bearer immediately after
   * the attack is cancelled. Used by in-play items like Torque of Hues
   * ("Bearer makes a corruption check").
   */
  readonly enqueueCorruptionCheck?: true;
  /**
   * When set, the card offers an alternative "reduce attack prowess by this
   * amount" mode alongside the outright cancellation — the player chooses one
   * at play time (CoE: "Cancels the attack OR gives the attack -N prowess,
   * your choice"). The reduce-prowess variant resolves through the chain like
   * the cancel variant but lowers the attack's strike prowess uniformly
   * instead of ending combat. Used by The Tormented Earth (as-102, value 3).
   */
  readonly prowessPenalty?: number;
  /**
   * When set, a cost-paying character whose race matches this value pays no
   * cost (the corruption check is skipped). Backs clauses like "Unless he is a
   * Ringwraith, character makes a corruption check…" on The Tormented Earth
   * (as-102, `"ringwraith"`).
   */
  readonly costExemptRace?: Race;
  /**
   * Dual-mode faction cancel (Wild Hounds wh-40). Set on a `cancel-attack`
   * effect carrying `cost: { discard: "self" }` on a dual-alignment faction.
   * The effect has two sources:
   *   - the controlled faction in play, discarded (no covert/alignment gate); and
   *   - the card in hand, played as a minion resource — but ONLY by a character
   *     in a covert company (this flag), and only by a minion (Ringwraith) player.
   * Backs "May also be used as a minion resource card that is only playable by a
   * character in a covert company."
   */
  readonly handModeRequiresCovert?: true;
  /**
   * When true, cancelling this attack additionally grants the defending player
   * a one-shot *deferred* free cancellation of a **later** attack this turn
   * against a company containing The Balrog ("cancel this attack and a latter
   * attack of your choice against his company this turn"). On resolution a
   * turn-scoped `free-attack-cancel` constraint is installed on the defending
   * player; the legal-action layer then offers a costless `cancel-attack`
   * (`mode: "free-later-cancel"`) during a later combat whose defending company
   * contains The Balrog, consuming the constraint. Used by Darkness Wielded
   * (ba-55).
   */
  readonly alsoCancelLaterAttack?: true;
  /**
   * Restricts the {@link alsoCancelLaterAttack} deferred free cancellation to
   * a later attack against a company containing The Balrog avatar ("against
   * his company"). Used by Darkness Wielded (ba-55). Mutually exclusive in
   * practice with {@link alsoCancelLaterAttackSameCompanyOnly}, which scopes
   * to "the company" that played the card instead.
   */
  readonly alsoCancelLaterAttackRestrictToBalrogCompany?: true;
  /**
   * Restricts the {@link alsoCancelLaterAttack} deferred free cancellation to
   * a later attack against the *same* company that played this card ("the
   * next non-unique hazard creature the company faces this turn"). Used by
   * Fifteen Birds in Five Firtrees (dm-129).
   */
  readonly alsoCancelLaterAttackSameCompanyOnly?: true;
  /**
   * Restricts the {@link alsoCancelLaterAttack} deferred free cancellation to
   * an attack sourced from a non-unique hazard creature (`enemy.unique !==
   * true`), mirroring this effect's own `enemy.unique` gate. Used by Fifteen
   * Birds in Five Firtrees (dm-129).
   */
  readonly alsoCancelLaterAttackRequireNonUnique?: true;
  /**
   * When true, cancelling this attack additionally installs a turn-scoped
   * `tap-on-strike-assignment` constraint on the defending company: "An
   * untapped character in the company must tap to face any strike from a
   * subsequent hazard creature attack for the rest of the turn." The
   * `assign-strike` reducer taps the assigned character in place whenever the
   * constraint is present and the attack is hazard-creature-sourced. Used by
   * Fifteen Birds in Five Firtrees (dm-129).
   */
  readonly installsTapOnStrikeAssignment?: true;
  /**
   * When true, the cancel is only available against a company-vs-company
   * combat (`combat.isCvCC`) — "an attack against them by an opponent's
   * company". Used by Going Ever Under Dark (ba-37).
   */
  readonly requiresCvCC?: true;
  /**
   * When true, cancelling this attack (which must be a CvCC combat —
   * paired with {@link requiresCvCC}) additionally forces the attacking
   * company to face all of the site's automatic-attacks again, this time
   * attacking normally rather than as detainment; once those re-faced
   * attacks are resolved (or immediately, if the site has none), the
   * attacking company may declare the CvCC attack again. Used by All the
   * Bells Ringing (as-44): "The attack is canceled and the minion company
   * must face all automatic-attacks of the site—which attack normally, not
   * as detainment. Afterwards, the minion company may attack the hero
   * company again." Handled by `triggerBellsRingingReface` in
   * `combat-cancel.ts`, dispatched from `applyEffect`'s `cancel-attack`
   * branch once the cancellation itself resolves.
   */
  readonly forceSiteAutoAttacksNormalReface?: true;
  /**
   * When set, the cancel is not automatic: paying the cost enqueues a 2d6
   * dice-check that only cancels the attack on success. Backs "make a roll to
   * attempt to cancel an attack … If the roll plus the number of scouts in the
   * company is greater than 7, the attack is canceled" (Going Ever Under Dark
   * ba-37, `skillBonus: "scout"`) and "…the number of rangers in the company…"
   * (Crept Along Carefully ba-29, `skillBonus: "ranger"`). The roller is the
   * defending player; the modified 2d6 total is compared to `threshold` via
   * `comparison`.
   */
  readonly roll?: {
    /** Success requires `roll (+ bonuses) comparison threshold`. */
    readonly threshold: number;
    /** `'gt'` (strictly greater) or `'gte'` (≥). */
    readonly comparison: 'gt' | 'gte';
    /** When set, add the number of characters with this skill in the company to the roll. */
    readonly skillBonus?: Skill;
  };
  /**
   * Site-swap cancellation (Farmer Maggot as-48): "If one of your companies
   * faces an attack while at a site in The Shire, Arthedain, or Cardolan, you
   * may immediately replace its site card with another site card in The Shire,
   * Arthedain, or Cardolan (from your location deck). If your company takes
   * this option, the attack is canceled and this card is discarded."
   *
   * Carried by an in-play resource permanent-event together with
   * `cost: { discard: "self" }`. The cancel is offered only when the defending
   * company is standing **at** a site (not moving — `destinationSite` is null)
   * whose region is one of {@link SiteSwapCancel.regions}; one action is
   * generated per candidate replacement site in the controller's location deck
   * whose region is also in that list. Taking the option replaces the company's
   * current site with the chosen one, discards the host card, and cancels the
   * attack.
   */
  readonly siteSwap?: SiteSwapCancel;
  /**
   * When true, cancelling this attack also abandons any remaining
   * automatic-attacks in the site's sequence for this company's visit —
   * "All automatic-attacks at the site are canceled" (Riven Gate as-98).
   * Sets `SitePhaseState.autoAttacksSkipped = true` (the same "sequence
   * abandoned" flag Farmer Maggot's site-swap and Burglary's success use),
   * so any automatic-attack not yet faced this slot is skipped once the
   * player next passes at the automatic-attacks step. A no-op outside the
   * Site phase.
   */
  readonly cancelsRemainingSiteAttacks?: true;
  /**
   * When set, cancelling this attack also adds a turn-scoped
   * `influence-at-site-modifier` constraint bonusing every faction-influence
   * attempt against a faction at the defending company's current site for
   * the rest of the turn. Used by Riven Gate (as-98, value 2).
   */
  readonly influenceAtSiteModifier?: number;
}

/**
 * The site-replacement payload of a `cancel-attack` effect (Farmer Maggot
 * as-48). Both the company's current site and the replacement drawn from the
 * location deck must lie in one of {@link regions}.
 */
export interface SiteSwapCancel {
  /**
   * Region names (as printed on site cards' `region` field) that both the
   * company's current site and the replacement site must belong to — e.g.
   * `["The Shire", "Arthedain", "Cardolan"]`.
   */
  readonly regions: readonly string[];
}

/**
 * Converts an attacking hazard creature into an ally controlled by the
 * defending company (CoE — *Ready to His Will* le-220, *Memories of Old
 * Torture* ba-67). Carried by a resource permanent-event that the defending
 * player plays during the creature's attack (assign-strikes combat window).
 *
 * On play: all the creature's attacks are canceled (combat ends without
 * resolution), the creature card moves from the attacker's cards-in-play into
 * a chosen controlling character's `allies` list with the stats from `ally`,
 * and the event card is "placed with the creature" — kept in the defender's
 * cards-in-play with `attachedTo` set to the new ally so the two are
 * discarded together.
 *
 * Eligibility: the attacking creature's race must be one of `races` and its
 * printed strike count must be ≤ `maxStrikes` ("one strike for each of its
 * attacks").
 */
export interface ConvertCreatureToAllyEffect extends EffectBase {
  readonly type: 'convert-creature-to-ally';
  /**
   * Canonical {@link Race} values eligible for conversion (matched against the
   * combat's `creatureRace`, e.g. `["orc", "troll"]`).
   */
  readonly races: readonly Race[];
  /** Maximum printed strikes the creature may have (1 for "one strike for each of its attacks"). */
  readonly maxStrikes: number;
  /** Whether the controlling character taps when taking control (le-220: yes; ba-67: no). */
  readonly controllerTaps: boolean;
  /** Stats granted to the resulting ally. */
  readonly ally: {
    /** Fixed mind value for the new ally. */
    readonly mind: number;
    /** Fixed body value for the new ally. */
    readonly body: number;
    /** Amount added to the creature's printed prowess to get the ally's prowess (e.g. -7). */
    readonly prowessModifier: number;
  };
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
    readonly races: ReadonlyArray<Race>;
    readonly threshold: number;
  }>;
  /** Bonus added to the roll when the making character has the diplomat skill. */
  readonly diplomatBonus: number;
  /** Amount to reduce the company's hazard limit on a successful attempt. */
  readonly hazardLimitReduction: number;
}

/**
 * Offering attempt: the bearer's company is facing a creature or Agent
 * attack. A diplomat in the company makes a corruption check first; if he
 * survives, he discards a company item of the listed rank to make an
 * influence roll (2d6 + unused DI). Success (roll > threshold) cancels the
 * attack and offers to fetch one resource card from the play deck or discard
 * pile into hand (reshuffling the play deck if it was searched).
 *
 * Used by Token of Goodwill (dm-160). CRF 22 erratum: "…and make a roll…"
 * should be read "…to make a roll…" — the item discard is the cost that
 * enables the roll, not an unconditional extra step.
 */
export interface GoodwillCancelAttackEffect extends EffectBase {
  readonly type: 'goodwill-cancel-attack';
  /**
   * Race/Agent-to-(item rank, threshold) mappings, matched against the
   * facing attack at play time. `matchAnyAgentAttack` additionally matches
   * any attack whose source is a minion Agent, regardless of race (dm-160:
   * "against … any Agent").
   */
  readonly thresholds: ReadonlyArray<{
    readonly races: ReadonlyArray<Race>;
    readonly matchAnyAgentAttack?: boolean;
    readonly itemSubtype: 'minor' | 'major' | 'greater';
    readonly threshold: number;
  }>;
}

/**
 * Riddling attempt: the bearer's company is facing a creature attack and a
 * character in the company makes a riddling roll (2d6 + `sageBonus` per Sage
 * in the company + `hobbitBonus` per Hobbit in the company) to try to trick
 * the attacker into a fatal slip. Success requires roll > threshold for the
 * attacker's race. On success, the player names a card; the opponent then
 * reveals their hand. If the named card is present, the attack is cancelled
 * and the company's hazard limit is decreased by `hazardLimitReduction`.
 * If the roll fails, or the named card is not in the opponent's hand, the
 * attack proceeds normally.
 *
 * Used by Riddling Talk (td-148). Two-stage resolution: pending kind
 * `'riddling-attempt'` (the roll) enqueues kind `'riddling-guess'` (the
 * naming + reveal) on success.
 */
export interface RiddlingAttemptEffect extends EffectBase {
  readonly type: 'riddling-attempt';
  /**
   * Race-to-threshold mappings. The threshold for the facing creature's
   * race is looked up at play time. Success requires roll > threshold.
   */
  readonly thresholds: ReadonlyArray<{
    readonly races: ReadonlyArray<Race>;
    readonly threshold: number;
  }>;
  /** Bonus added to the roll for each Sage-skilled character in the company. */
  readonly sageBonus: number;
  /** Bonus added to the roll for each Hobbit-race character in the company. */
  readonly hobbitBonus: number;
  /** Amount to reduce the company's hazard limit when the guess succeeds. */
  readonly hazardLimitReduction: number;
}

/**
 * Burglary attempt: playable at a site during the site phase, before any of
 * its automatic-attacks has been faced. Tap a character and the site "in
 * lieu of facing" the site's automatic-attacks, then roll 2d6 modified by
 * `scoutBonus` if the character has the Scout skill and `hobbitBonus` if he
 * is a Hobbit. If the total is greater than `threshold`, the company's
 * automatic-attacks are skipped entirely and an item normally playable at
 * the site may be played with the (tapped) character. Otherwise the
 * character must face all of the site's automatic-attacks alone, with no
 * combat support from the rest of his company.
 *
 * Used by Burglary (td-103). Offered as a bespoke `declare-burglary` action
 * in `legal-actions/site.ts` (not a `play-target`/chain flow); the roll
 * itself is a `burglary-attempt` pending resolution enqueued by the
 * `declare-burglary` reducer in `reducer-site.ts`, so a future on-guard
 * interaction (e.g. Half an Eye Open, td-29, which modifies the roll by -5)
 * can hook the same resolution before it resolves.
 */
export interface BurglaryAttemptEffect extends EffectBase {
  readonly type: 'burglary-attempt';
  /** Roll + modifiers must exceed this for success. */
  readonly threshold: number;
  /** Bonus added to the roll if the character has the Scout skill. */
  readonly scoutBonus: number;
  /** Bonus added to the roll if the character is a Hobbit. */
  readonly hobbitBonus: number;
}

/**
 * Roll-gated counter-cancel (Black Vapour ba-14): a hazard short-event the
 * *attacking* (hazard) player plays during a combat chain to negate an
 * opponent-declared chain entry that would cancel a creature attack of a
 * matching {@link race}. Unlike a plain cancel, the negation is not automatic:
 * on resolution the card enqueues a `dice-check` (roll 2d6 + the attack's
 * current prowess). If the total is greater than {@link threshold} the target
 * cancel entry is negated (the attack survives) and the attack receives
 * {@link prowessBonus} extra prowess; otherwise the cancel resolves normally.
 *
 * Distinct from a marker-only counter-cancel because of the roll: the card is
 * pushed onto the chain as a short-event entry and, when it resolves un-negated
 * (flattery pattern), enqueues the check (`chain-reducer.ts`). The onPass verb
 * is the `counter-cancel-attack` {@link TriggeredAction}.
 *
 * Black Vapour's other mode ("+1 prowess to a Spider attack") is a plain
 * {@link ModifyAttackEffect} (`fromHand`, `player: "attacker"`), which also
 * carries the "reveal as an on-guard card" behaviour for that mode.
 */
export interface CounterCancelAttackRollEffect extends EffectBase {
  readonly type: 'counter-cancel-attack-roll';
  /** Creature races whose cancellation this card may counter (e.g. `"spider"`). */
  readonly race: ReadonlyArray<Race>;
  /** The modified roll total must exceed this for the counter to succeed. */
  readonly threshold: number;
  /** Prowess added to the surviving attack on a successful counter. */
  readonly prowessBonus: number;
}

/**
 * Sets a character's status to one of the three standard values.
 *
 * When `target` is `"target-character"`, applies to the character targeted
 * by a {@link PlayTargetEffect} on the same card (e.g. Escape: the targeted
 * unwounded character is set to `inverted` / wounded as the cost of
 * cancelling the attack). When `target` is `"company"`, applies to every
 * character in the bearer's company (e.g. Strangling Coils ba-76 untaps the
 * whole company). When `target` is absent, applies to the bearer.
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
  readonly requiredRace?: Race;
  /**
   * A skill required on the character who pays the cost (e.g. "shadow-magic").
   * Checked against the character's skills array plus any item-granted skills.
   * May be combined with {@link requiredRace}: both must match when both are set.
   */
  readonly requiredSkill?: string;
  /**
   * Restricts cancellation to specific target kinds. When present, the
   * cancel-influence action is only available when the pending
   * `opponent-influence-defend` resolution's `targetKind` appears in this list.
   * When absent (or empty), all target kinds are valid.
   */
  readonly targetKindFilter?: readonly ('character' | 'ally' | 'faction' | 'item')[];
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
 * Played from hand as a short event during the assign-strikes phase, targeting
 * a character (or, with `includeAllies`, an ally) in the defending company
 * meeting the eligibility gate (a required skill and/or a generic `filter`).
 * No strike from the current attack may be assigned to that target for the
 * rest of the attack's assign-strikes phase.
 *
 * Unlike `cancel-attack` (which cancels the entire attack), this only prevents
 * assignment to the targeted character/ally — other company members may still
 * be assigned strikes normally.
 *
 * Used by Ruse (le-225) mode B: play on a scout facing an attack; no strikes
 * of the attack may be assigned to the scout — `requiredSkill: "scout"`.
 *
 * Sojourn in Shadows (wh-49): play on any character in a shadow-magic-using
 * character's company — `filter: { "company.hasShadowMagicUser": true }` (the
 * eligibility context mirrors `organization-events.ts`'s play-target context:
 * `target.*` character fields plus `company.hasShadowMagicUser`) — and
 * `corruptionCheck` forces the company's shadow-magic user (skipped entirely
 * if a Ringwraith qualifies) to check at the given modifier.
 *
 * More Sense than You (td-140): "Playable before strikes are assigned on an
 * untapped character or ally … Tap target character or ally. He may not be
 * assigned a strike from this attack." — `includeAllies: true` widens the
 * candidate pool to allies (in addition to characters), `requireUntapped:
 * true` restricts eligibility to untapped targets, and `tapTarget: true` taps
 * the chosen target as a side effect of playing the card.
 */
export interface ProtectFromStrikeAssignmentEffect extends EffectBase {
  readonly type: 'protect-from-strike-assignment';
  /** The skill required on the character to be protected (e.g. "scout"). */
  readonly requiredSkill?: string;
  /**
   * Generic eligibility filter, evaluated per candidate character against
   * `{ target: { race, status, skills, name, mind, keywords, itemKeywords,
   * itemNames, isAvatar, homeSiteTypes }, company: { skills, hasShadowMagicUser } }`.
   * Combined with `requiredSkill` via AND when both are present. Not
   * evaluated against ally candidates (`includeAllies`) — only `requireUntapped`
   * applies to those.
   */
  readonly filter?: Condition;
  /**
   * When true, allies hosted by the defending company are also eligible
   * targets, not just characters (More Sense than You td-140: "character or
   * ally"). `requiredSkill`/`filter` are not evaluated against ally candidates.
   */
  readonly includeAllies?: true;
  /**
   * When true, only an untapped candidate (character or ally) is a legal
   * target — a tapped candidate is skipped entirely (More Sense than You
   * td-140: "on an untapped character or ally").
   */
  readonly requireUntapped?: true;
  /**
   * When true, playing this card taps the chosen target as a side effect,
   * in addition to protecting it from strike assignment (More Sense than You
   * td-140: "Tap target character or ally.").
   */
  readonly tapTarget?: true;
  /**
   * When present, playing this protection also forces a corruption check
   * (CoE "unless he is a Ringwraith" wording): the company's shadow-magic
   * user (Ringwraith by race, or `skills` includes `"shadow-magic"`) makes a
   * corruption check at `modifier`. If any qualifying shadow-magic user is a
   * Ringwraith, no check is made at all. `on: 'shadow-magic-user'` is
   * currently the only supported source.
   */
  readonly corruptionCheck?: {
    readonly modifier: number;
    readonly on: 'shadow-magic-user';
  };
}

/**
 * Played from hand during strike resolution as a short event.
 * Covers three distinct mechanical modes, selected by `dodge` / `reroll` flags:
 *
 * - **Default** (neither flag): prowess/body modifier. The card accumulates
 *   `prowessBonus` and `bodyPenalty` on the current strike; the character
 *   still taps normally. An optional `requiredSkill` gates availability and
 *   enforces the "one skill-requiring resource per strike" rule (CoE 3.iv.5).
 *   Example: Risky Blow (tw-319) — Warrior only, +3 prowess and -1 body.
 *
 * - **`dodge: true`**: the character resolves the strike without tapping
 *   (unless wounded). `bodyPenalty` applies to the body check only if wounded.
 *   The strike otherwise uses the character's full prowess.
 *   Example: Dodge (tw-209) — no tap; if wounded, body −1.
 *
 * - **`reroll: true`**: the strike is resolved by making two 2d6 rolls and
 *   using the better result. The character taps normally (tap-to-fight).
 *   An optional `filter` gates availability on the strike target character.
 *   Example: Lucky Strike (tw-270) — Warrior only; roll twice, take better.
 *
 * - **`cancel: true`**: the strike is canceled outright, no roll made. Like
 *   dodge and reroll, an optional `filter` gates availability on the strike
 *   target character (e.g. race and/or skill). Resolves immediately (no
 *   chain — matches the item-based `cancel-strike` and `flee-from-strike`
 *   precedent of not offering the opponent a response window).
 *   Example: Orc Stealth (le-217) — Orc scout only; cancels one strike
 *   against an Orc scout.
 *
 * A `dodge` effect may instead carry `cost: { tap: "self" }`, marking it as
 * an in-play item/ally ability (not a hand-played short event): the bearer's
 * item taps itself to dodge one strike against its own bearer, rather than
 * being played from hand and discarded. Emits a `dodge-strike` action
 * (resolved immediately, no chain — same item-tap convention as
 * `cancel-strike`) instead of `play-strike-event`. Example: Great-shield of
 * Rohan (tw-250) — Warrior only, tap to remain untapped against one strike
 * (unless the bearer is wounded by the strike).
 */
export interface StrikeModifierEffect extends EffectBase {
  readonly type: 'strike-modifier';
  /** If true: character resolves the strike without tapping (dodge mode). */
  readonly dodge?: true;
  /** If true: roll twice and use the better result (reroll mode). */
  readonly reroll?: true;
  /** If true: the strike is canceled outright, no roll made (cancel mode). */
  readonly cancel?: true;
  /** Prowess bonus for this strike (+/−). Used in default and dodge modes. */
  readonly prowessBonus?: number;
  /** Body modifier applied on the body check (typically negative). */
  readonly bodyPenalty?: number;
  /** Optional skill the struck character must have (default and dodge modes). */
  readonly requiredSkill?: string;
  /** Filter condition on the strike target character (reroll and cancel modes). */
  readonly filter?: Condition;
  /**
   * When present, this is an in-play item/ally ability rather than a
   * hand-played short event: the source taps itself to protect its own
   * bearer against the current strike (dodge mode only). Absent for
   * hand-played strike-modifier cards.
   */
  readonly cost?: ActionCost;
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
 *
 * The effect may also be declared on an in-play **ally** with
 * `cost: { "tap": "self" }`: the ally taps to modify an attack against
 * its controlling character's company. Used by Great Bats (as-74) with
 * `removeAttackerChoosesDefenders` — tap to remove the "attacker chooses
 * defending characters" rule from the attack.
 */
export interface ModifyAttackEffect extends EffectBase {
  readonly type: 'modify-attack';
  /**
   * Activation scope.
   * - Absent (default): whole-attack modifier, available during the
   *   `assign-strikes` pre-assignment window. Applies `prowessModifier` to
   *   `CombatState.strikeProwess` (affects every defender) and `bodyModifier`
   *   to `CombatState.creatureBody`. Used by Black Arrow and Star-glass.
   * - `"current-strike"`: single-strike modifier, available during the
   *   `resolve-strike` phase. Applies `prowessModifier` to
   *   `StrikeAssignment.strikeProwessBonus` and (if set) `bodyModifier` to
   *   a per-strike `StrikeAssignment.strikeCreatureBodyModifier` — both
   *   benefit only the current strike, not the whole attack. The item must
   *   belong to the current strike target; a `cost: { tap: "self" }` item
   *   must also be untapped (a `cost: { discard: "self" }` item has no
   *   status requirement — it leaves play either way). Activates via the
   *   `tap-item-for-strike` action type (used for both cost variants). Used
   *   by Shield of Iron-bound Ash (tw-327): tap to gain +1 prowess against
   *   one strike. Used by Arrows Shorn of Ebony (td-99): discard to give
   *   -1 prowess, -2 body to one hazard-creature strike not keyed to a
   *   site (see {@link cascadeDefeatOnSuccess}).
   */
  readonly scope?: 'current-strike';
  /**
   * Cost to activate. `{ tap: "self" }` taps the item (e.g. Black Arrow,
   * Shield of Iron-bound Ash); `{ tap: "bearer" }` taps only the item's
   * bearer without tapping the item itself (e.g. Star-glass).
   * Absent when `fromHand` is true (hand cards are discarded, not tapped).
   */
  readonly cost?: ActionCost;
  /**
   * `"current-strike"` scope only. When true, the modifier applies
   * automatically to every strike whose target is the item's own bearer —
   * no action, no cost, no consumption. Mutually exclusive with `cost` /
   * `fromHand`. Only `prowessModifier` is honoured in this mode (added
   * directly to the defender's effective prowess for the strike, exactly
   * like the activated `current-strike` path's `StrikeAssignment.strikeProwessBonus`);
   * `bodyModifier` is not read here — a passive body reduction against the
   * *attacker* should instead use `body-check-modifier`'s `scope:
   * "bearer-combat"` with `when: { "bodyCheck.fromFailedStrike": true }`,
   * which (unlike this scope's `bodyModifier`) also covers CvCC. Used by
   * Morgul-blade (le-205): "Each strike against the Ringwraith receives...
   * -1 prowess" (expressed as `prowessModifier: 1`, favouring the bearer).
   */
  readonly passive?: true;
  /**
   * When true, the card is played from hand and discarded — not an in-play item.
   * Either the `attacker` (hazard player) or the `defender` (resource player)
   * may play, controlled by the `player` field.
   */
  readonly fromHand?: true;
  /**
   * When true, the source is an **in-play dual-mode creature permanent-event**
   * ({@link CreatureAltEventEffect} mode `permanent-event`, non-persistent) that
   * the hazard player converts to a short-event during the opponent's
   * movement/hazard phase: the card leaves play, is discarded, counts one
   * against the company's hazard limit, and applies its modifiers to the live
   * attack. Offered in the same pre-assignment combat window as `fromHand`, so
   * "any one attack" resolves to the attack actually being fought. Because the
   * conversion happens here, `tap-alt-permanent-event` is neither offered nor
   * accepted for such a card. Used by Hoarmûrath of Dír (tw-44): "When tapped,
   * Hoarmûrath of Dír becomes a short-event and gives +1 strike to any one
   * attack." Mutually exclusive with {@link fromHand}; requires {@link player}.
   */
  readonly fromAltPermanentEvent?: true;
  /**
   * Which side plays the card when `fromHand` / `fromAltPermanentEvent` is true.
   * `"attacker"` — the hazard player; `"defender"` — the resource player.
   */
  readonly player?: 'attacker' | 'defender';
  /**
   * When true, a corruption check is enqueued on the bearer immediately after
   * the attack is modified. Used by items like Star-glass
   * ("Bearer makes a corruption check").
   */
  readonly enqueueCorruptionCheck?: true;
  /** Amount added to the attack's strike prowess or current-strike prowess bonus. */
  readonly prowessModifier?: number;
  /**
   * Alternative to {@link prowessModifier}: a MathJS value expression
   * evaluated at play time instead of a flat number, for a bonus that scales
   * with in-play state. The expression context exposes
   * `nazgulPermanentEventsInPlay` — the count of Nazgûl permanent-events
   * currently in play across both players (see
   * {@link countNazgulPermanentEventsInPlay}). Used by The Pale Sword
   * (tw-97): "If played on a company facing an attack from the Witch-king of
   * Angmar, his prowess is increased by +1 plus the number of Nazgûl
   * permanent-events in play" — `"1 + nazgulPermanentEventsInPlay"`. The
   * result is rounded to the nearest integer. A card sets either this or
   * {@link prowessModifier}, never both.
   */
  readonly prowessModifierExpr?: string;
  /**
   * Amount added to the creature's body value for the creature body check.
   * Whole-attack scope: added persistently to `CombatState.creatureBody`.
   * `"current-strike"` scope: added only to this one strike's own creature
   * body check (`StrikeAssignment.strikeCreatureBodyModifier`) — not
   * persisted, so it has no effect on any other strike of the attack.
   */
  readonly bodyModifier?: number;
  /**
   * Amount added to the attack's total strike count (whole-attack scope only, usually negative).
   * The result is clamped to a minimum of 1.
   */
  readonly strikesModifier?: number;
  /**
   * When set (from-hand path, whole-attack scope), the attack's total strike
   * count is *set* to this exact value rather than adjusted by a delta —
   * "the attack is reduced to one strike" (`setStrikesTo: 1`). The result never
   * exceeds the attack's current strike count (it only reduces) and is clamped
   * to a minimum of 1. Used by Darkness Wielded (ba-55). Mutually exclusive with
   * {@link strikesModifier}.
   */
  readonly setStrikesTo?: number;
  /**
   * When true (from-hand attacker plays only), the buffed attack gains
   * "cancel protection": the first attempt to cancel the attack instead
   * removes this card's modifiers ({@link CombatState.cancelProtection}),
   * leaving the (now unmodified) attack in play. The card is still spent.
   * Used by Unabated in Malice (ba-26): "The first attempt to cancel this
   * attack instead cancels the effects of this card."
   */
  readonly firstCancelRemovesEffect?: true;
  /**
   * When true, activating removes the "attacker chooses defending characters"
   * rule from the current attack: {@link CombatState.attackerChoosesDefenders}
   * is cleared so the defending player assigns strikes normally. The action is
   * only offered while the attack actually carries the rule. Declared on
   * in-play allies with `cost: { tap: "self" }` (e.g. Great Bats, as-74).
   */
  readonly removeAttackerChoosesDefenders?: true;
  /**
   * When true (from-hand path), the current attack loses its detainment status
   * — {@link CombatState.detainment} is set to `false` — so its strikes wound
   * (and can eliminate) normally instead of merely tapping. Used by the
   * attacker-played FEAR! FIRE! FOES! (as-29) Mode B: "playable on a detainment
   * automatic-attack. Against a minion company the attack becomes normal (not
   * detainment) and has -1 prowess." Gate the play with `when` on
   * `attack.detainment` (and, for as-29, `defender.minionCompany`).
   */
  readonly removeDetainment?: true;
  /**
   * When set, the item is discarded instead of tapped if the bearer's
   * race is NOT in `race`. The modifier still applies (whole-attack scope only).
   */
  readonly discardIfBearerNot?: {
    readonly race: readonly Race[];
  };
  /**
   * `"current-strike"` scope only. When true, if this modified strike
   * ultimately resolves as defeated (`StrikeAssignment.result` ends as
   * `'success'` — including passing any creature body check triggered by
   * this strike), every other still-unresolved strike of the same attack
   * automatically resolves as defeated too — `CombatState.forcedStrikeDefeat`
   * is set. Used by Arrows Shorn of Ebony (td-99): "If this strike is
   * defeated, all other subsequent failed strikes from this attack are
   * automatically defeated."
   */
  readonly cascadeDefeatOnSuccess?: true;
  /**
   * When set (`fromHand` path only), playing the card schedules a post-attack
   * conditional split instead of (or alongside) any stat modifiers: if the
   * attack is not fully defeated, every character still in the defending
   * company at combat finalization rolls 2d6 plus his mind against
   * `threshold`; each character whose total is strictly below it splits off
   * into his own company sharing the same site path, facing a separate
   * movement/hazard phase this turn with a hazard limit of one (see
   * {@link Company.forcedSoloHazardLimit}). Unlike {@link LeftBehindSplitEffect},
   * there is no explicit "may rejoin" — the split company merges back through
   * the normal rule 2.IV.6 same-site auto-merge once its own separate phase
   * ends. Used by Turning Hope to Despair (as-41): "If the attack is not
   * defeated, each character in the company makes a roll and adds his mind.
   * If the result is less than 11, the character splits off..."
   */
  readonly postAttackMindRollSplit?: { readonly threshold: number };
  /**
   * When true (`fromHand` path, attacker-played only), playing the card
   * additionally schedules a post-attack dynamic corruption attachment:
   * {@link CombatState.pendingCorruptionAttach} is set, and at combat
   * finalization the card (already discarded, like any other from-hand
   * `modify-attack`) is spliced out of its owner's discard pile and attached
   * as a corruption card to the first character wounded by the attack who
   * has not already had a corruption card played on him this turn (CoE
   * 7.2.1). If no eligible character was wounded, the card simply remains
   * discarded. The corruption-point value itself comes from the card's own
   * `stat-modifier` effect (evaluated once attached, exactly like any other
   * attached corruption card) — this flag only controls *whether* and
   * *where* the card attaches. Used by Icy Touch (td-33): "The next
   * character wounded by the attack (on whom a corruption card has not
   * already been played this turn) receives 2 corruption points (place this
   * card with the character). Discard Icy Touch if it is not played with a
   * character."
   */
  readonly attachCorruptionOnWound?: true;
  /**
   * When true (`fromHand` path, attacker-played only), playing the card grants
   * "attacker chooses defending characters" for the current attack —
   * {@link CombatState.attackerChoosesDefenders} is set. If strike assignment
   * has not yet started (`CombatState.assignmentPhase === 'defender'`, the
   * only phase reachable while this card is still playable), assignment
   * control is handed straight to the attacker (`assignmentPhase: 'attacker'`)
   * rather than waiting for a defender pass — there is no `'cancel-window'`
   * step to unwind since the card itself resolves inside that same
   * pre-assignment opportunity. The opposite of {@link removeAttackerChoosesDefenders}.
   * Used by Adûnaphel Unleashed (le-161) Mode B: "playable on any attack by a
   * lone Adûnaphel the Ringwraith. You choose defending characters."
   */
  readonly grantAttackerChoosesDefenders?: true;
  /**
   * When set (`fromHand` path), adds to {@link CombatState.bodyCheckModifier}
   * for the rest of this combat — every body check the attack produces
   * (creature and character alike) is modified by this amount, on top of the
   * already-wounded +1 and any item/global modifiers. Distinct from
   * {@link bodyModifier}, which changes the creature's own body *stat* rather
   * than the body-check roll. Used by Adûnaphel Unleashed (le-161) Mode B:
   * "Any resulting body checks for defending characters are modified by +2."
   */
  readonly bodyCheckModifier?: number;
  /**
   * When set (`fromHand` path, whole-attack scope), overrides the prowess
   * penalty for the *first* excess strike assigned to each defending
   * character this attack — {@link CombatState.firstExcessStrikePenalty}.
   * Normally each excess strike costs a flat -1 prowess
   * (`StrikeAssignment.excessStrikes`); with this set, a character's first
   * excess strike costs this amount instead, and any further excess strikes
   * on the same character still cost -1 each (so total penalty for N excess
   * strikes on one character is `firstExcessStrikePenalty + (N - 1)`). Used
   * by Pierced by Many Wounds (dm-79): "The first excess strike assigned to
   * each character gives a -4 modification to his prowess instead of -1."
   */
  readonly firstExcessStrikePenalty?: number;
}

/**
 * An in-play item (or character-attached permanent event) that may be tapped
 * during a creature/automatic-attack's strike-assignment window to let its
 * bearer face one of the attack's strikes **regardless of the attack's normal
 * capabilities and the bearer's status** — i.e. the bearer takes on a strike
 * even while tapped or wounded, and even when the attack's normal rules would
 * not direct a strike at him. Offered only to the defending player during the
 * `assign-strikes` defender phase, while the item is untapped, its bearer is in
 * the defending company, and an unassigned strike remains. Activating taps the
 * item and adds a forced strike assignment to the bearer.
 *
 * If `bodyReductionOnParry` is set and the bearer subsequently defeats (parries)
 * that strike — the strike "fails" to wound him — the attack's body
 * ({@link CombatState.creatureBody}) is reduced by that amount for the rest of
 * the combat, making the creature easier to defeat via its own body checks.
 *
 * Used by Bow of Alatar (wh-90): "you may tap Bow of Alatar to allow him to face
 * a strike from an attack against his company regardless of the attack's normal
 * capabilities and his status. If such a strike fails, the attack's body is
 * reduced by 1."
 */
export interface FaceStrikeOnTapEffect extends EffectBase {
  readonly type: 'face-strike-on-tap';
  /**
   * Amount subtracted from the attack's body (floored at 0) when the bearer
   * parries the strike he faced via this ability. Omit for no body reduction.
   */
  readonly bodyReductionOnParry?: number;
}

/**
 * Grants the bearer, at the moment he is assigned the *first* strike of an
 * attack (`CombatState.strikeAssignments.length === 0`), the option to face
 * every remaining strike of that attack himself instead of the strikes being
 * distributed across the company — CoE rule 3.i.5: "If a character is
 * assigned to more than one strike from an attack, a separate strike
 * sequence is initiated for each strike." The choice must be declared before
 * any other strike is assigned, matching the rule's "must be declared before
 * strikes are assigned."
 *
 * Implemented by letting the defender's `assign-strike` action on this
 * character carry `allStrikes: true`; the reducer then runs the same
 * multi-attack auto-assignment loop used for `CombatState.forceSingleTarget`
 * (`handleAssignStrike`, `reducer-combat.ts`), building one assignment per
 * remaining strike — each with `excessStrikes: 0` (a full separate sequence),
 * not merged into the "excess strikes" -1-prowess pool a repeat assignment
 * would otherwise produce. `assignStrikeActions` (`legal-actions/combat.ts`)
 * offers both the plain single-strike assignment and this `allStrikes`
 * variant so the player may still decline.
 *
 * Used by Horn of Defiance (td-183): "If its bearer is the first to face a
 * strike, that character may choose to face all strikes of an attack. The
 * character faces a separate strike sequence for each strike."
 */
export interface FaceAllStrikesOptionEffect extends EffectBase {
  readonly type: 'face-all-strikes-option';
}

/**
 * A hand-played short event that, once played during the pre-assignment
 * window of an attack (before any strike of that attack has been assigned —
 * CoE 3.i.5's "must be declared before strikes are assigned"), grants the
 * defending player a standing option for the rest of that attack's
 * assignment: any character in the defending company who carries
 * `requiredSkill` and has already been assigned a strike may be assigned an
 * *additional* strike from the same attack. CoE 3.i.5 still applies — each
 * additional strike is a genuinely separate strike sequence, not merged into
 * the "excess strikes" -1-prowess pool a repeat assignment would otherwise
 * produce (CoE 3.iv.2) — but unlike a plain excess strike, every strike
 * beyond the character's first accumulates a -1 prowess **and** -1 body
 * penalty (via `StrikeAssignment.strikeProwessBonus` /
 * `StrikeAssignment.strikeBodyPenalty`, not `excessStrikes`, since the
 * latter would double-count the strike against `combat.strikesTotal` — see
 * `handleAssignStrike`, `reducer-combat.ts`).
 *
 * Used by Many Foes He Fought (td-131): "If defender chooses a warrior to be
 * the target of a strike from an attack, that character may choose to face
 * any number of the strikes from that attack. The character suffers a
 * cumulative -1 prowess/-1 body for each additional strike faced. The
 * character faces a separate strike sequence for each strike."
 */
export interface MultiStrikeOptionEffect extends EffectBase {
  readonly type: 'multi-strike-option';
  /** The skill required on the character choosing to face extra strikes. */
  readonly requiredSkill: string;
}

/**
 * Overrides an item's printed marshalling/corruption points once its
 * `ItemInPlay.restored` flag is set (see {@link RestoreItemAction}). Declared
 * on the item alongside the `restore-item` grant-action; read directly by
 * `recompute-derived.ts`'s per-item corruption and marshalling-point loops,
 * which substitute these values for the printed `corruptionPoints` /
 * `marshallingPoints` fields whenever `item.restored` is true. Fields absent
 * here leave the printed value untouched even once restored.
 *
 * Used by Horn of Defiance (td-183): "Once restored, Horn of Defiance gives 3
 * marshalling points and 2 corruption points" — printed 1 MP / 1 CP become
 * `{ marshallingPoints: 3, corruptionPoints: 2 }`.
 */
export interface RestoredItemStatsEffect extends EffectBase {
  readonly type: 'restored-item-stats';
  /** Marshalling points the item gives once restored, replacing the printed value. */
  readonly marshallingPoints?: number;
  /** Corruption points the item gives once restored, replacing the printed value. */
  readonly corruptionPoints?: number;
}

/**
 * `combat-cancel-weapon` — an in-play item ability, usable only during a
 * company-vs-company combat (CvCC) in which the item's bearer's company is a
 * participant. The controller pays the {@link cost} (tapping the item) and
 * chooses one weapon (a `weapon`-keyword item) borne by a character in the
 * *opponent's* company; that weapon's effects are cancelled for the rest of the
 * combat via {@link CombatState.suppressedWeaponInstanceIds}. The weapon is NOT
 * discarded — only its effects are nulled, and only until the combat ends.
 *
 * Because a weapon's contribution is always evaluated live from the item on the
 * character (never a separate chain entry), a weapon that was just declared onto
 * a character during the current combat's chain of effects is suppressed
 * identically to one already in play — backing the "(even declared in the same
 * chain of effects)" clause with no extra chain plumbing.
 *
 * Used by Whip of Many Thongs (ba-82): "If The Balrog is in company vs. company
 * combat, tap this item to cancel all effects of one weapon of your choice (even
 * declared in the same chain of effects) in an opponent's company until the end
 * of the combat. This does not discard the weapon." The item is borne by The
 * Balrog (a Balrog-specific item, exempt from the usual "items on the Balrog
 * have no effect" ban).
 */
export interface CombatCancelWeaponEffect extends EffectBase {
  readonly type: 'combat-cancel-weapon';
  /** The cost to activate — tapping the item itself (`{ tap: "self" }`). */
  readonly cost?: ActionCost;
}

/**
 * `join-combat-force-strike` — a resource short-event played by the defending
 * player during the pre-assignment window of the `assign-strikes` combat
 * sub-phase (the same window as {@link CompanyCombatBoostEffect}). It brings a
 * named character (e.g. The Balrog) into the defending company if absent —
 * "considered movement with no movement/hazard phase", so only the company
 * membership arrays change — forces that character to face a strike from the
 * current attack regardless of conflicting effects (via
 * {@link CombatState.forcedStrikeTargets}, whose status gate is bypassed for a
 * forced target), and optionally taps the character after the attack if still
 * untapped (via a {@link PostAttackEffect} with `tapIfUntapped`).
 *
 * Used by Vanguard of Might (ba-79): "Playable if a company at or moving to an
 * Under-deeps site is facing an attack and Flame of Udûn is not in play. If not
 * in the company, The Balrog immediately joins the company. … The Balrog must
 * face a strike from the attack, regardless of any conflicting effects.
 * Following the attack, if untapped, tap The Balrog."
 */
export interface JoinCombatForceStrikeEffect extends EffectBase {
  readonly type: 'join-combat-force-strike';
  /** Name of the character who joins the defending company and must face a strike. */
  readonly characterName: string;
  /** When true, tap the character after the attack if still untapped. */
  readonly tapAfterAttack?: boolean;
  /**
   * Site keyword the defending company must be at (currentSite) or moving to
   * (destinationSite) for the event to be playable, e.g. `"under-deeps"`.
   */
  readonly requiresSiteKeyword?: string;
  /** Name of a card that must NOT be in play for the event to be playable (e.g. "Flame of Udûn"). */
  readonly notInPlay?: string;
}

/**
 * `combat-discard-opponent-item` — a Balrog resource short-event played during
 * a **company-vs-company combat** in which The Balrog is untapped and a
 * participant. On play, the card-player chooses one item borne by any character
 * in the *opposing* company and discards it (to the opponent's discard pile),
 * modeled via a {@link discard-one-company-item} pending resolution on that
 * company. The Balrog-untapped + in-CvCC gate and the opponent's company are
 * resolved in the legal-action emitter (`combatDiscardOpponentItemActions` in
 * `engine/legal-actions/combat.ts`) and the reducer branch
 * (`handlePlayResourceShortEvent` in `engine/reducer-events.ts`).
 *
 * Used by Scourge of Fire (ba-75): "Choose and discard one item an opponent's
 * company bears if The Balrog is untapped and in company vs. company combat with
 * that company. Cannot be duplicated on a given turn." The play-restriction
 * (Balrog-specific, playable only if Flame of Udûn is in play) is carried by the
 * `balrog-specific` keyword and a `card-in-play` play-condition; the
 * once-per-turn limit by a `duplication-limit` effect with `scope: "turn"`.
 */
export interface CombatDiscardOpponentItemEffect extends EffectBase {
  readonly type: 'combat-discard-opponent-item';
}

/**
 * Crowned with Storm (ba-54): a Balrog CvCC resource short-event that unleashes
 * a devastating storm on **everyone at the site** — both the Balrog's company
 * and the opposing (Wizard's) company participating in the company-vs-company
 * combat. When it resolves, in this fixed order:
 *
 * 1. **Discard all no-body allies** at the site (an ally whose effective body
 *    is `0`/absent — e.g. Great Bats, Regiment of Black Crows). They are removed
 *    to their owners' discard piles before any roll.
 * 2. **Tap** every untapped ally and every untapped character *with a mind stat*
 *    at the site (avatars — Balrog/Wizard/Ringwraith — have a `null` printed
 *    mind and are left untapped). Applied before the rolls; because tapping only
 *    ever affects untapped cards and the roll outcome (wound/eliminate) does not
 *    depend on status, the observable end-state is identical to applying the tap
 *    after the rolls.
 * 3. **Roll** for each character whose mind is `< characterMindBelow` and each
 *    ally normally worth `< allyMpBelow` marshalling points (the printed MP of
 *    the ally card): the Balrog's controller rolls 2d6 per target. If
 *    `roll - 1 > body`, the target is wounded, or — if already wounded
 *    (inverted) — eliminated. Enqueued as one generic `dice-check` per target
 *    with `comparison: 'gt'`, `threshold = body + 1`, and a `wound-or-eliminate`
 *    onPass verb (see {@link WoundOrEliminateAction}), so each roll surfaces as
 *    its own explicit roll action. No-body allies discarded in step 1 never
 *    reach this step.
 *
 * Playability is gated by the legal-action emitter (`siteStormAtSiteActions` in
 * `legal-actions/combat.ts`): the combat must be CvCC, the Balrog's controller
 * must own one of the two companies with The Balrog in it, that company's site
 * must **not** carry the `under-deeps` keyword, and the opposing company must
 * contain a Wizard (a character of race `wizard`).
 */
export interface SiteStormDevastationEffect extends EffectBase {
  readonly type: 'site-storm-devastation';
  /** Characters with a mind stat strictly below this value are rolled against. */
  readonly characterMindBelow: number;
  /** Allies whose printed MP value is strictly below this value are rolled against. */
  readonly allyMpBelow: number;
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
  /**
   * When true the card may only be stored once it is itself **tapped**
   * ({@link CardStatus.Tapped}). Used by Pass the Doors of Dol Guldur
   * (dm-154): "If tapped, this card can be stored at a Haven [{H}]" — the
   * card's tap is the rescue it records, so an untapped copy has nothing to
   * store. Applies to the company-bound `cardsInPlay` storage path (the card
   * has no bearer); character-borne items ignore it.
   */
  readonly requiresTapped?: boolean;
}

/**
 * Item-cache host, mode "hand store" (Armory dm-116): during the
 * controller's organization phase, an item of a matching subtype may be
 * moved directly from the controller's hand into the set-aside pile kept
 * with this card (`CardInPlay.setAside`, via `placeCardSetAside`), rather
 * than being played. The stored item earns no marshalling points on its own
 * (`setAsideNoMp`) — only the cache's own {@link ItemCacheCountBonusEffect},
 * if present, scores anything for it.
 */
export interface ItemCacheHandStoreEffect extends EffectBase {
  readonly type: 'item-cache-hand-store';
  /** Item subtypes eligible to be moved from hand into the cache. */
  readonly subtypes: readonly ('minor' | 'major' | 'greater' | 'gold-ring' | 'special')[];
}

/**
 * Item-cache host, mode "alternate storage" (Armory dm-116): "A character at
 * a Haven can store a minor item under Armory instead of to your marshalling
 * point pile." Offered as an additional destination alongside the normal
 * `store-item` action (CoE rule 2.II.4) whenever a matching item is storable
 * at a site whose type is in `siteTypes`; choosing it moves the item into
 * this card's set-aside pile instead of the marshalling-point kill pile,
 * scoring no individual marshalling points (`setAsideNoMp`).
 */
export interface ItemCacheAltStorageEffect extends EffectBase {
  readonly type: 'item-cache-alt-storage';
  /** Site types where the cache destination is offered (e.g. any Haven). */
  readonly siteTypes: readonly SiteType[];
  /** Item subtypes eligible for the cache destination. */
  readonly subtypes: readonly ('minor' | 'major' | 'greater' | 'gold-ring' | 'special')[];
}

/**
 * Item-cache host, mode "play source" (Armory dm-116): "When you otherwise
 * would be allowed to play a minor item from your hand at a Border-hold,
 * Free-hold, or Haven, you may play an item from under Armory instead."
 * Items set aside under this host (via {@link ItemCacheHandStoreEffect} or
 * {@link ItemCacheAltStorageEffect}) are merged into the normal hand-card
 * loop when the active company's site's effective type is in `siteTypes`,
 * exactly like a hand card — every ordinary item-play gate (site resource
 * type, uniqueness, untapped bearer) still applies. Mirrors the
 * `play-target: targetsSetAside` shape already used by Great Secrets Buried
 * There (dm-63), generalized to a declarable site-type list instead of a
 * hardcoded Under-deeps check.
 */
export interface ItemCachePlaySourceEffect extends EffectBase {
  readonly type: 'item-cache-play-source';
  /** Site types where cached items are playable as though in hand. */
  readonly siteTypes: readonly SiteType[];
}

/**
 * Item-cache host, count-threshold marshalling-point bonus (Armory dm-116):
 * "If you have at least three minor items under Armory, gain 1 marshalling
 * point." Scored once per qualifying host in `recompute-derived.ts` by
 * counting the host's `CardInPlay.setAside` list — the same shape as
 * `leader-control`'s `groupBonus`, applied to a card-count instead of a
 * faction-count.
 */
export interface ItemCacheCountBonusEffect extends EffectBase {
  readonly type: 'item-cache-count-bonus';
  /** Minimum number of cards set aside under this host to earn the bonus. */
  readonly count: number;
  /** Marshalling points awarded (misc category) once the threshold is met. */
  readonly mp: number;
}

/**
 * Storage-site transfer (Wizard's Trove wh-85, "Alternatively" mode): playing
 * this permanent event *is* the act of storing one marshalling-point card at a
 * site the storing card could not normally be stored at — "any reference to
 * the site where the card can normally be stored are transferred instead" to
 * the chosen site.
 *
 * Offered during the controller's organization phase (Stage resource timing)
 * for every (item, bearer) pair where:
 * - the bearer's company is at a site matching `siteFilter` (matched against
 *   the site definition extended with `regionType` and `effectiveSiteType`,
 *   exactly like a site `play-target` filter — Wizard's Trove uses
 *   `{ "effectiveSiteType": "haven" }` for "one of your Wizardhavens"), and
 * - the item carries a `storable-at` effect with an explicit
 *   `marshallingPoints` override (the "marshalling point card" reading: a card
 *   that scores its own MP value from storage, e.g. Sapling of the White Tree,
 *   Book of Mazarbul — as opposed to regular items stored at any Haven).
 *
 * On chain resolution the item is stored exactly like a `store-item` action
 * (moved to the marshalling-point pile, initial bearer makes a corruption
 * check, `bearer-cannot-untap` constraints from the stored card are cleared),
 * the stored pile entry is stamped with `storedAtSite` = the chosen site, and
 * the resolving event enters play with {@link CardInPlay.attachedToStored}
 * pointing at the stored card. While the event remains in play and
 * `fullMarshallingPoints` is set, the stored card scores its full declared
 * storage MP — exempt from the MEWH §4 Fallen-wizard flat-1 clamp and the
 * MELE cross-alignment halving ("which is worth full marshalling points").
 */
export interface StorageSiteTransferEffect extends EffectBase {
  readonly type: 'storage-site-transfer';
  /** Condition the storage site must match (site definition + `regionType` + `effectiveSiteType` context). */
  readonly siteFilter?: Condition;
  /** When true, the stored card scores its full storage MP while this card is in play (no §4 clamp, no cross-alignment halving). */
  readonly fullMarshallingPoints?: boolean;
}

/**
 * Play a named card from hand together with this card at a site where another
 * named card is stored (Wizard's Trove wh-85, primary mode: "You may play The
 * White Tree at one of your Wizardhavens [{H}] if Sapling of the White Tree is
 * stored there").
 *
 * Offered during the controller's organization phase (Stage resource timing)
 * when:
 * - a card named `cardName` is in the controller's hand, and
 * - the controller's marshalling-point pile holds a card named
 *   `requiresStored` whose {@link CardInstance.storedAtSite} names a site
 *   matching `siteFilter` (same matching context as a site `play-target`
 *   filter). Since `storedAtSite` is only stamped by the storage flows, this
 *   naturally requires the companion combo piece to have been stored first
 *   (for Wizard's Trove: a Sapling stored at a Wizardhaven via a previous
 *   Wizard's Trove `storage-site-transfer`).
 *
 * On chain resolution both cards enter play: the companion `cardName` card is
 * taken from hand into `cardsInPlay` and this card is linked to it via
 * `linkedInstanceId` (mutual discard — "Place Wizard's Trove with The White
 * Tree"). The companion:
 * - is stamped `mpPinned` = its printed MP when `fullMarshallingPoints` is set
 *   ("worth full marshalling points" — overrides the MEWH §4 clamp), and
 * - is stamped {@link CardInPlay.textIgnored} when `ignoreCardText` is set
 *   ("Ignore the text of The White Tree (including the Unique keyword)"): its
 *   own play requirements/effects are never evaluated and its name is excluded
 *   from the in-play names list, so uniqueness does not bind.
 *
 * When `siteBecomesProtected` is set, an `until-cleared` `site-protected`
 * constraint bound to the chosen site is added for the controller ("Your
 * Wizardhaven [{H}] becomes protected"), sourced from this card so it is
 * cleared if this card leaves play.
 */
export interface PlayWithStoredCardEffect extends EffectBase {
  readonly type: 'play-with-stored-card';
  /** Name of the card played from hand together with this card (e.g. "The White Tree"). */
  readonly cardName: string;
  /** Name of the card that must be stored (`storedAtSite`) at the target site (e.g. "Sapling of the White Tree"). */
  readonly requiresStored: string;
  /** Condition the target site must match (site definition + `regionType` + `effectiveSiteType` context). */
  readonly siteFilter?: Condition;
  /** When true, the companion card enters play `mpPinned` to its printed MP ("worth full marshalling points"). */
  readonly fullMarshallingPoints?: boolean;
  /** When true, an `until-cleared` `site-protected` constraint for the target site is added for the controller. */
  readonly siteBecomesProtected?: boolean;
  /** When true, the companion enters play with its text ignored (no effects, uniqueness does not bind). */
  readonly ignoreCardText?: boolean;
}

/**
 * Declarative restriction on when this card may be played at all, checked by
 * the legal-action computer before offering the play action.
 *
 * - `only-at-site-with-auto-attack` — playable only on a company moving to a
 *   site with at least one automatic-attack. Used by Tidings of Bold Spies
 *   (le-143): "Playable on a company moving to a site with an
 *   automatic-attack."
 *
 * - `unplayable-when` — the card cannot be played while the inherited `when`
 *   condition matches the play context
 *   `{ actor: { alignment }, opponent: { alignment } }` (the acting player and
 *   their opponent). `reason` is the human-readable explanation surfaced in the
 *   not-playable tooltip. This carries the opponent-conditional play bans that
 *   are otherwise invisible in deck construction: MEBA's "if you are a Balrog
 *   player, your opponent may not play …" list (with the CoE 3.10 mirror-match
 *   exemption expressed as `actor.alignment: { $ne: "balrog" }`) and CoE 1.35's
 *   cards with no effect against a Ringwraith player. Example (Durin's Bane
 *   dm-107):
 *
 * ```json
 * { "type": "play-restriction", "rule": "unplayable-when",
 *   "when": { "opponent.alignment": "balrog",
 *             "actor.alignment": { "$ne": "balrog" } },
 *   "reason": "cannot be played against a Balrog player (MEBA)" }
 * ```
 */
export interface PlayRestrictionEffect extends EffectBase {
  readonly type: 'play-restriction';
  readonly rule: 'only-at-site-with-auto-attack' | 'unplayable-when';
  /** For `unplayable-when`: tooltip text explaining why the card is not playable. */
  readonly reason?: string;
}

/**
 * Declarative **deck-construction** restriction, the build-time sibling of
 * {@link PlayRestrictionEffect}. Read by `validateDeck` (`deck-validation.ts`),
 * never by the engine at play time — a card carrying one of these rules is
 * rejected (or admitted) while the deck list is being checked, so the
 * situation never reaches the table.
 *
 * - `excluded-from-deck` — the card may not appear in any non-location section
 *   of a deck whose alignment matches the inherited `when` condition,
 *   evaluated against `{ deck: { alignment } }` (`"hero" | "minion" |
 *   "fallen-wizard" | "balrog"`). `reason` names the CoE rule and is quoted in
 *   the error message (`<alignment> deck: "<name>" is not allowed (<reason>)`).
 *   This carries the rule 1.18 Fallen-wizard ban list and the rule 1.23 Balrog
 *   ban list; a card banned for both sides declares one effect per rule so each
 *   error still cites the rule that produced it.
 *
 * ```json
 * { "type": "deck-restriction", "rule": "excluded-from-deck",
 *   "when": { "deck.alignment": "fallen-wizard" }, "reason": "rule 1.18" }
 * ```
 *
 * - `any-location-deck` — a Balrog site with no hero or minion counterpart
 *   (Ancient Deep-hold, The Wind-deeps, The Drowning-deeps, The Rusted-deeps,
 *   Remains of Thangorodrim). Rule 1.25 / CoE 1.4.1 lets *any* player put one
 *   copy in their location deck, so the hero (1.26) and minion (1.27) location
 *   deck checks admit it despite its `balrog-site` card type. Every other
 *   Balrog site still requires a Balrog player's deck.
 *
 * - `superseded-by-balrog-site` — a **minion** site that has a Balrog-specific
 *   reprint (Moria, Carn Dûm, Dol Guldur, Minas Morgul). Rule 1.29: a Balrog
 *   player must use the Balrog version, so the minion original is rejected
 *   from a Balrog location deck.
 */
export interface DeckRestrictionEffect extends EffectBase {
  readonly type: 'deck-restriction';
  readonly rule: 'excluded-from-deck' | 'any-location-deck' | 'superseded-by-balrog-site';
  /**
   * For `excluded-from-deck`: the CoE rule cited in the validation error
   * (e.g. `"rule 1.18"`).
   */
  readonly reason?: string;
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
 * If the condition is not met, the card is not offered as a legal action.
 */
export interface PlayConditionEffect extends EffectBase {
  readonly type: 'play-condition';
  readonly requires: 'site-path' | 'discard-named-card' | 'discard-keyword-card' | 'combat-creature-race' | 'target-company' | 'site-type' | 'card-not-in-play' | 'card-in-play' | 'site-has-resource' | 'company-has-item' | 'same-site-has-character-race' | 'active-company' | 'company-context' | 'player-state' | 'phase' | 'region-through-or-leave' | 'site-protected' | 'company-site' | 'card-attached-to-site' | 'card-on-adjacent-under-deeps' | 'card-stored-at-site' | 'supporters-in-region' | 'active-player-deck-size' | 'card-player-deck-size' | 'card-count-exceeds';
  /**
   * For `requires: 'phase'`: the phases during which the card may be played.
   * A permanent resource-event is otherwise offered in **both** the
   * organization and the site phase; a card whose text names one of them
   * ("Playable on a leader during the organization phase" — No More Nonsense
   * le-210) declares it here, e.g. `{ "requires": "phase", "phases":
   * ["organization"] }`. Values are {@link Phase} strings.
   */
  readonly phases?: readonly string[];
  /**
   * `requires: 'site-protected'` takes no extra fields. On a faction it gates
   * the influence attempt on the company's current site being **protected by
   * the controller** — an active `site-protected` constraint (added by a stage
   * permanent-event such as Guarded Haven wh-74) bound to the site's definition
   * id and owned by the player attempting the play. Used by Half-orcs (wh-87)
   * and Greater Half-orcs (wh-86): "Playable at one of your protected
   * Wizardhavens [{H}]".
   *
   * For `requires: 'card-attached-to-site'`: the permanent-event is only
   * playable at the active company's current site when a card named
   * {@link cardName} is in play attached to that same site (`attachedToSite`,
   * either player's `cardsInPlay`). Lord and Usurper (ba-65): "Playable …
   * on Invade Their Domain" — Invade Their Domain must already be attached to
   * the Dwarf-hold the company occupies.
   *
   * For `requires: 'card-on-adjacent-under-deeps'`: the permanent-event is only
   * playable at the active company's current site when a card named
   * {@link cardName} is in play attached to an **Under-deeps site adjacent to
   * that site** (an in-play card whose `attachedToSite` names an Under-deeps
   * site whose `adjacentSites` map includes the current site's name). Invade
   * Their Domain (ba-64): "… if … Breach the Hold is on its adjacent Under-deeps
   * site" — Breach the Hold sits on The Drowning-deeps (adjacent to the Blue
   * Mountain Dwarf-hold) or The Rusted-deeps (adjacent to the Iron Hill
   * Dwarf-hold).
   *
   * For `requires: 'card-stored-at-site'`: the permanent-event is only
   * playable at the active company's current site when the playing player's
   * marshalling-point pile (`killPile`) holds a card named {@link cardName}
   * stamped `storedAtSite` with that same site's definition id. Unlike
   * `card-attached-to-site` (an in-play card physically attached to the
   * site), this checks a *stored* item — placed there by the normal item
   * storage flow (`storable-at`). Mallorn (dm-148): "Playable at Bag End only
   * if Earth of Galadriel's Orchard is stored there."
   */
  /**
   * For `requires: 'region-through-or-leave'`: the named regions one of which
   * the target company must either *leave* (the origin region of region
   * movement) or *move through without stopping* (an intermediate region of
   * the region-movement path). The card is only playable when the active
   * company is using **region** movement and at least one of these named
   * regions appears in its resolved site path excluding the destination
   * region (the region where the company stops at a site). Used by Cruel
   * Caradhras (td-9).
   */
  readonly regionNames?: readonly string[];
  /**
   * For `requires: 'active-company'`: a generic DSL condition evaluated
   * against the active (site-phase) company's aggregate context:
   * `{ site: { name, type }, company: { itemNames, characterNames,
   * allyNames } }`. `itemNames`/`allyNames` are the names of all items /
   * allies borne by any character in the company; `characterNames` lists
   * the company's characters. Lets a card declare a positional play
   * prerequisite — e.g. The One Ring (and Gollum) at Mount Doom for the
   * CoE 10.39 win cards — without a per-card keyword.
   *
   * For `requires: 'company-context'`: a generic DSL condition evaluated
   * against the **play-target character's company** (for a character-targeting
   * permanent event), exposing `{ site: { name, type, isOwnWizardhaven },
   * company: { characterNames, itemNames, allyNames,
   * playedUniqueHeroFactionAtFreeHold } }`. `itemNames` aggregates every item /
   * attached permanent event borne by any character in the company, so a card
   * can gate on "in the same company as <named card>" (the named card being
   * attached to a company-mate). `site.isOwnWizardhaven` is `true` when the
   * company's current site is one of the player's own Wizardhavens (a
   * Fallen-wizard haven, or a Hidden-Haven-converted site), the meaning of "at
   * one of your Wizardhavens [{H}]" — distinct from a generic haven that merely
   * shares `type: "haven"`. `playedUniqueHeroFactionAtFreeHold` is `true` only
   * during the site phase and only for the active company once it has, this site
   * phase, successfully played a unique hero faction at a Free-hold that is not
   * Bag End. Unlike `active-company` (evaluated against the site-phase active
   * company for short-events), this condition is evaluated per target company in
   * the character-target permanent-event play paths (organization + site phases).
   * Used by To Fealty Sworn (ba-33): "Playable on a Hobbit: in the same company
   * as Return of the King or during the same site phase his company plays a
   * unique hero faction at a Free-hold [{F}] (not Bag End)." — and the
   * Fallen-wizard squire companions (Squire of the Hunt wh-95) via
   * `{ "site.isOwnWizardhaven": true }`.
   *
   * For `requires: 'company-site'`: a generic DSL condition evaluated,
   * during the M/H play-hazards step, against the active company's relevant
   * site — its **destination** site when moving, otherwise its current site —
   * exposing `{ site: { name, siteType, region, keywords } }`. Lets a hazard
   * short-event gate on where the targeted company is (or is moving) without a
   * per-card keyword. Used by Glance of Arien (ba-19): "Playable on The Balrog
   * at or moving to a non-Under-deeps site" via
   * `{ "$not": { "site.keywords": { "$includes": "under-deeps" } } }`.
   *
   * For `requires: 'player-state'`: a generic DSL condition evaluated
   * against the active player's avatar/alignment context:
   * `{ player: { alignment, hasRingwraithInPlay }, opponent: { alignment } }`
   * where `alignment` is the card-text alignment string (`"wizard"`,
   * `"ringwraith"`, `"fallen-wizard"`, `"balrog"`) and
   * `player.hasRingwraithInPlay` is `true` when the active player has a
   * Ringwraith-race avatar character in play. Lets a card gate on the
   * opposing player's alignment and the controller's revealed avatar —
   * e.g. Above the Abyss (as-77): "if your opponent is a Wizard and your
   * Ringwraith is in play". Evaluated for resource short-events in
   * `legal-actions/organization.ts`.
   *
   * For `requires: 'site-protected'`: no extra payload — the site the
   * permanent-event is being played on (the active company's current site)
   * must already be **protected** for the playing player, i.e. carry an active
   * `site-protected` constraint owned by that player (added by The Fortress of
   * Isen wh-68 / Fortress of the Towers wh-69 / Guarded Haven wh-74). Used by
   * Saruman's Machinery (wh-120): "Playable … on your protected Isengard or
   * your protected The White Towers." Evaluated for site-attached permanent
   * events in `legal-actions/site.ts`.
   */
  readonly condition?: Condition;
  /**
   * For `requires: 'discard-named-card'`: the card name that must be
   * discarded as a play prerequisite. Legal-action generation searches
   * the specified {@link sources} for a card with this name.
   *
   * For `requires: 'card-in-play'`: the card name that MUST be in play (as a
   * character or in any player's cardsInPlay) for the card to be playable.
   * Used by Snowstorm (tw-91): "Playable if Doors of Night is in play."
   *
   * For `requires: 'card-count-exceeds'`: the name of the card whose
   * controller-held count must exceed {@link comparedToCardName}'s. See that
   * field for the full description.
   */
  readonly cardName?: string;
  /**
   * For `requires: 'card-count-exceeds'`: the controlling player must hold
   * strictly more copies of {@link cardName} in play than of this card name
   * (both counted via `countPlayerHeldCopies` — the player's `cardsInPlay`
   * plus items attached to their characters). Evaluated in
   * `legal-actions/site.ts` for site-phase permanent events. Used by
   * Earth-eater (wh-67): "Playable during the site phase if … you have more
   * Delver's Harvest cards in play than you have Earth-eater cards" —
   * `{ "requires": "card-count-exceeds", "cardName": "Delver's Harvest",
   * "comparedToCardName": "Earth-eater" }`.
   */
  readonly comparedToCardName?: string;
  /**
   * For `requires: 'discard-keyword-card'`: the structural **keyword** every
   * candidate discard must carry on its definition (e.g. `"stolen-knowledge"`).
   * The keyword variant is otherwise identical to `discard-named-card` — the
   * same {@link sources} are searched and the chosen candidate rides the play
   * action's `discardCardInstanceId` — but it matches a *family* of cards
   * rather than one printing. Used by Pass the Doors of Dol Guldur (dm-154):
   * "Playable on a company if the company discards (for no effect) a Stolen
   * Knowledge card it controls" — any of Dark Numbers (dm-123), Knowledge of
   * the Enemy (dm-147), … qualifies. The discard is "for no effect": the card
   * is moved straight to its owner's discard pile without any of its own
   * discard-triggered abilities firing.
   */
  readonly cardKeyword?: string;
  /**
   * Where to look for the named (or keyword-matched) card.
   * - `character-items` — items on characters at the current site. For the
   *   company-scoped `discard-keyword-card` variant this means the items of
   *   the characters of the company being played on ("a card it controls").
   * - `kill-pile` — the player's marshalling point pile, where successfully
   *   stored items are placed (CoE rule 2.II.4.1). Used by The White Tree to
   *   discard a Sapling stored at Minas Tirith.
   * - `cards-in-play` — the player's `cardsInPlay`, where bare permanent
   *   events live. For the company-scoped `discard-keyword-card` variant only
   *   entries bound to the target company (`CardInPlay.companyId`) count, so
   *   the discard really is a card *that company* controls.
   *
   * Also used for `requires: 'card-not-in-play'`: the card name that must
   * NOT be in play (as a character or in any player's cardsInPlay) for the
   * card to be playable.
   */
  readonly sources?: readonly ('character-items' | 'kill-pile' | 'cards-in-play')[];
  /**
   * For `requires: 'combat-creature-race'`: the required attacker race
   * (lowercase, e.g. `"dragon"`). When the current combat's
   * `creatureRace` does not match, the card is non-playable.
   *
   * For `requires: 'same-site-has-character-race'`: the character race
   * (e.g. `"ringwraith"`) that must appear in at least one of the
   * controller's companies at the same site as the target's company.
   */
  readonly race?: Race;
  /**
   * For `requires: 'site-type'`: the site types at which the event may be
   * played. Only offered when the active company's current site type is in
   * this list. Used by Glamour of Surpassing Excellence (as-49):
   * `["border-hold", "free-hold"]`.
   *
   * For `requires: 'site-has-resource'`: the item subtype that must appear
   * in the active company's current site's `playableResources` list
   * (e.g. `"information"`). Only offered when the site supports that
   * resource subtype.
   *
   * For `requires: 'company-has-item'`: the item subtype that at least one
   * character in the active company must be carrying (e.g. `"gold-ring"`).
   */
  readonly siteTypes?: readonly string[];
  /**
   * For `requires: 'site-has-resource'` and `requires: 'company-has-item'`:
   * the item subtype to check (e.g. `"information"`, `"gold-ring"`).
   */
  readonly subtype?: string;
  /**
   * For `requires: 'supporters-in-region'`: the minimum combined count of the
   * playing player's **allies in play** plus their **unique factions in play
   * that can be played at a site in the target Wizardhaven's region or an
   * adjacent region**. Only offered when that combined count reaches this
   * threshold. Used by Girdle of Radagast (wh-110): "… have at least … 6 allies
   * and/or unique factions in play (the factions must be playable at sites in
   * the Wizardhaven's [{H}] region or adjacent regions)."
   */
  readonly min?: number;
  /**
   * For `requires: 'active-player-deck-size'`: the minimum number of cards
   * {@link GameState.activePlayer}'s play deck must hold. `GameState.activePlayer`
   * is always the correct party to check regardless of which "side" of the
   * card's text is being evaluated: a hazard permanent-event is only ever
   * declared by the *non*-active player against the active company's owner
   * ("opponent" in the card text = the active player), and a
   * `playable-as-resource` self-cast permanent-event is only ever declared by
   * the active player on themself ("you" = the active player). Used by Great
   * Secrets Buried There (dm-63): "Playable if opponent has at least ten cards
   * in his play deck" / "you may play this card as a resource on yourself if
   * you have at least ten cards in your play deck."
   *
   * For `requires: 'card-player-deck-size'`: the minimum number of cards the
   * player actually declaring this play must hold in their own play deck —
   * always "you" in the card text, regardless of side. Diverges from
   * `active-player-deck-size` whenever the card is played by the *non*-active
   * player against their own deck size rather than the active player's: Long
   * Dark Reach (dm-70), a hazard short-event, "if you have at least ten cards
   * in your play deck" gates on the hazard player's own deck, not the moving
   * (active) company owner's.
   */
  readonly minDeckSize?: number;
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
  readonly exclude: readonly Race[];
  /** Fixed race used when no choice is offered (e.g. Dragon's Desolation). */
  readonly fixedRace?: Race;
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
 * Used by Call of Home (tw-18, le-105), Tookish Blood (tw-104), and Call of
 * the Sea (tw-19).
 */
export interface CallOfHomeCheckEffect extends EffectBase {
  readonly type: 'call-of-home-check';
  /** Roll + unused GI must meet or exceed this to keep the character. */
  readonly threshold: number;
  /**
   * Optional roll adjustments evaluated at enqueue time against
   * `{ company: { sitePathRegionTypes: RegionType[] } }` — the region types
   * traveled by the target's company on its resolved path this turn. The
   * values of all matching entries are added to the roll. Used by Call of
   * the Sea (tw-19): "modified by -3 if the character's company moved this
   * turn using a site path containing a Coastal Sea."
   */
  readonly rollModifiers?: readonly {
    readonly when: Condition;
    readonly value: number;
  }[];
}

/**
 * Tookish Blood (tw-104), resource mode: played as a resource on the
 * controller's own Hobbit, it protects that character from being discarded or
 * returned to hand "for the rest of the turn … for any reason." Resolution
 * installs a turn-scoped `character-removal-protected` constraint on the target
 * (see `engine/removal-protection.ts`); the central return/discard helpers
 * consult it. The eligible target is expressed by the companion `play-target`
 * effect's `filter` (Hobbit), reused across both the hazard and resource modes.
 */
export interface ProtectFromRemovalEffect extends EffectBase {
  readonly type: 'protect-from-removal';
  /** How long the protection lasts. Currently only `'turn'` (rest of the turn). */
  readonly duration: 'turn';
}

/**
 * While the carrying card (a resource long-event) is in play, no character —
 * either player's — currently standing at a site whose effective
 * {@link SiteType} is in `siteTypes` may be discarded or returned to hand for
 * any reason. Unlike {@link ProtectFromRemovalEffect} (a turn-scoped
 * constraint on one selected character), this is a continuous, location-gated
 * protection over a dynamic population: a character gains it the moment it
 * stands at a matching site and loses it the moment it leaves, for as long as
 * the carrying long-event stays in play.
 *
 * Checked by `isSiteRemovalProtected` (`engine/removal-protection.ts`)
 * alongside the turn-scoped `character-removal-protected` constraint,
 * consulted by the same two central helpers (`returnCharacterToHand` /
 * `discardCharacter` in `pending-reducers.ts`). Because those helpers back
 * every removal path (dice-check returns, CoE 3.47 influence overflow, body
 * checks, …), this also covers the CRF-22 ruling that Elf-song "will
 * effectively stop influence attempts against characters" — no extra wiring
 * needed.
 *
 * Used by Elf-song (tw-223): "While Elf-song is in play, no character at a
 * Haven [{H}] may be discarded or returned to its owner's hand for any
 * reason."
 */
export interface RemovalProtectionEffect extends EffectBase {
  readonly type: 'removal-protection';
  /** Site types (e.g. `"haven"`) a character must currently occupy to be protected. */
  readonly siteTypes: readonly SiteType[];
}

/**
 * Forces a body or corruption check on every character in the active company
 * when this hazard short event resolves.
 *
 * For `check: "body"`:
 * Each character rolls 2d6. Per CoE 3.I.1, the check fails if roll >
 * (character.body + modifier); it passes if roll <= (character.body +
 * modifier).
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
 * When this hazard short-event resolves, **every character in play — both
 * players'** — must make a check. Enqueued as one `corruption-check`
 * {@link PendingResolution} per character, actor = the character's
 * controller, honouring the sequencing printed on the source card:
 *
 *  - The moving player (the active player whose M/H phase this is) makes
 *    their checks first — the declaring player's checks carry `blockedBy`
 *    referencing the moving player's resolution IDs.
 *  - Each player decides the order of their own characters' checks —
 *    every enqueued check carries `selectableOrder: true`.
 *  - `declarerMayTapSupport` grants the declaring player's checks
 *    `allowSupport` (company mates tap for +1, the Free Council mechanic).
 *  - `declarerNoResourceAid` marks the declaring player's checks
 *    `noResourceAid` (no reactive resource plays from hand to aid them).
 *
 * Used by Ren the Unclean (tw-83) as the on-tap short-event conversion of
 * its permanent-event mode: "each character in play must make a corruption
 * check. If you tap Ren the Unclean, then you cannot play resources to aid
 * your character's corruption checks. Your characters may tap in support.
 * The moving player makes corruption checks first. Each player decides the
 * order of the corruption checks for their characters."
 */
export interface ForceCheckAllInPlayEffect extends EffectBase {
  readonly type: 'force-check-all-in-play';
  /** Which check every character in play must make (`"corruption"`). */
  readonly check: 'corruption';
  /** Roll modifier applied to every check (default 0). */
  readonly modifier?: number;
  /** The declaring player's characters' checks allow tap-in-support (+1 each). */
  readonly declarerMayTapSupport?: boolean;
  /** The declaring player may not play resources from hand to aid their checks. */
  readonly declarerNoResourceAid?: boolean;
}

/**
 * When this hazard short-event resolves, **every faction in play — both
 * players'** — is rolled for and discarded on a bad result. Untargeted (no
 * `play-target`): the card's own text names the scope ("each player" /
 * "each faction he has in play"), so it needs no per-faction action —
 * generalizes the single-faction `play-target: "faction"` + `dice-check`
 * shape (Muster Disperses le-126/tw-67) to a sweep of every faction card
 * currently in either player's `cardsInPlay`.
 *
 * One `dice-check` {@link PendingResolution} is enqueued per faction found,
 * roller = that faction's own controller, modifier = that controller's
 * unused general influence, `onFail` discards the faction to its owner's
 * discard pile. All entries share `continuation: { kind: 'chain-entry',
 * match: 'source', drainSameSource: true }` so the chain entry stays
 * unresolved until every faction's roll is in — mirrors the
 * `force-check-all-company` "all company members" pattern. A faction whose
 * roll matches `alwaysFailRolls` (the card's "result is 2 or 3" clause)
 * discards regardless of the modified total.
 *
 * Used by News of Doom (le-127): "Each player makes a roll for each faction
 * he has in play. Discard any faction if its result is 2 or 3, or if its
 * result plus that player's unused general influence is less than 10."
 */
export interface MultiFactionCheckEffect extends EffectBase {
  readonly type: 'multi-faction-check';
  /** Pre-resolved threshold the modified total (roll + unused GI) must reach to survive. */
  readonly threshold: number;
  /** Pass condition: `'gt'` (strictly greater) or `'gte'` (≥). */
  readonly comparison: 'gt' | 'gte';
  /** Raw (pre-modifier) 2d6 values that always discard the faction regardless of the modified total. */
  readonly alwaysFailRolls?: readonly number[];
}

/**
 * When this short-event resolves, the **target character's controller** must
 * discard one item borne by that character — the choosing player picks which,
 * so the effect is a forced discard with an owner-chosen victim.
 *
 * Both halves of the choice are DSL conditions rather than hardcoded keywords:
 *
 *  - `targetFilter` narrows which characters the card-player may aim at. It is
 *    evaluated against the shared play-option context
 *    (`buildPlayOptionContext`), so it can read state as well as printed data —
 *    `{ "target.status": "inverted" }` is "a wounded character".
 *  - `itemFilter` narrows which of that character's items are eligible. It is
 *    evaluated against the item's card definition, so
 *    `{ "$not": { "keywords": { "$includes": "ring" } } }` is "but not a ring".
 *
 * Only characters that match `targetFilter` **and** bear at least one item
 * matching `itemFilter` are offered as targets — a card with no legal victim is
 * never playable "without effect" (CoE 9.6). Resolution enqueues the shared
 * `discard-one-company-item` pending resolution narrowed to that one character,
 * so Leaf Brooch (dm-171) style `discard-substitute` items interpose exactly as
 * they do for Brigands (tw-17).
 *
 * Used by Indûr Dawndeath (tw-46) as the on-tap short-event conversion of its
 * permanent-event mode: "makes any wounded character discard an item of his
 * choice (but not a ring)."
 */
export interface ForceDiscardTargetItemEffect extends EffectBase {
  readonly type: 'force-discard-target-item';
  /** Condition on a candidate target character (play-option context). */
  readonly targetFilter?: Condition;
  /** Condition on a candidate item's card definition. */
  readonly itemFilter?: Condition;
}

/**
 * When this short-event resolves, every attack made by a creature of one of
 * the named races receives the given prowess/strike bonus **for the rest of
 * the turn** — an untargeted, standing buff rather than a modifier on one
 * named attack ({@link ModifyAttackEffect}).
 *
 * Resolution installs a turn-scoped `creature-attack-boost` active constraint
 * — the same constraint kind Chill Douser (dm-106) places when its attack
 * survives — targeting the **opponent of the declaring player**, i.e. the
 * player whose companies face hazards this turn. A player-targeted constraint
 * covers every one of that player's companies, so the boost reaches hazard
 * creature attacks and site automatic-attacks alike, matching "all X attacks".
 *
 * Used by Dwar of Waw (tw-31) as the on-tap short-event conversion of its
 * permanent-event mode: "gives +1 prowess to all Wolf, Spider, and Animal
 * attacks until the end of the turn."
 */
export interface AttackRaceBoostEffect extends EffectBase {
  readonly type: 'attack-race-boost';
  /** Creature races whose attacks receive the boost. */
  readonly races: readonly Race[];
  /** Prowess added to every matching attack (default 0). */
  readonly prowess?: number;
  /** Strikes added to every matching attack (default 0). */
  readonly strikes?: number;
}

/**
 * When this short-event resolves, the **one character named when it was played
 * (or tapped)** has the given stat modified for the rest of the turn.
 *
 * Resolution installs a turn-scoped `character-stat-modifier` active constraint
 * bound to that character instance — the same kind Vilya and Glance of Arien
 * (ba-19) place — so the modifier flows through `collectCharacterStatModifier
 * Effects` into the character's `effectiveStats` and is swept at end of turn.
 * The difference from ba-19's `on-event: self-enters-play → add-constraint`
 * shape is *when* it fires: this effect resolves only on the **short-event**
 * chain path, so a dual-mode creature sitting in play as a permanent-event
 * grants nothing until it is tapped and converts (§56c).
 *
 * `targetFilter` (optional) narrows which characters the card-player may aim
 * at, evaluated against the shared play-option context exactly as
 * {@link ForceDiscardTargetItemEffect.targetFilter}. Omit it for "any one
 * character".
 *
 * Used by Akhôrahil (tw-4) as the on-tap short-event conversion of its
 * permanent-event mode: "modifies any one character's body by -1 for the rest
 * of this turn."
 */
export interface TargetCharacterStatModifierEffect extends EffectBase {
  readonly type: 'target-character-stat-modifier';
  /** The stat modified on the named character. */
  readonly stat: 'prowess' | 'body' | 'direct-influence';
  /** Signed modifier applied for the rest of the turn (negative to reduce). */
  readonly value: number;
  /** Condition on a candidate target character (play-option context). */
  readonly targetFilter?: Condition;
}

/**
 * Hazard short-event that makes **each character** in the target company face
 * one strike (not part of a creature attack — "not an attack"). The strike has
 * a fixed prowess, carries no creature race, and resolves through the normal
 * combat machinery (one strike per character, body checks on a successful
 * strike). Used by Cruel Caradhras (td-9): "Each character in target company
 * must face one strike (not an attack) of 8 prowess which cannot be canceled.
 * Any resulting body check is modified by +1."
 *
 * Resolution (chain-reducer): when the event resolves during the M/H phase, a
 * {@link CombatState} is initiated against the active company with
 * `strikesTotal = company.characters.length`, `strikeProwess = prowess`, no
 * creature race/body, `uncancelable`, and `bodyCheckModifier` threaded into the
 * character body check. Because the attack has no creature race and is
 * uncancelable, creature-attack triggers and cancel-attack cards do not apply —
 * matching the "not an attack" wording.
 */
export interface CompanyStrikeEffect extends EffectBase {
  readonly type: 'company-strike';
  /** Prowess of the single strike each character faces (e.g. `8`). */
  readonly prowess: number;
  /** When true, the strikes cannot be canceled (maps to combat `uncancelable`). */
  readonly uncancelable?: boolean;
  /**
   * Amount added to each resulting body-check roll (positive = more likely to
   * wound/eliminate). Cruel Caradhras uses `+1`.
   */
  readonly bodyCheckModifier?: number;
}

/**
 * When this hazard short-event resolves on the active movement/hazard company,
 * tap every untapped character in that company whose effective mind is strictly
 * below the {@link mindBelow} threshold and that satisfies the optional
 * {@link filter}. The threshold is a {@link ValueExpr} evaluated with a context
 * exposing `spawnCardsInPlay` (the number of `spawn`-keyword cards currently in
 * play, per "the number of Spawn cards in play"). Already-tapped or wounded
 * characters are left as-is (only untapped characters can be tapped).
 *
 * Used by The Reek (ba-23): "Tap all untapped characters in the company with a
 * mind less than 2 plus the number of Spawn cards in play. … Does not affect
 * Wizards or Ringwraiths." (`mindBelow: "2 + spawnCardsInPlay"`, `filter`
 * excluding the wizard and ringwraith races).
 */
export interface CompanyTapCharactersEffect extends EffectBase {
  readonly type: 'company-tap-characters';
  /**
   * Mind threshold expression. A character is tapped only if its effective mind
   * is strictly below this value. Context exposes `spawnCardsInPlay`. When
   * absent, no mind gate applies — every untapped character matching `filter`
   * is tapped (Heedless Revelry le-114 on-guard mode: "Tap all untapped
   * non-Ringwraith, non-Wizard characters in the company").
   */
  readonly mindBelow?: ValueExpr;
  /**
   * Optional per-character filter (context `{ target: { race, mind, name,
   * skills } }`). Only matching characters are tapped — e.g. excluding Wizards
   * and Ringwraiths.
   */
  readonly filter?: Condition;
}

/**
 * When this hazard short-event resolves on the active movement/hazard company,
 * roll 2d6 for each **untapped** character in that company matching the
 * optional {@link filter}. Each roll is adjusted by the first matching entry in
 * {@link rollModifiers}; if the modified result is strictly greater than the
 * character's effective mind, the character becomes tapped. The rolls are made
 * one at a time by the company's controller via a `company-tap-roll`
 * {@link PendingResolution}.
 *
 * Used by Heedless Revelry (le-114): "Make a roll for each untapped non-Wizard
 * character in the company; modify this roll by -2 for hero characters. If the
 * result is greater than the character's mind, the character becomes tapped."
 */
export interface CompanyTapRollEffect extends EffectBase {
  readonly type: 'company-tap-roll';
  /**
   * Optional per-character filter (context `{ target: { race, mind, name,
   * skills, cardType } }`). Only untapped characters matching it roll — e.g.
   * excluding the wizard race.
   */
  readonly filter?: Condition;
  /**
   * Per-character roll adjustments. Each entry's `when` condition is evaluated
   * against the same `{ target }` context as `filter`; the values of all
   * matching entries are added to that character's roll (e.g. `-2` when
   * `target.cardType` is `hero-character`).
   */
  readonly rollModifiers?: readonly {
    readonly when: Condition;
    readonly value: number;
  }[];
}

/**
 * When this resource short-event resolves on a company, roll 2d6 for each
 * hazard permanent-event attached to characters in that company. If the roll
 * exceeds the hazard's `removalNumber` (or 8 if not set), the hazard is
 * discarded. One {@link PendingResolution} of kind `dice-check` is
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
 * Left Behind (td-41): a hazard **short-event** played by the attacking (hazard)
 * player during a combat in which the defending company is facing an attack of
 * `minStrikes` or more strikes, targeting a non-Wizard character in that company
 * (via a companion `play-target` `target: 'character'` filter). Following the
 * attack, the targeted character **splits off into a separate company** that has
 * the same site path as the company he was in; that company faces its own
 * (separate) movement/hazard phase this turn with a **hazard limit of one**, and
 * the character may **rejoin** his original company after all movement/hazard
 * phases have finished.
 *
 * On play the reducer (`handleCombatPlayHazard`) schedules a
 * {@link PostAttackEffect} with `leftBehindSplit: true`; the split itself runs at
 * combat finalization (`applyPostAttackEffects`), which peels the character into
 * a new `leftBehind` {@link Company} carrying the same movement (currentSite /
 * destinationSite / movementPath) as the original. The `leftBehind` flag forces
 * that company's hazard-limit snapshot to 1, and the M/H→Site transition enqueues
 * a `left-behind-rejoin` resolution offering the merge back.
 */
export interface LeftBehindSplitEffect extends EffectBase {
  readonly type: 'left-behind-split';
  /** The attack must deliver at least this many strikes for the card to be playable. */
  readonly minStrikes: number;
}

/**
 * A play cost requiring the playing player to discard a card matching `filter`
 * from the named `source` pile as part of playing this card. The discarded card
 * is the player's choice — the legal-action layer offers one action per matching
 * candidate — and (when `revealToOpponent` is set) its identity is shown to the
 * opponent, satisfying a "show opponent" clause. If no matching card is
 * available in the source, the card cannot be played.
 *
 * Used by Faces of the Dead (dm-57): "…if you discard any Undead hazard creature
 * from your hand (show opponent)." (`source: 'hand'`,
 * `filter: { cardType: 'hazard-creature', race: 'undead' }`, `revealToOpponent: true`).
 *
 * `source: 'cards-in-play'` sources the candidate from the playing player's own
 * `cardsInPlay` instead of their hand — used for a **hazard long/permanent
 * event** whose text both requires and spends an existing in-play card, e.g.
 * Scimitars of Steel (dm-86): "Playable only if you have a Nazgûl
 * permanent-event in play. Discard the Nazgûl when this card is brought into
 * play." (`source: 'cards-in-play'`, `filter: { keywords: { $includes:
 * 'Nazgûl' } }`). Absence of a matching candidate makes the card unplayable,
 * which doubles as the "playable only if" gate. Paid at declaration time
 * (`playHazardsActions` / `mh-hazard-play.ts`), matching the short-event cost
 * timing.
 */
export interface PlayDiscardCostEffect extends EffectBase {
  readonly type: 'play-discard-cost';
  /** Source pile from which the cost card is discarded. */
  readonly source: 'hand' | 'cards-in-play';
  /** DSL condition matched against candidate card definitions in the source pile. */
  readonly filter: Condition;
  /** When true, the discarded card's identity is revealed to the opponent. */
  readonly revealToOpponent?: boolean;
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
  /**
   * Body value for body checks after a defeated strike. Absent (or omitted)
   * means the attack has no printed body — a successful strike still wounds the
   * character (with a body check against the character's own body), but a
   * defeated strike triggers no "body check vs creature". Used by region-attack
   * cards such as Mordor in Arms (dm-72) whose Orc/Troll attacks list no body.
   */
  readonly body?: number;
  /** Race of the attacking creature (e.g. "dragon"). */
  readonly race: Race;
  /** Combat rules that apply to the attack (e.g. "attacker-chooses-defenders"). */
  readonly combatRules?: readonly string[];
  /**
   * When set, the card "has no effect on a minion player" — this ahunt attack
   * is skipped when the moving (defending) player is a Ringwraith/Sauron
   * (minion) player. Used by Mordor in Arms (dm-72).
   */
  readonly noEffectOnMinion?: boolean;
  /**
   * Group-reward mechanic. When present, if **every** ahunt attack sourced from
   * this same card instance during a single company's order-effects step is
   * defeated, the card is moved from play into the defending (moving) player's
   * kill pile. Combine with an `mp-in-pile` effect to score the reward MPs.
   * Used by Mordor in Arms (dm-72): "If all three attacks are defeated by your
   * opponent, he receives this card in his MP pile and 2 kill MPs."
   */
  readonly groupReward?: {
    /** Move the card to the defending player's kill pile when all group attacks are defeated. */
    readonly toDefenderKillPile: true;
  };
  /** Extended regions that apply when a condition is met. */
  readonly extended?: {
    readonly when: Condition;
    readonly regionNames?: readonly string[];
    readonly regionTypes?: readonly string[];
  };
}

/**
 * Optional cost-bearing modification the influencer may apply when attempting to
 * bring **this faction** into play. Each option lets the influencing character
 * discard one of its carried items of a given subtype in exchange for a positive
 * modifier to the influence check. The influencer picks at most one option (or
 * none); the discard is paid whether or not the check then succeeds.
 *
 * Used by the Dragons "Roused" factions — Smaug Roused (le-285): "Modifications:
 * influencer discards a major item (+3) or a greater item (+6)." Modelled as a
 * player-chosen variant of the faction influence-attempt: the legal-action
 * generator emits one extra `influence-attempt` per eligible carried item, with
 * `need` already reduced by the option's `value` and a `discardForBonus` payload
 * naming the item; the declare handler discards that item and threads the bonus
 * onto the influence roll.
 */
export interface InfluenceModificationEffect extends EffectBase {
  readonly type: 'influence-modification';
  /** The available paid modifications; the influencer applies at most one. */
  readonly options: readonly {
    /** The item subtype the influencer must discard to gain this modifier. */
    readonly discardItemSubtype: 'minor' | 'major' | 'greater' | 'gold-ring' | 'special';
    /** The positive modifier added to the influence check when this option is taken. */
    readonly value: number;
  }[];
}

/**
 * Passive, in-play cancellation of every attack sourced from a **manifestation
 * of the named entity** against the controller's own companies. Borne by a
 * "Roused" Dragon faction — Smaug Roused (le-285): "All attacks by
 * manifestations of Smaug against any of your companies are canceled."
 *
 * `manifestId` identifies the manifestation chain (by convention the basic
 * form's id, e.g. `tw-90` for Smaug). While the controller of this card is the
 * moving/defending player, any Ahunt region-attack whose source card belongs to
 * that chain is skipped in `collectMatchingAhuntAttacks` — this covers the
 * faction's own region attack against its controller and any same-chain Ahunt an
 * opponent has in play. Under manifestation uniqueness (g.man.1) no other
 * form of the entity can be simultaneously in play to generate a site/creature
 * attack, so the Ahunt path is the reachable attack vector.
 */
export interface CancelManifestationAttacksEffect extends EffectBase {
  readonly type: 'cancel-manifestation-attacks';
  /** The manifestation-chain id whose attacks are canceled against your companies. */
  readonly manifestId: string;
}

/**
 * Environment effect carried by an in-play hazard permanent-event that penalises
 * (and optionally blocks card-boosts for) a character's faction-influence checks
 * made at a site located in one of the listed regions.
 *
 * While the carrying card is in play, any faction influence attempt whose site
 * is in a region named in `regionNames` is modified by `modifier` (typically
 * negative). Additionally, one-shot influence check-modifier constraints sourced
 * from a card whose name is listed in `blockCards` are suppressed for that
 * attempt ("cannot be done with <named card>").
 *
 * When `noEffectOnMinion` is set, the restriction does not apply if the
 * influencing (resource) player is a Ringwraith/Sauron (minion) player.
 *
 * Used by Mordor in Arms (dm-72): "Any attempt by a character to influence a
 * faction playable at a site in Horse Plains, Khand, Harondor, Nurn, Gorgoroth,
 * Imlad Morgul, or Udûn is modified by -6 and cannot be done with Muster."
 */
export interface FactionInfluenceRestrictionEffect extends EffectBase {
  readonly type: 'faction-influence-restriction';
  /** Region names whose sites trigger the restriction. */
  readonly regionNames: readonly string[];
  /** Modifier added to the influence check total (negative = penalty). */
  readonly modifier: number;
  /** Names of cards whose influence check-modifier boosts are suppressed here. */
  readonly blockCards?: readonly string[];
  /** When true, the restriction has no effect on a minion (Ringwraith) influencer. */
  readonly noEffectOnMinion?: boolean;
}

/**
 * Self-restriction carried directly by a faction card's own `effects`:
 * suppresses named one-shot influence-boost cards (e.g. Muster) for the
 * specific attempt to influence *this* faction. Unlike
 * {@link FactionInfluenceRestrictionEffect} (an environment scanned from
 * OTHER in-play cards, gated by region), this effect lives on the faction
 * card being played and applies to every attempt against it regardless of
 * site or region.
 *
 * Consulted alongside `faction-influence-restriction`'s `blockedCardNames` at
 * both influence seams — the influence-attempt legal-action generator
 * (`legal-actions/site.ts`) and the roll resolver
 * (`resolveInfluenceAttemptRoll` in `reducer-site.ts`) — so a matching
 * one-shot `check-modifier` constraint is consumed but contributes zero.
 *
 * Used by Angmarim (as-58) and Nûrniags (as-64): "Playable at <site> if the
 * influence check is greater than N (Muster has no effect on this
 * attempt)."
 */
export interface FactionSelfInfluenceBoostBlockEffect extends EffectBase {
  readonly type: 'block-influence-boost';
  /** Names of cards whose influence check-modifier boosts are suppressed for this faction. */
  readonly blockCards: readonly string[];
}

/**
 * Environment effect carried by a bare in-play hazard event that strips every
 * **card-sourced modification** from every influence attempt in the game, for
 * either player.
 *
 * Used by Webs of Fear & Treachery (le-150): "Except for unused general
 * influence and unused normal direct influence (including influence
 * modifications given in a character's card text), all modifications to each
 * influence attempt are reduced to zero."
 *
 * While a card carrying this effect sits bare (unattached) in either player's
 * `cardsInPlay`, {@link import('../engine/reducer-utils.js').influenceModificationsNullified}
 * reports true and every influence-check computation collapses to:
 *
 * - the 2d6 roll(s) and the printed target value (faction influence #, target
 *   mind, in-play influence #) — not modifications;
 * - unused **general** influence (the defender's opposing GI in an
 *   opponent-influence attempt, and a general-influence substitution that
 *   yields unused GI — Prophet of Doom wh-106);
 * - unused **normal** direct influence — the influencer's *printed* direct
 *   influence plus the influence modifications given in **his own card text**,
 *   minus his followers' mind cost
 *   ({@link import('../engine/legal-actions/organization.js').normalUnusedDI});
 * - rules-level (non-card) modifications: the cross-alignment influence
 *   penalty (CoE 8.W1/8.R1/8.F1/8.B1) and the rule 10.14 agent home-site
 *   bonuses. The defender's 2d6 roll is likewise untouched (Alfano, Worlds
 *   2009: Webs does not remove the defensive roll).
 *
 * Everything else contributes zero: influence `check-modifier` and
 * `direct-influence` `stat-modifier` effects from items, attached hazards,
 * allies and other players' in-play events; the faction card's own printed
 * "standard modifications"; one-shot influence constraints (Muster, Threats'
 * prowess substitution, …) — which are still *consumed*, just worth 0;
 * player-, site- and game-wide influence constraints; `faction-influence-
 * restriction` environments; and paid `influence-modification` bonuses.
 */
export interface NullifyInfluenceModificationsEffect extends EffectBase {
  readonly type: 'nullify-influence-modifications';
}

/**
 * Prone to Violence (ba-42): a minion permanent-event that grants an *extra*
 * Company-vs-Company-combat attack permission beyond the default alignment
 * matrix ({@link import('../engine/reducer-utils.js').canAttackAlignment}, CoE
 * rule 8.41). While any in-play permanent-event (either player's `cardsInPlay`)
 * carries this effect, a CvCC attack that the matrix would otherwise forbid is
 * allowed when the effect's `when` condition matches the attack.
 *
 * The condition is evaluated against a context describing both companies:
 * `{ attacker: { alignment, isMinion, hasRingwraith }, defender: { alignment,
 * isMinion, hasRingwraith } }`, where `alignment` is the owning player's engine
 * alignment (`"ringwraith"` / `"balrog"` / …), `isMinion` is true for
 * Ringwraith and Balrog players, and `hasRingwraith` is true when any character
 * in that company has the Ringwraith race. Prone to Violence uses
 * `{ attacker.isMinion, defender.isMinion, attacker.hasRingwraith: false,
 * defender.hasRingwraith: false }` — "any minion company without a Ringwraith
 * may attack another minion company without a Ringwraith" (the attacking
 * company may contain The Balrog, which the `isMinion` allowance covers).
 *
 * Collected by {@link import('../engine/reducer-utils.js').cvccAttackPermitted}
 * at both the legal-action declaration path
 * ({@link import('../engine/legal-actions/site.js')}) and the reducer
 * validation path ({@link import('../engine/reducer-site.js')}).
 */
export interface CvccAttackPermissionEffect extends EffectBase {
  readonly type: 'cvcc-attack-permission';
  /**
   * Condition matched against the CvCC attack context to permit an attack the
   * default alignment matrix forbids. Omitting it permits every CvCC attack
   * while the card is in play (no current card needs the unconditional form).
   */
  readonly when?: Condition;
}

/**
 * No Better Use (ba-41): while the bearer is untapped and this ability has
 * never been used, the bearer's controller may — instead of a pending
 * company-vs-company body check against a **character** (not an ally) in the
 * opposing company — tap the bearer to place that character "off to the side"
 * with this card. Offered alongside `body-check-roll` for either CvCC
 * body-check target (`'character'` — the bearer's own company struck the
 * opponent; `'attacker-character'` — the opponent's company struck the
 * bearer's own company and lost the exchange), whichever side the bearer's
 * company is on.
 *
 * The capture (strip all items/allies/hazards to discard, followers revert to
 * general influence, `character-pressed` constraint recording the bearer so
 * it can be watched) is implemented in `engine/no-better-use.ts`, reusing the
 * same off-to-the-side shape as Press-gang (ba-22). Unlike Press-gang the
 * capture is released — forming a fresh one-character company at the
 * bearer's current site — the moment the bearer is wounded or leaves active
 * play (`sweepNoBetterUseCaptures`, a `postReduce` sweep), and the ability
 * itself is one-time-per-card, enforced by a persistent `granted-action-used`
 * lock keyed `no-better-use-capture`.
 */
export interface CvccCaptureInLieuOfBodyCheckEffect extends EffectBase {
  readonly type: 'cvcc-capture-in-lieu-of-body-check';
}

/**
 * Caverns Unchoked (ba-51): a Balrog permanent-event played on an Under-deeps
 * site during the organization phase (via a companion `play-target: site`
 * filtered to the `under-deeps` keyword). While in play the card is bound to
 * that Under-deeps site (`CardInPlay.attachedToSite`) and has two effects:
 *
 * 1. **Permanence** — the bound site "is never discarded or returned to its
 *    location deck". The card itself is exempted from the site-attached orphan
 *    sweep ({@link import('../engine/reducer-utils.js').discardOrphanedSiteAttachedEvents}),
 *    so it persists even while the site is unoccupied, and when a company
 *    leaves the bound site it is always returned to the owner's location deck
 *    (never discarded), keeping it re-accessible.
 * 2. **Surface-region adjacency** — each *other* site of the card's owner that
 *    is normally one of `siteTypes` (Shadow-hold / Ruins & Lairs / Border-hold)
 *    and lies in the same region as the Under-deeps site's surface site is
 *    treated as Under-deeps-adjacent to it at a required roll of 0. Because an
 *    Under-deeps site and its surface site always share a region, the region is
 *    taken from the Under-deeps site's own `region` field. The adjacency is
 *    consulted by {@link import('../engine/legal-actions/organization-companies.js').isUnderDeepsAdjacent}
 *    and {@link import('../engine/mh-steps.js').getUnderDeepsRequiredRoll} via the
 *    moving player (`forPlayer`), so only the owner's own companies benefit
 *    ("of yours").
 */
export interface SurfaceRegionAdjacencyEffect extends EffectBase {
  readonly type: 'surface-region-adjacency';
  /**
   * The *normal* (printed) site types that a same-region site must have to
   * become adjacent. Caverns Unchoked uses shadow-hold / ruins-and-lairs /
   * border-hold.
   */
  readonly siteTypes: readonly SiteType[];
}

/**
 * Reduces the Under-deeps movement roll required for the owner's company to
 * ascend from the bound Under-deeps site to its **surface site** to zero, and
 * keeps the bound site permanent. Carried by a `trigger-attack-on-play`
 * permanent event played on the Under-deeps site (via `play-target: site`),
 * kept in play once its self-inflicted attacks are survived.
 *
 * Two effects ride on this while the card is in `cardsInPlay` bound to an
 * Under-deeps site U (`attachedToSite`):
 *
 * 1. **Surface-site roll zero** — when one of the owner's companies at U moves
 *    to U's surface site (the non-Under-deeps site listed in U's
 *    `adjacentSites`), the required Under-deeps movement roll is 0 instead of
 *    the printed value. Consulted by
 *    {@link import('../engine/legal-actions/organization-companies.js').breachTheHoldSurfaceRoll}
 *    from {@link import('../engine/mh-steps.js').getUnderDeepsRequiredRoll} via the
 *    moving player (`forPlayer`), so only the owner's own companies benefit.
 * 2. **Permanence** — "This site is never discarded or returned to its location
 *    deck." The card is exempt from the site-attached orphan sweep so it
 *    persists while U is unoccupied, and when a company leaves U the site is
 *    always returned to the owner's location deck (never discarded), keeping it
 *    re-accessible. Shared with {@link SurfaceRegionAdjacencyEffect} via
 *    {@link import('../engine/reducer-utils.js').cardKeepsBoundSitePermanent}.
 *
 * Used by Breach the Hold (ba-50): "The roll required to move to the surface
 * site is reduced to zero. This site is never discarded or returned to its
 * location deck."
 */
export interface SurfaceSiteRollZeroEffect extends EffectBase {
  readonly type: 'surface-site-roll-zero';
}

/**
 * Balrog-specific site-locking permanent-event. Played during the site phase on
 * the untapped site of the company containing The Balrog (the site must be
 * neither an Under-deeps site nor the surface site of one — gated by the
 * companion `play-target: site` filter and `untapped-site-required` /
 * `tap-site-on-play` play-flags, plus a `company-context` play-condition
 * requiring The Balrog in the company). On play the Balrog is tapped (handled in
 * `chain-reducer.ts` when this effect is present) and the site is tapped.
 *
 * While in play, bound to a site instance (`attachedToSite` = the site
 * definition id), it has three ongoing effects:
 *
 * 1. **Permanence** — the card is exempt from the site-attached orphan sweep
 *    ({@link import('../engine/reducer-utils.js').discardOrphanedSiteAttachedEvents})
 *    and the bound site is always returned to its owner's location deck rather
 *    than discarded (the `cavernsBound` branch in `mh-hazard-play.ts` step 8),
 *    the same treatment as {@link SurfaceRegionAdjacencyEffect} — "This site is
 *    never discarded."
 * 2. **Never untaps for the owner** — when the owner's company moves to a
 *    version of the bound site definition, the site is placed **tapped** rather
 *    than untapped (`mh-hazard-play.ts` step 8), realising "never untaps for
 *    you" (the engine never untaps a stationary site, so the only refresh point
 *    is re-placement on movement).
 * 3. **Two-character tax** — any company (either player) at any version of the
 *    bound site definition must tap `taxTapCharacters` of its characters during
 *    its site phase before it may play an ally or item there. The count paid so
 *    far this site phase is tracked on `SitePhaseState.eddyTaxTapped`; a
 *    `pay-site-tax` action taps one character and increments it, and the item /
 *    ally play paths are gated until it reaches `taxTapCharacters`.
 *
 * Used by Eddy in Fate's Tide (ba-57): "Playable during the site phase on an
 * untapped site if The Balrog is there; the site cannot be an Under-deeps site
 * or surface site thereof. Tap The Balrog and the site. This site is never
 * discarded and never untaps for you. Before a company can play any ally or item
 * at any version of this site, it must tap two characters during the site
 * phase."
 */
export interface EddyLockEffect extends EffectBase {
  readonly type: 'eddy-lock';
  /**
   * Number of characters a company must tap during its site phase before it may
   * play an ally or item at any version of the bound site (2 for Eddy in Fate's
   * Tide).
   */
  readonly taxTapCharacters: number;
}

/**
 * Generic Balrog site-domination lock carried by a permanent-event bound to a
 * site (`attachedToSite` = the site definition id). While the card is in play
 * (and not still `pendingTriggerAttack`), the bound site gains two ongoing
 * behaviours — plus an optional faction-influence penalty:
 *
 * 1. **Permanence** — the card is exempt from the site-attached orphan sweep
 *    ({@link import('../engine/reducer-utils.js').discardOrphanedSiteAttachedEvents})
 *    and the bound site is always returned to its owner's location deck rather
 *    than discarded (the permanent branch in `mh-hazard-play.ts` step 8),
 *    realising "This site is never discarded." Recognised via
 *    {@link import('../engine/reducer-utils.js').cardKeepsBoundSitePermanent},
 *    shared with {@link EddyLockEffect} / {@link SurfaceRegionAdjacencyEffect}.
 * 2. **Never untaps for the owner** — when the owner's company re-enters a
 *    version of the bound site definition, the site is placed **tapped** rather
 *    than untapped (`mh-hazard-play.ts` step 8, via
 *    {@link import('../engine/reducer-utils.js').siteNeverUntapsForOwner}),
 *    realising "never untaps for you" (the engine never untaps a stationary
 *    site, so re-placement on movement is the only refresh point).
 * 3. **Faction-influence modifier** (optional `factionInfluenceModifier`) —
 *    every influence attempt against a faction at any version of the bound site
 *    (by either player) is modified by this value (`-5` for People Diminished),
 *    summed live from bound in-play cards via
 *    {@link import('../engine/reducer-utils.js').siteFactionInfluenceModifier}
 *    in the site-phase influence path.
 *
 * Unlike {@link EddyLockEffect} this carries no per-company tax. Used by People
 * Diminished (ba-72): "This site is never discarded and never untaps for you.
 * -5 to each attempt against any faction at any version of this site."
 *
 * Also used by No Strangers at this Time (as-51), the hero counterpart, which
 * carries the anti-minion `convertDetainmentVsMinion` /
 * `duplicateFirstAutoAttackVsMinion` flags instead of a faction-influence
 * modifier.
 */
export interface SiteLockEffect extends EffectBase {
  readonly type: 'site-lock';
  /**
   * Optional modifier applied to every faction-influence attempt against a
   * faction at any version of the bound site (e.g. `-5` for People Diminished).
   * A negative value raises the influence number the attacker must roll.
   */
  readonly factionInfluenceModifier?: number;
  /**
   * When true, every detainment automatic-attack at any version of the bound
   * site against a **minion** (Ringwraith) company resolves as a **normal**
   * attack instead. No Strangers at this Time (as-51): "All detainment attacks
   * at all versions of this site against minion companies instead attack
   * normally." Folded into the `forcesNormalAttacks` gate in `reducer-site.ts`
   * (via {@link import('../engine/reducer-utils.js').siteLockAntiMinion}).
   */
  readonly convertDetainmentVsMinion?: boolean;
  /**
   * When true, a **minion** (Ringwraith) company facing this site's automatic-
   * attacks faces one additional attack: an exact copy of the first automatic-
   * attack listed on the site card (its runtime modifications are re-applied at
   * resolution, so "including all modifications" holds). No Strangers at this
   * Time (as-51). Handled in the `handleSiteAutomaticAttacks` done-branch.
   */
  readonly duplicateFirstAutoAttackVsMinion?: boolean;
}

/**
 * A minion permanent-event played on one of the controller's own in-play
 * **factions** (via `play-target` `target: 'faction'`) that lays siege to a
 * site chosen from the controller's location deck at play time. Used by Long
 * Grievous Siege (ba-40): "Playable on a unique non-Dragon faction. Place a
 * Border-hold [{B}] from your location deck 'off to the side' with this card.
 * The Border-hold must be in the same region or adjacent thereto as a site
 * where the target faction is playable. Return any faction playable at the
 * Border-hold to its owner's hand. -5 to any attempt to play a faction at any
 * version of the Border-hold. All versions of the Border-hold gain an
 * additional automatic-attack: same type as your target faction — 5 strikes
 * with 9 prowess (detainment against your companies)."
 *
 * Play-time wiring (chain resolution, `chain-reducer.ts`): the host enters
 * `cardsInPlay` with `attachedTo` = the target faction instance and
 * `attachedToSite` = the chosen site's definition id; the chosen site card is
 * moved from the controller's `siteDeck` off to the side with the host
 * (standard set-aside machinery), and every in-play faction playable at the
 * chosen site (either player's, per `isCardPlayableAtSiteDef`) is returned to
 * its owner's hand.
 *
 * Ongoing behaviour while in play (all matched against any version of the
 * bound site — by printed site *name*, since hero/minion twins use distinct
 * definition ids):
 *
 * 1. **Faction-influence penalty** — `factionInfluenceModifier` applies to
 *    every faction-play influence attempt at the site, for either player
 *    (summed in {@link import('../engine/reducer-utils.js').siteFactionInfluenceModifier},
 *    alongside `site-lock`).
 * 2. **Additional automatic-attack** — every version of the site gains an
 *    attack of `attack.strikes`×`attack.prowess` whose `creatureType` derives
 *    from the target faction's race at collection time
 *    (`collectPermanentEventAttacks`, `manifestations.ts`). The attack is
 *    **detainment against the controller's own companies only** (the injected
 *    {@link AutomaticAttack} carries `detainmentAgainstPlayer`).
 *
 * Lifecycle: the host is exempt from the site-attached orphan sweep
 * (`cardKeepsBoundSitePermanent` — the besieged site is off to the side and
 * never occupied). When the target faction leaves play the host is discarded
 * (`discardOrphanedFactionAttachedEvents`), and the set-aside site card is
 * returned to its owner's location deck (site-card branch of `sweepSetAside`).
 * "Cannot be duplicated on your faction" is `duplication-limit` scope
 * `'faction'` (per target faction instance).
 */
export interface FactionSiegeEffect extends EffectBase {
  readonly type: 'faction-siege';
  /** Printed type of the site chosen from the location deck (border-hold for ba-40). */
  readonly siteType: SiteType;
  /**
   * Modifier applied to every faction-play influence attempt at any version of
   * the besieged site (e.g. `-5`). A negative value raises the required roll.
   */
  readonly factionInfluenceModifier: number;
  /**
   * The additional automatic-attack every version of the besieged site gains.
   * Its creature type is not declared here — it is derived from the target
   * faction's race when the attack list is collected.
   */
  readonly attack: {
    readonly strikes: number;
    readonly prowess: number;
  };
}

/**
 * Balrog-specific movement grant: while this permanent-event is in play (and the
 * card named in `suppressedByInPlay` is *not* in play), a company containing The
 * Balrog avatar may use **region** movement — overriding his printed "may not use
 * region or starter movement" lock — provided at least one endpoint (origin or
 * destination) is an Under-deeps **surface site**. The number of regions the
 * company may span is derived from The Balrog player's marshalling-point total via
 * the ascending `[maxMp, regions]` bands in `regionAllowanceByMp` (the last band's
 * `regions` applies to any higher total). This region allowance replaces — and may
 * not be modified by — any other region-distance effect (environment reductions,
 * extra-region grants, etc.); only the card named in `modifiableBy` may adjust it.
 *
 * Used by Out He Sprang (ba-71): "If Great Shadow is not in play, The Balrog may
 * move with region movement (overriding his card) to an Under-deeps surface site
 * or from an Under-deeps surface site. Based on his marshalling point (MP) total,
 * he may use the following number of regions: 0-8 MPs – 1 region; 9-16 MPs – 2
 * regions; 17-24 MPs – 3 regions; 25+ MPs – 4 regions. This region allowance may
 * not be modified by any other effects except A More Evil Hour."
 */
export interface BalrogSurfaceRegionMovementEffect extends EffectBase {
  readonly type: 'balrog-surface-region-movement';
  /** Name of a card whose presence in play suppresses this grant (e.g. "Great Shadow"). */
  readonly suppressedByInPlay?: string;
  /** Ascending `[maxMp, regions]` bands; the final band applies to any higher MP total. */
  readonly regionAllowanceByMp: readonly (readonly [number, number])[];
  /** Name of the only card allowed to modify the derived region allowance (e.g. "A More Evil Hour"). */
  readonly modifiableBy?: string;
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
    /** Absent means no body check. Each "At Home" card prints one (e.g. Scorba at Home "13/8"). */
    readonly body?: number;
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
  /**
   * Site definition IDs whose auto-attack list is augmented while this event is
   * in play. May be empty when {@link siteType} is used to target every site of
   * a given type instead of a fixed list.
   */
  readonly siteIds: readonly CardDefinitionId[];
  /**
   * When present, the attack is added to **every** site of this printed type
   * (e.g. Fell Winter le-111: "Each Border-hold receives an additional
   * automatic-attack"), in addition to any explicit {@link siteIds}.
   */
  readonly siteType?: SiteType;
  /**
   * When true, the attack is added to the site this card is **bound to** —
   * the site chosen when it was played (`CardInPlay.attachedToSite`) — and to
   * every other printing of that same named location (hero / minion /
   * Fallen-wizard / Balrog versions are distinct definitions sharing one
   * name), matching the `allVersions` site-type override. Nature's Revenge
   * (wh-27): "All versions of the site … each gains an additional
   * automatic-attack: Animals." Mutually exclusive with a fixed
   * {@link siteIds} list, which names sites at card-definition time.
   */
  readonly boundSite?: boolean;
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
 * Grants the controller of the carrying in-play card an **optional, per-attack**
 * combat modifier: for each attack whose creature race matches `creatureRace`
 * that their opponent faces, the controller (the attacking / hazard player) may
 * choose to apply `prowessModifier` and/or make the attack `detainment`.
 *
 * The choice is offered as an `apply-attacker-attack-option` combat action in
 * the attacking player's Step 1 priority window (CoE rule 3.iv.1), before any of
 * the attack's strikes have resolved — so the modifier, once applied, affects
 * the whole attack. It is a genuine option: the controller may simply decline
 * (pass), leaving the attack unmodified. Applying it once flags the combat so it
 * cannot be applied again.
 *
 * Example — Ungoliant's Progeny (ba-27): "for each Spider attack your opponent
 * faces, you can choose for it to be at +1 prowess and detainment."
 *
 * ```json
 * { "type": "attacker-attack-option",
 *   "creatureRace": "spider", "prowessModifier": 1, "detainment": true }
 * ```
 */
export interface AttackerAttackOptionEffect extends EffectBase {
  readonly type: 'attacker-attack-option';
  /**
   * The normalized (lowercase, singular) creature race the faced attack must
   * have for the option to be offered (e.g. `"spider"`). Matched against
   * {@link import('./state-combat.js').CombatState.creatureRace}.
   */
  readonly creatureRace: Race;
  /** Prowess added to every strike of the attack when the option is applied. */
  readonly prowessModifier?: number;
  /** When true, applying the option makes the attack a detainment attack. */
  readonly detainment?: boolean;
}

/**
 * Splits a site's effective type and automatic-attacks between the **one
 * instance the carrying card is attached to** ("the associated site") and
 * **every other in-play copy of the same site definition** ("all other
 * versions"). Carried by a kept resource permanent-event bound to a site
 * (`attachedToSite`); scanned dynamically by {@link getEffectiveSiteType} and
 * `getActiveAutoAttacks`, both of which take an optional site *instance* id so
 * they can distinguish the associated copy (the controller's own current site)
 * from the other copies.
 *
 * Unlike the generic `site-type-override` `attribute-modifier` (Hold Rebuilt
 * and Repaired, as-88), this effect **bypasses the MEAS §6(d) Under-deeps
 * type-immutability short-circuit** — it exists precisely to retype an
 * Under-deeps site — and it discriminates by instance rather than applying to
 * every copy uniformly.
 *
 * Used by Roots of the Earth (ba-74): the associated Under-deeps Ruins & Lairs
 * becomes a Darkhaven [{H}] that loses all automatic-attacks, while every other
 * version becomes a Shadow-hold [{S}] that gains an Orcs 5-strike/9-prowess
 * automatic-attack.
 */
export interface SiteInstanceTransformEffect extends EffectBase {
  readonly type: 'site-instance-transform';
  /** How the single instance this card is attached to is transformed. */
  readonly associated: {
    /** Effective {@link SiteType} of the associated instance. */
    readonly siteType: SiteType;
    /** When true, the associated instance loses all automatic-attacks. */
    readonly removeAllAutoAttacks?: boolean;
    /**
     * When set, the associated instance loses every automatic-attack of this
     * creature race (matched against the attack's `creatureType`). Lord and
     * Usurper (ba-65): "lose all Dwarf automatic-attacks".
     */
    readonly removeAutoAttacksByRace?: Race;
  };
  /** How every other in-play copy of the same site definition is transformed. */
  readonly others: {
    /** Effective {@link SiteType} of every other version. */
    readonly siteType: SiteType;
    /** When set, every other version gains this automatic-attack. */
    readonly addAutoAttack?: TriggerAttackEntry;
    /**
     * When set, every other version loses every automatic-attack of this
     * creature race before {@link addAutoAttack} is applied. Lord and Usurper
     * (ba-65): the other versions lose their Dwarf auto-attacks and gain an
     * Orcs auto-attack.
     */
    readonly removeAutoAttacksByRace?: Race;
  };
  /**
   * When true, no faction may be played at any version of the transformed site
   * (associated or other). Lord and Usurper (ba-65): "may have no factions
   * played there".
   */
  readonly noFactions?: boolean;
}

/**
 * Grants a fixed bonus to the carrying in-play card's own marshalling-point
 * value when a named card is in play attached to the **same site**. Folded into
 * the `cardsInPlay` marshalling-point tally in `recompute-derived.ts` on top of
 * the card's printed `marshallingPoints`.
 *
 * Used by Roots of the Earth (ba-74): "If Breach the Hold is on the same site,
 * this card gives 3 marshalling points" (printed 1 + bonus 2).
 */
export interface ConditionalMpEffect extends EffectBase {
  readonly type: 'conditional-mp';
  /** Points added to the carrying card's marshalling value when the condition holds. */
  readonly bonus: number;
  /**
   * The bonus applies while a card with this exact name is in play (either
   * player's `cardsInPlay`) attached to the same site as the carrying card.
   * Used by Roots of the Earth (ba-74). Exactly one of `requiresCardOnSameSite`
   * / `requiresFactionCount` is set.
   */
  readonly requiresCardOnSameSite?: string;
  /**
   * The bonus applies while the carrying card's controller has at least `min`
   * factions of one of `races` in play (their own `cardsInPlay`) that satisfy
   * the optional filters. Used by Great Army of the North (ba-38): "If you have
   * at least 4 unique Orc and/or Troll factions —none playable at a Darkhold
   * [{D}]—you receive this card's marshalling points."
   */
  readonly requiresFactionCount?: {
    /** Minimum number of qualifying in-play factions required. */
    readonly min: number;
    /** Faction races that qualify (e.g. `["orc","troll"]`). */
    readonly races: readonly Race[];
    /** When true, only unique factions count. */
    readonly unique?: boolean;
    /**
     * When set, a faction playable at a site of this type (e.g. `"dark-hold"`)
     * is excluded from the count ("none playable at a Darkhold").
     */
    readonly excludePlayableAtSiteType?: string;
  };
}

/**
 * A permanent-event that grants an **additional marshalling point** to a whole
 * class of the controller's in-play factions while a race-diversity gate holds.
 *
 * Alliance of Free Peoples (as-45): "If at least one hero Dwarf faction, one
 * hero Elf faction, and one hero Man faction is in play, all hero Dwarf
 * factions, hero Elf factions, and hero Man factions give an additional
 * marshalling point." Here `requireEachRace` is `["dwarf","elf","man"]` (the
 * gate: the controller must have at least one in-play faction of *each* listed
 * race) and `races` is `["dwarf","elf","man"]` (every controlled faction of one
 * of these races gains `bonus` faction MP). The two lists are independent so a
 * card can gate on one set of races while boosting another.
 *
 * Applied in `recompute-derived.ts` as a dedicated faction-MP pass (additive on
 * top of each faction's printed / overridden MP), scanning only the controller's
 * own non-set-aside `cardsInPlay` factions.
 *
 * ```json
 * { "type": "faction-mp-bonus", "bonus": 1,
 *   "requireEachRace": ["dwarf", "elf", "man"],
 *   "races": ["dwarf", "elf", "man"] }
 * ```
 */
export interface FactionMpBonusEffect extends EffectBase {
  readonly type: 'faction-mp-bonus';
  /** Marshalling points added to each qualifying faction while the gate holds. */
  readonly bonus: number;
  /**
   * Gate: the controller must have at least one in-play faction of **each** race
   * listed here for the bonus to apply at all. Empty/omitted means "no gate".
   */
  readonly requireEachRace?: readonly Race[];
  /** A controlled faction receives `bonus` MP iff its race is in this list. */
  readonly races: readonly Race[];
}

/**
 * A resource permanent event played on (`play-target: "faction"`) a single
 * in-play faction instance grants that specific faction's owner a flat MP
 * bonus, credited in `category` (independent of the faction's own printed
 * `marshallingCategory`).
 *
 * Distinct from {@link FactionMpBonusEffect} (as-45's race-diversity gate over
 * a *class* of factions): this effect is anchored to one attached instance
 * (`CardInPlay.attachedTo`) via the generic faction play-target binding
 * (chain-reducer.ts, the same mechanism Long Grievous Siege ba-40 uses), so
 * the bonus follows that one faction rather than every faction of a race.
 * Collected in `recompute-derived.ts` from the controller's own `cardsInPlay`
 * entries carrying an `attachedTo` pointer, and applied only while the target
 * faction remains in play — `discardOrphanedFactionAttachedEvents`
 * (reducer-utils.ts) discards the carrier once its target faction leaves.
 *
 * Used by Tribute Garnered (as-104): "Playable on a faction in play. That
 * faction gives an additional miscellaneous marshalling point."
 *
 * ```json
 * { "type": "attached-faction-mp-bonus", "value": 1, "category": "misc" }
 * ```
 */
export interface AttachedFactionMpBonusEffect extends EffectBase {
  readonly type: 'attached-faction-mp-bonus';
  /** Marshalling points added to the target faction's owner. */
  readonly value: number;
  /** Category the bonus is credited to (defaults to `misc`). */
  readonly category?: MarshallingCategory;
}

/**
 * A card that discards **itself** the moment another card matching `filter`
 * leaves its controller's play area (present in the controller's `cardsInPlay`
 * before an action, absent after). Evaluated as a `postReduce` prev/next diff
 * (the same reactive-diff pattern as A More Evil Hour's tap trigger), so it
 * fires no matter how the tracked card left play.
 *
 * Alliance of Free Peoples (as-45): "Discard when any hero Dwarf faction, hero
 * Elf faction, or hero Man faction is discarded from play." — `filter` matches a
 * hero faction whose race is Dwarf, Elf, or Man. The trigger fires even when the
 * race-diversity gate still holds afterwards (e.g. losing one of two Man
 * factions), matching the printed "any … faction … discarded" wording.
 *
 * ```json
 * { "type": "discard-on-card-leaves-play",
 *   "filter": { "$and": [ { "card.cardType": "hero-resource-faction" },
 *                         { "card.race": { "$in": ["dwarf", "elf", "man"] } } ] } }
 * ```
 */
export interface DiscardOnCardLeavesPlayEffect extends EffectBase {
  readonly type: 'discard-on-card-leaves-play';
  /**
   * Condition matched against a leaving card's definition, wrapped as
   * `{ card: def }` (so `card.cardType`, `card.race`, `card.name`, etc. are
   * available). A leaving card that matches triggers the self-discard.
   */
  readonly filter: Condition;
}

/**
 * Suspends the normal end-of-long-event-phase discard of hazard long-events for
 * as long as the carrying card stays in play, and discards every hazard
 * long-event in play the moment the carrier leaves.
 *
 * Hazard long-events are normally swept from the hazard player's `cardsInPlay`
 * when the resource player passes out of the long-event phase ([2.III.3]). While
 * any card carrying this effect is in play — in *either* player's `cardsInPlay`,
 * since the effect is game-wide — that sweep is skipped, so the long-events
 * accumulate. When the last carrier leaves play (for any reason: its own
 * `discard-self-when`, deck exhaustion, cancellation), the retained long-events
 * are all discarded at once.
 *
 * Used by The Will of Sauron (tw-100): "All hazard long-events remain in play
 * until this card is discarded. … When this card is discarded, all hazard long
 * events are discarded."
 *
 * ```json
 * { "type": "retain-hazard-long-events" }
 * ```
 */
export interface RetainHazardLongEventsEffect extends EffectBase {
  readonly type: 'retain-hazard-long-events';
}

/**
 * Declares that, while the carrying card is in play, any hazard creature whose
 * card definition matches `creatureFilter` may be keyed to any site matching
 * `siteFilter` (its effective site type is one of `siteTypes` and it carries
 * every keyword in `siteKeywords`), regardless of the creature's own `keyedTo`.
 *
 * This is the in-play permanent-event analogue of the site-bound
 * {@link import('./effects/site-rules.js').AllowCreatureByRaceSiteRule} /
 * {@link import('./effects/site-rules.js').AllowCreatureByKeyingSiteRule}: the
 * grant travels with an environment card rather than living on a single site,
 * so it applies at every site of the matching kind for as long as the card
 * stays in play. Feeds only the normal M/H hazard-creature play path (the same
 * `keyedBy: { method: 'keying-bypass' }` mechanism the site rules use).
 *
 * Example — Ungoliant's Foul Issue (ba-28): "non-unique Spider creatures can
 * be keyed to Under-deeps Ruins & Lairs [{R}] and Shadow-holds [{S}]."
 *
 * ```json
 * { "type": "grant-creature-keying",
 *   "creatureFilter": { "race": "spider", "unique": { "$ne": true } },
 *   "siteFilter": { "siteTypes": ["ruins-and-lairs", "shadow-hold"], "siteKeywords": ["under-deeps"] } }
 * ```
 *
 * The grant may also open **region-type** keying: `siteFilter.regionTypes` lets
 * the creature key to any of those region types present in the moving company's
 * resolved site path (OR'd with the site-type / keyword branch). A Pack at the
 * Door (tw-497) grants non-unique Animal/Spider/Wolf creatures keying to
 * Border-lands [{b}] (region type) or Border-holds [{B}] / Ruins & Lairs [{R}]
 * (site types), gated by `requiresNonCoastalKeying` (see below).
 *
 * `siteFilter.excludeSiteTypes` inverts the site-type branch into a
 * denylist: the grant matches any effective site type *except* those listed
 * (mutually exclusive with `siteTypes` — a card uses one or the other). Used
 * by The Nazgûl are Abroad (tw-96): "Nazgûl may attack a hero company … at
 * any site that is not a Free-hold [{F}] or Haven [{H}]."
 *
 * The optional `companyFilter` gates the grant on the *target company* being
 * attacked (in addition to the site/region match), evaluated via
 * {@link buildTargetCompanyConditionContext}'s `company` context (exposing
 * `itemNames`, `itemKeywords`, `alignment`, …). Used by The Nazgûl are Abroad
 * (tw-96) to restrict the widened keying to a hero company bearing The One
 * Ring (`{ "company.itemKeywords": { "$includes": "the-one-ring" } }`) or any
 * Ring (`{ "company.itemKeywords": { "$includes": "ring" } }`).
 */
export interface GrantCreatureKeyingEffect extends EffectBase {
  readonly type: 'grant-creature-keying';
  /** DSL condition on the hazard-creature's card definition (dot-path keys). */
  readonly creatureFilter: Condition;
  /** The site(s) / region(s) matching creatures may be keyed to while this card is in play. */
  readonly siteFilter: {
    /** Effective site type must be one of these (omit = no site-type branch). */
    readonly siteTypes?: readonly SiteType[];
    /**
     * Effective site type must NOT be one of these (an alternative to
     * `siteTypes` for "any site except …" grants — mutually exclusive with it).
     */
    readonly excludeSiteTypes?: readonly SiteType[];
    /** Site must carry every keyword listed here (applies to the site-type branch). */
    readonly siteKeywords?: readonly string[];
    /**
     * The moving company's resolved site path must contain a region of one of
     * these types (omit = no region-type branch). OR'd with the site-type
     * branch — a match on either grants the keying.
     */
    readonly regionTypes?: readonly RegionType[];
  };
  /**
   * DSL condition evaluated against the target company's condition context
   * (`{ company: { itemNames, itemKeywords, alignment, … } }` — see
   * {@link buildTargetCompanyConditionContext}). Omit to gate on site/region
   * alone.
   */
  readonly companyFilter?: Condition;
  /**
   * When true, the grant applies only to creatures whose own printed `keyedTo`
   * offers at least one non-Coastal-Sea region keying — i.e. the creature "must
   * be playable in a non-Coastal Sea [{c}] region" (A Pack at the Door tw-497).
   * Excludes Coastal-Sea-only creatures (e.g. tw-34) from the broadened keying.
   */
  readonly requiresNonCoastalKeying?: boolean;
  /**
   * Where the grant lives — i.e. what makes it active against the company
   * currently being attacked. Defaults to `'in-play'`.
   *
   * - `'in-play'` — the carrying card must sit in either player's
   *   `cardsInPlay` (an environment / long- or permanent-event such as
   *   Ungoliant's Foul Issue ba-28 or A Pack at the Door tw-497).
   * - `'faced-this-turn'` — the grant is carried by a **hazard creature** and
   *   is active only against a company that has already faced that creature
   *   this turn, i.e. the carrier's name appears in the company's
   *   `MovementHazardPhaseState.hazardsEncountered` (rule 8.03 — an attack
   *   counts as faced even when it was canceled). The carrier itself is long
   *   gone from play by then (discarded, or in the defender's kill pile), so
   *   the grant is resolved from the card pool by name rather than from
   *   `cardsInPlay`. Used by Dwarven Travelers (as-9): "Maia hazard creatures
   *   may be keyed to Border-holds [{B}] or Ruins & Lairs [{R}] against any
   *   company that has faced Dwarven Travelers this turn."
   */
  readonly source?: 'in-play' | 'faced-this-turn';
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
 *
 * The condition is evaluated against a context exposing the company's
 * site-path terrain counts (`sitePath.{wilderness,shadow,dark,coastal,border,
 * free}Count`, `sitePath.length`), the moving player's alignment
 * (`player.minion`), and `underDeepsMove` — true when the company's origin or
 * destination is an Under-deeps site. Used by The Way is Shut (dm-98):
 * `{ "underDeepsMove": true }` forces any company moving to or from an
 * Under-deeps site back to its site of origin.
 */
export interface ForceReturnToOriginEffect extends EffectBase {
  readonly type: 'force-return-to-origin';
  /** Company-context condition that must hold for the effect to apply. */
  readonly condition?: Condition;
  /** If true, a company containing at least one ranger is exempt. */
  readonly rangerException?: boolean;
}

/**
 * When this environment (long-event) resolves and enters play, tap every
 * distinct site currently in play (a company's current site, on either
 * side) whose attributes satisfy {@link condition}. Used by the
 * Doors-of-Night clause of Foul Fumes (tw-36) and Long Winter (le-117):
 * "if Doors of Night is in play, each non-Haven site with a Shadow-land /
 * Dark-domain (resp. ≥2 Wildernesses) in its site path is tapped."
 *
 * The per-site condition is evaluated against a context exposing the
 * site's type and its printed site-path terrain counts:
 * `{ site: { type }, sitePath: { wildernessCount, shadowCount, darkCount } }`.
 * Tapping is a one-time effect applied at resolution; sites that enter play
 * later are unaffected.
 */
export interface TapSitesInPlayEffect extends EffectBase {
  readonly type: 'tap-sites-in-play';
  /**
   * Name of a card that must be in play for the tapping to occur (e.g.
   * "Doors of Night"). When absent, the tapping always applies on resolution.
   */
  readonly requiresInPlay?: string;
  /** Per-site condition; a site is tapped only when it matches. */
  readonly condition?: Condition;
}

/**
 * While the carrying card (a permanent-event/environment) is in play, any
 * character standing at a site in a matching region — or, mid-transit,
 * whose company is the active mover of an in-progress movement/hazard phase
 * with a matching region in its resolved site path — no longer counts as
 * having `skill` for any purpose that reads {@link getEffectiveSkills}.
 *
 * Used by In the Heart of his Realm (dm-67): "any sage at a site in a
 * Dark-domain [{d}] or Gorgoroth, or moving with a Dark-domain [{d}] or
 * Gorgoroth in his site path, loses his sage skill."
 *
 * A character's location is resolved by `characterLocation` (`reducer-utils.ts`):
 * the current site's containing region (via `siteRegionTypeOf`), plus —
 * only while that character's company is the phase's active mover — the
 * `resolvedSitePath` / `resolvedSitePathNames` of the movement/hazard phase
 * state. Matched against `regionTypes` / `regionNames` by
 * `locationMatchesSpec`.
 */
export interface SkillSuppressionEffect extends EffectBase {
  readonly type: 'skill-suppression';
  /** The skill a matching character no longer counts as having. */
  readonly skill: Skill;
  /** Region types (e.g. `"dark"`) whose sites/paths trigger the suppression. */
  readonly regionTypes?: readonly RegionType[];
  /** Named regions (e.g. `"Gorgoroth"`) whose sites/paths trigger the suppression. */
  readonly regionNames?: readonly string[];
  /** When true, a character controlled by a Ringwraith/Balrog player is exempt. */
  readonly noEffectOnMinion?: boolean;
}

/**
 * While the carrying card (a permanent-event/environment) is in play, no
 * character standing at a site in a matching region — or transiting one, per
 * the same location rule as {@link SkillSuppressionEffect} — may play a
 * magic-class card: one carrying any of `keywords` (default `"spell"`,
 * `"sorcery"`, `"spirit-magic"`, `"shadow-magic"`, `"light-enchantment"`,
 * `"ritual"`).
 *
 * Used by In the Heart of his Realm (dm-67): "No character at a site in a
 * Dark-domain [{d}] or Gorgoroth, or moving with a Dark-domain [{d}] or
 * Gorgoroth in his site path, can use spells, light enchantments, or
 * rituals."
 *
 * Enforced centrally by `applyLocationMagicRestriction`
 * (`engine/location-magic-restriction.ts`), which runs every evaluated
 * action through the same `computeLegalActions` chokepoint as
 * `prohibit-card-play`: an action that plays a matching-keyword card and
 * names an acting character (via `characterId` / `scoutInstanceId` /
 * `targetCharacterId` / `targetScoutInstanceId`) is turned into a
 * not-playable entry when that character's location matches.
 */
export interface LocationMagicRestrictionEffect extends EffectBase {
  readonly type: 'location-magic-restriction';
  /** Region types (e.g. `"dark"`) whose sites/paths trigger the restriction. */
  readonly regionTypes?: readonly RegionType[];
  /** Named regions (e.g. `"Gorgoroth"`) whose sites/paths trigger the restriction. */
  readonly regionNames?: readonly string[];
  /** Card keywords considered "magic" for this restriction. Defaults to every magic/enchantment keyword. */
  readonly keywords?: readonly string[];
  /** When true, a character controlled by a Ringwraith/Balrog player is exempt. */
  readonly noEffectOnMinion?: boolean;
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
 * Marker on a Balrog resource short-event (Great Fissure ba-61): while a chain
 * is active during a company-vs-company attack made *by* The Balrog's company
 * against an opponent, the card may be played from hand to target and negate an
 * unresolved chain entry declared by the opponent that would cancel that attack
 * (a `cancel-attack` effect). It is the counter-cancel counterpart to
 * {@link CancelChainReturnToOriginEffect} (Goldberry): a chain-declaring
 * response, not a combat pre-assignment cancel, but sourced from a discarded
 * hand card rather than a tapped in-play ally.
 *
 * Great Fissure's other mode ("cancel an attack against a company at, or moving
 * to or from, an Under-deeps site") is a plain {@link CancelAttackEffect} gated
 * on `attack.atUnderDeeps`.
 */
export interface CancelChainAttackCancelEffect extends EffectBase {
  readonly type: 'cancel-chain-attack-cancel';
}

/**
 * While the carrying card is in play, any active constraint sourced from a
 * card whose name is listed in {@link cardNames} is suppressed — its effect
 * is treated as absent for as long as this card remains in play. This is the
 * generic "cancels the effects of X" primitive: it neutralizes the named
 * cards' *in-play constraints* by source card name, so only those cards are
 * affected (an unrelated card that happens to use the same constraint kind is
 * untouched).
 *
 * Used by The Way is Shut (dm-98): "cancels the effects of Secret Passage and
 * Secret Entrance" — while it is in play, the creature-play restrictions those
 * two cards place on a company are lifted.
 */
export interface CancelCardEffectsEffect extends EffectBase {
  readonly type: 'cancel-card-effects';
  /** Names of the cards whose in-play constraint effects are suppressed. */
  readonly cardNames: readonly string[];
}

/**
 * In-play ally ability: tap this ally to discard one hazard permanent-event
 * attached to the ally's (moving) company or to a character in it. Offered
 * during the company's M/H phase to the active (resource) player when
 * {@link when} holds (e.g. the company is moving to a qualifying region).
 *
 * Used by Last Child of Ungoliant (le-153): "tap this ally to ... discard one
 * hazard permanent-event on such a company or on a character in such a company"
 * (a company moving to Imlad Morgul, Ithilien, or Gorgoroth). The discarded
 * hazard returns to its owner's discard pile.
 */
export interface TapDiscardAttachedHazardEffect extends EffectBase {
  readonly type: 'tap-discard-attached-hazard';
  /** Activation cost — tap the bearer ally. */
  readonly cost: { readonly tap: 'self' };
  /**
   * Gate evaluated against `{ bearer: { destinationRegion } }` — the region
   * the bearer's company is moving to. When absent, the ability is always
   * offered while an eligible target exists.
   */
  readonly when?: Condition;
}

/**
 * When this permanent event is in play, any site (that is not a Dragon lair)
 * with more than one automatic attack is reduced to a single attack chosen
 * by the hazard player, and any creature with more than one attack (i.e.
 * combat-multi-attack) is reduced to one attack. The remaining attack
 * cannot be canceled. The event discards itself when that isolated attack
 * is defeated (handled via `on-event: attack-defeated` with
 * `when: { "attack.isolated": true }`).
 * Use `play-flag: 'reduce-attacks-to-one'` on permanent event cards.
 */

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
 *  - `allies-on-target` — allies borne by `ctx.targetCardId`.
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
  | 'allies-on-target'
  /** Source: hazard permanent-events attached to the target character
   *  (`ctx.targetCharacterId`). Owner is resolved from the instance-id prefix
   *  (fallback: the holder's opponent, since hazards on a character are played
   *  by the opposing hazard player). Used by "remove all hazard
   *  permanent-events on the character" (The Sun Unveiled as-56). */
  | 'hazards-on-target'
  | 'items-on-wounded'
  | 'attached-to-target-company'
  /** Source: a single instance attached to ANY character's `hazards` or
   *  `allies` (located by `select: 'target'` + `targetCardId`). Owner is
   *  resolved from the instance-id prefix (fallback: hazards → the holder's
   *  opponent, allies → the holder). Used by dice-check ally/hazard discards. */
  | 'attached-to-character'
  /** Source: the event card resolving on the chain (held on the chain entry,
   *  not in any pile). Used when an event "enters play". Removal is a no-op. */
  | 'chain'
  /** Destination: into play attached to a character — a resource permanent
   *  event into the bearer's `items`, a hazard permanent event into `hazards`
   *  (chosen by card type via `inPlayOnCharacterSlot`). */
  | 'in-play-on-character'
  /** Destination: into a player's general `cardsInPlay`. */
  | 'in-play-general';

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
   * For fetch-to-deck moves (`select: 'target'`, `to: 'deck' | 'hand'`): when
   * true, the spent event card is removed from the game instead of discarded
   * once the interactive fetch resolves. Backs "Remove this card from the
   * game." on Longbottom Leaf (ba-30).
   */
  readonly removeFromGame?: boolean;
  /**
   * Enqueue a corruption check on the bearer after resolution.
   * Carried by bounce-hazard-events equivalents (Wizard Uncloaked).
   */
  readonly corruptionCheck?: { readonly modifier: number };
  /** For `select: 'named'`: the card name to match. */
  readonly cardName?: string;
  /**
   * For an `organization-phase-start` self-discard on a company-bound
   * permanent-event: when true, discarding the card also discards every
   * Ringwraith follower character in the bound company (their attached
   * items/allies go with them; hazards to the opponent). Backs Black Rider
   * (le-170) — "Discard this card and any other Ringwraith followers in the
   * company …". The avatar's own allies are untouched.
   */
  readonly alsoDiscardCompanyFollowers?: boolean;
  /**
   * For a `select: 'target'` fetch-to-hand/deck move: when true, the fetched
   * card's identity is revealed to the opponent as it is taken (recorded in
   * {@link GameState.revealedInstances}). Generalizes the field already
   * carried by the internal {@link FetchToDeckEffect} (Inner Cunning dm-68)
   * to the card-level `move` primitive. Used by Far-sight (tw-238): "choose
   * an item that you must reveal to your opponent."
   */
  readonly revealToOpponent?: boolean;
}

/**
 * Marks an in-play permanent-event that taps itself when the controller's
 * opponent plays a card that normally gives that opponent `mpThreshold` or more
 * marshalling points (A More Evil Hour, ba-48: "Tap this card when an opponent
 * plays a card normally giving him three or more marshalling points"). The
 * "normally giving" value is the card's printed {@link CardBase.marshallingPoints}.
 *
 * The tap is a passive reaction: after every reducer step, the engine diffs the
 * opponent's in-play scoring zones and, when a fresh card with printed MP ≥
 * `mpThreshold` entered play, taps each untapped copy of the carrying card.
 * Pair with `play-flag: no-auto-untap` so the card "does not untap".
 */
export interface EvilHourTapTriggerEffect extends EffectBase {
  readonly type: 'evil-hour-tap-trigger';
  /** Minimum printed marshalling points of the opponent's played card. */
  readonly mpThreshold: number;
}

/**
 * Grants an in-play permanent-event a once-only organization-phase ability
 * (usable only while the card is tapped) to **discard itself** and mark one of
 * the controller's companies (one allowed to use region movement) with a
 * persistent conditional region-movement bonus (A More Evil Hour, ba-48). The
 * marked company may move up to `extraRegions` additional regions whenever it
 * moves to — or away from — a site where an opponent's company is present
 * ({@link Company.evilHourMovementBonus}).
 */
export interface EvilHourGrantMovementEffect extends EffectBase {
  readonly type: 'evil-hour-grant-movement';
  /** Additional region distance granted (ba-48: 2). */
  readonly extraRegions: number;
}

/**
 * Repeatable "for each character you tap, discard one matching in-play card
 * belonging to your opponent" resource short-event ability (Praise to
 * Elbereth tw-305: "For each of your characters in play that you choose to
 * tap ... cancel one Nazgûl event ... against that character's company").
 *
 * On resolution the engine enqueues a `card-effect` pending effect (the
 * `fetch-to-deck` loop-until-pass pattern): the declaring player repeatedly
 * chooses one of their own untapped characters and one untapped opponent
 * in-play card matching {@link filter}, taps the character, and discards the
 * target — resolved immediately with no chain entry, so the opponent gets no
 * response window to act on the targeted card first (e.g. tapping a Nazgûl
 * permanent-event to convert it into its short-event mode before it can be
 * discarded — "may not be tapped in response to its play"). The discard never
 * triggers the target's own abilities ("Nazgûl events discarded ... have no
 * effect"). Repeats until no untapped character or matching target remains,
 * or the player passes.
 */
export interface TapDiscardInPlayEffect extends EffectBase {
  readonly type: 'tap-discard-in-play';
  /** DSL condition each target card's definition must match (e.g. keyword "Nazgûl"). */
  readonly filter: Condition;
}

/**
 * Discriminated union of all card effect types.
 * The `type` field serves as the discriminant for type narrowing.
 */
export type CardEffect =
  | EvilHourTapTriggerEffect
  | EvilHourGrantMovementEffect
  | AllyMovementRestrictionExemptionEffect
  | AgentHomeSiteFactionLockEffect
  | StatModifierEffect
  | CheckModifierEffect
  | BodyCheckModifierEffect
  | MpModifierEffect
  | InPlayItemModifierEffect
  | CorruptionSourceMultiplierEffect
  | FallenWizardMpFullEffect
  | FallenWizardNoMpEffect
  | FallenWizardCharacterAllyMpEffect
  | FallenWizardKillMpEffect
  | DetainmentAttacksNormalEffect
  | AutoAttacksNormalEffect
  | CompanyModifierEffect
  | EnemyModifierEffect
  | HandSizeModifierEffect
  | DrawModifierEffect
  | DrawCardsEffect
  | ReshuffleFromDiscardEffect
  | NewHandEffect
  | ForceOpponentDiscardEffect
  | CycleHandEffect
  | RevealChooseShuffleEffect
  | PeekShuffleDeckTopEffect
  | RevealRemoveFromDiscardEffect
  | RevealDeckChoosePenaltyEffect
  | RevealDeckChooseSetAsideEffect
  | RevealDeckChooseAttackerEffect
  | OpponentChooseTapOrRollEffect
  | WithdrawAgentEffect
  | GrantActionEffect
  | OnEventEffect
  | CancelStrikeEffect
  | CancelAttackEffect
  | ConvertCreatureToAllyEffect
  | FlatteryCancelAttackEffect
  | GoodwillCancelAttackEffect
  | RiddlingAttemptEffect
  | BurglaryAttemptEffect
  | CounterCancelAttackRollEffect
  | CancelInfluenceEffect
  | StrikeModifierEffect
  | ModifyAttackEffect
  | FaceStrikeOnTapEffect
  | FaceAllStrikesOptionEffect
  | MultiStrikeOptionEffect
  | RestoredItemStatsEffect
  | CombatCancelWeaponEffect
  | JoinCombatForceStrikeEffect
  | CombatDiscardOpponentItemEffect
  | SiteStormDevastationEffect
  | HalveStrikesEffect
  | ProtectFromStrikeAssignmentEffect
  | FleeFromStrikeEffect
  | SacrificeOfFormEffect
  | RollUntapSiteEffect
  | UntapMindRollEffect
  | SkipNextUntapOnPlayEffect
  | ReturnToHandEffect
  | CombatAttackerChoosesDefendersEffect
  | CombatMultiAttackEffect
  | CombatCancelAttackByTapEffect
  | CombatDetainmentEffect
  | CombatTapLowMindEffect
  | CombatStrikeEffectEffect
  | CombatOneStrikePerCharacterEffect
  | CombatBodyCheckModifierEffect
  | CombatBodyPerDefenderSkillEffect
  | CombatTapToCancelStrikeEffect
  | PlayFlagEffect
  | DuplicationLimitEffect
  | NameAliasEffect
  | EnvironmentOverrideEffect
  | ManifestationSwapEffect
  | DiscardToRecruitEffect
  | RegionKeyingBoostEffect
  | RegionTypeRemapEffect
  | SiteTypeRemapEffect
  | RegionTypeConversionEffect
  | ItemPlayCorruptionCheckEffect
  | TapAtSiteEffect
  | PlayTargetEffect
  | PlayOptionEffect
  | PlayWindowEffect
  | PlayRestrictionEffect
  | DeckRestrictionEffect
  | PlayConditionEffect
  | CreatureRaceChoiceEffect
  | OnGuardRevealEffect
  | FetchToDeckEffect
  | AgentRevealSiteOverrideEffect
  | FetchAgentToHandEffect
  | SiteRuleEffect
  | ItemPlaySiteEffect
  | DiscardSubstituteEffect
  | StorableAtEffect
  | ItemCacheHandStoreEffect
  | ItemCacheAltStorageEffect
  | ItemCachePlaySourceEffect
  | ItemCacheCountBonusEffect
  | StorageSiteTransferEffect
  | PlayWithStoredCardEffect
  | CallOfHomeCheckEffect
  | ProtectFromRemovalEffect
  | ForceCheckAllCompanyTopEffect
  | ForceCheckAllInPlayEffect
  | MultiFactionCheckEffect
  | ForceDiscardTargetItemEffect
  | AttackRaceBoostEffect
  | TargetCharacterStatModifierEffect
  | CompanyStrikeEffect
  | CompanyTapCharactersEffect
  | CompanyTapRollEffect
  | SeizedByTerrorCheckEffect
  | LeftBehindSplitEffect
  | PlayDiscardCostEffect
  | RollRemoveHazardEventsEffect
  | AgentTapInfluenceEffect
  | AgentTapAttackEffect
  | AgentAttackModifierEffect
  | AgentDiscardReturnToOriginEffect
  | AgentMoveRestrictionEffect
  | AhuntAttackEffect
  | InfluenceModificationEffect
  | CancelManifestationAttacksEffect
  | DragonAtHomeEffect
  | CallCouncilEffect
  | WardBearerEffect
  | MoveEffect
  | SetCharacterStatusEffect
  | TriggerAttackOnPlayEffect
  | DeckSearchAttackEffect
  | RevealAndAttackEffect
  | NamedCreatureHuntEffect
  | TapAgentEffect
  | ForceReturnToOriginEffect
  | TapSitesInPlayEffect
  | SkillSuppressionEffect
  | LocationMagicRestrictionEffect
  | CancelChainReturnToOriginEffect
  | CancelChainAttackCancelEffect
  | CancelCardEffectsEffect
  | TapDiscardAttachedHazardEffect
  | FetchWizardOnStoreEffect
  | ExtraAgentActionsEffect
  | CompanyCombatBoostEffect
  | PermanentEventAutoAttackEffect
  | FactionSiegeEffect
  | AttackerAttackOptionEffect
  | SiteInstanceTransformEffect
  | ConditionalMpEffect
  | GrantCreatureKeyingEffect
  | PassiveMovementBonusEffect
  | UnderDeepsRollModifierEffect
  | ProhibitCardPlayEffect
  | ExtraUnderDeepsMhPhaseEffect
  | GrantExtraMHPhaseEffect
  | KeyedAttacksNormalEffect
  | AllyTapExtraMHPhaseEffect
  | CharacterTapExtraMHPhaseEffect
  | RegionMovementLimitEffect
  | FwSiteAlignmentRestrictionEffect
  | ProhibitCompanyEventsEffect
  | HazardLimitEnvironmentEffect
  | CancelHazardEventPlayEffect
  | TakePrisonerEffect
  | StrikeShieldEffect
  | CancelPrisonerTakingEffect
  | EventMaintenanceEffect
  | DuplicateSiteAutoAttacksEffect
  | CreateSiteAutoAttackEffect
  | AutoAttackBoostEffect
  | SiteItemTrapEffect
  | SiteEntryRollAttackEffect
  | SitePhaseStartAttackEffect
  | CompanyMovementRollEffect
  | HazardLimitSwapEffect
  | DiscardForHazardLimitEffect
  | RingTestTableEffect
  | RingTestSearchEffect
  | GrantSkillEffect
  | OverrideSkillsEffect
  | ItemSlotModifierEffect
  | CompanyOvertEffect
  | AssignStrikeWhenTappedEffect
  | FreeStrikeAssignmentEffect
  | AvatarHomeSiteRestrictionEffect
  | CombatTapCompanyBoostEffect
  | RingwraithModeEffect
  | RingwraithFollowerSlotsEffect
  | RingwraithSelfFollowerEffect
  | MagicDiscardToDeckEffect
  | AbsorbWoundEffect
  | GrantKeywordEffect
  | ProtectFromBodyCheckEffect
  | ExtraTrollLeaderSlotEffect
  | ExtraLeaderSlotEffect
  | StartingCompanyPlacementEffect
  | SummonsFromLongSleepEffect
  | SetAsideEffect
  | PressGangCaptureEffect
  | EliminateInsteadOfDiscardEffect
  | PlayCreatureFromDiscardEffect
  | GrantReplayAttackedCreatureEffect
  | LeaderControlEffect
  | StagePointsEffect
  | ControlRestrictionEffect
  | GeneralInfluenceExemptEffect
  | AutoInfluenceFactionEffect
  | PlayAsSauronEffect
  | NoCharacterPlayLimitEffect
  | OwnMpNotCountedEffect
  | FactionMpOverrideEffect
  | PermanentEventMpEffect
  | NonCharacterMpOverrideEffect
  | CharacterMpOverrideEffect
  | NonHavenCompanyMpPinEffect
  | PlayedAfterFactionMpPinEffect
  | RecruitmentVehicleEffect
  | RecruitCharacterEffect
  | AllowCharacterPlayEffect
  | OrgPhaseFetchEffect
  | StayHerAppetiteEffect
  | AllyBodyCheckBoostEffect
  | CreatureAltEventEffect
  | CancelDeckSearchEffect
  | CompanyReturnToOriginEffect
  | RunHomeToHavenEffect
  | CompanySitePhaseDoNothingEffect
  | TapCharacterEffect
  | MpInPileEffect
  | DisplaceStoredItemEffect
  | AgentAttackOutcomeEffect
  | AgentTapReturnCharacterEffect
  | AgentTapFactionInfluenceEffect
  | AgentTapMultiInfluenceEffect
  | AgentInfluenceBoostEffect
  | AgentTapOpponentInfluenceEffect
  | OpponentInfluenceOverrideEffect
  | DiscardSelfWhenEffect
  | ReturnSelfToHandWhenEffect
  | DiscardSelfWhenCompanyEffect
  | CompanySizeUnlimitedEffect
  | CompanyInfluenceExemptEffect
  | CompanyCharacterPlayExemptEffect
  | SurfaceRegionAdjacencyEffect
  | SurfaceSiteRollZeroEffect
  | EddyLockEffect
  | SiteLockEffect
  | BalrogSurfaceRegionMovementEffect
  | CompanyMovementRestrictionEffect
  | CompanyMovementTaxEffect
  | VoluntaryDiscardEffect
  | CvccAttackPermissionEffect
  | CvccCaptureInLieuOfBodyCheckEffect
  | GrantAllyPlayEffect
  | FactionMpBonusEffect
  | AttachedFactionMpBonusEffect
  | DiscardOnCardLeavesPlayEffect
  | RetainHazardLongEventsEffect
  | OpposedRollEffect
  | FactionInfluenceRestrictionEffect
  | FactionSelfInfluenceBoostBlockEffect
  | NullifyInfluenceModificationsEffect
  | TapDiscardInPlayEffect
  | RemovalProtectionEffect
  | ForceAgentAttackEffect
  | DiscardUnrevealedOnGuardEffect
  | SwapNewSiteEffect;

/**
 * One consequence of an {@link OpposedRollEffect} contest, run against one of
 * the two rollers. Kept a small closed union (rather than the open
 * {@link TriggeredAction} set) because both branches must name *which* roller
 * they act on — an ambiguity the generic triggered actions cannot express.
 */
export type OpposedRollOutcome =
  | OpposedRollDiscardAttachedOutcome
  | OpposedRollStatModifierOutcome;

/**
 * Discard cards attached to one of the two rollers, each to its **owner's**
 * discard pile (a hazard attached to your character belongs to the opponent).
 * Implemented by the shared `move` primitive with `from: 'hazards-on-target'`,
 * so the owner routing matches The Sun Unveiled (as-56).
 *
 * No More Nonsense (le-210) uses it as: "discard any hazard permanent-events on
 * the other character".
 */
export interface OpposedRollDiscardAttachedOutcome {
  /** Discriminant. */
  readonly type: 'discard-attached';
  /** Whose attached cards are discarded. */
  readonly on: 'challenger' | 'opponent';
  /**
   * DSL condition matched against each attached card's definition (e.g.
   * `{ "$and": [ { "cardType": "hazard-event" }, { "eventType": "permanent" } ] }`).
   * Omit to discard every attached hazard.
   */
  readonly filter?: Condition;
}

/**
 * Grant one of the two rollers a persistent stat modifier bound to the card
 * that ran the contest. Modelled as a `character-stat-modifier` active
 * constraint with `scope: until-cleared` and `requiresSourceBorne`, so the
 * bonus lasts exactly as long as the source card stays attached to that
 * character — matching a permanent event that keeps sitting on its bearer.
 *
 * No More Nonsense (le-210) uses it as: "the leader receives +2 direct
 * influence" / "the leader receives -2 direct influence".
 */
export interface OpposedRollStatModifierOutcome {
  /** Discriminant. */
  readonly type: 'stat-modifier';
  /** Which roller receives the modifier. */
  readonly on: 'challenger' | 'opponent';
  /** Which stat the modifier adjusts. */
  readonly stat: 'prowess' | 'body' | 'direct-influence';
  /** Signed adjustment (le-210: `2` on a win, `-2` on a loss). */
  readonly value: number;
}

/**
 * An **opposed roll**: two characters each make a 2d6 roll, a stat is added to
 * each total, and the totals are compared. The *challenger* is the card's
 * play-target; the *opponent* is a second character chosen when the card is
 * played (`opponent: 'chosen-company-member'` — any other character in the
 * challenger's company). The two rolls are made one at a time through an
 * `opposed-roll` pending resolution, so each is a distinct, modifiable game
 * event rather than a hidden pair of RNG draws.
 *
 * Used by No More Nonsense (le-210): "Make a roll for the leader. Choose
 * another character in the company and do the same. If the leader's result plus
 * his prowess is greater than the other character's result plus his prowess,
 * discard any hazard permanent-events on the other character and the leader
 * receives +2 direct influence. Otherwise, the leader receives -2 direct
 * influence."
 *
 * ```json
 * { "type": "opposed-roll", "opponent": "chosen-company-member",
 *   "addStat": "prowess", "comparison": "gt",
 *   "onWin": [ { "type": "discard-attached", "on": "opponent", "filter": … },
 *              { "type": "stat-modifier", "on": "challenger",
 *                "stat": "direct-influence", "value": 2 } ],
 *   "onLose": [ { "type": "stat-modifier", "on": "challenger",
 *                 "stat": "direct-influence", "value": -2 } ] }
 * ```
 */
export interface OpposedRollEffect extends EffectBase {
  readonly type: 'opposed-roll';
  /**
   * How the opposing roller is picked. `'chosen-company-member'` — the playing
   * player selects any *other* character in the challenger's company at play
   * time (the card is unplayable when the company holds no other character).
   */
  readonly opponent: 'chosen-company-member';
  /** Stat added to each side's 2d6 roll before the totals are compared. */
  readonly addStat: 'prowess' | 'body' | 'mind';
  /**
   * How the challenger's total must compare to the opponent's to win.
   * `'gt'` (default) — strictly greater, the "is greater than" wording;
   * `'gte'` — ties go to the challenger.
   */
  readonly comparison?: 'gt' | 'gte';
  /** Outcomes applied, in order, when the challenger wins the contest. */
  readonly onWin?: readonly OpposedRollOutcome[];
  /** Outcomes applied, in order, when the challenger does not win. */
  readonly onLose?: readonly OpposedRollOutcome[];
}

/**
 * Grants extended ally-play permission from a permanent-event attached to a
 * character (the *bearer*). While in play, any ally matching {@link filter}
 * becomes playable in the bearer's company at its **current site** — regardless
 * of the ally's printed `playableAt` restrictions — and, when
 * {@link fromDiscard} is set, may be sourced from the player's **discard pile**
 * as well as the hand. When {@link excludeBearerControlsCopy} is set, an ally is
 * excluded from the grant if the bearer already controls a copy of it (matched
 * by card name).
 *
 * Used by Glove of Radagast (wh-111): "Any non-unique ally with 1 mind (a copy
 * of which he does not already control) is considered playable with Radagast at
 * his site. This ally may be taken from your discard pile or hand." Here
 * `filter` matches non-unique, 1-mind allies, `excludeBearerControlsCopy` is
 * true, and `fromDiscard` is true.
 *
 * ```json
 * { "type": "grant-ally-play",
 *   "filter": { "$and": [ { "target.unique": { "$ne": true } }, { "target.mind": 1 } ] },
 *   "excludeBearerControlsCopy": true,
 *   "fromDiscard": true }
 * ```
 */
export interface GrantAllyPlayEffect extends EffectBase {
  readonly type: 'grant-ally-play';
  /**
   * Condition matched against the candidate ally's card definition, wrapped as
   * `{ target: allyDef }` (so `target.unique`, `target.mind`, `target.race`,
   * etc. are available). Omit to grant every ally.
   */
  readonly filter?: Condition;
  /**
   * When `true`, a granted ally may also be played from the player's discard
   * pile (not only the hand).
   */
  readonly fromDiscard?: boolean;
  /**
   * When `true`, an ally is excluded from the grant if the bearer already
   * controls a copy of it (same card name in the bearer's `allies`).
   */
  readonly excludeBearerControlsCopy?: boolean;
  /**
   * When `true`, the grant is **player-scoped and Wizardhaven-keyed** rather
   * than tied to a bearer character. The engine finds the granting
   * permanent-event in the player's `cardsInPlay` (not a company member's
   * `items`) and extends playability to a matching ally only when the acting
   * company's current site is one of the player's own **protected
   * Wizardhavens** ({@link playerHasProtectedWizardhaven}). Used by An Untimely
   * Brood (wh-62): "One non-unique ally with a mind of 1 is playable at one of
   * your tapped or untapped protected Wizardhavens each of your site phases."
   */
  readonly atProtectedWizardhavens?: boolean;
  /**
   * When set, the grant is **player-scoped and company-size-keyed** rather
   * than tied to a bearer character or a Wizardhaven: the engine finds the
   * granting permanent-event in the player's `cardsInPlay` and extends
   * {@link allowTappedSite} to any company whose {@link companyEffectiveSize}
   * is at most this value, at **any** site (unlike
   * {@link atProtectedWizardhavens}, no site restriction applies). Unlike
   * `filter`, this does not relax *which* allies are playable — only the
   * printed untapped-site requirement. Used by Friend of Secret Things
   * (wh-109): "Your companies with a company size of 2 or less may play
   * allies at tapped sites."
   */
  readonly maxCompanySize?: number;
  /**
   * When `true`, the target site may be **tapped or untapped** — the grant
   * lifts the normal untapped-site requirement for ally play. Meaningful with
   * {@link atProtectedWizardhavens} (wh-62: "tapped or untapped protected
   * Wizardhavens") or {@link maxCompanySize} (wh-109).
   */
  readonly allowTappedSite?: boolean;
  /**
   * When `true`, only **one** ally may be played through this grant per site
   * phase. The reducer records a turn-scoped `granted-action-used` lock
   * (keyed by the granting card instance) the first time such an ally is
   * played; the legal-action scanner suppresses further grant-enabled plays
   * for the rest of the phase (wh-62: "each of your site phases").
   */
  readonly oncePerSitePhase?: boolean;
}

/**
 * Marks a hazard-creature card as also playable in an alternative event mode
 * (CoE "dual-mode" creatures, e.g. Mouth of Sauron tw-65, Beorning
 * Skin-changers ba-10). The creature keeps its normal keyed-creature combat
 * play; this effect declares the *alternative* — the same card may instead be
 * played by the hazard player as a `short-event` (or, later, a
 * `permanent-event`) against the active company, counting against the hazard
 * limit like any event.
 *
 * The alternative mode's actual behaviour lives in the card's other top-level
 * effects (e.g. a `move` from discard to hand for tw-65), which resolve through
 * the normal hazard short-event chain path once the card is played in event
 * mode — so no behaviour is duplicated here. This effect is purely the mode
 * declaration the legal-action generator and play reducer key off.
 *
 * Distinct from `play-flag: playable-as-event`, which only feeds the
 * deck-construction ½-creature weighting (`deck-validation.ts`) and carries no
 * mode; both may coexist on a card.
 */
export interface CreatureAltEventEffect extends EffectBase {
  readonly type: 'creature-alt-event';
  /** The alternative event mode this creature may also be played in. */
  readonly mode: 'short-event' | 'permanent-event';
  /**
   * Optional targeting for the event mode, evaluated against the active
   * company (via the target-company condition context: `company.alignment`,
   * `company.characterNames`, `company.maxUntappedWarriorProwess`, …). When
   * absent, the event may be played against any company. Distinct from the
   * creature mode's own `play-condition: target-company` — the two modes of a
   * dual card can target different companies (e.g. Beorning Skin-changers
   * ba-10: creature vs minion companies, short-event vs a hero company).
   */
  readonly targetCompany?: Condition;
  /**
   * When true, the event mode may only be played against a company that is
   * actually moving (has a declared destination site) — e.g. ba-10's
   * short-event "against a moving hero company".
   */
  readonly requiresMovingCompany?: boolean;
  /**
   * When true (permanent-event mode only), the in-play permanent-event is
   * NOT convertible to a short-event by tapping (the Nazgûl mechanism):
   * `tap-alt-permanent-event` is neither offered nor accepted for it. The
   * card simply stays in play carrying its passive effects and leaves play
   * only via its own rules — e.g. Lady of the Golden Wood (as-13), whose
   * permanent-event persists until "any play deck is exhausted" (an
   * `on-event: play-deck-exhausted` self-discard).
   */
  readonly persistent?: boolean;
  /**
   * Gates the permanent-event mode's *availability* (not its ongoing
   * behaviour) on a condition evaluated against `{ inPlay: <game-wide in-play
   * card names> }` — e.g. `{ "inPlay": "Doors of Night" }`. When absent, the
   * event mode is always offered. Used by Shelob (tw-86): "If Doors of Night
   * is in play, Shelob may be played as a permanent-event…" — the creature
   * mode has no such gate, only the alternate permanent-event mode does.
   */
  readonly when?: Condition;
  /**
   * When true (permanent-event mode only), the in-play permanent-event
   * converts to a full **creature attack** — using the card's own printed
   * stats plus any global effects active at resolution (including the
   * carrying card's own passive `stat-modifier`s, since the card is still in
   * `cardsInPlay` while its attack resolves) — instead of a short-event
   * conversion. Offered as `attack-alt-permanent-event` rather than
   * `tap-alt-permanent-event` (`attackFromAltPermanentEventActions`,
   * `legal-actions/movement-hazard.ts`); the card stays in `cardsInPlay`
   * until `finalizeCombat`'s standard creature-attack disposal (discard, or
   * the defender's kill pile if defeated) removes it. Counts one against the
   * hazard limit like the short-event conversion. Used by Shelob (tw-86):
   * "She may opt to attack from a permanent-event state and receive these
   * bonuses, but her attack counts as one against the hazard limit."
   */
  readonly attacksAsCreature?: true;
}

/**
 * While the card carrying this effect is in play (in its owner's
 * `cardsInPlay`), all effects that would let an affected player search through
 * or look at any portion of **his own** play deck or discard pile outside of
 * the normal sequence of play are automatically canceled.
 *
 * {@link affects} selects which players are hit: `"minion"` (the default) hits
 * only Ringwraith/Balrog players — MEBA: the Balrog player is a minion player —
 * `"non-minion"` hits everyone *but* those, i.e. Wizard and Fallen-wizard
 * players, and `"all"` hits every player regardless of alignment.
 *
 * The inherited {@link EffectBase.when} narrows the cancel further, evaluated
 * per *acting* player (the one whose search is about to happen) against the
 * context `{ player: { alignment, minion, playDeckSize } }`. Flotsam and Jetsam
 * (wh-18) uses it for "If a player has 15 or fewer cards in his play deck (20
 * or fewer if a Fallen-wizard)": `affects: "all"` plus an `$or` over the two
 * alignment/deck-size branches. Because the gate reads the *current* deck size,
 * a player drops in and out of the cancel as his deck shrinks.
 *
 * Enforced at every point where a `fetch-to-deck` pending effect with a
 * `deck` or `discard-pile` source would be enqueued for such a player (the
 * shared `gateDeckSearchFetch` helper in `reducer-utils.ts`): the canceled
 * sources are stripped; when no source remains the whole fetch fizzles.
 * Sideboard access and the normal sequence of play (end-of-turn draws, the
 * deck-exhaustion reshuffle and its sideboard exchange) are unaffected.
 *
 * Used by Lady of the Golden Wood (as-13) in its permanent-event mode
 * (`affects: "minion"`), and by Bane of the Ithil-stone (tw-13), whose
 * "Automatically cancels any effect that causes a player to search through or
 * look at any portion of a play deck or a discard pile outside of the normal
 * sequence of play" is narrowed by "This card has no effect on a minion
 * player" to `affects: "non-minion"`. Flotsam and Jetsam (wh-18) hits every
 * player (`affects: "all"`) but only while his play deck has run low, via the
 * inherited `when` gate.
 */
export interface CancelDeckSearchEffect extends EffectBase {
  readonly type: 'cancel-deck-search';
  /** Which players the cancel applies to (default `"minion"`). */
  readonly affects?: 'minion' | 'non-minion' | 'all';
}

/**
 * Forces the active movement/hazard company to return to its site of origin
 * (CoE rule 2.IV.4 mechanism, shared with `agent-discard-return-to-origin`):
 * the company keeps its origin site instead of its destination and may not act
 * during its site phase (a `site-phase-do-nothing` constraint). Carried by a
 * hazard short-event (including a dual-mode creature played as a short-event,
 * e.g. Beorning Skin-changers ba-10) and applied on chain resolution.
 *
 * The optional `unless` condition is evaluated against the target company; when
 * it matches, the company is NOT returned (the card resolves with no effect).
 * ba-10: "Unless the company contains Beorn or an untapped warrior with prowess
 * greater than 4, it must return to its site of origin."
 */
export interface CompanyReturnToOriginEffect extends EffectBase {
  readonly type: 'company-return-to-origin';
  /** When this condition matches the target company, the return is skipped. */
  readonly unless?: Condition;
}

/**
 * "Run home" ally ability (Bill the Pony tw-198). While the ally carrying this
 * effect is in a company at a non-Haven, non-Under-deeps site whose character
 * count is `maxCompanySize` or fewer, the controlling player may — during their
 * end-of-turn phase — discard this ally and move its company to the site's
 * nearest Haven [{H}]. Per the card errata this is considered movement with no
 * movement/hazard phase, so the departure site follows the ordinary site-card
 * lifecycle (untapped/haven → location deck, tapped → site discard pile).
 */
export interface RunHomeToHavenEffect extends EffectBase {
  readonly type: 'run-home-to-haven';
  /** Maximum company size (character count) for the option to be available. */
  readonly maxCompanySize: number;
}

/**
 * Forbids the active movement/hazard company from doing anything during its
 * upcoming site phase this turn — a `site-phase-do-nothing` constraint is added
 * to the target company (the same mechanism `company-return-to-origin` uses),
 * but the company keeps its destination site and its movement is unaffected
 * (only the site phase is blocked). Carried by a hazard short-event and applied
 * on chain resolution.
 *
 * Playability is expressed with a companion `play-target: "company"` filter (the
 * short-event company-target path in `legal-actions/movement-hazard.ts` exposes
 * `target.siteType`, `target.siteKeywords`, `target.characterCount`,
 * `target.spawnInPlayCount`, and the precomputed `target.moreSpawnThanCompany`
 * boolean so the filter can gate on the site type and the Spawn-count
 * comparison).
 *
 * Used by **Darkness Made by Malice (ba-15)**: "Playable on a company at or
 * moving to a Ruins & Lairs [{R}] or Under-deeps site, if there are more Spawn
 * cards in play than characters in the company. Eliminated Spawn do not count.
 * The company must do nothing during its site phase this turn."
 */
export interface CompanySitePhaseDoNothingEffect extends EffectBase {
  readonly type: 'company-site-phase-do-nothing';
  /**
   * When this condition matches the target company (evaluated against the
   * {@link buildTargetCompanyConditionContext} `company.*` fields, same as
   * {@link CompanyReturnToOriginEffect.unless}), the restriction is skipped
   * entirely — no constraint is installed. Used by Fifteen Birds in Five
   * Firtrees (dm-129): "unless it contains a Wizard" (`company.containsWizard`).
   */
  readonly unless?: Condition;
  /**
   * Optional companion escape hatch installed alongside the
   * `site-phase-do-nothing` constraint, sourced from the same card so
   * `remove-constraint` (`select: "constraint-source"`) clears both at once —
   * the same two-constraint pattern River (tw-84/le-95) uses for its
   * ranger-tap escape, but declared directly rather than via an `on-event`
   * wrapper (this effect fires on the short event's own resolution, not a
   * later triggered event). Used by Fifteen Birds in Five Firtrees (dm-129):
   * "or you discard Eagle-mounts from your hand" — a `cost: { discard:
   * "named-card", discardCardName: "Eagle-mounts" }` grant with no character
   * actor required.
   */
  readonly escape?: GrantedActionConstraintPayload;
}

/**
 * Taps one chosen character in play. A short-event effect (including a dual-mode
 * creature's `permanent-event` on-tap behaviour, e.g. Adûnaphel tw-2: "When
 * tapped, … causes any one character to tap"). The specific character is chosen
 * when the card is played/tapped and carried on the chain entry's
 * `targetCharacterId`; the legal-action generator offers one action per
 * eligible target.
 */
export interface TapCharacterEffect extends EffectBase {
  readonly type: 'tap-character';
  /**
   * Optional filter on which characters may be targeted (evaluated against the
   * character definition). Absent = any character in play.
   */
  readonly filter?: Condition;
}

/**
 * Bespoke post-attack behaviour for a manifestation agent (My Precious dm-29),
 * evaluated when the agent's own attack resolves (in `finalizeCombat`):
 *
 * - `onSuccessVsRing`: on a successful attack (a defender was wounded) against a
 *   company holding a ring (a `gold-ring` item), the agent is discarded and one
 *   ring is discarded — reusing the `force-discard-card` resolution so the
 *   attacker chooses which ring.
 * - `onFailSurvive`: on a failed attack (no wound) where the agent survives, the
 *   defender is offered (via a `agent-play-manifestation-offer` resolution) the
 *   option to tap a character in the target company and play the agent's other
 *   manifestation (`manifestationCardName`, e.g. Gollum tw-246) from hand, after
 *   which the agent is discarded.
 */
export interface AgentAttackOutcomeEffect extends EffectBase {
  readonly type: 'agent-attack-outcome';
  readonly onSuccessVsRing?: 'discard-self-and-ring';
  readonly onFailSurvive?: 'defender-plays-manifestation';
  /** The card name of the manifestation the defender may play from hand (Gollum). */
  readonly manifestationCardName?: string;
}

/**
 * Global rule (in-play, either player's `cardsInPlay`): every revealed
 * (face-up) agent standing at a site a company enters must declare an attack
 * against that company — the hazard player's usual option to pass on an
 * agent attack is removed for any such agent. Face-down agents are
 * unaffected: revealing one to attack remains optional.
 *
 * Computed by `agentAttackIsMandatory` (`reducer-utils.ts`) and consulted by
 * `declareAgentAttackActions` (`legal-actions/site.ts`), which omits the
 * `pass` action from the declare-agent-attack step whenever a face-up agent
 * at the company's current site has not yet attacked this site phase.
 *
 * Used by Ordered to Kill (dm-152): "Each face up agent must attack if a
 * company enters a site where he is located."
 */
export interface ForceAgentAttackEffect extends EffectBase {
  readonly type: 'force-agent-attack';
}

/**
 * Global rule (in-play, either player's `cardsInPlay`): at site-phase
 * cleanup, on-guard cards still sitting unrevealed on a company are
 * discarded to their owner's discard pile instead of being returned to the
 * owner's hand (the CoE default, `returnOnGuardCardsToHand`).
 *
 * Computed by `unrevealedOnGuardDiscarded` (`reducer-utils.ts`) and consulted
 * by `returnOnGuardCardsToHand` (`reducer-site.ts`).
 *
 * Used by Ordered to Kill (dm-152): "Additionally, any unrevealed on-guard
 * cards are discarded instead of being returned to their owner's hand."
 */
export interface DiscardUnrevealedOnGuardEffect extends EffectBase {
  readonly type: 'discard-unrevealed-on-guard';
}

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

/**
 * Bonus to the 2d6 roll required for a company to move between adjacent
 * Under-deeps sites (CoE 2.IV.i.1). Carried by an item, ally, or character
 * card; while the source card is present anywhere in the moving company,
 * {@link value} is added to the roll — modeled as an equivalent reduction of
 * the required roll (floored at 0), the same trick used for the Balrog's
 * built-in +3 (`companyContainsBalrogAvatar` in `mh-steps.ts`). Modifiers
 * from every company member stack.
 *
 * Collected in `mh-steps.ts` (`getUnderDeepsRequiredRoll` call site) via
 * `collectCharacterEffects` over each character in the moving company.
 *
 * Used by Iron Shield of Old (as-127): "+2 to all rolls required for
 * bearer's company to move to adjacent Under-deeps sites."
 */
export interface UnderDeepsRollModifierEffect extends EffectBase {
  readonly type: 'under-deeps-roll-modifier';
  /** Bonus added to the roll (equivalently subtracted from the required roll). */
  readonly value: number;
  /**
   * Where the modifier applies.
   *
   * - Omitted (default): the effect is carried by an item, ally, or character
   *   and applies only to the company that carries it (Iron Shield of Old,
   *   as-127; collected via `collectCharacterEffects`).
   * - `'minion-companies'`: the effect is a game-wide environment (an in-play
   *   resource long-event) that applies to every Ringwraith-minion company's
   *   Under-deeps movement roll, regardless of who carries it. Collected from
   *   either player's `cardsInPlay` in `mh-steps.ts`. Used by The Under-roads
   *   (as-106): "The roll required for minions to move between adjacent
   *   Under-deeps sites is decreased by 3."
   * - `'all-companies'`: the effect is a game-wide environment applying to
   *   *every* company's Under-deeps movement roll regardless of alignment —
   *   unlike `'minion-companies'`, the card text names no side. Collected the
   *   same way (either player's `cardsInPlay`), with no alignment gate. Used
   *   by Secret Ways (dm-157): "The roll required to move between adjacent
   *   Under-deeps sites is decreased by 4."
   */
  readonly scope?: 'minion-companies' | 'all-companies';
}

/**
 * While the carrying card is in play, the cards it names (or matches with
 * {@link ProhibitCardPlayEffect.filter}) may not be played by **either**
 * player. This is the generic "prohibits the subsequent play of X" primitive —
 * a hard play-lock, distinct from {@link CancelCardEffectsEffect} (which only
 * suppresses an in-play card's *constraints* while leaving it in play and
 * re-playable).
 *
 * Two ways to select the locked cards, which may be combined:
 *
 * - `cardNames` — by card name. Additionally a **one-time discard on entry**:
 *   when the carrying card resolves, every named card already in either
 *   player's `cardsInPlay` is discarded to its owner's discard pile
 *   (`resolveLongEvent`). This is the "discards *and* prohibits" wording of
 *   The Under-roads (as-106): "Discards and prohibits the subsequent play of
 *   The Way is Shut."
 * - `filter` — a DSL condition matched against card **definitions**, for
 *   class-wide locks. Purely forward-looking: copies already in play are left
 *   alone, matching Balance Between Powers (dm-118), "No environment cards can
 *   be played", which never touches the environments already on the table.
 *
 * The ongoing play-lock is enforced centrally in `computeLegalActions`
 * (`legal-actions/index.ts`), which turns every `play-short-event` /
 * `play-long-event` / `play-permanent-event` / `play-hazard` action for a
 * locked card into a `not-playable` entry, in every phase and in the chain and
 * combat windows alike.
 */
export interface ProhibitCardPlayEffect extends EffectBase {
  readonly type: 'prohibit-card-play';
  /** Names of the cards that are discarded on entry and may not be played. */
  readonly cardNames?: readonly string[];
  /**
   * Condition matched against card definitions. Every matching card is barred
   * from play while this card is in play; nothing already in play is touched.
   */
  readonly filter?: Condition;
}

/**
 * Permanent-event effect granting repeated Under-deeps movement/hazard phases
 * (Gangways over the Fire, ba-60). While the controlling player has a card
 * carrying this effect in play, each of their **moving** companies may — at the
 * end of its movement/hazard phase — attempt another Under-deeps movement to a
 * new site it has not used yet this turn; another site card is played and a
 * fresh movement/hazard phase immediately follows for that company.
 *
 * The Under-deeps movement roll for each such extra phase is penalised by the
 * number of complete movement/hazard phases the company has already taken this
 * turn (the first extra move is at −1, the second at −2, and so on). The engine
 * tracks these counts and the sites used per company on the movement/hazard
 * phase state (`gangwaysPhaseCounts` / `gangwaysSitesUsed`) and offers the
 * choice at the dedicated `gangways-offer` step.
 */
export interface ExtraUnderDeepsMhPhaseEffect extends EffectBase {
  readonly type: 'extra-under-deeps-mh-phase';
}

/**
 * Resource short-event that grants a moving company **another** movement/hazard
 * phase this turn (Forced March le-185, Bridge tw-202, Leg It Double Quick
 * le-202, Ûvatha Unleashed le-248). Played at the end of the company's
 * movement/hazard phase — routed through the resource short-event handler,
 * which flags the active company with `extraMHPhasePending`. Once the company
 * commits its current move, `advanceAfterCompanyMH` consumes the flag and
 * offers it a new movement to an additional site (the `extra-mh-move-offer`
 * step): another site card is played and a fresh movement/hazard phase follows
 * for that company.
 *
 * The play window is gated to the qualifying destination: when
 * {@link requiresDestinationSiteType} is set, the company must be moving to a
 * site of that type (e.g. `haven` for Forced March / Bridge); when
 * {@link requiresDestinationAlignment} is set, the destination site must carry
 * that alignment (e.g. `ringwraith` — a Darkhaven — for Forced March). With no
 * requirements, any moving company qualifies (Leg It Double Quick).
 *
 * {@link movement} `"under-deeps"` switches the whole effect to the
 * Under-deeps variant (World Gnawed by the Nameless as-110): the play gate
 * requires the company to be moving to an Under-deeps site (`under-deeps`
 * keyword on the destination), and the extra move offers Under-deeps
 * destinations instead of normally-reachable ones — sites carrying the
 * `under-deeps` keyword, Under-deeps-adjacent to the company's current site,
 * still in the site deck, and **not attempted by this company yet this turn**
 * (tracked per company on the M/H phase state `underDeepsAttempts` whenever an
 * Under-deeps path is declared, so a failed movement roll still marks the site
 * as attempted). The extra phase itself runs through the normal Under-deeps
 * declare-path/roll flow.
 *
 * {@link returnToHand} makes the resolved event return to its owner's hand
 * instead of being discarded ("Return this card to your hand" — as-110), so it
 * can be replayed in a later movement/hazard phase this turn.
 */
export interface GrantExtraMHPhaseEffect extends EffectBase {
  readonly type: 'grant-extra-mh-phase';
  /** Required destination {@link SiteType} of the qualifying move, if any. */
  readonly requiresDestinationSiteType?: SiteType;
  /** Required destination site alignment (e.g. `ringwraith` for a Darkhaven), if any. */
  readonly requiresDestinationAlignment?: string;
  /** `"under-deeps"`: gate on an Under-deeps destination and offer an Under-deeps extra move. */
  readonly movement?: 'under-deeps';
  /** Return the resolved event to its owner's hand instead of discarding it. */
  readonly returnToHand?: boolean;
}

/**
 * Companion effect on a company-affecting resource event: for the rest of the
 * turn, every hazard-creature attack the target company faces that is **keyed
 * to** one of {@link siteTypes} resolves as a normal attack, never as
 * detainment — overriding the alignment-based detainment rules of CoE §3.II.2
 * (and any `combat-detainment` declared on the creature).
 *
 * Resolved into a turn-scoped `keyed-attacks-normal` active constraint on the
 * target company; `isDetainmentAttack` consults it via the
 * `normalIfKeyedToSiteTypes` context field, matched against the site types the
 * attack was actually keyed by (the declared keying when available, else the
 * union of the creature's currently-valid `keyedTo` site types).
 *
 * Used by World Gnawed by the Nameless (as-110): "All hazard creatures the
 * company faces this turn keyed to Shadow-holds [{S}] attack normally, not as
 * detainment" — `siteTypes: ["shadow-hold"]`.
 */
export interface KeyedAttacksNormalEffect extends EffectBase {
  readonly type: 'keyed-attacks-normal';
  /** Site types whose keyed attacks against the target company become normal. */
  readonly siteTypes: readonly SiteType[];
}

/**
 * Ally-carried ability offered at the same `advanceAfterCompanyMH` decision
 * point as {@link GrantExtraMHPhaseEffect}: when the bearer's company matches
 * {@link condition} (evaluated against the {@link CompanyCharacterCount}-style
 * composition context — `company.characterCount` plus one `count.<as>` per
 * declared {@link counts} entry) at the end of its movement/hazard phase, the
 * active player may tap the untapped ally carrying this effect to send the
 * company on another movement to an additional site — a fresh movement/hazard
 * phase, via the shared `extra-mh-move-offer` step.
 *
 * Used by Shadowfax (tw-326): "If his company has only one character or one
 * character and a Hobbit at the end of the movement/hazard phase, tap
 * Shadowfax to allow his company to immediately move again" —
 * `counts: [{ "as": "hobbit", "filter": { "character.race": "hobbit" } }]`,
 * `condition: { "$or": [{ "company.characterCount": 1 }, { "$and": [{ "company.characterCount": 2 }, { "count.hobbit": 1 }] }] }`.
 */
export interface AllyTapExtraMHPhaseEffect extends EffectBase {
  readonly type: 'ally-tap-extra-mh-phase';
  /** Named filtered headcounts published to {@link condition} as `count.<as>`. */
  readonly counts?: readonly CompanyCharacterCount[];
  /** Condition against the company-composition context gating the offer. */
  readonly condition: Condition;
}

/**
 * Character-carried counterpart to {@link AllyTapExtraMHPhaseEffect}: the
 * bearer (a character in the company, not an attached ally) may itself be
 * tapped, at the same end-of-M/H-phase decision point, to send its own
 * company on another movement to an additional site — a fresh
 * movement/hazard phase, via the shared `extra-mh-move-offer` step. There is
 * no company-composition condition; any company containing an untapped
 * bearer qualifies.
 *
 * {@link requiresDestinationSitePathIncludes}, if set, additionally restricts
 * the extra move's destination to a site whose static `sitePath` (region
 * types) includes at least one of the listed types.
 *
 * Used by Carambor (le-5): "May tap at the end of his company's
 * movement/hazard phase to allow it to move to an additional site on the
 * same turn... The new site path must contain at least one Wilderness
 * [{w}]." — `requiresDestinationSitePathIncludes: ["wilderness"]`.
 */
export interface CharacterTapExtraMHPhaseEffect extends EffectBase {
  readonly type: 'character-tap-extra-mh-phase';
  /** Destination site's `sitePath` must include at least one of these region types. */
  readonly requiresDestinationSitePathIncludes?: readonly RegionType[];
}

/**
 * Hazard short-event that substitutes a *different* site card, drawn from the
 * hazard player's own location deck, for a moving company's already-declared
 * destination site — CoE 2.II.7's normal rule that a company's new site
 * always comes from its own owner's location deck is overridden for this one
 * substitution. Playable only while the destination site's static `sitePath`
 * includes at least one of {@link requiresDestinationSitePathIncludes}; the
 * replacement drawn from the hazard player's location deck must satisfy the
 * same site-path requirement.
 *
 * `swapNewSiteActions` (`legal-actions/movement-hazard.ts`) offers one
 * `play-hazard` action per eligible site left in the hazard player's own
 * `siteDeck`, each carrying its instance in `replacementSiteInstanceId`.
 * `handleSwapNewSite` (`mh-hazard-play.ts`) then: returns the company's
 * original destination site card, untapped, to its own owner's location deck
 * (mirroring `clearPlannedMovement` — it was never entered, only declared),
 * pulls the chosen replacement out of the hazard player's location deck as
 * the company's new untapped `destinationSite`, and refreshes the cached
 * `destinationSiteName` / `destinationSiteType` on the movement/hazard phase
 * state (both already resolved by the time the play-hazards step runs) to
 * match the replacement. `resolvedSitePath` (the region types the company
 * actually traveled through) is a movement-path record, not a site-identity
 * one, so it is untouched by the swap.
 *
 * Used by *Winds of Wrath* (td-82): "Playable if Doors of Night is in play
 * and opponent is using the same type of location deck (minion/hero) as
 * yourself. Replace the new site card of a moving company with a Coastal Sea
 * [{c}] in its site path with a card from your location deck that has a
 * Coastal Sea [{c}] in its site path." — `requiresDestinationSitePathIncludes:
 * ["coastal"]`, paired with a `play-condition` `requires: "card-in-play"`
 * (Doors of Night) and a `play-condition` `requires: "player-state"` gate on
 * `player.sameLocationDeckTypeAsOpponent`.
 */
export interface SwapNewSiteEffect extends EffectBase {
  readonly type: 'swap-new-site';
  /**
   * Both the company's current destination site and the replacement site
   * must have a static `sitePath` including at least one of these region
   * types.
   */
  readonly requiresDestinationSitePathIncludes: readonly RegionType[];
}

/**
 * Environment effect that reduces the maximum number of regions any moving
 * company may traverse with region movement. Carried by an in-play hazard
 * environment permanent-event; it applies game-wide (to every player's
 * companies), not just to the controller's.
 *
 * The effective max region distance is reduced by {@link reduce}, or by
 * {@link reduceWithDoorsOfNight} while *Doors of Night* is in play, and is
 * never lowered below {@link min}.
 *
 * Consumed at movement-plan time (`organization-companies.ts`) and at
 * company selection in the Movement/Hazard phase
 * (`reducer-movement-hazard.ts`) via `collectRegionMovementReduction`.
 *
 * Used by No Way Forward (dm-75): "The number of region cards that may be
 * played by a moving company using region movement is reduced by one (by
 * two if Doors of Night is in play) to a minimum of two."
 */
export interface RegionMovementLimitEffect extends EffectBase {
  readonly type: 'region-movement-limit';
  /** Regions subtracted from the max region distance for every moving company. */
  readonly reduce: number;
  /** Reduction applied instead of {@link reduce} while Doors of Night is in play. */
  readonly reduceWithDoorsOfNight?: number;
  /** Floor below which the reduced max region distance may never drop. */
  readonly min: number;
}

/**
 * Locks which *alignment* of a site card a Fallen-wizard player may use for a
 * given location. A Fallen-wizard's location deck may hold both the hero and
 * the minion version of the same place (CoE rule 1.28), and the two versions
 * play very differently — hero Lórien (tw-408) is a Haven, minion Lórien
 * (as-155) is a plain Free-hold with no haven benefits.
 *
 * While a card carrying this effect is in play, every Fallen-wizard player is
 * barred from *using* the version named by the opposite of {@link require} for
 * any location whose printed site type is in {@link siteTypes} — the other
 * version must be used instead. If the player's location deck holds only the
 * barred version, that location simply becomes unreachable.
 *
 * The effect applies game-wide to every Fallen-wizard player, and its optional
 * `when` is matched per-player against
 * `{ player: { alignment, stagePoints } }`, so a single card can escalate its
 * reach with the Fallen-wizard's stage points.
 *
 * Only `hero-site` / `minion-site` cards are affected: a `fallen-wizard-site`
 * (any Wizardhaven) counts as both hero and minion (MEWH §10) and is never
 * barred.
 *
 * Consumed when movement is declared (`organization-companies.ts`
 * `planMovementActions`, via `fwSiteVersionForbidden`), which is the only point
 * at which a player chooses a site card from the location deck.
 *
 * Used by Heart Grown Cold (wh-21): "Fallen-wizard players must use minion site
 * cards for hero Havens [{H}]. If a Fallen-wizard has more than 4 stage points,
 * his player must also use minion site cards for Free-holds [{F}]. If a
 * Fallen-wizard has more than 7 stage points, his player must also use minion
 * site cards for Border-holds [{B}]."
 */
export interface FwSiteAlignmentRestrictionEffect extends EffectBase {
  readonly type: 'fw-site-alignment-restriction';
  /** The site-card alignment the Fallen-wizard is forced to use. */
  readonly require: 'minion' | 'hero';
  /**
   * Printed site types the lock covers, read off the *barred* version's card
   * (e.g. `["haven"]` with `require: "minion"` bars hero Haven cards).
   */
  readonly siteTypes: readonly SiteType[];
}

/**
 * Environment effect that suppresses **resource permanent-events played on a
 * company as a whole** (e.g. Fellowship tw-240) for every company that
 * contains a character of {@link companyHasRace}.
 *
 * Carried by an in-play hazard environment permanent-event, it applies
 * game-wide and has two faces:
 *
 * - **Discard** — every resource permanent-event bound to a matching company
 *   (`CardInPlay.companyId` set, cardType `hero-resource-event` /
 *   `minion-resource-event`, `eventType: "permanent"`) is discarded to its
 *   owner's discard pile. Run continuously by `sweepProhibitedCompanyEvents`
 *   (a `postReduce` sweep in `reducer.ts`), so it also catches a case where a
 *   matching character later joins a company already carrying such an event.
 * - **Prohibition** — no such card may be played on a matching company. The
 *   organization-phase `play-target: company` emitter
 *   (`legal-actions/organization-events.ts`) refuses the play via
 *   `isCompanyEventPlayProhibited`.
 *
 * "Played on the company as a whole, not individual characters" is exactly the
 * `companyId`-bound resource permanent-event (Fellowship), distinct from a
 * character-attached permanent-event (which sets `attachedTo`, not
 * `companyId`), so those are untouched.
 *
 * Used by Stormcrow (td-73): "Discard all resource permanent-events that have
 * been played on each company with a Wizard … No such cards may be played on
 * each Wizard's company." — `companyHasRace: "wizard"`.
 */
export interface ProhibitCompanyEventsEffect extends EffectBase {
  readonly type: 'prohibit-company-events';
  /**
   * Only companies containing a character of this race (e.g. `"wizard"`) are
   * affected — matched against each company member's printed `race`.
   */
  readonly companyHasRace: Race;
}

/**
 * Environment-style effect that modifies companies' hazard limits while the
 * carrying card is in play. Carried by an in-play permanent or long event in
 * either player's `cardsInPlay`; it applies game-wide (to every player's
 * companies), evaluated independently for each company at the moment its
 * hazard limit is snapshotted (site revelation in the Movement/Hazard phase).
 *
 * The {@link value} is added to the company's hazard limit once per matching
 * in-play card. The optional {@link when} condition is evaluated against a
 * per-company context exposing `company.size` (effective size, CoE rule 3.24),
 * `company.hasWizard` (a Wizard avatar is in the company),
 * `company.maxNonRangerMind` (the highest mind among the company's
 * non-ranger characters, or 0 if none), `company.alignment` (the owning
 * player's alignment), `company.covert` (MELE covert/overt status — an
 * overt company is `false`) and `company.regionNames` (the names of the regions
 * the company is moving through this phase, empty when stationary) — see
 * `snapshotHazardLimit` in `mh-steps.ts`. An absent `when` matches every
 * company.
 *
 * Used by Eyes of the Shadow (dm-56): "The hazard limit is increased by two
 * for each moving company with a size of less than four that also contains a
 * Wizard or a non-ranger character with a mind of 6 or more." — `value: 2`
 * with a `when` gate (moving companies only, the default).
 *
 * Used by The Great Eye (as-85): "The hazard limit against all companies is
 * decreased by one (to a minimum of two)." — `value: -1, floor: 2,
 * appliesTo: "all"`.
 *
 * Used by Gandalf the White Rider (as-11): "the hazard limit against all overt
 * minion companies is increased by one." — `value: 1, appliesTo: "all"` with
 * `when: { "company.alignment": "ringwraith", "company.covert": false }`.
 *
 * Used by Radagast the Tamer (as-18): "all companies moving in Southern
 * Mirkwood, Western Mirkwood, Woodland Realm, and/or Heart of Mirkwood have
 * their hazard limit increased by one." — `value: 1` (default
 * `appliesTo: "moving"`) with an `$or` of
 * `{ "company.regionNames": { "$includes": <region> } }` clauses.
 */
export interface HazardLimitEnvironmentEffect extends EffectBase {
  readonly type: 'hazard-limit-environment';
  /** Amount added to a matching company's hazard limit. */
  readonly value: number;
  /** Condition (over the per-company context) gating whether {@link value} applies. Absent = always. */
  readonly when?: Condition;
  /**
   * Floor a negative {@link value} never reduces the limit below ("to a
   * minimum of two"). A limit already at or below the floor is left
   * unchanged — the effect only ever decreases, never raises to the floor.
   */
  readonly floor?: number;
  /**
   * Which companies the effect reaches. `'moving'` (the default) applies only
   * to a company with a declared destination site — dm-56's "each moving
   * company". `'all'` also reaches stationary companies — as-85's "against
   * all companies".
   */
  readonly appliesTo?: 'moving' | 'all';
}

/**
 * In-play card ability: while the carrying card is in play, its controller may
 * discard it during chain declaring to negate an unresolved hazard *event*
 * (short, long, or permanent) declared by the opponent, before it resolves.
 * An event revealed from on-guard is never a legal target (its chain entry
 * carries `fromOnGuard`), matching the printed "cannot be used against an
 * on-guard card" restriction.
 *
 * Offered as a `cancel-hazard-event` action by `legal-actions/chain.ts` and
 * applied by `handleCancelHazardEvent` in `chain-reducer.ts`: the source card
 * moves from `cardsInPlay` to its owner's discard pile and the target entry is
 * marked negated (the canceled card is routed to its owner's discard when the
 * chain completes).
 *
 * Used by The Great Eye (as-85): "If this card is in play, you can discard it
 * to target and cancel the play of a hazard event played by your opponent
 * before it resolves. This cannot be used against an on-guard card."
 */
export interface CancelHazardEventPlayEffect extends EffectBase {
  readonly type: 'cancel-hazard-event-play';
}

// ---- Rescue attack shape (used by TakePrisonerEffect) ----

/**
 * A single rescue-attack that must be faced before rescuing prisoners from
 * a hazard host. Rescue-attacks are not automatic-attacks and do not count
 * against the hazard limit.
 */
export interface RescueAttack {
  /** Race of the rescuing creature (e.g. `"spider"`). */
  readonly race: Race;
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
  /**
   * When true, the character must discard its ring items along with its
   * other possessions on capture — overriding the default CoE 8.35/3.III.3
   * behavior of retaining ring items while imprisoned.
   *
   * Used by Spells of the Barrow-wights (dm-90).
   */
  readonly discardRings?: boolean;
  /**
   * Recurring body check made for the prisoner at the start of each of its
   * owner's untap phases (CoE 3.III.4 does not require this by default —
   * only specific hosts do). `enterUntapPhase` (`reducer-untap.ts`) scans
   * every `character-is-prisoner` constraint targeting the newly-active
   * player's characters; for each whose host carries this field, it
   * enqueues a `dice-check` (roll 2d6 + `modifier` vs the character's
   * effective body; the host's owner rolls, CoE 3.I.1) that eliminates the
   * character on failure. Unlike {@link autoRescue}, surviving the check has
   * no further effect — there is no follow-up escape roll.
   *
   * Used by Spells of the Barrow-wights (dm-90).
   */
  readonly untapBodyCheck?: {
    readonly modifier: number;
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
 * Recurring upkeep cost on an in-play event: every turn its controller must
 * either discard the card or keep it in play by discarding matching cards
 * from hand.
 *
 * The controller pays at the moment named by `trigger`. If no matching card
 * is in hand, the only option is to discard the source card.
 *
 * Used by:
 * - *Thrice Outnumbered* (le-142), a hazard permanent-event: "Discard this
 *   card or a Man hazard creature from your hand at the end of opponent's
 *   long-event phase."
 * - *Balance Between Powers* (dm-118), a hero resource permanent-event: "At
 *   the start of your organization phase, discard this card **or** keep it in
 *   play by discarding an environment card from your hand." — plus the
 *   {@link EventMaintenanceEffect.counterChain} bidding war that follows.
 */
export interface EventMaintenanceEffect extends EffectBase {
  readonly type: 'event-maintenance';
  /**
   * When this maintenance fires.
   *
   * - `opponent-long-event-end` — as the controller's opponent leaves their
   *   long-event phase (le-142, a hazard event: "at the end of opponent's
   *   long-event phase").
   * - `controller-organization-phase-start` — as the controller's own
   *   organization phase begins (dm-118: "at the start of your organization
   *   phase").
   */
  readonly trigger: 'opponent-long-event-end' | 'controller-organization-phase-start';
  /**
   * Filter condition evaluated against card definitions in the paying
   * player's hand. Matching cards may be discarded as payment instead
   * of discarding the source card itself.
   */
  readonly handCardFilter: Condition;
  /**
   * Optional bidding war after the controller keeps the card: the opponent
   * may discard `challengeCount` matching hand cards to discard the source,
   * which the controller may counter with `counterCount`, which the opponent
   * may counter with `challengeCount` again, and so on until one side declines
   * or runs out of matching cards. Absent (le-142) the upkeep payment simply
   * ends the matter.
   */
  readonly counterChain?: {
    /** Cards the opponent discards per attempt to kill the source card. */
    readonly challengeCount: number;
    /** Cards the controller discards per attempt to save it. */
    readonly counterCount: number;
  };
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
 * FEAR! FIRE! FOES! (as-29) Mode A: a hazard short-event played during the M/H
 * phase on a company **moving to** a site whose type is one of {@link siteTypes}
 * ("Playable on a Free-hold [{F}] or Border-hold [{B}]"). On resolution it
 * installs a turn-scoped `extra-automatic-attack` constraint keyed to the
 * destination site instance (which becomes the company's `currentSite` on
 * arrival), so the company faces one **additional real automatic-attack** at the
 * site this turn — resolved through the normal site-phase auto-attack flow
 * alongside the site's printed attacks. Unlike Tidings of Bold Spies
 * ({@link DuplicateSiteAutoAttacksEffect}), the created attack IS an
 * automatic-attack (so cards referencing automatic-attacks apply) and it is
 * faced in the SITE phase, not immediately in M/H.
 *
 * The attack carries no creature race ("no attack type") and forced detainment,
 * expressed on the injected {@link AutomaticAttack} via `creatureType: ""` and
 * `forceDetainment: true`.
 */
export interface CreateSiteAutoAttackEffect extends EffectBase {
  readonly type: 'create-site-auto-attack';
  /**
   * The destination site types the company may be moving to for this card to be
   * playable (e.g. `["free-hold", "border-hold"]`). Checked against the target
   * company's destination site during M/H short-event emission.
   */
  readonly siteTypes: readonly import('./common.js').SiteType[];
  /** The additional automatic-attack created at the site this turn. */
  readonly attack: {
    /** Creature type; empty string means "no attack type". */
    readonly creatureType: string;
    readonly strikes: number;
    readonly prowess: number;
    readonly body?: number;
    /** When true, the created attack is detainment regardless of alignment/site. */
    readonly detainment?: boolean;
  };
}

/**
 * Arouse Defenders (le-101): a hazard short-event played in the M/H phase on a
 * company moving to a Free-hold [{F}] or Border-hold [{B}]. It boosts the
 * prowess of one automatic-attack (the hazard player's choice) at the target
 * site by {@link prowessBonus} and makes that attack impossible to cancel, for
 * that turn's site phase. "Cannot be duplicated on a given site."
 *
 * Like {@link CreateSiteAutoAttackEffect}, the playability gate is the
 * destination site's type; on resolution an `auto-attack-boost` constraint is
 * installed against the moving company (scope `company-site-phase`, keyed to the
 * destination site definition for the per-site duplication limit). The boost is
 * consumed on the first automatic-attack the company faces at the site — the
 * same "one automatic-attack (your choice) = the first faced" modelling used by
 * Choking Shadows (tw-21).
 */
export interface AutoAttackBoostEffect extends EffectBase {
  readonly type: 'auto-attack-boost';
  /**
   * The destination site types the company may be moving to for this card to be
   * playable (e.g. `["free-hold", "border-hold"]`). Checked against the target
   * company's destination site during M/H short-event emission.
   */
  readonly siteTypes: readonly import('./common.js').SiteType[];
  /** Prowess added to the boosted automatic-attack (Arouse Defenders: +2). */
  readonly prowessBonus: number;
  /** When true, the boosted automatic-attack cannot be canceled that turn. */
  readonly uncancelable: boolean;
}

/**
 * Troll-purse (dm-95): a hazard permanent-event attached to a site that has
 * an Orc or Troll automatic-attack. When the resource player plays any item
 * at the bound site during the site phase, the company must face all of the
 * site's automatic-attacks again, each with prowess modified by
 * {@link prowessBonus}. A successful strike does not wound the character;
 * instead the character is taken prisoner at the site (the rescue-attack is
 * the site's automatic-attacks at the time of rescue).
 *
 * The re-faced attacks are sequenced through the `troll-purse-attacks` site
 * sub-step (mirroring the normal `automatic-attacks` step) and the
 * prisoner-on-success is signalled to combat via `CombatState.trollPursePrisoner`.
 */
export interface SiteItemTrapEffect extends EffectBase {
  readonly type: 'site-item-trap';
  /** Prowess added to each re-faced automatic-attack (Troll-purse: +3). */
  readonly prowessBonus: number;
}

/**
 * The attack a {@link SiteEntryRollAttackEffect} inflicts when its entry roll
 * fails. Mirrors an {@link import('./cards-sites.js').AutomaticAttack}'s core
 * fields, but the attack is **not** an automatic-attack: it is created by the
 * hazard event, so automatic-attack modifiers do not apply to it and it carries
 * no site keying.
 */
export interface SiteEntryAttackSpec {
  /** Creature race of the attack, e.g. `"Orcs"`. */
  readonly creatureType: string;
  /** Number of strikes. */
  readonly strikes: number;
  /** Prowess of each strike. */
  readonly prowess: number;
  /** Body of the attacking creature (absent → strikes are auto-defeated on a win). */
  readonly body?: number;
}

/**
 * Doubled Vigilance (dm-51): a hazard permanent-event attached to a site that
 * gates **entering** the site behind a dice roll. When a company chooses to
 * enter the bound site, its controller rolls 2d6 and subtracts the company's
 * effective size (CoE 3.24 half-character rule) when
 * {@link subtractCompanySize} is set. If the modified total beats
 * {@link threshold} (per {@link comparison}) the company enters as normal;
 * otherwise it must face {@link attack} **before** any of the site's
 * automatic-attacks.
 *
 * Engine wiring (`reducer-site.ts`): the gate is evaluated when the company
 * commits to entering (`enter-or-skip` → `enter-site`) and again after the
 * `reveal-on-guard-attacks` step, so a copy revealed from an on-guard slot
 * still fires before the automatic-attacks. Each host card fires at most once
 * per company site phase (tracked by `SitePhaseState.siteEntryGatesFaced`). The
 * roll runs as a generic `dice-check` pending resolution whose `onFail` is a
 * {@link SiteEntryAttackAction}; the resulting combat is sequenced through the
 * `site-entry-attack` site sub-step.
 *
 * The "Discard when the site card is discarded or returned to its location
 * deck" clause needs no effect: every `attachedToSite` card is swept by
 * `discardOrphanedSiteAttachedEvents` once no company occupies the bound site.
 */
export interface SiteEntryRollAttackEffect extends EffectBase {
  readonly type: 'site-entry-roll-attack';
  /** Subtract the entering company's effective size from the 2d6 roll. */
  readonly subtractCompanySize?: boolean;
  /** The number the modified roll must beat (Doubled Vigilance: 6). */
  readonly threshold: number;
  /** How the modified roll is compared to `threshold` (default `"gt"`). */
  readonly comparison?: 'gt' | 'gte';
  /** The attack faced when the roll fails, before any automatic-attacks. */
  readonly attack: SiteEntryAttackSpec;
}

/**
 * A besieging card bound to a site (`CardInPlay.attachedToSite`) that forces
 * every company at that site to face an extra attack **at the beginning of its
 * site phase** — before the company decides whether to enter the site or do
 * nothing. This is the distinguishing feature versus a site automatic-attack
 * (which a company avoids entirely by doing nothing at the site) and versus
 * {@link PermanentEventAutoAttackEffect} (which augments the printed
 * automatic-attack list of a whole class of sites).
 *
 * The attack is sequenced through the `siege-attacks` site sub-step (mirroring
 * `automatic-attacks`) with a `siege-attack` {@link import('./state-combat.js').AttackSource};
 * it is not an automatic-attack, so auto-attack modifiers and the home-site
 * tap-to-cancel option do not apply to it.
 *
 * Used by Siege (tw-87): "A company at this site must face an Orc attack of
 * three strikes at 7 prowess at the beginning of its site phase."
 */
export interface SitePhaseStartAttackEffect extends EffectBase {
  readonly type: 'site-phase-start-attack';
  /** The attack every company at the bound site faces. */
  readonly attack: {
    readonly creatureType: string;
    readonly strikes: number;
    readonly prowess: number;
    readonly body?: number;
  };
}

/**
 * A besieging card bound to a site (`CardInPlay.attachedToSite`) that makes a
 * company at that site roll at the **end of its organization phase** to keep
 * its movement. The roll is 2d6 modified by {@link penalty} for every character
 * in the company that lacks {@link penaltyPerCharacterWithoutSkill}; a total
 * below {@link threshold} locks the company stationary for the turn (its
 * planned destination is cancelled and a turn-scoped `company-cannot-move`
 * constraint is installed).
 *
 * Used by Siege (tw-87): "At the end of its organization phase, a company at a
 * site with Siege on it must make a roll and subtract one from the result for
 * every non-scout character it contains. If this result is less than 5, the
 * company may not move this turn."
 */
export interface CompanyMovementRollEffect extends EffectBase {
  readonly type: 'company-movement-roll';
  /** The company may move when the modified 2d6 total is ≥ this value. */
  readonly threshold: number;
  /** Skill a character must have to avoid contributing {@link penalty}. */
  readonly penaltyPerCharacterWithoutSkill: import('./common.js').Skill;
  /** Roll penalty per character lacking the skill (default 1). */
  readonly penalty?: number;
}

/**
 * Power Built by Waiting (as-34): a permanent hazard event that can be tapped
 * to raise the hazard limit, and untapped by spending hazard limit slots.
 * Both directions are expressed together because they are two sides of the
 * same card mechanic and always appear on the same card.
 */
export interface HazardLimitSwapEffect extends EffectBase {
  readonly type: 'hazard-limit-swap';
  /** Hazard limit slots added when this card is tapped. */
  readonly tapValue: number;
  /** Hazard limit slots consumed to untap this card. */
  readonly untapCost: number;
}

/**
 * A permanent hazard event that may be **discarded from play** during the
 * opponent's movement/hazard phase (not counting against the hazard limit) to
 * increase the hazard limit against one company by `value`.
 *
 * Unlike {@link HazardLimitSwapEffect}, the boost is paid once by removing the
 * card from play (cardsInPlay → discard pile) rather than by tapping; there is
 * no way to recover it. The added hazard limit is scoped to the target
 * company's current movement/hazard phase.
 *
 * Used by the 9 Dragon "At Home" permanent-events (METD §4), whose second
 * sentence reads "you may discard this card from play during opponent's
 * movement/hazard phase (not counting against the hazard limit) to increase
 * the hazard limit against one company by two."
 */
export interface DiscardForHazardLimitEffect extends EffectBase {
  readonly type: 'discard-for-hazard-limit';
  /** Hazard limit slots added to the target company when the card is discarded. */
  readonly value: number;
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

/**
 * Grants a character skill to the item's bearer while the item is in play.
 *
 * The bearer counts as having the named skill for all purposes — play-target
 * filters, sage+scout pair requirements, etc. — exactly as if their card
 * definition listed the skill. Used by Magic Ring of Stealth (tw-274) to grant
 * scout skill to any bearer.
 *
 * Note: the cancel-strike ability on Magic Ring of Stealth checks whether the
 * bearer is "already a scout" (natural skill on the character card), so that
 * ability's `when` condition intentionally reads natural skills and is not
 * affected by this effect.
 */
export interface GrantSkillEffect extends EffectBase {
  readonly type: 'grant-skill';
  /** The skill to grant (e.g. `"scout"`, `"warrior"`, `"sage"`). */
  readonly skill: string;
}

/**
 * **Replaces** the bearer's printed skills with {@link skills} while the card
 * carrying this effect is in play on them.
 *
 * The counterpart to {@link GrantSkillEffect}, which only *adds*. Used by the
 * Radagast Shapeshifter forms ("Radagast's skills become Warrior/Diplomat" —
 * Shifter of Hues wh-115), where taking a new shape strips the skills the
 * previous shape had rather than accumulating them. Skills granted by other
 * cards (`grant-skill`) still stack on top of the replacement set: the
 * override replaces what the *character card* prints, not what other cards
 * confer.
 *
 * Resolved through {@link getEffectiveSkills}; when several overrides are
 * collected (which no printed card currently does — the Shapeshifter forms
 * return each other to hand) the last one collected wins.
 */
export interface OverrideSkillsEffect extends EffectBase {
  readonly type: 'override-skills';
  /** The bearer's complete skill set while this card is on them. */
  readonly skills: readonly string[];
}

/**
 * Adjusts how many items of a given slot the bearing character may have
 * **in use** at once (rule 9.15). By default every slot (weapon, armor,
 * shield, helmet) allows exactly one in-use item; this effect changes the
 * capacity for the slot it names on the character that bears the item
 * carrying it.
 *
 * Carried by an item/enchantment borne on the character. Evaluated in
 * `item-slots.ts` when picking which borne items are "in use".
 *
 * Used by Swordmaster (tw-498): "If the sage is already a warrior, he can use
 * two weapons (both modifiers count). If he uses two weapons, he can't use a
 * shield." That is `{ slot: "weapon", delta: 1, requiresNaturalSkill:
 * "warrior", excludesSlotWhenExtraUsed: "shield" }`.
 */
export interface ItemSlotModifierEffect extends EffectBase {
  readonly type: 'item-slot-modifier';
  /** Item-slot keyword whose in-use capacity this modifies (e.g. `"weapon"`). */
  readonly slot: Keyword;
  /**
   * Capacity delta. `+1` lets a second item of {@link slot} be in use
   * simultaneously (both their effects/modifiers count).
   */
  readonly delta: number;
  /**
   * If set, the modifier applies only when the bearing character has this
   * skill **naturally** (listed on its card definition), independent of skills
   * granted by items. Mirrors the "already a <skill>" convention used by
   * Magic Ring of Stealth — Swordmaster's two-weapon privilege requires the
   * sage to already be a warrior, not merely warrior-by-this-card.
   */
  readonly requiresNaturalSkill?: string;
  /**
   * If set, whenever the extra capacity is actually consumed (i.e. more than
   * one item of {@link slot} ends up in use), the named slot's capacity drops
   * to 0 and its items are no longer in use. Models "if he uses two weapons he
   * can't use a shield". Note: the active player's right to instead forgo the
   * extra item to keep the excluded slot (rule 9.16 election) is not modeled;
   * the engine prefers consuming the extra capacity.
   */
  readonly excludesSlotWhenExtraUsed?: Keyword;
}

/**
 * Marks the bearing character's company as overt as long as this ally is in play.
 *
 * Certain allies (e.g. Regiment of Black Crows, Great Bats, Great Lord of
 * Goblin-gate, Last Child of Ungoliant) explicitly state "its controlling
 * character's company is overt". This effect is evaluated at any point where
 * covert/overt status is checked (combat, detainment, hazard eligibility).
 */
export interface CompanyOvertEffect extends EffectBase {
  readonly type: 'company-overt';
}

/**
 * Marks an ally as always assignable a strike during the defender's
 * strike-assignment phase, even while it is tapped or wounded — its status is
 * treated as untapped for the purpose of being a legal strike target only.
 *
 * Unlike {@link StrikeShieldEffect} with `alwaysCountsAsUntapped`, this does
 * NOT force strikes onto the ally before its controlling character (no allied
 * protection): the ally simply remains a voluntary strike target regardless of
 * its combat status.
 *
 * Used by Great Troll (ba-46): "Even if tapped or wounded, you may assign a
 * strike to this ally as though it were untapped."
 */
export interface AssignStrikeWhenTappedEffect extends EffectBase {
  readonly type: 'assign-strike-when-tapped';
}

/**
 * While the carrying card sits in a player's `cardsInPlay`, the defender of
 * any hazard-creature-sourced attack (`attack.source` of `"creature"`,
 * `"on-guard-creature"`, or `"played-auto-attack"` — the same set
 * `tap-on-strike-assignment` uses to mean "hazard creature attack", never a
 * site's own automatic-attack or a CvCC/agent attack) may assign that
 * attack's strikes to any character or ally in the defending company
 * regardless of tapped/wounded status, and the attack's own
 * `combat-attacker-chooses-defenders` rule (if any) is suppressed for that
 * attack — assignment always opens in the defender's own phase.
 *
 * Resolved by `resolveDefenderFreeStrikeAssignment` (`reducer-utils.ts`) at
 * every hazard-creature-sourced combat-initiation site, mirroring
 * `resolveAttackerChoosesDefenders`'s global-grant scan. Consumed by
 * `assignStrikeActions` (`legal-actions/combat.ts`), which drops the
 * untapped-only gate for characters and allies when
 * `CombatState.defenderFreeStrikeAssignment` is set.
 *
 * Used by Cloudless Day (td-104): "Whenever a company faces a hazard
 * creature attack, the defender may choose which characters in the company
 * will be the targets of the attack's strikes (regardless of tapped status,
 * wounded status, and the normal abilities of the attack)."
 */
export interface FreeStrikeAssignmentEffect extends EffectBase {
  readonly type: 'free-strike-assignment';
}

/**
 * Marker effect on an in-play permanent-event: while the carrying card is in its
 * controller's `cardsInPlay`, that player's own avatar may only be *brought into
 * play* at its home site — the extra-haven reveal option (a Wizard avatar's
 * Rivendell, a Ringwraith avatar's Minas Morgul / Dol Guldur; see
 * `avatarExtraHavenNames`) is suppressed. Consulted by the play-character legal
 * action (`legal-actions/organization-characters.ts`) when the character being
 * played is the acting player's avatar. Non-avatar character play is unaffected.
 *
 * Used by Saw Further and Deeper (dm-156): "Your Wizard may only be brought into
 * play at his home site." (Its companion clauses are a `general-influence`
 * `stat-modifier` +5, a `player-state` play-condition gated on
 * `player.avatarInPlay: false`, an `on-event: avatar-enters-play` self-discard,
 * and a `duplication-limit` scope `player`.)
 */
export interface AvatarHomeSiteRestrictionEffect extends EffectBase {
  readonly type: 'avatar-home-site-restriction';
}

/**
 * Tap an in-play ally during combat to grant an attack-scoped stat boost to
 * every character in the ally's own company that satisfies the optional
 * `filter`. The modifier lasts only for the current attack (it is applied as
 * one `character-stat-modifier` active constraint per matching character with
 * `scope: { kind: 'attack' }`, swept when the attack finalizes) — the same
 * machinery as {@link CompanyCombatBoostEffect}, but triggered by tapping an
 * in-play ally rather than playing a short event from hand.
 *
 * Unlike `company-combat-boost`, this applies to the ally's *own* company
 * whichever side of the combat it is on (the defending company in creature
 * combat, or either company in company-vs-company combat), so it covers
 * "against one attack **or** in company versus company combat".
 *
 * Example: Great Lord of Goblin-gate (as-75) — "Tap to give +2 prowess to all
 * Orcs in its company: against one attack or in company versus company combat."
 */
export interface CombatTapCompanyBoostEffect extends EffectBase {
  readonly type: 'combat-tap-company-boost';
  /** The stat to modify (`"prowess"` or `"body"`). */
  readonly stat: 'prowess' | 'body';
  /** The modifier value (positive to boost, negative to penalise). */
  readonly value: number;
  /**
   * Optional DSL condition evaluated against `{ target: { race, name, skills } }`
   * for each character in the ally's company. Only matching characters receive
   * the modifier. When absent, every character in the company receives it.
   */
  readonly filter?: Condition;
  /** Activation cost — always `{ tap: "self" }` (the ally taps itself). */
  readonly cost: ActionCost;
}

/**
 * Activated ability on an in-play ally that boosts its controlling character's
 * body for the body check resulting from the *current* strike, offered only
 * when the ally itself and its controlling character are both targets of
 * strikes from the same attack (CoE rule 2.V.2.2 companion mechanic).
 *
 * Unlike {@link BodyCheckModifierEffect} (a static, always-on item effect
 * added to the roll), this is a one-shot, tap-activated ally ability: the
 * player decides whether to tap the ally during the `body-check` combat
 * phase, before the roll is made, and the bonus is added directly to the
 * character's effective body for that single body check (via
 * `StrikeAssignment.strikeBodyPenalty`, the same field used by strike-event
 * body modifiers such as Risky Blow).
 *
 * Eligibility (checked structurally by the legal-action generator, not via
 * `when`): the ally must be untapped, its controlling character must be the
 * character currently facing a body check (`combat.strikeAssignments[combat.currentStrikeIndex]`),
 * and the ally's own instance ID must also appear among `combat.strikeAssignments`
 * for the same attack (i.e. the ally itself was also struck).
 *
 * Used by War-warg (le-156): "If the War-warg and its controlling character
 * are both targets of strikes from the same attack, you may tap War-warg to
 * give +2 body to its controlling character."
 */
export interface AllyBodyCheckBoostEffect extends EffectBase {
  readonly type: 'ally-body-check-boost';
  /** Amount added to the controlling character's effective body (positive protects). */
  readonly value: number;
  /** Activation cost — always `{ tap: "self" }` (the ally taps itself). */
  readonly cost: ActionCost;
}

/**
 * Marks this permanent event as a Ringwraith mode card (Black Rider, Fell Rider,
 * Heralded Lord). When in play bound to a company, the Ringwraith company is
 * permitted to move to non-Darkhaven sites. Without a mode card in play the
 * Ringwraith company is restricted to Darkhaven-to-Darkhaven movement only.
 *
 * The optional `mode` identifies which mode the card establishes. It is exposed
 * to the effective-stats resolver as `bearer.ringwraithMode`, so a Ringwraith
 * avatar can carry per-mode `stat-modifier` effects (e.g. Hoarmûrath le-53:
 * `+1 direct influence in Heralded Lord mode`, `+2 prowess in Fell Rider mode`).
 */
export interface RingwraithModeEffect extends EffectBase {
  readonly type: 'ringwraith-mode';
  /** Which mode this card establishes when bound to a company. */
  readonly mode?: 'black-rider' | 'fell-rider' | 'heralded-lord';
}

/**
 * Carried by a Ringwraith avatar: while this avatar is the player's revealed
 * Ringwraith, up to {@link count} other Ringwraith avatar cards may be played
 * as "Ringwraith followers" in his company, controlled with no influence
 * (CoE 2.II.2.1.R4–R5: follower play requires an enabling ability; this is
 * that ability).
 *
 * A follower may only enter play when the controlling Ringwraith's company is
 * at a Darkhaven or at the follower's home site, and joins that company under
 * the avatar's control (`controlledBy` = the avatar's instance). Because a
 * Ringwraith follower has `mind === null` it consumes none of the avatar's
 * direct influence. Followers come into play through the normal
 * one-character-per-turn organization-phase flow, which enforces the card's
 * "separate organization phases" clause.
 *
 * Used by *The Witch-king* (le-58): "As your Ringwraith, up to two Ringwraith
 * followers in his company may be controlled with no influence."
 */
export interface RingwraithFollowerSlotsEffect extends EffectBase {
  readonly type: 'ringwraith-follower-slots';
  /** Maximum number of Ringwraith followers this avatar may control. */
  readonly count: number;
}

/**
 * Marks a Ringwraith avatar card as a *self-granting* Ringwraith follower: it
 * may be played from hand as a follower of the player's already-revealed
 * Ringwraith (with no influence to control) **regardless** of whether that
 * revealed Ringwraith carries a {@link RingwraithFollowerSlotsEffect}. The
 * card grants its own follower slot, so it does not consume the host
 * Ringwraith's slot budget (`ringwraith-follower-slots.count`).
 *
 * Like a slot-enabled follower, it may only enter play when the revealed
 * Ringwraith's company is at a Darkhaven or at this card's home site, joins
 * that company under the avatar's control, consumes none of the avatar's
 * direct influence (`mind === null`), and comes into play through the normal
 * one-character-per-turn organization-phase flow.
 *
 * Used by *Ûvatha the Ringwraith* (le-57): "He may join another Ringwraith's
 * company during your organization phase and requires no influence to control."
 */
export interface RingwraithSelfFollowerEffect extends EffectBase {
  readonly type: 'ringwraith-self-follower';
}

/**
 * Passive avatar flag: while this avatar is a player's revealed Ringwraith,
 * any *magic card* (a card carrying a `spell` / `sorcery` / `spirit-magic` /
 * `shadow-magic` keyword) that the player casts is shuffled back into their
 * play deck when it would otherwise be discarded, rather than going to the
 * discard pile. The play deck is reshuffled after the card is returned.
 *
 * Used by *Akhôrahil the Ringwraith* (le-51): "As your Ringwraith, when a
 * magic card used by him has to be discarded, return it to the play deck and
 * reshuffle." The engine treats the redirect as a replacement applied at the
 * point a just-played magic event would land in the caster's discard pile
 * (see `discardOrRecyclePlayedEvent` in `reducer-utils.ts`).
 */
export interface MagicDiscardToDeckEffect extends EffectBase {
  readonly type: 'magic-discard-to-deck';
}

/**
 * When a strike against the bearer succeeds (would wound), the wound is
 * prevented. Instead, the attacker rolls 2d6; if the result strictly exceeds
 * {@link rollThreshold}, this item is discarded from the bearer.
 *
 * "If a strike against the bearer is successful, he is not wounded. Instead,
 * the attacker makes a roll — if this result is greater than 6, discard
 * [item]."
 *
 * Used by *Sable Shield* (le-341).
 */
export interface AbsorbWoundEffect extends EffectBase {
  readonly type: 'absorb-wound';
  /** Roll total must strictly exceed this value for the item to be discarded (default 6). */
  readonly rollThreshold: number;
}

/**
 * Grants a keyword tag to the item's bearer while the item is attached.
 *
 * The bearer counts as having the named keyword for all purposes — e.g. the
 * "leader" keyword makes the bearer subject to the one-leader-per-company
 * rule (CoE 3.26) and eligible for faction-influence bonuses gated on Leader
 * status — exactly as if their card definition listed the keyword.
 *
 * Used by *By the Ringwraith's Word* (le-174) to grant the "leader" keyword
 * to any non-Ringwraith minion character while the event is attached.
 */
export interface GrantKeywordEffect extends EffectBase {
  readonly type: 'grant-keyword';
  /** The keyword to grant (e.g. `"leader"`). */
  readonly keyword: string;
}

/**
 * Suppresses the bearer's printed discard-number check (`discardBodyCheck`) during
 * a regular combat body check. When the body check roll matches a value in the
 * character's `discardBodyCheck` array (e.g. roll = 8 for characters with
 * `discardBodyCheck: [8]`), the discard is prevented and the bearer remains in
 * play wounded instead. Does NOT protect against elimination (roll > body).
 *
 * Used by *By the Ringwraith's Word* (le-174): "cannot be discarded by a body
 * check."
 */
export interface ProtectFromBodyCheckEffect extends EffectBase {
  readonly type: 'protect-from-body-check';
}

/**
 * Declares that the company this permanent event is bound to may contain one
 * Troll-race Leader-keyword character in addition to the one leader already
 * permitted by CoE rule 3.26 (one-leader-per-company). Without this effect a
 * company may have at most one character with the Leader keyword; with this
 * effect it may have exactly two leaders provided one of them is a Troll.
 *
 * The engine reads this effect when checking whether adding a character to a
 * company would violate the leader restriction (see
 * `organization-companies.ts` `wouldViolateLeaderRestriction`).
 *
 * Used by *Orders from Lugbúrz* (as-94).
 */
export interface ExtraTrollLeaderSlotEffect extends EffectBase {
  readonly type: 'extra-troll-leader-slot';
}

/**
 * Declares that the company this permanent event is bound to may contain one
 * additional Leader-keyword character beyond the single leader already
 * permitted by CoE rule 2.II.3.1.3 (one-leader-per-company), with no race
 * restriction on either leader. Additionally, one Leader-keyword character in
 * the company is exempted from the company-size maximum of CoE rule 2.II.3.1
 * (max size 7 outside a haven) — i.e. it does not count toward that headcount.
 *
 * Each copy of the carrying card in play on a company grants one such slot;
 * two copies permit two additional leaders and exempt two leaders from the
 * size count.
 *
 * The engine reads this effect in `organization-companies.ts`
 * `wouldViolateLeaderRestriction` (leader-count exemption) and in
 * `moveToCompanyActions`/`mergeCompaniesActions` (size-cap exemption, via
 * `companyEffectiveSizeExemptingLeaders`).
 *
 * Used by *Orders from the Great Demon* (ba-70).
 */
export interface ExtraLeaderSlotEffect extends EffectBase {
  readonly type: 'extra-leader-slot';
}

/**
 * Marks a permanent-event resource card as eligible for placement on a
 * starting company during the item-draft setup phase, consuming one item
 * slot (counts against MAX_STARTING_ITEMS).
 *
 * Allows the card to be placed directly from the play deck onto a company
 * instead of assigning a minor item.
 *
 * Used by *Orders from Lugbúrz* (as-94).
 */
export interface StartingCompanyPlacementEffect extends EffectBase {
  readonly type: 'starting-company-placement';
}

/**
 * Marks a hazard permanent-event as a "Summons from Long Sleep" reservation
 * slot (as-39). While this card is in play the hazard player may:
 *  1. Move one Dragon or Drake hazard creature from hand into this slot
 *     (free action, does not count against the hazard limit).
 *  2. Play the reserved creature from this slot as though it were in hand
 *     (counts against the hazard limit; creature attacks with +2 prowess).
 * The permanent-event is discarded after the reserved creature resolves combat.
 */
export interface SummonsFromLongSleepEffect extends EffectBase {
  readonly type: 'summons-from-long-sleep';
}

/**
 * MEAS §1 ("Placement of cards off to the side"). Carried by a host
 * permanent-event whose resolution places one or more target cards "off to the
 * side" with it (e.g. *Sack Over the Head*, *Summons from Long Sleep*,
 * *Sacrifice of Form*). Set-aside cards:
 *
 * - are kept with the host (recorded in the host {@link CardInPlay}'s
 *   `setAside` list, each child stamped with `setAsideHost`);
 * - count as "in play" for uniqueness;
 * - cannot be targeted except by cards whose `play-target` declares
 *   `targetsSetAside`;
 * - are discarded to their **owner** when the host leaves play, unless
 *   {@link keepOnHostRemoval} is set (the host states otherwise);
 * - award their marshalling points to their **owner**, not the host's player.
 *
 * The target(s) are selected by the host's accompanying `play-target` effect;
 * this effect only declares the off-to-the-side disposition. Per-card wiring of
 * which cards a given host sets aside is card-certification work.
 */
/**
 * Press-gang (ba-22). Marks a hazard permanent-event as a "press-gang" capture
 * host: while it is in play, whenever a character owned by the card controller's
 * **opponent** would be *discarded* from play (not eliminated), it is instead
 * held "off to the side" with this card — stripped of all possessions, kept in
 * its owner's `characters` map, and worth **negative** character marshalling
 * points to its owner (like a prisoner, CoE 8.35). The card holds at most one
 * character; a new capture returns the prior one to its owner's hand, and when
 * this card leaves play the held character returns to its owner's hand.
 *
 * See {@link module:engine/press-gang} for the interception + scoring wiring.
 */
export interface PressGangCaptureEffect extends EffectBase {
  readonly type: 'press-gang-capture';
}

/**
 * Pallando the Soul-keeper (as-17). Marks an in-play card as a *replacement*
 * for character discards: while it is in play, the next character matching
 * {@link filter} that would be **discarded from play** is instead **eliminated**
 * — its card goes to its owner's out-of-play pile rather than the discard pile,
 * so it can never be recycled. Possessions and followers are dispersed exactly
 * as for a normal discard.
 *
 * The filter is a plain card-definition condition (`matchesDefinition`), so the
 * "which characters" clause stays data-driven: as-17's "non-Ringwraith minion"
 * is `{ "cardType": "minion-character", "race": { "$ne": "ringwraith" } }`.
 *
 * With {@link discardSelf} the host is discarded the moment the replacement
 * fires ("Discard when a minion is so eliminated"), which is also what makes
 * the effect one-shot — "the *next* … minion".
 *
 * Interacts with `press-gang-capture`, which intercepts the same discards: a
 * Press-gang capture wins (the character is never discarded at all, so there is
 * nothing left for this effect to replace).
 *
 * See {@link module:engine/eliminate-instead-of-discard} for the wiring.
 */
export interface EliminateInsteadOfDiscardEffect extends EffectBase {
  /** Discriminator. */
  readonly type: 'eliminate-instead-of-discard';
  /**
   * Card-definition condition the discarded character must match. When absent,
   * every character discard is replaced.
   */
  readonly filter?: Condition;
  /**
   * When true, the host card is discarded as soon as the replacement fires,
   * making it a one-shot ("the next … is instead eliminated. Discard when a
   * minion is so eliminated.").
   */
  readonly discardSelf?: boolean;
}

export interface SetAsideEffect extends EffectBase {
  readonly type: 'set-aside';
  /**
   * When true, the host card states the set-aside cards are *not* discarded
   * when the host leaves play (they remain in play under their owner).
   * Defaults to false — set-aside cards are discarded with the host.
   */
  readonly keepOnHostRemoval?: boolean;
}

/**
 * Hazard short-event effect: play a hazard creature from the hazard player's
 * own discard pile as an immediate attack against the active company, without
 * counting against the hazard limit. Models Exhalation of Decay (dm-55):
 * "Playable on an Undead hazard creature in your discard pile. If target
 * Undead can attack, bring it into play as a creature that attacks immediately
 * (not counting against the hazard limit). The attack's prowess is modified
 * by -1."
 *
 * The candidate creature is chosen from the discard pile (one legal action per
 * keyable creature matching {@link filter}); it must satisfy normal creature
 * keying against the target company ("if target Undead can attack"). The event
 * card itself is a short event and is discarded on play. After the spawned
 * attack resolves it is disposed by the normal combat-finalization rules
 * (defender's kill pile if defeated, otherwise back to the discard pile).
 */
export interface PlayCreatureFromDiscardEffect extends EffectBase {
  readonly type: 'play-creature-from-discard';
  /**
   * Condition matched against each candidate creature's card definition to
   * decide which discard-pile creatures may be played (e.g.
   * `{ "race": "undead" }`). Reuses the shared condition-matcher rather than a
   * card-specific keyword.
   */
  readonly filter: Condition;
  /**
   * Signed modifier applied to the spawned attack's prowess (e.g. -1 for
   * Exhalation of Decay). Added directly to the creature's combat prowess.
   */
  readonly prowessModifier: number;
}

/**
 * Effect carried by an in-play hazard permanent-event (Monstrosity of Diverse
 * Shape, ba-21) that grants its controller a once-per-turn "replay" of a
 * creature from their own discard pile against a moving company.
 *
 * During the play-hazards window of a company's movement/hazard phase, the
 * hazard player may bring one hazard-creature matching `filter` out of their
 * discard pile as an immediate attack, provided that same creature has already
 * attacked that company earlier this movement/hazard phase (its name appears in
 * `MovementHazardPhaseState.hazardsEncountered`). Unlike
 * {@link PlayCreatureFromDiscardEffect}, this play:
 *  - is granted by an in-play permanent-event (not a card in hand),
 *  - counts one against the hazard limit, and
 *  - may be used only once per company's movement/hazard phase
 *    (tracked via `MovementHazardPhaseState.spawnReplayUsedSources`).
 *
 * The creature's race is matched by the card's authoritative `race` string
 * (e.g. "wolf", "animal"); the source permanent-event's own name in the
 * printed text ("This card must have already attacked the company this turn")
 * is realised as the "already attacked this turn" gate — the Balrog set's
 * intent, confirmed by the French text ("Cette créature doit déjà avoir
 * attaquée cette compagnie ce tour-ci").
 */
export interface GrantReplayAttackedCreatureEffect extends EffectBase {
  readonly type: 'grant-replay-attacked-creature';
  /**
   * Condition matched against each candidate creature's card definition to
   * decide which discard-pile creatures may be replayed (e.g.
   * `{ "race": { "$in": ["wolf", "animal"] } }`). Reuses the shared
   * condition-matcher rather than a card-specific keyword.
   */
  readonly filter: Condition;
}

/**
 * Hazard short-event effect for Stay Her Appetite (le-140).
 *
 * When this short event resolves against a company containing the targeted
 * ally, the engine enqueues a `stay-her-appetite-roll` pending resolution:
 *  1. Roll 2d6 (the condition roll).
 *  2. If roll + ally.mind > opponent.unusedGI + bearerChar.unusedDI + 5:
 *     roll again for prowess (ally.prowess + 2d6), then initiate a
 *     detainment attack (1 strike, computed prowess) against the ally's
 *     controlling character.
 *  3. If the attack is NOT defeated, the ally is discarded.
 */
export interface StayHerAppetiteEffect extends EffectBase {
  readonly type: 'stay-her-appetite';
}

/**
 * Hazard short-event effect for Pilfer Anything Unwatched (as-33).
 *
 * "Playable on an untapped agent. Tap the agent. Make a roll for a character
 * in play of your choice with a home site the same as the agent's current
 * site. To the roll add 5 if the agent's current site is also the agent's home
 * site. If the result is greater than the character's mind plus 5, the
 * character is returned to his player's hand (one item may be transferred to
 * another character in the same company). Cannot be played if your opponent is
 * a minion player."
 *
 * The card player (hazard player) selects one of their own untapped agents plus
 * one opponent character in play whose home site matches the agent's current
 * site. Playing the card taps the agent and enqueues a generic `dice-check`
 * pending resolution: the hazard player rolls 2d6 (+`atHomeSiteBonus` when the
 * agent is at one of its own home sites) and, if the total is strictly greater
 * than the target's mind + `mindBonus`, the character is returned to its
 * owner's hand with the option to save one of its items onto a company-mate.
 */
export interface AgentTapReturnCharacterEffect extends EffectBase {
  readonly type: 'agent-tap-return-character';
  /** Bonus added to the roll when the agent's current site is its home site. */
  readonly atHomeSiteBonus: number;
  /** Amount added to the target's mind to form the roll threshold. */
  readonly mindBonus: number;
}

/**
 * Hazard short-event effect for Twisted Tales (dm-96).
 *
 * "Playable on an untapped diplomat agent. Tap the agent who may then make an
 * influence attempt against a faction playable at the agent's site. +6 to
 * influence attempt. Attempt is automatically successful if target faction is
 * playable at the agent's home site. Cannot be played if your opponent is a
 * minion player."
 *
 * The card *grants* a rule-10.14 agent influence attempt against an opponent's
 * in-play faction — the agent needs no `agent-tap-influence` effect of its own
 * ("if an effect allows an agent hazard to make an influence attempt"). Playing
 * the card taps and reveals the agent and enqueues the standard
 * `opponent-influence-defend` resolution, carrying the rule-10.14 bonuses (+2
 * direct influence at a home site; faction playable at a home site → value 0
 * and +2 to the roll) plus this card's own {@link attemptBonus}.
 */
export interface AgentTapFactionInfluenceEffect extends EffectBase {
  readonly type: 'agent-tap-faction-influence';
  /**
   * Condition the acting agent's card definition must satisfy, evaluated
   * against `{ target: { name, race, skills, keywords } }` — e.g.
   * `{ "target.skills": { "$includes": "diplomat" } }` for "diplomat agent".
   * Omit to allow any untapped agent.
   */
  readonly agentFilter?: Condition;
  /** Modifier added to the attacker's side of the influence attempt (+6). */
  readonly attemptBonus: number;
  /**
   * When true, the attempt succeeds automatically (no defence roll) if the
   * target faction is playable at one of the agent's home sites.
   */
  readonly autoSuccessAtHomeSite?: boolean;
}

/**
 * Hazard short-event mode A for Good Sense Revolts (dm-61).
 *
 * "Playable on an untapped agent. Tap the agent who may then make an
 * influence attempt against an ally, faction, or character. +4 to influence
 * attempt. +8 if ally, faction, or character is playable at agent's home
 * site."
 *
 * The multi-target counterpart of {@link AgentTapFactionInfluenceEffect}: the
 * card *grants* any of the hazard player's own untapped agents a rule-10.14
 * influence attempt against an opponent's ally, faction, or character — the
 * same target kinds the native {@link AgentTapInfluenceEffect} ability covers
 * — without requiring the agent to carry that ability itself. Instead of an
 * auto-success tier (dm-96), this card's own bonus is tiered: {@link
 * attemptBonus} normally, {@link attemptBonusAtHomeSite} when the target
 * shares (character/ally) or is playable at (faction) one of the agent's home
 * sites — the same condition rule 10.14 already zeroes the target's value
 * for.
 */
export interface AgentTapMultiInfluenceEffect extends EffectBase {
  readonly type: 'agent-tap-multi-influence';
  /** Which kinds of opponent target the granted attempt may be made against. */
  readonly targetKinds: readonly ('character' | 'ally' | 'faction')[];
  /** Modifier added to the attacker's side of the influence attempt (+4). */
  readonly attemptBonus: number;
  /**
   * Replaces {@link attemptBonus} when the target is playable at (or shares)
   * one of the agent's home sites (+8).
   */
  readonly attemptBonusAtHomeSite?: number;
}

/**
 * Hazard short-event mode B for Good Sense Revolts (dm-61): "Alternatively,
 * modify an influence attempt by an agent by +4. This card cannot serve both
 * functions."
 *
 * Banks a one-shot `check-modifier` {@link ActiveConstraint} (`check:
 * "influence"`, gated by `when: { reason: "opponent-influence-check" }`) on
 * one of the hazard player's own agents (any tap status) — the same
 * constraint kind Mine or No One's (ba-68) uses — consumed by that agent's
 * next qualifying rule-10.14 attempt, whether via a native {@link
 * AgentTapInfluenceEffect} ability or a granted attempt such as this same
 * card's own mode A. Does not tap or reveal the target agent by itself.
 */
export interface AgentInfluenceBoostEffect extends EffectBase {
  readonly type: 'agent-influence-boost';
  /** Modifier banked onto the target agent's next qualifying attempt (+4). */
  readonly attemptBonus: number;
}

/**
 * Hazard short-event effect for Your Welcome Is Doubtful (dm-104).
 *
 * "Playable on an untapped agent. Tap the agent who may then make an
 * influence attempt against an ally or character. +6 to influence attempt
 * (+10 if the agent is a diplomat). An additional +7 to the attempt if
 * target character has the same home site as the agent or if target ally is
 * playable at the agent's home site. Cannot be played if your opponent is a
 * minion player."
 *
 * Sibling of {@link AgentTapFactionInfluenceEffect}: grants a rule-10.14
 * agent influence attempt against an opponent's in-play **character or
 * ally** rather than a faction — the acting agent needs no
 * `agent-tap-influence` effect of its own. Rule-10.14 bonuses stack
 * underneath as usual (+2 direct influence at a home site; target mind
 * treated as 0 with +2 to the roll when a character shares a home site with
 * the agent, or an ally is playable at one of the agent's home sites), on
 * top of which this card layers {@link attemptBonus} (or
 * {@link diplomatAttemptBonus}) plus {@link homeSiteBonus} under that same
 * shared-home-site condition.
 */
export interface AgentTapOpponentInfluenceEffect extends EffectBase {
  readonly type: 'agent-tap-opponent-influence';
  /** Which kinds of targets this grant covers. */
  readonly targetKinds: readonly ('character' | 'ally')[];
  /**
   * Condition the acting agent's card definition must satisfy, evaluated
   * against `{ target: { name, race, skills, keywords } }`. Omit to allow
   * any untapped agent.
   */
  readonly agentFilter?: Condition;
  /** Modifier added to the attacker's side of the influence attempt (+6). */
  readonly attemptBonus: number;
  /**
   * Overrides `attemptBonus` when the acting agent has the diplomat skill
   * (+10 instead of +6).
   */
  readonly diplomatAttemptBonus?: number;
  /**
   * Additional flat bonus applied when the target character shares a home
   * site with the agent, or the target ally is playable at one of the
   * agent's home sites (+7).
   */
  readonly homeSiteBonus?: number;
}

/**
 * Modifies a *named* influencer's opponent-influence attempts (CoE rule 10.10:
 * influencing away an opponent's in-play character/ally/faction during your
 * site phase). Carried by an in-play stage permanent-event; while the card is
 * in play, every opponent-influence attempt made by the influencer whose name
 * matches {@link influencer} (the active player's avatar) is modified:
 *
 * - `fromAnySite` — the influencer "need not be at the appropriate site": the
 *   normal same-site requirement is lifted, so he may target the opponent's
 *   cards in any of their companies (and any of their in-play factions),
 *   regardless of where his own (active) company stands.
 * - `generalInfluenceSubstitution` — the influence check adds a value derived
 *   from the influencer's *player's unused general influence* (half, rounded up
 *   per `roundUp`, capped at `max`) **instead of** the influencer's unused
 *   direct influence.
 * - `regionDistancePenalty` — subtract the number of regions between the
 *   influencer's site and the site where the attempt would normally be made
 *   (CRF 22: the count is inclusive of both endpoint regions, i.e. same region
 *   = 1, adjacent = 2, …).
 *
 * Used by Prophet of Doom (wh-106).
 */
export interface OpponentInfluenceOverrideEffect extends EffectBase {
  readonly type: 'opponent-influence-override';
  /** The influencer name this override applies to (e.g. "Pallando"). */
  readonly influencer: string;
  /** Lift the same-site requirement — target opponents at any site. */
  readonly fromAnySite?: boolean;
  /**
   * Substitute the influencer's unused DI with a value derived from the
   * player's unused general influence.
   */
  readonly generalInfluenceSubstitution?: {
    /** Divisor applied to the unused general influence (e.g. 2 = half). */
    readonly divisor: number;
    /** Round the quotient up when true (rounded down otherwise). */
    readonly roundUp?: boolean;
    /** Maximum value the substitution may contribute. */
    readonly max: number;
  };
  /** Subtract the inclusive region distance to the target's site. */
  readonly regionDistancePenalty?: boolean;
}

/**
 * Discards the carrying in-play card the moment a player-state condition holds.
 * Evaluated as post-action housekeeping against the card controller's
 * player-state context (the same context used by `play-condition`
 * `requires: "player-state"`: `player.avatar`, `player.stagePoints`,
 * `player.factionCount`, `charactersInPlayAnywhere`, …). Distinct from the
 * play-condition, which gates *entry*; this gates *staying in play*.
 *
 * Used by Prophet of Doom (wh-106): "Discard if you have fewer than 5 factions
 * in play."
 *
 * Used by Gandalf the White Rider (as-11): "Discard this card if Gandalf comes
 * into play." — `{ "charactersInPlayAnywhere": "Gandalf" }`. A `discard-self-when`
 * on a manifestation sister also satisfies g.man.1's "unless the current
 * manifestation would leave play" clause, so the named character stays playable
 * (see `blockingManifestationForCharacterPlay` in `manifestations.ts`).
 */
export interface DiscardSelfWhenEffect extends EffectBase {
  readonly type: 'discard-self-when';
  /** Condition (against the player-state context) that forces the discard. */
  readonly condition: Condition;
}

/**
 * The return-to-hand sibling of {@link DiscardSelfWhenEffect}: the carrying
 * card leaves play for its controller's **hand** the moment a player-state
 * condition holds, rather than for the discard pile. Same context, same
 * post-action sweep, and — unlike `discard-self-when` — it also reaches a card
 * held as an **ally attached to a character**, since that is where the
 * manifestation cards using it live.
 *
 * Used by Last Child of Ungoliant (le-153): "Return her to your hand if Shelob
 * is played." — `{ "inPlayAnywhere": "Shelob" }`. Last Child is a
 * manifestation of Shelob (`manifestId: tw-86`), so g.man.1 would otherwise
 * have the two competing for one slot; the rule resolves it in the ally's
 * favour by giving her back rather than discarding her.
 */
export interface ReturnSelfToHandWhenEffect extends EffectBase {
  readonly type: 'return-self-to-hand-when';
  /** Condition (against the player-state context) that forces the return. */
  readonly condition: Condition;
}

/**
 * Lifts the company-size maximum of CoE rule 2.II.3.1 (seven effective
 * characters outside a haven) for the company this permanent-event is bound to
 * (`CardInPlay.companyId`, i.e. a `play-target` `target: "company"` card).
 *
 * Unlike `extra-leader-slot` (ba-70), which merely exempts one Leader from the
 * headcount, this removes the cap outright: the bound company may grow without
 * limit through `move-to-company` and `merge-companies`.
 *
 * Used by *An Unexpected Party* (dm-114): "There is no limit to the size of
 * this company."
 */
export interface CompanySizeUnlimitedEffect extends EffectBase {
  readonly type: 'company-size-unlimited';
}

/**
 * Characters in the company this permanent-event is bound to that match
 * {@link filter} cost **no influence** to control: their mind is not subtracted
 * from the controller's general influence pool, and they may be brought into
 * play into that company for free.
 *
 * The filter is evaluated against a per-character context
 * (`{ character: { name, race, mind, unique, isAvatar, keywords } }`, see
 * `buildCompanyCharacterContext` in `engine/company-composition.ts`), so the
 * exemption class is expressed entirely in card data rather than as an engine
 * branch.
 *
 * Used by *An Unexpected Party* (dm-114): "Dwarves with a mind of 2 or less in
 * this company do not require influence to be controlled."
 */
export interface CompanyInfluenceExemptEffect extends EffectBase {
  readonly type: 'company-influence-exempt';
  /** Condition on the per-character context selecting the exempt characters. */
  readonly filter: Condition;
}

/**
 * Characters matching {@link filter} may be brought into play into the company
 * this permanent-event is bound to without regard for the
 * one-character-per-turn limit of CoE rule 2.II.2.1 — and without consuming
 * that turn's single slot, so a normal character may still be played.
 *
 * Uses the same per-character filter context as
 * {@link CompanyInfluenceExemptEffect}.
 *
 * Used by *An Unexpected Party* (dm-114): "there is no limit to how many
 * Dwarves may be brought into play on a given turn with the company" (CRF 22:
 * "It allows the player to play one non-Dwarf character and any number of
 * Dwarves all in the same organization phase").
 */
export interface CompanyCharacterPlayExemptEffect extends EffectBase {
  readonly type: 'company-character-play-exempt';
  /** Condition on the per-character context selecting the exempt characters. */
  readonly filter: Condition;
}

/**
 * One named headcount over the characters of a company: how many of them match
 * {@link filter}. Declared on {@link DiscardSelfWhenCompanyEffect} and exposed
 * to that effect's condition as `count.<as>`.
 */
export interface CompanyCharacterCount {
  /** Name the count is published under (`count.<as>` in the condition). */
  readonly as: string;
  /** Condition on the per-character context selecting the counted characters. */
  readonly filter: Condition;
}

/**
 * The company-scoped sibling of {@link DiscardSelfWhenEffect}: discards the
 * carrying permanent-event the moment a condition over the **bound company's
 * composition** holds. Evaluated as post-action housekeeping, so every path
 * that changes a company (character play, split/merge, elimination, influencing
 * a character away) is covered by one chokepoint.
 *
 * The condition sees `company.characterCount` / `company.atHaven` /
 * `company.siteType` plus one `count.<as>` entry per {@link counts} declaration,
 * which is how "more than two non-Dwarf characters" style clauses stay in card
 * data instead of becoming engine branches.
 *
 * Used by *An Unexpected Party* (dm-114): "Discard this card if the company has
 * more than one non-Wizard character with a mind greater than 5 or more than
 * two non-Dwarf characters or no Dwarf with a mind greater than 5."
 */
export interface DiscardSelfWhenCompanyEffect extends EffectBase {
  readonly type: 'discard-self-when-company';
  /** Named filtered headcounts published to the condition as `count.<as>`. */
  readonly counts?: readonly CompanyCharacterCount[];
  /** Condition (against the company-composition context) that forces the discard. */
  readonly condition: Condition;
}
