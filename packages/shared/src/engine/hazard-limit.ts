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
import type { CompanyId } from '../types/common.js';
import type { ActiveConstraint } from '../types/pending.js';

/**
 * Compute the live hazard limit for `companyId` from its raw ingredients.
 *
 * Starts from the limit captured when hazards were revealed
 * (`hazardLimitAtReveal`) and applies every `hazard-limit-modifier` active
 * constraint targeting this company that was added *after* the reveal
 * (constraints present at reveal are already baked into `hazardLimitAtReveal`
 * and listed in `preRevealHazardLimitConstraintIds`). Never returns negative.
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
): number {
  let limit = hazardLimitAtReveal;
  for (const constraint of activeConstraints) {
    if (constraint.kind.type !== 'hazard-limit-modifier') continue;
    if (constraint.target.kind !== 'company') continue;
    if (constraint.target.companyId !== companyId) continue;
    if (preRevealHazardLimitConstraintIds.includes(constraint.id as string)) continue;
    limit += constraint.kind.value;
  }
  return Math.max(limit, 0);
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
  );
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
