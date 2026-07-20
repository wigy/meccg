/**
 * @module effects/site-rules
 *
 * Site-rule effects (the `site-rule` effect family): declarative rules a site
 * card applies to standard game mechanics while a company is at that site
 * (healing, item/character denial, attack cancellation, hazard limits, etc.).
 * Split out of `types/effects.ts` for cohesion and re-exported from there, so
 * the public `types/effects.js` import path is unchanged.
 */

import type { Alignment, CardDefinitionId, RegionType, SiteType } from '../common.js';
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
  | CancelAttacksIfCharacterInPlaySiteRule
  | StolenKnowledgeSiteRule
  | DeepMinesMovementSiteRule
  | NoStorageSiteRule
  | HazardSiteTypeOverrideSiteRule
  | AllowAgentPlaySiteRule
  | ProtectedWizardhavenSiteRule
  | DynamicUnderDeepsAdjacencySiteRule
  | EndOfTurnWinSiteRule;

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
  /**
   * Player alignments for which the automatic test is skipped entirely at
   * this site. MEBA: "Rings are not automatically tested for a Balrog player
   * at Barad-dûr" (Barad-dûr is not one of the Balrog's Darkhavens) — encoded
   * on Barad-dûr (le-352) as `"skipForAlignments": ["balrog"]`. The company's
   * default rule-9.23 modifier still applies to ring tests triggered by other
   * means.
   */
  readonly skipForAlignments?: readonly Alignment[];
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
 * Declares that agent characters may be brought into play at this site under a
 * character's **direct influence** (as a follower joining a company already at
 * the site), overriding rule 2.II.2.2.5 — which otherwise confines an agent
 * played as a character to its own home site.
 *
 * The permission applies only to Ringwraith/Fallen-wizard players (the only
 * players who may play agents as characters at all) and only via direct
 * influence: general-influence play at this site is NOT granted, matching the
 * printed wording "under direct influence at this site". A company must be
 * physically at the site with an untapped controller holding enough direct
 * influence for the agent's mind.
 *
 * Example — Bree (le-356): "Agent minions may be brought into play under direct
 * influence at this site."
 *
 * ```json
 * { "type": "site-rule", "rule": "allow-agent-play" }
 * ```
 */
export interface AllowAgentPlaySiteRule extends EffectBase {
  readonly type: 'site-rule';
  readonly rule: 'allow-agent-play';
}

/**
 * Declares that this Under-deeps site's adjacency is *chosen when it is played*
 * rather than fixed on the card: it is Under-deeps-adjacent — at the given
 * `roll` — to any **other** Under-deeps site whose effective type is one of
 * `siteTypes`. This models a site whose printed adjacency reads "one Under-deeps
 * <site type> chosen by you when playing this card (N)". Since the engine has no
 * unoccupied-in-play site zone in which to record the once-chosen connection,
 * the faithful generalization is to treat the site as reachable from — and back
 * to — any Under-deeps site of the required type at the required roll. The
 * connected site must carry the `under-deeps` keyword, so no *surface* site is
 * ever adjacent ("no surface site").
 *
 * The rule is symmetric (works whether this site is the movement origin or
 * destination) and player-agnostic, mirroring the printed `adjacentSites`
 * adjacency it stands in for. Consulted by {@link isUnderDeepsAdjacent} and
 * {@link getUnderDeepsRequiredRoll}.
 *
 * Example — Ancient Deep-hold (ba-83): "no surface site, one Under-deeps
 * Ruins & Lairs [{R}] chosen by you when playing this card (8)".
 *
 * ```json
 * { "type": "site-rule", "rule": "dynamic-under-deeps-adjacency",
 *   "siteTypes": ["ruins-and-lairs"], "roll": 8 }
 * ```
 */
