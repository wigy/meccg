/**
 * @module legal-actions/site
 *
 * Legal actions during the site phase. Each company resolves its site
 * phase sequentially: the resource player selects which company goes
 * next, decides whether to enter the site, faces automatic attacks
 * and on-guard/agent attacks, then may play resources.
 *
 * CoE rules section 2.V (lines 340–393).
 */

import type { GameState, PlayerId, GameAction, SitePhaseState } from '../../index.js';
import { getPlayerIndex } from '../../index.js';
import { logDetail, logHeading } from './log.js';

/**
 * Compute legal actions for the site phase.
 *
 * The first step ('select-company') requires the resource player to choose
 * which of their unhandled companies will resolve next. No pass is allowed —
 * a company must be selected.
 */
export function siteActions(state: GameState, playerId: PlayerId): GameAction[] {
  const isActive = state.activePlayer === playerId;
  const siteState = state.phaseState as SitePhaseState;

  logHeading(`Site phase (step: ${siteState.step}): player is ${isActive ? 'active (resource)' : 'non-active (hazard)'}`);

  if (siteState.step === 'select-company') {
    return selectCompanyActions(state, playerId, siteState);
  }

  // TODO: enter-or-skip, reveal-on-guard-attacks, automatic-attacks,
  //       declare-agent-attack, resolve-attacks, play-resources, play-minor-item

  if (!isActive) {
    logDetail(`Not active player, no site actions`);
    return [];
  }

  return [{ type: 'pass', player: playerId }];
}

/**
 * Generate select-company actions for the site phase.
 *
 * The resource player picks which unhandled company resolves its site
 * phase next. Companies returned to their site of origin during M/H
 * are automatically skipped (CoE line 336). If only one company
 * remains, it is still offered as a choice for explicitness.
 */
function selectCompanyActions(
  state: GameState,
  playerId: PlayerId,
  siteState: SitePhaseState,
): GameAction[] {
  const isActive = state.activePlayer === playerId;
  if (!isActive) {
    logDetail(`Not active player — no actions during select-company step`);
    return [];
  }

  const playerIndex = getPlayerIndex(state, playerId);
  const player = state.players[playerIndex];
  const handledSet = new Set(siteState.handledCompanyIds);

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
