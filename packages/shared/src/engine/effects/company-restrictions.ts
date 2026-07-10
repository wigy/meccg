/**
 * @module engine/effects/company-restrictions
 *
 * Helpers for the `company-movement-restriction` DSL effect — a permanent
 * event bound to a company (`CardInPlay.companyId`) that constrains how that
 * company may move and how many hazards it faces while moving.
 *
 * Used by Going Ever Under Dark (ba-37): "The company cannot use starter
 * movement. In addition, if they move with region movement, they are limited
 * in all cases to 3 regions maximum and their hazard limit is reduced by one
 * (to a minimum of two)."
 *
 * The restriction is read at four sites:
 * - organization plan-movement (`legal-actions/organization-companies.ts`) —
 *   drop starter destinations, cap the region distance;
 * - M/H select-company (`mh-steps.ts`) — cap the recomputed region distance;
 * - M/H declare-path (`legal-actions/movement-hazard.ts`) — suppress the
 *   starter path option;
 * - the hazard-limit snapshot (`mh-steps.ts`) — apply the (floored) hazard
 *   modifier for a region-moving company.
 */

import type { GameState, Company, PlayerState } from '../../index.js';
import type { CompanyMovementRestrictionEffect } from '../../types/effects.js';
import { defById, getCardEffects } from '../reducer-utils.js';

/**
 * The aggregate movement/hazard restrictions imposed on `company` by every
 * `company-movement-restriction` permanent-event its owner has bound to it.
 * Returns `null` when no restriction card is bound (the common case), so
 * callers can cheaply skip the restriction logic entirely.
 *
 * Aggregation across multiple restriction cards: `noStarterMovement` is OR-ed,
 * the region cap takes the strictest (smallest) declared maximum, and hazard
 * modifiers sum while the floor takes the highest declared value.
 */
export function companyMovementRestrictions(
  owner: PlayerState,
  company: Company,
  state: GameState,
): {
  readonly noStarterMovement: boolean;
  readonly regionMovementMax: number | null;
  readonly hazardLimitModifier: number;
  readonly hazardLimitFloor: number;
} | null {
  let found = false;
  let noStarterMovement = false;
  let regionMovementMax: number | null = null;
  let hazardLimitModifier = 0;
  let hazardLimitFloor = 0;

  for (const card of owner.cardsInPlay) {
    if (card.companyId !== company.id) continue;
    const def = defById(state, card.definitionId);
    for (const eff of getCardEffects(def)) {
      if (eff.type !== 'company-movement-restriction') continue;
      const e: CompanyMovementRestrictionEffect = eff;
      found = true;
      if (e.noStarterMovement) noStarterMovement = true;
      if (e.regionMovementMax !== undefined) {
        regionMovementMax = regionMovementMax === null
          ? e.regionMovementMax
          : Math.min(regionMovementMax, e.regionMovementMax);
      }
      if (e.hazardLimitModifier !== undefined) hazardLimitModifier += e.hazardLimitModifier;
      if (e.hazardLimitFloor !== undefined) hazardLimitFloor = Math.max(hazardLimitFloor, e.hazardLimitFloor);
    }
  }

  if (!found) return null;
  return { noStarterMovement, regionMovementMax, hazardLimitModifier, hazardLimitFloor };
}