export interface DynamicUnderDeepsAdjacencySiteRule extends EffectBase {
  readonly type: 'site-rule';
  readonly rule: 'dynamic-under-deeps-adjacency';
  /** Effective site types the connected Under-deeps site must be. */
  readonly siteTypes: readonly SiteType[];
  /** Required 2d6 roll to move between this site and the connected one. */
  readonly roll: number;
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
 * the attacking creature's race matches this rule's `race` field. The bypass
 * feeds normal hazard-creature play against a company at the site. It **also**
 * feeds the site's `dynamic-auto-attack` eligibility (such a creature becomes a
 * legal choice for the opponent's dynamically-played automatic-attack) — but
 * only when that attack keys by **site-type** (e.g. The Iron-deeps ba-91: "…
 * keyed to a Ruins and Lairs"), since being keyed to *this site* is itself a
 * form of site keying. When the attack keys by **region-type** (e.g. The
 * Drowning-deeps ba-89: "…keyed to Coastal Seas"), keying to this site grants
 * no region keying, so the race bypass does not feed the auto-attack.
 *
 * When the optional `except` condition is present, it is evaluated against the
 * creature's card definition (via the standard DSL matcher, dot-path keys); a
 * creature matching `except` does **not** receive the bypass even if its race
 * matches. This models "any <race> creature (except <named creature>) may be
 * keyed to this site."
 *
 * Example — Geann a-Lisch (as-138): "Any Man hazard creature can be played
 * at this site."
 *
 * ```json
 * { "type": "site-rule", "rule": "allow-creature-by-race", "race": "men" }
 * ```
 *
 * Example — The Iron-deeps (ba-91): "Any Drake creature (except Sea Serpent)
 * may be keyed to this site."
 *
 * ```json
 * { "type": "site-rule", "rule": "allow-creature-by-race", "race": "drake",
 *   "except": { "name": "Sea Serpent" } }
 * ```
 */
export interface AllowCreatureByRaceSiteRule extends EffectBase {
  readonly type: 'site-rule';
  readonly rule: 'allow-creature-by-race';
  /** The creature race that bypasses keying at this site (e.g. "men"). */
  readonly race: string;
  /**
   * Optional DSL condition on the creature card definition; a creature that
   * matches is excluded from the bypass (e.g. Sea Serpent for a Drake rule).
   */
  readonly except?: Condition;
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
 * Example — The Drowning-deeps (ba-89) and Remains of Thangorodrim (ba-95):
 * "Creatures keyed to Coastal Seas may be keyed to this site."
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
 * Declares that ALL of this site's printed automatic-attacks are removed
 * while a character with the given card name is in play for either player.
 * Matched by name rather than definition ID so every version of the card
 * counts (Wizard avatars exist in multiple sets).
 *
 * Used by Rhosgobel (as-159): "If the Wizard card Radagast is in play, the
 * automatic-attacks are removed." — Radagast may be in play as the hero
 * Wizard (tw-178) or the Fallen-wizard (wh-8).
 *
 * Only the site's own printed attacks are removed; attacks added to the
 * site by hazard effects (Spawn permanent-events, extra-automatic-attack
 * constraints) are separate hazard attacks and are unaffected.
 *
 * ```json
 * { "type": "site-rule", "rule": "cancel-attacks-if-character-in-play",
 *   "characterName": "Radagast" }
 * ```
 */
export interface CancelAttacksIfCharacterInPlaySiteRule extends EffectBase {
  readonly type: 'site-rule';
  readonly rule: 'cancel-attacks-if-character-in-play';
  /** Card name of the character that, while in play, removes the site's printed automatic-attacks. */
  readonly characterName: string;
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
 * Declares that this site is an Under-deeps-style destination reachable **only**
 * from one of the moving Fallen-wizard's own *protected Wizardhavens*, and only
 * while that player has more than six stage points. The protected Wizardhaven is
 * the site's "surface site": the two are adjacent and the movement roll required
 * to move between them is 0 (so the move auto-succeeds like a roll-0 Under-deeps
 * step). The site is never reachable via ordinary starter/region movement.
 *
 * A "protected Wizardhaven" is a site that (a) is a Wizardhaven for the moving
 * Fallen-wizard (`isHavenForPlayer` — a Fallen-wizard haven or a Hidden-Haven
 * conversion) and (b) carries an active `site-protected` constraint owned by
 * that player (Guarded Haven wh-74 / The Fortress of … family, or an inherently
 * protected Wizardhaven such as Rhosgobel wh-57). Per CRF 22 the phrase
 * "protected Wizardhaven" is otherwise just a keyword.
 *
 * The stage-point requirement (>6) is enforced at both the plan-movement offer
 * and the M/H declare-path offer, so if the total drops before the company's
 * movement/hazard phase the descent is no longer a legal path and the company
 * simply stays put (rule 5.04) — matching the CRF ruling that "if [the stage
 * point requirement] is not met the company does not move at all."
 *
 * Example — Deep Mines (wh-55):
 *
 * ```json
 * { "type": "site-rule", "rule": "deep-mines-movement" }
 * ```
 */
export interface DeepMinesMovementSiteRule extends EffectBase {
  readonly type: 'site-rule';
  readonly rule: 'deep-mines-movement';
}

/**
 * Declares that resources may never be stored at this site. The standard
 * storage flow (regular items at any Haven, or `storable-at` items at their
 * listed sites/site-types) is suppressed for any company whose current site
 * carries this rule — no `store-item` action is offered there (organization
 * phase or an `allow-store-eot` end-of-turn window), and the reducer rejects a
 * store attempt as a safety backstop.
 *
 * Example — Geann a-Lisch (le-374): "Resources may never be stored at this
 * site." (a minion Haven that would otherwise permit storing regular items).
 *
 * ```json
 * { "type": "site-rule", "rule": "no-storage" }
 * ```
 */
export interface NoStorageSiteRule extends EffectBase {
  readonly type: 'site-rule';
  readonly rule: 'no-storage';
}

/**
 * Declares that this site is an **inherently protected Wizardhaven** — it is a
 * Wizardhaven that is always protected for the Fallen-wizard who controls it,
 * without any card having to establish protection on it (unlike Isengard/The
 * White Towers, which only become protected once The Fortress of Isen wh-68 /
 * Guarded Haven wh-74 etc. are played on them).
 *
 * The site behaves exactly as if it carried an active `site-protected`
 * constraint owned by its Fallen-wizard controller: it counts as one of that
 * player's *protected Wizardhavens* for every consumer of that concept — the
 * Deep Mines (wh-55) descent source, the "at a protected Wizardhaven" play
 * conditions (A Strident Spawn wh-61 / An Untimely Brood wh-62, Half-orcs
 * wh-86/87), the `player.hasProtectedWizardhaven` player-state flag, and the
 * protected-site marshalling-point block against the opponent. The controller
 * is the Fallen-wizard for whom this is a Wizardhaven ({@link isHavenForPlayer})
 * and who satisfies the site's `<wizard>-specific` keyword restriction, if any
 * (Rhosgobel is `radagast-specific`, so only Radagast controls it).
 *
 * Per CRF 22 the bare phrase "protected Wizardhaven" is otherwise just a
 * keyword; the attack-cancellation Rhosgobel also prints is a separate
 * `cancel-attacks` rule, and the stage point it grants is a separate
 * `stage-points` effect.
 *
 * Example — Rhosgobel (wh-57): "This site is a protected Wizardhaven [{H}]."
 *
 * ```json
 * { "type": "site-rule", "rule": "protected-wizardhaven" }
 * ```
 */
export interface ProtectedWizardhavenSiteRule extends EffectBase {
  readonly type: 'site-rule';
  readonly rule: 'protected-wizardhaven';
}

/**
 * Declares a positional win condition checked at the start of each of the
 * site owner's end-of-turn phases: if a company of the active player is at
 * this site and the `when` condition matches, that player immediately wins
 * the game (via the shared `oneRingWin` endgame primitive). The condition is
 * evaluated against
 * `{ player: { alignment }, company: { itemNames } }` — the active player's
 * alignment and the names of every item borne by the company's characters.
 *
 * Example — Barad-dûr (tw-374 / le-352), MELE §1: a Ringwraith player whose
 * company is bearing The One Ring at Barad-dûr wins immediately:
 *
 * ```json
 * { "type": "site-rule", "rule": "end-of-turn-win",
 *   "when": { "player.alignment": "ringwraith",
 *             "company.itemNames": { "$includes": "The One Ring" } } }
 * ```
 */
export interface EndOfTurnWinSiteRule extends EffectBase {
  readonly type: 'site-rule';
  readonly rule: 'end-of-turn-win';
  /** Condition on `{ player: { alignment }, company: { itemNames } }`. */
  readonly when: Condition;
}

/**
 * Overrides the site-type (and, optionally, the site path) the engine uses when
 * **playing and interpreting hazards** against a company whose effective site
 * (destination if moving, else current) carries this rule. The override applies
 * only to hazard keying — the site keeps its printed type for every other
 * purpose (movement, healing/untap, draws, storage, etc.).
 *
 * This models a site that "counts as a <site type> for the purposes of playing
 * and interpreting hazards": normally a Haven blocks hazards emergently (its
 * empty site path and `haven` type match no creature keying), so declaring an
 * override site-type — and the site path to use "if needed" — re-exposes the
 * company to hazards keyed to that type / path.
 *
 * `siteType` replaces `mhState.destinationSiteType` for the keying pass;
 * `sitePath` (when present) replaces `mhState.resolvedSitePath`, so creatures
 * keyed to the listed region-types can be played.
 *
 * Example — Geann a-Lisch (le-374): "Geann a-Lisch counts as a Ruins & Lairs
 * [{R}] for the purposes of playing and interpreting hazards. Its site path for
 * this purpose, if needed, is the one from Carn Dûm [{s}{w}{w}{w}{w}]."
 *
 * ```json
 * { "type": "site-rule", "rule": "hazard-site-type-override",
 *   "siteType": "ruins-and-lairs",
 *   "sitePath": ["shadow", "wilderness", "wilderness", "wilderness", "wilderness"] }
 * ```
 */
export interface HazardSiteTypeOverrideSiteRule extends EffectBase {
  readonly type: 'site-rule';
  readonly rule: 'hazard-site-type-override';
  /** Site-type to use when keying hazards against a company at this site. */
  readonly siteType: SiteType;
  /** Optional site path (region-types) to use for hazard keying "if needed". */
  readonly sitePath?: readonly RegionType[];
}
