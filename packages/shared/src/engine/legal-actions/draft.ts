/**
 * @module legal-actions/draft
 *
 * Legal actions during the character draft phase. Both players act
 * simultaneously, picking characters from their pool or stopping.
 *
 * Uses the rules engine to evaluate each pool character's eligibility,
 * producing both viable picks and non-viable picks with human-readable
 * reasons explaining why they can't be selected.
 */

import type { GameState, PlayerId, EvaluatedAction } from '../../index.js';
import { GENERAL_INFLUENCE, Alignment, getAlignmentRules, isCharacterCard, evaluateAction, CHARACTER_DRAFT_RULES, STAGE_RESOURCE_DRAFT_RULES, SetupStep, setupStepContext } from '../../index.js';
import { hasPlayFlag } from '../../effects/play-flags.js';
import { logDetail } from './log.js';
import { defById, isStageResourceCard, isAgentCharacter, hasRecruitmentVehicleEffect } from '../reducer-utils.js';
import { siteMatchesStageResourceTarget, unpairedSiteStageResources, blockingSiteStageResources } from '../stage-resource-sites.js';
import type { DraftPlayerState } from '../../index.js';

export function draftActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const ctx = setupStepContext(state, playerId, SetupStep.CharacterDraft);
  if (!ctx) return [];
  const { step: setupStep, playerIndex } = ctx;
  const draft = setupStep.draftState[playerIndex];

  // Phase-level guards — not per-card, stay imperative
  if (draft.stopped) {
    logDetail(`Player already stopped drafting`);
    return [];
  }
  if (draft.currentPick !== null) {
    logDetail(`Player already picked this round, waiting for opponent`);
    return [];
  }

  const { maxStartingCompanySize } = getAlignmentRules(state.players[playerIndex].alignment);
  if (draft.drafted.length >= maxStartingCompanySize) {
    logDetail(`Already at max starting company size (${maxStartingCompanySize})`);
    // No more character picks, but a site-targeting Stage resource (Hidden
    // Haven) may still need its site paired before the draft can end.
    return stageResourcePairingTail(state, playerId, playerIndex, draft);
  }

  logDetail(`Draft round ${setupStep.round}, drafted ${draft.drafted.length}/${maxStartingCompanySize} characters`);

  // Pre-compute context values shared across all candidates
  const opponentIndex = 1 - playerIndex;
  const opponentDrafted = new Set(
    setupStep.draftState[opponentIndex].drafted.map(card => card.definitionId as string),
  );
  const currentMind = draft.drafted.reduce((sum, card) => {
    const def = defById(state, card.definitionId);
    return sum + (isCharacterCard(def) && def.mind !== null ? def.mind : 0);
  }, 0);

  // Fallen-wizard draft gate (rules 1.42, 1.44): until an enabling Stage
  // resource (Thrall of the Voice) has been drafted, a Fallen-wizard may not
  // draft a character with mind > 5 or an agent character.
  const isFallenWizard = state.players[playerIndex].alignment === Alignment.FallenWizard;
  const enablerDrafted = draft.draftedStageResources.some(c => hasRecruitmentVehicleEffect(defById(state, c.definitionId)));
  const fwGateActive = isFallenWizard && !enablerDrafted;

  logDetail(`Current total mind: ${currentMind}/${GENERAL_INFLUENCE}, pool size: ${draft.pool.length}, FW draft gate ${fwGateActive ? 'active' : 'inactive'}`);

  const evaluated: EvaluatedAction[] = [];

  for (const charCard of draft.pool) {
    const charDef = defById(state, charCard.definitionId);

    // Fallen-wizard Stage resources (Thrall, Hidden Haven) share the pool with
    // characters but are drafted under their own (relaxed) rule set.
    if (isStageResourceCard(charDef)) {
      const stageContext = {
        card: {
          name: charDef?.name ?? (charCard.instanceId as string),
          isStageResource: true,
        },
        ctx: { isFallenWizard },
      };
      const action = { type: 'draft-pick' as const, player: playerId, characterInstanceId: charCard.instanceId };
      const result = evaluateAction(action, STAGE_RESOURCE_DRAFT_RULES, stageContext);
      logDetail(`${stageContext.card.name} (Stage resource): ${result.viable ? 'eligible' : result.reason}`);
      evaluated.push(result);
      continue;
    }

    const isChar = isCharacterCard(charDef);
    const mind = isChar ? charDef.mind : null;

    const context = {
      card: {
        name: charDef?.name ?? (charCard.instanceId as string),
        isCharacter: isChar,
        mind,
        unique: isChar ? charDef.unique : false,
        cannotBeStartingCharacter: isChar && hasPlayFlag(charDef, 'not-starting-character'),
        isAgent: isAgentCharacter(charDef),
      },
      ctx: {
        opponentHasCard: opponentDrafted.has(charCard.definitionId as string),
        currentMind,
        mindLimit: GENERAL_INFLUENCE,
        projectedMind: currentMind + (mind !== null ? mind : 0),
        fwMindGateActive: fwGateActive,
        fwAgentGateActive: fwGateActive,
      },
    };

    const action = { type: 'draft-pick' as const, player: playerId, characterInstanceId: charCard.instanceId };
    const result = evaluateAction(action, CHARACTER_DRAFT_RULES, context);

    logDetail(`${context.card.name}: ${result.viable ? 'eligible' : result.reason}`);
    evaluated.push(result);
  }

  // Site-targeting Stage resource pairing offers + the (possibly gated) stop.
  evaluated.push(...stageResourcePairingTail(state, playerId, playerIndex, draft));

  return evaluated;
}

