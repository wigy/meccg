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
 * Rule 3.II.4 (Nazgûl vs minion company) is not computed here; it
 * applies to cross-alignment site-phase combat (a Ringwraith character
 * attacking another minion player's company), which is initiated on a
 * different code path than the three hazard-style call sites that
 * consume this helper.
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

export function isDetainmentAttack(ctx: DetainmentContext): boolean {
  const conditionContext = {
    defender: {
      alignment: defenderAlignmentLabel(ctx.defendingAlignment),
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

  return false;
}
