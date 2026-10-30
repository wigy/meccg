/**
 * @module short-event-suspension
 *
 * The `suspend-short-event-effects` primitive (Noose of the Sea td-51):
 * "Affects each company with a Coastal Sea [{c}] in its site path. The
 * on-going effects of all resource short-events that were played during the
 * organization phase are cancelled for the duration of the movement/hazard
 * phase and the site phase. Such short-events have no effect on this card."
 *
 * A resource short-event's on-going effect is modelled as an
 * {@link ActiveConstraint} (Stealth's `no-creature-hazards-on-company`,
 * Master of Esgaroth's `extra-mh-phase`, a turn-scoped stat bonus, …), and
 * those constraints are read in well over a hundred places. Rather than
 * teaching every consumer about the cancellation, this module runs once after
 * every reducer step (`reduce` in `reducer.ts`) and **moves** each affected
 * constraint from `GameState.activeConstraints` into
 * `GameState.suspendedConstraints`, where no consumer looks; it moves it back
 * the moment the suspension no longer applies (the site phase ends, the
 * carrying card leaves play). `sweepExpired` and `removeConstraint` also act
 * on the suspended list, so a suspended effect still expires on schedule.
 *
 * "Its site path" is only known once the company declares its path during
 * its own movement/hazard phase, so the sweep also records the active
 * company's resolved site path into `GameState.sitePathsThisTurn`, keeping
 * the answer available for the rest of the turn (the site phase, and the
 * movement/hazard phases of later companies).
 *
 * The carrying card's immunity to the same class of short-events is enforced
 * where resource short-events pick discard targets
 * (`collectDiscardInPlayTargets` → {@link isImmuneToShortEventsInPhase}).
 */

import type { ActiveConstraint, GameState, SuspendShortEventEffectsEffect } from '../index.js';
import type { CardDefinition } from '../types/cards.js';
import { isResourceEventCard } from '../types/cards.js';
import type { RegionType } from '../types/common.js';
import { Phase } from '../types/state-phases.js';
import { logDetail } from './legal-actions/log.js';
import { defById, findPlayerAndCompany, getCardEffects } from './reducer-utils.js';

/** Every `suspend-short-event-effects` effect on a card in either player's play area. */
function collectSuspendEffects(state: GameState): SuspendShortEventEffectsEffect[] {
  const found: SuspendShortEventEffectsEffect[] = [];
  for (const p of state.players) {
    for (const card of p.cardsInPlay) {
      for (const eff of getCardEffects(defById(state, card.definitionId))) {
        if (eff.type === 'suspend-short-event-effects') found.push(eff);
      }
    }
  }
  return found;
}

/**
 * True when `def` carries a `suspend-short-event-effects` effect whose
 * `playedDuring` includes `phase` — i.e. a resource short-event declared in
 * `phase` "has no effect on this card" and may not discard it.
 */
export function isImmuneToShortEventsInPhase(def: CardDefinition | undefined, phase: Phase): boolean {
  return getCardEffects(def).some(
    e => e.type === 'suspend-short-event-effects' && e.playedDuring.includes(phase),
  );
}

/** The company a constraint is bound to, or undefined for player-targeted ones. */
function constraintCompanyId(state: GameState, c: ActiveConstraint): string | undefined {
  if (c.target.kind === 'company') return c.target.companyId as string;
  if (c.target.kind === 'character') return findPlayerAndCompany(state, c.target.characterId)?.company.id as string | undefined;
  return undefined;
}

/** Region types recorded for the company's site path this turn (empty when stale/absent). */
function companySitePath(state: GameState, companyId: string): readonly RegionType[] {
  const rec = state.sitePathsThisTurn;
  if (!rec || rec.turnNumber !== state.turnNumber) return [];
  return rec.byCompany[companyId] ?? [];
}

/**
 * Record the active company's resolved site path during its movement/hazard
 * phase into `sitePathsThisTurn` (merged with any path it already took this
 * turn, e.g. a second movement/hazard phase).
 */
