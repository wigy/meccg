/**
 * @module ai/h2/services/strike/prowess
 *
 * Predicting the 2d6 target the engine will publish for a strike.
 *
 * Inside the strike window this is unnecessary — the engine puts `need` on
 * every option it offers. But the attack-level decisions happen *before* that:
 * choosing who faces a strike, or whether to cancel the attack outright, means
 * pricing strikes the engine has not been asked about yet.
 *
 * It lives in `services/` rather than inside `combat` because the *attacking*
 * seat needs exactly the same arithmetic and may not import a sibling module.
 * `hazards` (§3.4) prices a bundle by asking what the defending company would
 * roll against it, which is this calculation with the roster taken from the
 * opponent's side of the view and the strike prowess taken from a creature
 * card rather than from a live combat.
 *
 * So this mirrors the formula in `legal-actions/combat.ts`, built on the
 * character's already-computed `effectiveStats.prowess` (which the engine's
 * own `recomputeDerived` fills in, items included) and the shared
 * `stayUntappedPenalty`. What it cannot see are modifiers that depend on the
 * attacker's race — a weapon keyed to Orcs, say — because those are resolved
 * by `computeCombatProwess` against server state. That gap is declared as an
 * assumption and is directly measurable: `predictedNeed` can be compared
 * against the number the engine publishes once the strike is reached, which is
 * exactly what `prowess.test.ts` does across the scenario corpus.
 */

import { CardStatus, stayUntappedPenalty } from '@meccg/shared';
import type { CardDefinition, CardInstanceId, CombatState, PlayerView } from '@meccg/shared';

/** A character or ally that could face a strike. */
export interface StrikeTarget {
  /** Instance ID of the character or ally. */
  readonly instanceId: CardInstanceId;
  /** Its definition, for the stay-untapped penalty and body. */
  readonly definitionId: string;
  /**
   * The card's printed name. Carried on the target because every label a
   * reader sees is built from it — an explanation that says `p1-107 parries`
   * is not an explanation.
   */
  readonly name: string;
  /** Effective prowess including item modifiers. */
  readonly prowess: number;
  /** Current status. */
  readonly status: CardStatus;
  /** Allies cannot bear items and are salvaged differently. */
  readonly isAlly: boolean;
}

/** Modifiers that apply to one particular strike assignment. */
export interface StrikeModifiers {
  /** Excess strikes piled onto this character, each −1 prowess. */
  readonly excessStrikes?: number;
  /** Companions tapped to support, each +1 prowess (CoE 3.iv.4). */
  readonly supportCount?: number;
  /** Prowess added by a strike event already played. */
  readonly strikeProwessBonus?: number;
  /** Whether the character stays untapped rather than tapping to fight. */
  readonly stayUntapped?: boolean;
}

/** Every character and ally of the defending company, as strike targets. */
export function strikeTargets(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  combat: CombatState,
): StrikeTarget[] {
  const company = view.self.companies.find(c => c.id === combat.companyId);
  if (!company) return [];
  return rosterOf(company, view.self.characters, cardPool);
}

/**
 * The only part of a company this needs: who is in it.
 *
 * Typed structurally so the opponent's `OpponentCompanyView` — which carries a
 * character list and little else, because that is all the projection makes
 * public — satisfies it just as the player's own `Company` does.
 */
export interface CompanyRoster {
  readonly characters: readonly CardInstanceId[];
}

/**
 * A company's characters and allies as strike targets, from either seat.
 *
 * The defending seat reaches this through {@link strikeTargets}; the attacking
 * seat passes the *opponent's* company and character record, which the view
 * publishes in full — characters in play are public, so nothing here depends on
 * information the projection hides.
 */
