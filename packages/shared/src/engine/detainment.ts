/**
 * @module detainment
 *
 * Determines whether an attack is a detainment attack per CoE §3.II.
 *
 * A detainment attack taps characters instead of wounding them and
 * suppresses the character body-check (rule 3.II.1); defeated
 * detainment creatures award 0 kill-MP (rule 3.II.3). The detainment
 * status of an attack is computed at combat-initiation time from:
 *
 *  1. A `combat-detainment` effect declared on the attack source card
 *     (rule 3.II.2 — "or depends on an effect of the attack itself").
 *  2. The defending player's alignment combined with the attack's
 *     keying (rules 3.II.2.R1-R3 for Ringwraith players, 3.II.2.B1-B3
 *     for Balrog players).
 *
 *  3. Rule 3.II.4 — a Nazgûl attack against a minion company is
 *     detainment unless it is an automatic-attack. The nine Nazgûl
 *     hazard creatures are `race: "ringwraith"` cards played through
 *     the same hazard combat path as any other creature, so the branch
 *     keys on {@link DetainmentContext.attackRace} plus
 *     {@link DetainmentContext.isAutomaticAttack}. An automatic-attack
 *     Nazgûl falls through to the remaining checks, so it is still
 *     detainment when "modified by an effect" (a `combat-detainment`
 *     effect on the attack, handled above this branch).
 */
import type { CardEffect } from '../types/effects.js';
import type { CreatureKeyRestriction } from '../types/cards-hazards.js';
import { Alignment, Race, RegionType, SiteType } from '../types/common.js';
import { matchesCondition } from '../effects/condition-matcher.js';
import { logDetail } from './legal-actions/log.js';

/**
 * Context consumed by {@link isDetainmentAttack}. Call sites build this
 * from the attack source (creature / automatic-attack effect) and the
 * defending player's alignment. Fields are optional where the attack
 * source does not provide them (e.g. a plain site automatic-attack has
 * no {@link CreatureKeyRestriction} list).
 */
export interface DetainmentContext {
  /** Effects declared on the attack source card (creature, site, etc.). */
  readonly attackEffects?: readonly CardEffect[];
  /** Race of the attacking creature, if any. */
  readonly attackRace?: Race | null;
  /** Region/site keying restrictions on the attacking creature. */
  readonly attackKeyedTo?: readonly CreatureKeyRestriction[];
  /**
   * Names of cards currently in play. Used to evaluate optional `when`
   * clauses on `attackKeyedTo` entries — a conditional keying entry
   * (e.g. *Elf-lord Revealed in Wrath*'s shadow-lands keying, gated on
   * "Doors of Night not in play") is ignored when its condition fails,
   * so the rule 3.II.2.R1/B1 dark-hold/shadow-hold detainment branch
   * does not fire solely from an inactive alternative.
   */
  readonly inPlayNames?: readonly string[];
  /** Alignment of the defending player. */
  readonly defendingAlignment: Alignment;
  /**
   * Whether the defending company is in covert mode (Fallen-wizard
   * covert toggle). Referenced by card-level `combat-detainment` `when`
   * clauses such as "detainment against covert and hero companies".
   * Covert/overt mode is not yet implemented on companies — call sites
   * currently pass `false`. When the toggle is wired, threading the
   * real company value here makes the affected cards automatically
   * correct.
   */
  readonly defendingCovert?: boolean;
  /**
   * Whether the attack is an agent-hazard attack (rule 3.II.2.R3/B3).
   * The engine does not yet tag agents explicitly — when that data
   * becomes available, wire this flag at the call site. For now
   * defaults to `false`.
   */
  readonly isAgentHazard?: boolean;
  /**
   * Effects declared on the defending company's current site. Consulted
   * for `site-rule: attacks-not-detainment` entries that override the
   * default detainment computation (e.g. Moria — non-Nazgûl creatures
   * attack normally, not as detainment).
   */
  readonly defendingSiteEffects?: readonly CardEffect[];
  /**
   * Name of the defending company's effective site (destination if
   * moving, else current). Consulted for `site-rule:
   * keyed-creatures-detainment` entries, which force detainment whenever
   * the attacking creature carries a `siteNames` keying entry naming
   * this site (e.g. Moria's "Creatures keyed to this site are
   * detainment").
   */
  readonly defendingSiteName?: string | null;
  /**
   * True when this attack is the defending company's *current site's own*
   * listed automatic-attack (static or dynamically played via
   * `site-rule: dynamic-auto-attack`) rather than a hazard creature played
   * normally against the company. Exposed to an `attacks-not-detainment`
   * `filter` as `attack.automatic`, letting a site distinguish "creatures
   * keyed to this site [that hazard players play against a visiting
   * company] attack normally" from its own scripted automatic-attack(s),
   * which may separately declare `combat-detainment` to force detainment
   * regardless of the site-wide override. Used by The Under-leas (ba-102):
   * the 1st automatic-attack is unconditionally detainment while all other
   * attacks at the site are not. Defaults to `false` (a normal hazard
   * creature attack) when omitted.
   */
  readonly isAutomaticAttack?: boolean;
  /**
   * When `true`, the defending player converts every detainment attack against
   * his companies into a normal attack (Alatar wh-1's `detainment-attacks-normal`
   * effect, active above 7 stage points). Short-circuits the entire computation:
   * {@link isDetainmentAttack} returns `false` regardless of any
   * `combat-detainment` effect, site-forced detainment rule, or alignment-based
   * §3.II keying. Call sites compute it via
   * `playerConvertsDetainmentToNormal(state, defendingPlayer)`.
   */
  readonly defenderForcesNormalAttacks?: boolean;
}

