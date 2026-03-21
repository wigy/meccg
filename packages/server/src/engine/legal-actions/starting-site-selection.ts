/**
 * @module legal-actions/starting-site-selection
 *
 * Legal actions during the starting site selection step. Each player
 * selects one or two sites from their site deck to form initial companies.
 *
 * Uses the rules engine for per-site eligibility with human-readable reasons.
 */

import type { GameState, PlayerId, EvaluatedAction } from '@meccg/shared';
import { getAlignmentRules, evaluateAction, SITE_SELECTION_RULES } from '@meccg/shared';
import { logDetail } from './log.js';

export function startingSiteSelectionActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  if (state.phaseState.phase !== 'setup' || state.phaseState.setupStep.step !== 'starting-site-selection') return [];

  const playerIndex = state.players[0].id === playerId ? 0 : 1;
  const siteSelection = state.phaseState.setupStep.siteSelectionState[playerIndex];

  if (siteSelection.done) {
    logDetail(`Player already finished site selection`);
    return [];
  }

  const player = state.players[playerIndex];
  const { defaultStartingSites, maxStartingSites } = getAlignmentRules(player.alignment);
  const allowedDefIds = new Set(defaultStartingSites.map(id => id as string));
  const selectedSet = new Set(siteSelection.selectedSites.map(id => id as string));

  logDetail(`Selected ${siteSelection.selectedSites.length}/${maxStartingSites} sites, ${player.siteDeck.length} in site deck, ${allowedDefIds.size} allowed starting site def(s)`);

  const evaluated: EvaluatedAction[] = [];

  // Only offer sites if we haven't hit the max yet
  if (siteSelection.selectedSites.length < maxStartingSites) {
    for (const siteInstId of player.siteDeck) {
      const inst = state.instanceMap[siteInstId as string];
      if (!inst) {
        logDetail(`Skipping site instance ${siteInstId as string}: not found in instance map`);
        continue;
      }

      const siteDef = state.cardPool[inst.definitionId as string];
      const context = {
        card: {
          name: siteDef?.name ?? (inst.definitionId as string),
        },
        ctx: {
          isAllowedSite: allowedDefIds.has(inst.definitionId as string),
          alreadySelected: selectedSet.has(siteInstId as string),
        },
      };

      const action = { type: 'select-starting-site' as const, player: playerId, siteInstanceId: siteInstId };
      const result = evaluateAction(action, SITE_SELECTION_RULES, context);

      logDetail(`${context.card.name}: ${result.viable ? 'eligible' : result.reason}`);
      evaluated.push(result);
    }
  } else {
    logDetail(`Already at max starting sites (${maxStartingSites})`);
  }

  // Can pass if at least one site is selected
  if (siteSelection.selectedSites.length > 0) {
    evaluated.push({ action: { type: 'pass', player: playerId }, viable: true });
  } else {
    logDetail(`Cannot pass: no sites selected yet`);
  }

  return evaluated;
}