export function rosterOf(
  company: CompanyRoster,
  characters: PlayerView['self']['characters'],
  cardPool: Readonly<Record<string, CardDefinition>>,
): StrikeTarget[] {
  const targets: StrikeTarget[] = [];
  for (const characterId of company.characters) {
    const character = characters[characterId];
    if (!character) continue;
    targets.push({
      instanceId: character.instanceId,
      definitionId: character.definitionId,
      name: nameOf(cardPool, character.definitionId, character.instanceId),
      prowess: character.effectiveStats.prowess,
      status: character.status,
      isAlly: false,
    });
    for (const ally of character.allies) {
      targets.push({
        instanceId: ally.instanceId,
        definitionId: ally.definitionId,
        name: nameOf(cardPool, ally.definitionId, ally.instanceId),
        // An ally's effective prowess is not published on the view, so its
        // printed value is used; an instance override (a creature converted by
        // Ready to His Will) is not visible here.
        prowess: 0,
        status: ally.status,
        isAlly: true,
      });
    }
  }
  return targets;
}

/** A card's printed name, falling back to its instance ID if unknown. */
export function nameOf(
  cardPool: Readonly<Record<string, CardDefinition>>,
  definitionId: string,
  instanceId: CardInstanceId,
): string {
  const name = (cardPool[definitionId] as unknown as { name?: string } | undefined)?.name;
  return name ?? (instanceId as string);
}

/** The strike prowess a defender must beat, agent rolls included. */
export function effectiveStrikeProwess(combat: CombatState): number {
  return combat.attackSource.type === 'agent' && combat.agentRollTotal !== undefined
    ? combat.agentRollTotal
    : combat.strikeProwess;
}

/**
 * The 2d6 target this character would need, mirroring the engine's own
 * calculation. Returns the same clamp at 2: a character who already
 * out-prowesses the strike wins on any roll.
 */
export function predictedNeed(
  target: StrikeTarget,
  cardPool: Readonly<Record<string, CardDefinition>>,
  combat: CombatState,
  modifiers: StrikeModifiers = {},
): number {
  return needAgainst(target, cardPool, effectiveStrikeProwess(combat), modifiers);
}

/**
 * The same 2d6 target against a bare strike prowess, with no combat in play.
 *
 * This is the form the attacking seat needs: a creature card in hand has a
 * printed prowess and no `CombatState` behind it, so there is nothing to read
 * `effectiveStrikeProwess` from. The arithmetic is identical, which is the
 * point — a bundle must be priced by the same formula the defender will
 * actually face, not by a second one that drifts.
 */
export function needAgainst(
  target: StrikeTarget,
  cardPool: Readonly<Record<string, CardDefinition>>,
  strikeProwess: number,
  modifiers: StrikeModifiers = {},
): number {
  let prowess = target.prowess;
  if (modifiers.stayUntapped) prowess -= stayUntappedPenalty(cardPool[target.definitionId]);
  if (target.status === CardStatus.Tapped) prowess -= 1;
  if (target.status === CardStatus.Inverted) prowess -= 2;
  prowess -= modifiers.excessStrikes ?? 0;
  prowess += modifiers.supportCount ?? 0;
  prowess += modifiers.strikeProwessBonus ?? 0;
  return Math.max(2, strikeProwess - prowess + 1);
}

/** Printed body of a strike target, defaulting to 9 as the engine does. */
export function bodyOf(target: StrikeTarget, cardPool: Readonly<Record<string, CardDefinition>>): number {
  const body = (cardPool[target.definitionId] as unknown as { body?: number } | undefined)?.body;
  return typeof body === 'number' ? body : DEFAULT_BODY;
}

/** The engine's fallback body for a definition that prints none. */
export const DEFAULT_BODY = 9;

/**
 * Targets that could still be assigned a strike, best first.
 *
 * "Best" is the lowest predicted target, which is the order a defender
 * actually assigns in: the character most likely to parry takes the strike.
 * Only untapped targets are eligible for ordinary assignment (CoE 3.iv).
 */
export function availableDefenders(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  combat: CombatState,
): StrikeTarget[] {
  const assigned = new Set(combat.strikeAssignments.map(a => a.characterId as string));
  return strikeTargets(view, cardPool, combat)
    .filter(t => !assigned.has(t.instanceId as string) && t.status === CardStatus.Untapped)
    .sort((a, b) => predictedNeed(a, cardPool, combat) - predictedNeed(b, cardPool, combat));
}
