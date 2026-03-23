/**
 * @module legal-actions/movement-hazard
 *
 * Legal actions during the movement/hazard phase. Companies move to
 * their destinations while the opponent plays hazard cards. Combat
 * sub-states further constrain available actions.
 */

import type { GameState, PlayerId, GameAction, MovementHazardPhaseState } from '../../index.js';
import { getPlayerIndex } from '../../index.js';
import { logDetail, logHeading } from './log.js';

/**
 * Compute legal actions for the movement/hazard phase.
 *
 * The first step ('select-company') requires the resource player to choose
 * which of their unhandled companies will resolve next. No pass is allowed —
 * a company must be selected.
 */
export function movementHazardActions(state: GameState, playerId: PlayerId): GameAction[] {
  const isActive = state.activePlayer === playerId;
  const mhState = state.phaseState as MovementHazardPhaseState;

  logHeading(`Movement/hazard phase (step: ${mhState.step}): player is ${isActive ? 'active (mover)' : 'non-active (hazard player)'}`);

  if (mhState.step === 'select-company') {
    return selectCompanyActions(state, playerId, mhState);
  }

  // TODO: declare-path, order-effects, play-hazard, assign-strike, resolve-strike, support-strike
  if (!isActive) {
    logDetail(`Not active player, no movement/hazard actions`);
    return [];
  }

  return [{ type: 'pass', player: playerId }];
}

/**
 * Generate select-company actions for the resource player.
 *
 * Lists all of the active player's companies that have not yet been
 * handled this turn. Only the active (resource) player may select;
 * the hazard player receives no actions during this step.
 */
function selectCompanyActions(
  state: GameState,
  playerId: PlayerId,
  mhState: MovementHazardPhaseState,
): GameAction[] {
  const isActive = state.activePlayer === playerId;
  if (!isActive) {
    logDetail(`Not active player — no actions during select-company step`);
    return [];
  }

  const playerIndex = getPlayerIndex(state, playerId);
  const player = state.players[playerIndex];
  const handledSet = new Set(mhState.handledCompanyIds);

  const actions: GameAction[] = [];
  for (const company of player.companies) {
    if (handledSet.has(company.id)) {
      logDetail(`Company ${company.id} already handled — skipping`);
      continue;
    }
    logDetail(`Company ${company.id} not yet handled — offering select-company`);
    actions.push({ type: 'select-company', player: playerId, companyId: company.id });
  }

  logDetail(`${actions.length} unhandled company(ies) available for selection`);
  return actions;
}