function recordActiveCompanySitePath(state: GameState): GameState {
  const ps = state.phaseState;
  if (ps.phase !== Phase.MovementHazard) return state;
  // This sweep runs after *every* reducer step, so it also sees movement/hazard
  // states that were never built by `beginMovementHazard` (tests enter the
  // phase with only `phase` set). Treat a missing path as "nothing declared
  // yet" rather than dereferencing it.
  const resolvedSitePath = ps.resolvedSitePath ?? [];
  if (resolvedSitePath.length === 0) return state;
  const player = state.players.find(p => p.id === state.activePlayer);
  const company = player?.companies[ps.activeCompanyIndex];
  if (!company) return state;
  const fresh = state.sitePathsThisTurn?.turnNumber === state.turnNumber ? state.sitePathsThisTurn.byCompany : {};
  const known = fresh[company.id as string] ?? [];
  const added = resolvedSitePath.filter((t, i, arr) => !known.includes(t) && arr.indexOf(t) === i);
  if (added.length === 0 && state.sitePathsThisTurn?.turnNumber === state.turnNumber) return state;
  return {
    ...state,
    sitePathsThisTurn: {
      turnNumber: state.turnNumber,
      byCompany: { ...fresh, [company.id as string]: [...known, ...added] },
    },
  };
}

/**
 * Whether `c` is currently cancelled by one of the in-play `effects`: the game
 * is in a `suspendDuring` phase, the constraint was installed by a resource
 * short-event during a `playedDuring` phase, and it is bound to a company
 * whose site path this turn includes `sitePathRegionType`.
 */
function isSuspended(
  state: GameState,
  c: ActiveConstraint,
  effects: readonly SuspendShortEventEffectsEffect[],
): boolean {
  if (effects.length === 0 || !c.addedInPhase) return false;
  const sourceDef = defById(state, c.sourceDefinitionId);
  if (!isResourceEventCard(sourceDef) || sourceDef.eventType !== 'short') return false;
  const companyId = constraintCompanyId(state, c);
  if (!companyId) return false;
  const phase = state.phaseState.phase;
  const path = companySitePath(state, companyId);
  return effects.some(e =>
    e.suspendDuring.includes(phase)
    && e.playedDuring.includes(c.addedInPhase!)
    && path.includes(e.sitePathRegionType),
  );
}

/**
 * Post-step sweep: record the active company's site path, then move every
 * constraint whose `suspend-short-event-effects` cancellation currently
 * applies into `suspendedConstraints`, and every suspended one whose
 * cancellation lapsed back into `activeConstraints`. Returns `state` unchanged
 * when nothing moves.
 */
export function sweepSuspendedShortEventConstraints(state: GameState): GameState {
  const recorded = recordActiveCompanySitePath(state);
  const effects = collectSuspendEffects(recorded);
  const suspended = recorded.suspendedConstraints ?? [];
  if (effects.length === 0 && suspended.length === 0) return recorded;

  const toSuspend = recorded.activeConstraints.filter(c => isSuspended(recorded, c, effects));
  const toRestore = suspended.filter(c => !isSuspended(recorded, c, effects));
  if (toSuspend.length === 0 && toRestore.length === 0) return recorded;

  for (const c of toSuspend) {
    logDetail(`suspend-short-event-effects: on-going effect "${c.kind.type}" of ${c.sourceDefinitionId as string} (played during ${c.addedInPhase ?? '?'}) cancelled during ${recorded.phaseState.phase}`);
  }
  for (const c of toRestore) {
    logDetail(`suspend-short-event-effects: on-going effect "${c.kind.type}" of ${c.sourceDefinitionId as string} restored during ${recorded.phaseState.phase}`);
  }
  const suspendIds = new Set(toSuspend.map(c => c.id));
  const restoreIds = new Set(toRestore.map(c => c.id));
  return {
    ...recorded,
    activeConstraints: [...recorded.activeConstraints.filter(c => !suspendIds.has(c.id)), ...toRestore],
    suspendedConstraints: [...suspended.filter(c => !restoreIds.has(c.id)), ...toSuspend],
  };
}
