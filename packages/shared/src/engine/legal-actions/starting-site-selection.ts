/**
 * @module legal-actions/starting-site-selection
 *
 * Legal actions during the starting site selection step. Each player
 * selects one or two sites from their site deck to form initial companies.
 *
 * Uses the rules engine for per-site eligibility with human-readable reasons.
 */

import type { GameState, PlayerId, EvaluatedAction } from '../../index.js';
import { getAlignmentRules } from '../../alignment-rules.js';
import { SITE_SELECTION_RULES } from '../../rules/definitions/starting-site-selection.js';
import { evaluateAction } from '../../rules/evaluator.js';
import { setupStepContext } from '../../state-utils.js';
import { SetupStep } from '../../types/state-phases.js';
import { logDetail } from './log.js';

export function startingSiteSelectionActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const ctx = setupStepContext(state, playerId, SetupStep.StartingSiteSelection);
  if (!ctx) return [];
  const { step: setupStep, playerIndex } = ctx;
  const siteSelection = setupStep.siteSelectionState[playerIndex];

  if (siteSelection.done) {
    logDetail(`Player already finished site selection`);
    return [];
  }

  const player = state.players[playerIndex];
  const { defaultStartingSites, maxStartingSites } = getAlignmentRules(player.alignment);
  const allowedDefIds = new Set(defaultStartingSites.map(id => id as string));
  const selectedSet = new Set(siteSelection.selectedSites.map(s => s.instanceId as string));

  logDetail(`Selected ${siteSelection.selectedSites.length}/${maxStartingSites} sites, ${player.siteDeck.length} in site deck, ${allowedDefIds.size} allowed starting site def(s)`);

  const evaluated: EvaluatedAction[] = [];

  // Only offer sites if we haven't hit the max yet
  if (siteSelection.selectedSites.length < maxStartingSites) {
    for (const siteCard of player.siteDeck) {
      const defIdStr = siteCard.definitionId as string;
      const siteDef = state.cardPool[defIdStr];
      const context = {
        card: {
          name: siteDef?.name ?? defIdStr,
        },
        ctx: {
          isAllowedSite: allowedDefIds.has(defIdStr),
          alreadySelected: selectedSet.has(siteCard.instanceId as string),
        },
      };

      const action = { type: 'select-starting-site' as const, player: playerId, siteInstanceId: siteCard.instanceId };
      const result = evaluateAction(action, SITE_SELECTION_RULES, context);

      logDetail(`${context.card.name}: ${result.viable ? 'eligible' : result.reason}`);
      evaluated.push(result);
    }
  } else {
    logDetail(`Already at max starting sites (${maxStartingSites})`);
  }

  // Can pass if at least one site is selected, or if a company already has a
  // starting site pre-placed by a Hidden Haven (wh-75) draft pairing — such a
  // player needs no manual selection to finish.
  const hasPrePlacedSite = player.companies.some(c => c.currentSite != null);
  if (siteSelection.selectedSites.length > 0 || hasPrePlacedSite) {
    evaluated.push({ action: { type: 'pass', player: playerId }, viable: true });
  } else {
    logDetail(`Cannot pass: no sites selected yet`);
  }

  return evaluated;
}