/**
 * Pairing offers for any unpaired site-targeting Stage resource (Hidden Haven,
 * wh-75) plus the draft-stop action. Each unpaired resource gets one
 * `select-stage-resource-site` offer per eligible Ruins & Lairs in the player's
 * own site deck. While any remain unpaired, `draft-stop` is non-viable — CRF 22
 * requires the site to be chosen when Hidden Haven is revealed. Shared between
 * the normal end of the draft round and the at-max-company-size branch.
 */
function stageResourcePairingTail(
  state: GameState,
  playerId: PlayerId,
  playerIndex: number,
  draft: DraftPlayerState,
): EvaluatedAction[] {
  const evaluated: EvaluatedAction[] = [];
  const siteDeck = state.players[playerIndex].siteDeck;
  const unpaired = unpairedSiteStageResources(state, draft);
  for (const stageResource of unpaired) {
    const stageResourceDef = defById(state, stageResource.definitionId);
    const resName = stageResourceDef?.name ?? (stageResource.instanceId as string);
    logDetail(`${resName} needs a paired Ruins & Lairs site from the site deck`);
    for (const siteCard of siteDeck) {
      if (!siteMatchesStageResourceTarget(state, stageResourceDef, siteCard)) continue;
      const siteName = defById(state, siteCard.definitionId)?.name ?? (siteCard.instanceId as string);
      logDetail(`  ${resName} can pair with site ${siteName}`);
      evaluated.push({
        action: {
          type: 'select-stage-resource-site',
          player: playerId,
          stageResourceInstanceId: stageResource.instanceId,
          siteInstanceId: siteCard.instanceId,
        },
        viable: true,
      });
    }
  }

  // Can stop — but not while a Hidden Haven that CAN be paired (the site deck
  // holds an eligible Ruins & Lairs) is still unpaired. If no eligible site
  // exists, the requirement cannot be met, so stopping is allowed (the card
  // falls to hand at finalize).
  const blocking = blockingSiteStageResources(state, draft, siteDeck);
  if (blocking.length > 0) {
    logDetail(`Cannot stop: ${blocking.length} Stage resource(s) still need a paired site`);
    evaluated.push({
      action: { type: 'draft-stop', player: playerId },
      viable: false,
      reason: 'You must choose a site for your Hidden Haven before stopping',
    });
  } else {
    evaluated.push({ action: { type: 'draft-stop', player: playerId }, viable: true });
  }

  return evaluated;
}
