/**
 * @module hazard-limit
 *
 * The current hazard limit for a company during the Movement/Hazard phase.
 *
 * This lives in its own neutral leaf module — depending on nothing in the
 * engine — so that both `reducer-movement-hazard.ts` (which owns the M/H
 * phase) and `chain-reducer.ts` (which checks the limit while resolving
 * played hazards) can read it without importing each other. Previously
 * `currentHazardLimit` lived in `reducer-movement-hazard.ts`, and
 * `chain-reducer.ts` imported it from there while `reducer-movement-hazard.ts`
 * imported the chain entry points back — a direct import cycle between two of
 * the largest engine modules. Relocating this single shared seam breaks that
 * cycle (see the architecture roadmap, P09).
 */

import type { GameState, MovementHazardPhaseState } from '../index.js';
import { Phase } from '../types/state-phases.js';
import type { CompanyId, RegionType, Race } from '../types/common.js';
import type { ActiveConstraint } from '../types/pending.js';
import type { CombatState } from '../types/state-combat.js';
import type { CardEffect } from '../types/effects.js';

/**
 * Compute the live hazard limit for `companyId` from its raw ingredients.
 *
 * Starts from the limit captured when hazards were revealed
 * (`hazardLimitAtReveal`) and applies every `hazard-limit-modifier` active
 * constraint targeting this company that was added *after* the reveal
 * (constraints present at reveal are already baked into `hazardLimitAtReveal`
 * and listed in `preRevealHazardLimitConstraintIds`). Also applies any
 * `hazard-limit-region-count` constraint added after reveal (e.g. a "Lost in
 * X" hazard event played mid-M/H-phase, tw-51/le-118 and its family: "the
 * hazard limit increases by one for every Border-land in its site path"),
 * counted against `resolvedSitePath` — unlike Fair Sailing's (tw-232)
 * end-of-organization-phase timing, these are played *after* the site path
 * is already resolved, so they are read live here rather than baked into
 * `hazardLimitAtReveal` by `snapshotHazardLimit`. Never returns negative.
 *
 * This structural overload takes only the pieces it needs — the active
 * constraints, the reveal snapshot, and the pre-reveal constraint ids — so the
 * browser can call it from a {@link PlayerView} (which exposes
 * `activeConstraints` and the M/H `phaseState`) to display the *effective*
 * limit after a Dragon "At Home" discard boosts it. Server code should prefer
 * {@link currentHazardLimit}, which reads these off `GameState`/`mhState`.
 */
export function effectiveHazardLimit(
  activeConstraints: readonly ActiveConstraint[],
  hazardLimitAtReveal: number,
  preRevealHazardLimitConstraintIds: readonly string[],
  companyId: CompanyId,
  resolvedSitePath: readonly RegionType[] = [],
  facingAttackBonus = 0,
): number {
  let limit = hazardLimitAtReveal + facingAttackBonus;
  for (const constraint of activeConstraints) {
    if (constraint.target.kind !== 'company') continue;
    if (constraint.target.companyId !== companyId) continue;
    if (preRevealHazardLimitConstraintIds.includes(constraint.id as string)) continue;
    if (constraint.kind.type === 'hazard-limit-modifier') {
      limit += constraint.kind.value;
    } else if (constraint.kind.type === 'hazard-limit-region-count') {
      const { regionType, perCount, floor } = constraint.kind;
      const count = resolvedSitePath.filter(rt => rt === regionType).length;
      if (count === 0) continue;
      let next = limit + perCount * count;
      if (perCount < 0 && next < floor) next = Math.min(limit, floor);
      limit = next;
    }
  }
  // Lost in Dark-domains (tw-52): "hazard limit is doubled until the end of
  // the turn" — a multiplier over the limit as computed so far (base plus
  // every additive modifier), not a flat delta. Always added after reveal
  // (the card is played once the site path is already resolved), so there is
  // no pre-reveal exclusion to mirror.
  for (const constraint of activeConstraints) {
    if (constraint.kind.type !== 'hazard-limit-multiplier') continue;
    if (constraint.target.kind !== 'company') continue;
    if (constraint.target.companyId !== companyId) continue;
    limit *= constraint.kind.value;
  }
  return Math.max(limit, 0);
}

/**
 * Live hazard-limit bonus from in-play `hazard-limit-facing-attack` effects
 * (Bairanax at Home td-5: "the hazard limit against any company facing one or
 * more animal hazard creature attacks is increased by one").
 *
 * The company counts as facing a matching attack once a hand-played hazard
 * creature of the effect's `race` has attacked it this M/H sub-phase — either
 * the attack currently in combat (`combat.attackSource.type === 'creature'`
 * against `companyId`) or one already finalized and recorded by name in
 * `hazardsEncountered`. Each matching in-play card adds its `value` once,
 * however many such attacks the company faces.
 *
 * Takes structural pieces so the browser can compute the same bonus from a
 * {@link PlayerView} (both players' `cardsInPlay`, the M/H `phaseState`, and
 * `combat`) as the server does from `GameState`.
 */