/** Races covered by rule 3.II.2.R2/B2 when keyed to a Shadow-land. */
const SHADOW_LAND_RACES: ReadonlySet<Race> = new Set<Race>([
  Race.Orc,
  Race.Troll,
  Race.Undead,
  Race.Man,
]);

/** Site types covered by rule 3.II.2.R1/B1. */
const DARK_SITE_TYPES: ReadonlySet<SiteType> = new Set<SiteType>([
  SiteType.DarkHold,
  SiteType.ShadowHold,
]);

/**
 * Returns `true` when the given attack is detainment per CoE §3.II.
 * Always logs the deciding branch via {@link logDetail} so the combat
 * trace reveals why the flag was set.
 */
/**
 * Translates a player's {@link Alignment} enum value to the
 * rules-terminology string used by DSL `defender.alignment` conditions.
 * Specifically, wizard-avatar players are the "hero" alignment in card
 * text (rule 3.II.2, CRF "hero company"); the other alignments map 1:1.
 */
export function defenderAlignmentLabel(a: Alignment): string {
  return a === Alignment.Wizard ? 'hero' : a;
}

/**
 * Translates a defending player's {@link Alignment} to the
 * rules-terminology string used by `combat-detainment` `when` clauses
 * *when determining whether an attack is detainment*.
 *
 * This differs from {@link defenderAlignmentLabel} for Fallen-wizard
 * players: rule 2.IV.vii.F1 states that "when determining whether an
 * attack is detainment, a Fallen-wizard player's companies are
 * considered hero companies" — and the 2026-02-07 clarification to that
 * rule confirms the company's covert/overt status is irrelevant for
 * detainment determination. So both Wizard and Fallen-wizard defenders
 * label as `'hero'` here, ensuring cards such as *Ent in Search of the
 * Entwives* ("detainment against covert and hero companies") fire their
 * `defender.alignment: hero` branch against a Fallen-wizard company.
 */
function detainmentAlignmentLabel(a: Alignment): string {
  return a === Alignment.Wizard || a === Alignment.FallenWizard ? 'hero' : a;
}

