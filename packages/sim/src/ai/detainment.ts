/**
 * @module ai/detainment
 *
 * Whether an attack the hazard seat is *considering* would be a detainment
 * attack, before there is any combat to read it off.
 *
 * The defending seat never needs this: the engine publishes `combat.detainment`
 * on the live combat, and `combat` / `attack-value` read it. The attacking seat
 * has no combat — it is choosing which creature to play — so it has to predict
 * the flag the engine will compute, exactly as `strike/prowess` predicts the
 * `need` the engine will publish. The prediction is not a second model: it calls
 * the engine's own `isDetainmentAttack` (CoE §3.II) with the context rebuilt
 * from the view, so a card that changes the rule changes both seats at once.
 *
 * **Why the hazard side has to know.** Three things separate a detainment attack
 * from a normal one, and all three change what a bundle is worth:
 *
 * - It **taps** rather than wounds, and never eliminates — so it does less harm
 *   than the printed prowess suggests.
 * - It awards **no kill marshalling points** when it is defeated (§3.II.3) — so
 *   it is the one attack that cannot pay the defender for beating it.
 * - It **suppresses the body check**, so the struck character is never lost.
 *
 * Modelled as a normal attack, a detainment creature was priced as a gamble that
 * wounds and can hand over points; it is in fact a free way to spend a hazard
 * slot tapping the roster. That is what makes it the natural *opener*: the
 * sequence enumeration resolves the bundle against a degrading company, so the
 * defenders a detainment attack taps meet the hard-hitting creature behind it at
 * −1, which both raises its chance of getting through and lowers its chance of
 * being defeated — the kill MP the hazard player is trying not to give away.
 *
 * **What it cannot see.** Two overrides live in server-side state the view does
 * not publish: a defender who converts every detainment attack into a normal one
 * (Alatar wh-1 above 7 stage points) and a company's turn-scoped
 * `keyed-attacks-normal` constraint (World Gnawed by the Nameless as-110). Both
 * would turn a predicted detainment attack back into a normal one, so against
 * those two boards this under-states the attack rather than over-stating it.
 */

import { isDetainmentAttack } from '@meccg/shared';
import type {
  CardDefinition, CardEffect, CreatureKeyRestriction, CreatureKeyingMatch, OpponentCompanyView,
  PlayerView, Race, RegionType, SiteType,
} from '@meccg/shared';

/** The fields of a creature definition the detainment rule reads. */
interface CreatureShape {
  readonly cardType?: string;
  readonly race?: Race;
  readonly keyedTo?: readonly CreatureKeyRestriction[];
  readonly effects?: readonly CardEffect[];
}

/** The fields of a site definition the detainment rule reads. */
interface SiteShape {
  readonly name?: string;
  readonly effects?: readonly CardEffect[];
}

/**
 * Names of every card in play, either side, for the `when` clauses on a
 * creature's keying entries (a Doors-of-Night alternative is only keying when
 * Doors of Night is actually out).
 */
function inPlayNames(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): string[] {
  const names: string[] = [];
  // Tolerant of a view without either zone: a `when` clause that finds no card
  // is false, which is the safe answer, and this is reached from the heuristic
  // evaluator's own hand-built contexts as well as from a real projection.
  for (const zone of [view.self?.cardsInPlay ?? [], view.opponent?.cardsInPlay ?? []]) {
    for (const card of zone) {
      const name = (cardPool[card.definitionId] as unknown as { name?: string } | undefined)?.name;
      if (name) names.push(name);
    }
  }
  return names;
}

/**
 * The site the company will be at when the attack lands: its revealed
 * destination while it is moving, else where it stands. This is the engine's
 * own `resolveDefendingSiteDef`, which is what site rules such as Moria's
 * "creatures keyed to this site are detainment" are read from.
 */
function defendingSite(
  company: OpponentCompanyView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): SiteShape | undefined {
  const site = company.revealedDestinationSite ?? company.currentSite;
  if (!site) return undefined;
  return cardPool[site.definitionId] as unknown as SiteShape | undefined;
}

/**
 * Whether playing this creature against this company would be a detainment
 * attack.
 *
 * `keyedBy` is the keying the engine offered the play under. A creature whose
 * `keyedTo` lists several independent alternatives is keyed only to the one the
 * play actually used, and §3.II.2.R1/B1 turns on precisely that — so the
 * declared match is threaded through rather than the union of everything the
 * card could have keyed to, mirroring `chain-reducer`. Without one (an on-guard
 * reveal, or a caller with no action in hand), the union is the engine's own
 * fallback.
 */
export function attackIsDetainment(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  company: OpponentCompanyView,
  definitionId: string,
  keyedBy?: CreatureKeyingMatch,
): boolean {
  const def = cardPool[definitionId] as unknown as CreatureShape | undefined;
  if (!def || def.cardType !== 'hazard-creature') return false;
  const site = defendingSite(company, cardPool);
  return isDetainmentAttack({
    attackEffects: def.effects,
    attackRace: def.race ?? null,
    attackKeyedTo: def.keyedTo,
    inPlayNames: inPlayNames(view, cardPool),
    defendingAlignment: view.opponent.alignment,
    defendingSiteEffects: site?.effects,
    defendingSiteName: site?.name,
    ...(keyedBy
      ? {
        attackDeclaredSiteTypes: keyedBy.method === 'site-type' ? [keyedBy.value as SiteType] : [],
        attackDeclaredRegionTypes: keyedBy.method === 'region-type' ? [keyedBy.value as RegionType] : [],
      }
      : {}),
  });
}
