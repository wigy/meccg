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
import type { CompanyId } from '../types/common.js';

/**
 * The live hazard limit for `companyId` in the current M/H phase.
 *
 * Starts from the limit captured when hazards were revealed
 * (`mhState.hazardLimitAtReveal`) and applies every `hazard-limit-modifier`
 * active constraint targeting this company that was added *after* the reveal
 * (constraints present at reveal are already baked into `hazardLimitAtReveal`
 * and listed in `preRevealHazardLimitConstraintIds`). Never returns negative.
 */
export function currentHazardLimit(
  state: GameState,
  mhState: MovementHazardPhaseState,
  companyId: CompanyId,
): number {
  let limit = mhState.hazardLimitAtReveal;
  for (const constraint of state.activeConstraints) {
    if (constraint.kind.type !== 'hazard-limit-modifier') continue;
    if (constraint.target.kind !== 'company') continue;
    if (constraint.target.companyId !== companyId) continue;
    if (mhState.preRevealHazardLimitConstraintIds.includes(constraint.id)) continue;
    limit += constraint.kind.value;
  }
  return Math.max(limit, 0);
}
