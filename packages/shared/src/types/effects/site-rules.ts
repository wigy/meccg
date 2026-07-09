/**
 * @module effects/site-rules
 *
 * Site-rule effects (the `site-rule` effect family): declarative rules a site
 * card applies to standard game mechanics while a company is at that site
 * (healing, item/character denial, attack cancellation, hazard limits, etc.).
 * Split out of `types/effects.ts` for cohesion and re-exported from there, so
 * the public `types/effects.js` import path is unchanged.
 */

import type { CardDefinitionId, RegionType, SiteType } from '../common.js';
import type { EffectBase, Condition } from '../effects.js';

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
  | SitePhaseRingAutoTestSiteRule
  | SageTapRingTestSiteRule
  | AttacksNotDetainmentSiteRule
  | KeyedCreaturesDetainmentSiteRule
  | AttacksAreDetainmentSiteRule
  | NeverTapsSiteRule
  | HealDuringUntapSiteRule
  | DynamicAutoAttackSiteRule
  | AlwaysReturnToDeckSiteRule
  | HazardLimitSiteRule
  | AllowCreatureByRaceSiteRule
  | AllowCreatureByKeyingSiteRule
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
 * Auto-tests every gold-ring item **borne** by characters in any company at
 * this site at the start of the site phase, before the enter-or-skip decision.
 * The test fires regardless of whether the company enters the site.
 *
 * Unlike `auto-test-gold-ring` (which fires when a gold ring is stored or
 * played at a Darkhaven), this rule scans items already held by characters.
 *
 * Example — Barad-dûr (le-352): "Any gold ring item at this site is
 * automatically tested during the site phase (the site need not be entered).
 * All ring tests at this site are modified by -3."
 */
export interface SitePhaseRingAutoTestSiteRule extends EffectBase {
  readonly type: 'site-rule';
  readonly rule: 'site-phase-ring-auto-test';
  /** Roll modifier applied to every auto-test (e.g. -3 for Barad-dûr). */
  readonly rollModifier: number;
}

/**
 * Grants an active, optional ring-test ability at this site: any untapped
 * sage in a company located at the site may tap to test a gold-ring item
 * borne by a character in that company, applying the given roll modifier to
 * the 2d6 ring-test result. Unlike `auto-test-gold-ring` (fires on store)
 * and `site-phase-ring-auto-test` (fires automatically at company selection),
 * this rule is player-initiated during the organization phase — the sage
 * chooses if and which ring to test.
 *
 * Example — Mount Doom (le-393): "Any sage may tap to test a ring at this
 * site, modifying the result by -3."
 */
export interface SageTapRingTestSiteRule extends EffectBase {
  readonly type: 'site-rule';
  readonly rule: 'sage-tap-ring-test';
  /** Roll modifier applied to the 2d6 ring-test (e.g. -3 for Mount Doom). */
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
 * `enemy.race` (the attacking creature's race) and `attack.automatic`
 * (true for the site's own listed automatic-attack, static or the
 * dynamically-played `site-rule: dynamic-auto-attack` 2nd attack; false
 * for a hazard creature played normally against the company). A missing
 * filter makes every attack at this site attack normally.
 *
 * Example — Moria (le-392): "Non-Nazgûl creatures played at this site
 * attack normally, not as detainment."
 *
 * Example — The Under-leas (ba-102): "Creatures keyed to this site
 * attack normally, not as detainment" while its own 1st automatic-attack
 * is separately declared detainment via `combat-detainment` — the filter
 * `{ "attack.automatic": false }` excludes the site's own automatic-attack
 * from the override so the two rules coexist.
 */
export interface AttacksNotDetainmentSiteRule extends EffectBase {
  readonly type: 'site-rule';
  readonly rule: 'attacks-not-detainment';
  /** Optional condition on the attacking creature (e.g. race ≠ nazgul). */
  readonly filter?: Condition;
}

/**
 * Forces attacks at this site to be resolved as detainment whenever the
 * attacking hazard creature is keyed to the site *by name* (a `keyedTo`
 * entry whose `siteNames` includes this site's own name — e.g. Watcher in
 * the Water's "May also be played at Moria" alternate keying).
 *
 * Unlike the default CoE §3.II.2 R1-R3/B1-B3 rules (which only ever
 * produce detainment for Ringwraith/Balrog defenders), this rule applies
 * regardless of the defending player's alignment — the detainment status
 * is a property of the site, not the defender.
 *
 * Example — Moria (ba-93): "Creatures keyed to this site are/attack as
 * detainment."
 */
export interface KeyedCreaturesDetainmentSiteRule extends EffectBase {
  readonly type: 'site-rule';
  readonly rule: 'keyed-creatures-detainment';
}

/**
 * Mirror of {@link AttacksNotDetainmentSiteRule}: forces every attack against
 * a company at this site to be treated as detainment, overriding the default
 * detainment computation (CoE §3.II.2 R1/R2/R3 and B1/B2/B3 and any
 * keying-based detainment) even when the attacker's race/keying or the
 * defending alignment would not normally make it so.
 *
 * Example — The Under-gates (ba-100), a Balrog Darkhaven printed as a Haven:
 * "Creatures keyed to this site attack as detainment."
 *
 * ```json
 * { "type": "site-rule", "rule": "attacks-are-detainment" }
 * ```
 */
export interface AttacksAreDetainmentSiteRule extends EffectBase {
  readonly type: 'site-rule';
  readonly rule: 'attacks-are-detainment';
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
 * Declares that any hazard creature whose own `keyedTo` includes one of the
 * listed region-types or site-types may be played at this site regardless of
 * the site's actual region/site type. This is the "Creatures keyed to X may be
 * keyed to this site" clause: the creature keys as if the site matched its
 * `keyedTo`, bypassing the normal path/site keying check.
 *
 * Distinct from {@link AllowCreatureByRaceSiteRule} (which keys on the
 * creature's race): this rule keys on the creature's own keying requirement.
 * The `keying` filter mirrors {@link DynamicAutoAttackSiteRule.keying}. Feeds
 * only the normal hazard-creature play path (not the site's dynamic
 * auto-attack, whose own `keying` filter already governs eligibility).
 *
 * Example — The Drowning-deeps (ba-89): "Creatures keyed to Coastal Sea ...
 * may be keyed to this site."
 *
 * ```json
 * { "type": "site-rule", "rule": "allow-creature-by-keying",
 *   "keying": { "regionTypes": ["coastal"] } }
 * ```
 */
export interface AllowCreatureByKeyingSiteRule extends EffectBase {
  readonly type: 'site-rule';
  readonly rule: 'allow-creature-by-keying';
  /** Site-types and region-types whose presence in a creature's `keyedTo` grants the bypass. */
  readonly keying: {
    readonly siteTypes?: readonly SiteType[];
    readonly regionTypes?: readonly RegionType[];
  };
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