export function facingAttackHazardLimitBonus(
  cardsInPlay: readonly { readonly definitionId: string }[],
  cardPool: Readonly<Record<string, unknown>>,
  hazardsEncountered: readonly string[],
  combat: CombatState | null,
  companyId: CompanyId,
): number {
  const effects: { race: Race; value: number }[] = [];
  for (const card of cardsInPlay) {
    const def = cardPool[card.definitionId] as { effects?: readonly CardEffect[] } | undefined;
    for (const eff of def?.effects ?? []) {
      if (eff.type === 'hazard-limit-facing-attack') effects.push({ race: eff.race, value: eff.value });
    }
  }
  if (effects.length === 0) return 0;

  const faced = new Set<Race>();
  if (combat && combat.companyId === companyId && combat.attackSource.type === 'creature') {
    for (const r of combat.creatureRaces ?? (combat.creatureRace ? [combat.creatureRace] : [])) faced.add(r);
  }
  for (const name of hazardsEncountered) {
    for (const def of Object.values(cardPool)) {
      const d = def as { cardType?: string; name?: string; race?: Race; additionalRaces?: readonly Race[] };
      if (d.cardType !== 'hazard-creature' || d.name !== name) continue;
      if (d.race) faced.add(d.race);
      for (const r of d.additionalRaces ?? []) faced.add(r);
      break;
    }
  }

  let bonus = 0;
  for (const eff of effects) {
    if (faced.has(eff.race)) bonus += eff.value;
  }
  return bonus;
}

/**
 * Live hazard-limit bonus from in-play `hazard-limit-per-extra-draw` effects
 * (Shadow of Mordor td-68: "The hazard limit for each company is increased by
 * one for every card over one drawn by that company during its
 * movement/hazard phase").
 *
 * `resourceCardsDrawn` is the number of cards the moving company's player has
 * actually drawn in the current company's draw-cards step. Each matching
 * in-play card adds `value` per card beyond the first.
 *
 * Takes structural pieces so the browser can compute the same bonus from a
 * {@link PlayerView} as the server does from `GameState`.
 */
export function extraDrawHazardLimitBonus(
  cardsInPlay: readonly { readonly definitionId: string }[],
  cardPool: Readonly<Record<string, unknown>>,
  resourceCardsDrawn: number,
): number {
  const extra = Math.max(0, resourceCardsDrawn - 1);
  if (extra === 0) return 0;
  let bonus = 0;
  for (const card of cardsInPlay) {
    const def = cardPool[card.definitionId] as { effects?: readonly CardEffect[] } | undefined;
    for (const eff of def?.effects ?? []) {
      if (eff.type === 'hazard-limit-per-extra-draw') bonus += eff.value * extra;
    }
  }
  return bonus;
}

/**
 * The live hazard limit for `companyId` in the current M/H phase.
 *
 * Thin server-side wrapper over {@link effectiveHazardLimit} that reads the
 * ingredients off `GameState` and the M/H phase state.
 */
export function currentHazardLimit(
  state: GameState,
  mhState: MovementHazardPhaseState,
  companyId: CompanyId,
): number {
  return effectiveHazardLimit(
    state.activeConstraints,
    mhState.hazardLimitAtReveal,
    mhState.preRevealHazardLimitConstraintIds,
    companyId,
    mhState.resolvedSitePath,
    facingAttackHazardLimitBonus(
      state.players.flatMap(p => p.cardsInPlay),
      state.cardPool,
      mhState.hazardsEncountered,
      state.combat,
      companyId,
    ) + extraDrawHazardLimitBonus(
      state.players.flatMap(p => p.cardsInPlay),
      state.cardPool,
      mhState.resourceCardsDrawn ?? 0,
    ),
  );
}

/**
 * The hazard-limit "charge" idiom shared by every reducer that plays a
 * limit-counted hazard action during the M/H phase: compute the live limit for
 * the target company, refuse the action when the limit is already reached, and
 * otherwise hand back the limit together with the incremented
 * `hazardsPlayedThisCompany` count for the caller to store (and log).
 *
 * `actionName` prefixes the refusal message so each reducer keeps its
 * action-specific error text (`"<action>: hazard limit reached (<limit>)"`).
 * Callers that only need the check (e.g. a validation pass whose increment
 * happens later after other state updates) simply ignore the returned count.
 */
export function chargeHazardLimit(
  state: GameState,
  mhState: MovementHazardPhaseState,
  companyId: CompanyId,
  actionName: string,
): { error: string } | { limit: number; newHazardCount: number } {
  const limit = currentHazardLimit(state, mhState, companyId);
  const played = mhState.hazardsPlayedThisCompany ?? 0;
  if (played >= limit) {
    return { error: `${actionName}: hazard limit reached (${limit})` };
  }
  return { limit, newHazardCount: played + 1 };
}

/**
 * How the company stands against its hazard limit right now, or undefined when
 * there is no limit to stand against.
 *
 * Hazard-limit bookkeeping only exists in the Movement/Hazard phase, whose
 * phase state carries the reveal snapshot the limit is derived from. Outside it
 * — most notably site-phase combat — no hazard action is limit-gated at all,
 * and this returns undefined rather than a vacuous "not reached".
 *
 * Callers need the numbers, not just the verdict: the combat-window scanners
 * log the played/limit pair, and one of them offers the action as non-viable
 * with the count in its reason rather than hiding it. See CoE rule 8.12 —
 * hazard actions taken during a strike sequence in the opponent's M/H phase
 * count against the defending company's limit.
 */
export function hazardLimitStatus(
  state: GameState,
  companyId: CompanyId,
): { played: number; limit: number; reached: boolean } | undefined {
  if (state.phaseState.phase !== Phase.MovementHazard) return undefined;
  const mhState = state.phaseState;

  const limit = currentHazardLimit(state, mhState, companyId);
  const played = mhState.hazardsPlayedThisCompany ?? 0;
  return { played, limit, reached: played >= limit };
}