export function isDetainmentAttack(ctx: DetainmentContext): boolean {
  if (ctx.defenderForcesNormalAttacks) {
    logDetail('Detainment: overridden — defender converts all detainment attacks to normal (e.g. Alatar wh-1)');
    return false;
  }

  const forcedDetainmentRule = (ctx.defendingSiteEffects ?? []).find(
    e => e.type === 'site-rule' && e.rule === 'attacks-are-detainment',
  );
  if (forcedDetainmentRule) {
    logDetail('Detainment: forced by site-rule attacks-are-detainment');
    return true;
  }

  const siteOverride = (ctx.defendingSiteEffects ?? []).find(
    e => e.type === 'site-rule' && e.rule === 'attacks-not-detainment',
  );
  if (siteOverride && siteOverride.type === 'site-rule' && siteOverride.rule === 'attacks-not-detainment') {
    const filter = siteOverride.filter;
    const filterContext = {
      enemy: { race: ctx.attackRace ?? null },
      attack: { automatic: ctx.isAutomaticAttack ?? false },
    };
    if (!filter || matchesCondition(filter, filterContext)) {
      logDetail(
        filter
          ? `Detainment: overridden by site-rule attacks-not-detainment (enemy race=${ctx.attackRace ?? 'none'} matches filter)`
          : `Detainment: overridden by site-rule attacks-not-detainment (no filter)`,
      );
      return false;
    }
    logDetail(
      `Detainment: site-rule attacks-not-detainment skipped; filter rejected enemy race=${ctx.attackRace ?? 'none'}`,
    );
  }

  const keyedDetainmentRule = (ctx.defendingSiteEffects ?? []).find(
    e => e.type === 'site-rule' && e.rule === 'keyed-creatures-detainment',
  );
  if (keyedDetainmentRule && ctx.defendingSiteName) {
    const keyingContextForSite = { inPlay: ctx.inPlayNames ?? [] };
    const keyedToSite = (ctx.attackKeyedTo ?? []).some(
      k => (k.siteNames ?? []).includes(ctx.defendingSiteName!)
        && (!k.when || matchesCondition(k.when, keyingContextForSite)),
    );
    if (keyedToSite) {
      logDetail(
        `Detainment: site-rule keyed-creatures-detainment — creature keyed to ${ctx.defendingSiteName} by name`,
      );
      return true;
    }
    logDetail(
      `Detainment: site-rule keyed-creatures-detainment present but creature not keyed to ${ctx.defendingSiteName} by name`,
    );
  }

  const conditionContext = {
    defender: {
      alignment: detainmentAlignmentLabel(ctx.defendingAlignment),
      covert: ctx.defendingCovert ?? false,
    },
  };
  for (const effect of ctx.attackEffects ?? []) {
    if (effect.type !== 'combat-detainment') continue;
    if (!effect.when || matchesCondition(effect.when, conditionContext)) {
      logDetail(
        effect.when
          ? `Detainment: combat-detainment effect matches defender alignment=${ctx.defendingAlignment} (§3.II.2)`
          : 'Detainment: attack declares combat-detainment effect (§3.II.2)',
      );
      return true;
    }
    logDetail(
      `Detainment: combat-detainment effect skipped; when-clause false for defender alignment=${ctx.defendingAlignment}`,
    );
  }

  const isMinion = ctx.defendingAlignment === Alignment.Ringwraith;
  const isBalrog = ctx.defendingAlignment === Alignment.Balrog;
  if (!isMinion && !isBalrog) return false;

  const rawKeyedTo = ctx.attackKeyedTo ?? [];
  const keyingContext = { inPlay: ctx.inPlayNames ?? [] };
  const keyedTo = rawKeyedTo.filter(
    k => !k.when || matchesCondition(k.when, keyingContext),
  );
  const tag = isMinion ? 'R' : 'B';

  const darkDomain = keyedTo.some(k => (k.regionTypes ?? []).includes(RegionType.Dark));
  const darkOrShadowHold = keyedTo.some(k => (k.siteTypes ?? []).some(s => DARK_SITE_TYPES.has(s)));
  if (darkDomain || darkOrShadowHold) {
    logDetail(`Detainment: attack keyed to Dark-domain/Dark-hold/Shadow-hold (§3.II.2.${tag}1)`);
    return true;
  }

  if (ctx.attackRace && SHADOW_LAND_RACES.has(ctx.attackRace)) {
    const shadowLand = keyedTo.some(k => (k.regionTypes ?? []).includes(RegionType.Shadow));
    if (shadowLand) {
      logDetail(`Detainment: ${ctx.attackRace} keyed to Shadow-land (§3.II.2.${tag}2)`);
      return true;
    }
  }

  if (ctx.isAgentHazard) {
    logDetail(`Detainment: agent hazard attack vs ${isMinion ? 'Ringwraith' : 'Balrog'} company (§3.II.2.${tag}3)`);
    return true;
  }

  // §3.II.4 — a Nazgûl attack against a minion company is detainment,
  // unless the attack is an automatic-attack (then it is not detainment
  // unless modified by an effect — the combat-detainment branch above).
  if (ctx.attackRace === Race.Ringwraith && !ctx.isAutomaticAttack) {
    logDetail(`Detainment: Nazgûl attack vs ${isMinion ? 'Ringwraith' : 'Balrog'} company (§3.II.4)`);
    return true;
  }

  return false;
}
