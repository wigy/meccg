/**
 * @module mh-phase-state
 *
 * Canonical construction of Movement/Hazard phase state.
 *
 * `MovementHazardPhaseState` carries about thirty fields, and they fall into
 * two groups: those scoped to the **company** currently in its M/H sub-phase
 * (movement type, declared path, hazards played, draw counts, pass flags, …)
 * and those scoped to the **phase** as a whole (which company is active, which
 * are already handled, per-character corruption plays, Nazgûl sideboard
 * access).
 *
 * Both groups were spelled out field-by-field in two different modules — the
 * per-company reset in `mh-hazard-play.ts` and the fresh-phase entry in
 * `reducer-events.ts` — so adding a field to the phase state meant remembering
 * to touch both. They now share {@link resetCompanyMHFields} and
 * {@link enterMovementHazardPhase} from here.
 *
 * This is a neutral leaf module, depending only on types and the movement
 * rules, for the same reason `hazard-limit.ts` is: `mh-hazard-play.ts` imports
 * the event reducers from `reducer-events.ts`, so `reducer-events.ts` cannot
 * import back from `mh-hazard-play.ts` without creating a cycle between two of
 * the largest engine modules.
 */

import type { MovementHazardPhaseState } from '../types/state-phases.js';
import { Phase } from '../types/state-phases.js';
import { BASE_MAX_REGION_DISTANCE } from '../rules/definitions/movement.js';

/**
 * The company-scoped M/H fields at their start-of-company values.
 *
 * Deliberately excludes the phase-scoped fields (`activeCompanyIndex`,
 * `handledCompanyIds`, `corruptionCardsPlayedPerChar`, `nazgulSideboard*`),
 * which must survive from one company's sub-phase to the next, and
 * `underDeepsRollRequired`, which the under-deeps roll steps clear themselves
 * on both of their exit paths.
 *
 * Built fresh on every call so no two phase states can ever alias the same
 * empty array.
 */
function freshCompanyFields() {
  return {
    step: 'select-company' as const,
    movementType: null,
    declaredRegionPath: [],
    maxRegionDistance: BASE_MAX_REGION_DISTANCE,
    hazardsPlayedThisCompany: 0,
    hazardLimitAtReveal: 0,
    preRevealHazardLimitConstraintIds: [],
    resolvedSitePath: [],
    resolvedSitePathNames: [],
    destinationSiteType: null,
    destinationSiteName: null,
    resourceDrawMax: 0,
    hazardDrawMax: 0,
    resourceDrawCount: 0,
    hazardDrawCount: 0,
    resourcePlayerPassed: false,
    hazardPlayerPassed: false,
    siteRevealed: false,
    onGuardPlacedThisCompany: false,
    returnedToOrigin: false,
    hazardsEncountered: [],
    spawnReplayUsedSources: [],
    ahuntAttacksResolved: 0,
    ahuntGroupOutcomes: [],
  };
}

/**
 * Clear every company-scoped M/H field, returning the phase to
 * `select-company` for the next company while keeping the phase-scoped
 * bookkeeping intact.
 *
 * Callers pre-set `handledCompanyIds` when finalizing a completed company, and
 * the extra-phase offer handlers override `step`/`siteRevealed` afterwards to
 * re-enter at `reveal-new-site`.
 */
export function resetCompanyMHFields(mhState: MovementHazardPhaseState): MovementHazardPhaseState {
  return { ...mhState, ...freshCompanyFields() };
}

/**
 * Build the phase state for entering the Movement/Hazard phase: every
 * company-scoped field at its start value, and the phase-scoped bookkeeping
 * empty — the first company is active, none are handled, no corruption cards
 * have been played and the Nazgûl sideboard is untouched.
 */
export function enterMovementHazardPhase(): MovementHazardPhaseState {
  return {
    phase: Phase.MovementHazard,
    ...freshCompanyFields(),
    activeCompanyIndex: 0,
    handledCompanyIds: [],
    corruptionCardsPlayedPerChar: {},
    nazgulSideboardDestination: null,
    nazgulSideboardFetched: 0,
  };
}
