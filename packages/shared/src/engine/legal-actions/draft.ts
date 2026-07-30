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

import type { GameState, PlayerId, EvaluatedAction, DraftPlayerState } from '../../index.js';
import { getAlignmentRules } from '../../alignment-rules.js';
import { GENERAL_INFLUENCE } from '../../constants.js';
import { CHARACTER_DRAFT_RULES, STAGE_RESOURCE_DRAFT_RULES } from '../../rules/definitions/character-draft.js';
import { evaluateAction } from '../../rules/evaluator.js';
import { setupStepContext } from '../../state-utils.js';
import { isCharacterCard, isHalfOrc, printedMind } from '../../types/cards.js';
import { Alignment, Race } from '../../types/common.js';
import { SetupStep } from '../../types/state-phases.js';
import { hasPlayFlag } from '../../effects/play-flags.js';
import { logDetail } from './log.js';
import { defById, isStageResourceCard, isAgentCharacter, hasRecruitmentVehicleEffect, hasAgentSummonsEffect, getCardEffects, matchesDefinition, countAgentSummonsEnablersForDraft, countDraftedAgents, stageResourceDuplicationLimitReached } from '../reducer-utils.js';
import { siteMatchesStageResourceTarget, unpairedSiteStageResources, blockingSiteStageResources } from '../stage-resource-sites.js';

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
  // One character pick per round: once this player has picked a (face-down)
  // character, they wait for the opponent to pick and the round to reveal before
  // doing anything else. (Stage resources are not face-down round picks — they
  // resolve immediately, CoE 1.9.F4 — so they never set currentPick.)
  if (draft.currentPick !== null) {
    logDetail(`Player already picked this round, waiting for opponent to reveal`);
    return [];
  }

  // CRF 22 ("Stage Resources"): "you must bring out your starting site when you
  // reveal Hidden Haven." While a revealed site-targeting Stage resource can
  // still be paired with an eligible Ruins & Lairs from the player's own site
  // deck, pairing it is the ONLY thing the draft offers — the draft cannot move
  // forward (no further character picks, no stop) until the site is chosen.
  if (blockingSiteStageResources(state, draft, state.players[playerIndex].siteDeck).length > 0) {
    logDetail(`Revealed Hidden Haven must be paired with its site before the draft can continue`);
    return stageResourcePairingTail(state, playerId, playerIndex, draft);
  }

  // A Stage resource drafted this round (and its site, if any, now paired) is
  // this player's completed action for the round — they add no character. They
  // wait for the opponent to act and the round to resolve; nothing else is
  // offered. (Round resolution clears the marker, reopening the next round.)
  if (draft.stageResourcePickedThisRound) {
    logDetail(`Stage resource drafted this round — waiting for opponent to resolve the round`);
    return [];
  }

  // A Stage resource never counts toward the starting company size (CoE 1.9.F4),
  // so reaching the company cap only stops further *character* picks — any
  // remaining Stage resource in the pool is still draftable below.
  const { maxStartingCompanySize } = getAlignmentRules(state.players[playerIndex].alignment);
  const atMaxCompany = draft.drafted.length >= maxStartingCompanySize;

  logDetail(`Draft round ${setupStep.round}, drafted ${draft.drafted.length}/${maxStartingCompanySize} characters${atMaxCompany ? ' (company full — only Stage resources remain draftable)' : ''}`);

  // Pre-compute context values shared across all candidates
  const opponentIndex = 1 - playerIndex;
  const opponentDrafted = new Set(
    setupStep.draftState[opponentIndex].drafted.map(card => card.definitionId as string),
  );
  const currentMind = draft.drafted.reduce((sum, card) => {
    const def = defById(state, card.definitionId);
    return sum + printedMind(def);
  }, 0);

  // Fallen-wizard draft gate (rules 1.42, 1.44): until an enabling Stage
  // resource (Thrall of the Voice) has been drafted, a Fallen-wizard may not
  // draft a character with mind > 5 or an agent character.
  //
  // Each recruitment-vehicle Stage resource enables exactly ONE such "gated"
  // character — Thrall's text reads "you may bring into play ONE character
  // (including a minion agent) with up to a 6 mind". So the gate is not a simple
  // on/off boolean: it stays lifted only while an unconsumed vehicle remains.
  // Count the vehicles drafted against the gated characters already drafted (a
  // character is gated if its mind > 5 or it is an agent — one consuming the
  // vehicle on either axis still counts once). The gate is active when no free
  // vehicle is left, so a single Thrall can never enable two gated characters.
  const isFallenWizard = state.players[playerIndex].alignment === Alignment.FallenWizard;
  const vehiclesDrafted = draft.draftedStageResources.filter(c =>
    hasRecruitmentVehicleEffect(defById(state, c.definitionId)),
  ).length;
  const gatedCharsDrafted = draft.drafted.filter(card => {
    const def = defById(state, card.definitionId);
    if (!isCharacterCard(def)) return false;
    return (def.mind !== null && def.mind > 5) || isAgentCharacter(def);
  }).length;
  const hasFreeVehicle = vehiclesDrafted > gatedCharsDrafted;
  const fwGateActive = isFallenWizard && !hasFreeVehicle;
  // Rule 1.41 (CoE 1.9.R2): a Ringwraith cannot draft agent characters unless an
  // enabling resource (Open to the Summons) has been drafted for the starting
  // company — see the agent-summons enabler count below. Without one the gate
  // stays active for the whole draft.
  const isRingwraith = state.players[playerIndex].alignment === Alignment.Ringwraith;

  // Open to the Summons (wh-46): each copy the player has **drafted** — from the
  // pool "in lieu of a minor item", into draftedStageResources — lets a
  // Ringwraith or Fallen-wizard draft ONE agent as a starting character (the copy
  // is placed with that agent at finalize). It must be drafted as any other card
  // in an earlier round before an agent may be drafted; a copy still sitting in
  // the pool does not lift the gate. The gate is lifted while fewer agents have
  // been drafted than enablers drafted.
  const agentSummonsEnablers = countAgentSummonsEnablersForDraft(state, draft);
  const agentsDrafted = countDraftedAgents(state, draft.drafted);
  const summonsAgentAllowed = agentsDrafted < agentSummonsEnablers;

  logDetail(`Current total mind: ${currentMind}/${GENERAL_INFLUENCE}, pool size: ${draft.pool.length}, FW draft gate ${fwGateActive ? 'active' : 'inactive'} (vehicles ${vehiclesDrafted}, gated chars drafted ${gatedCharsDrafted}), RW agent gate ${isRingwraith ? 'active' : 'inactive'}, agent-summons enablers ${agentSummonsEnablers} (agents drafted ${agentsDrafted}, one more agent ${summonsAgentAllowed ? 'allowed' : 'not allowed'})`);

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
          // Open to the Summons (wh-46): a Ringwraith may draft this one Stage
          // resource "in lieu of a minor item" (CoE 1.9.R2), unlike ordinary
          // Fallen-wizard-only Stage resources.
          isAgentSummonsEnabler: hasAgentSummonsEffect(charDef),
        },
        ctx: {
          isFallenWizard,
          isRingwraith,
          // "Cannot be duplicated by a given player" (Bad Company wh-63): a
          // player-scoped `duplication-limit` caps the copies one player may
          // draft, since every drafted copy ends up in their play area.
          duplicationLimitReached: stageResourceDuplicationLimitReached(state, draft, charCard.definitionId),
        },
      };
      const action = { type: 'draft-pick' as const, player: playerId, characterInstanceId: charCard.instanceId };
      const result = evaluateAction(action, STAGE_RESOURCE_DRAFT_RULES, stageContext);
      logDetail(`${stageContext.card.name} (Stage resource): ${result.viable ? 'eligible' : result.reason}`);
      evaluated.push(result);
      continue;
    }

    // Company full → no further character picks (Stage resources, handled above,
    // are exempt and remain offered).
    if (atMaxCompany) continue;

    const isChar = isCharacterCard(charDef);
    const mind = isChar ? charDef.mind : null;
    // Rule 1.43 (CoE 1.9.F2): a Fallen-wizard cannot reveal an Orc or Troll
    // character during the draft unless a drafted Stage resource specifically
    // allows it (e.g. Bad Company, wh-63: an `allow-character-play` effect
    // matching this candidate). Bad Company grants a standing permission
    // (unlike Thrall's one-character vehicle above), so any matching drafted
    // enabler lifts the gate for the rest of the draft.
    const isOrcOrTroll = isFallenWizard && isChar
      && (charDef.race === Race.Orc || charDef.race === Race.Troll || isHalfOrc(charDef));
    const fwOrcTrollPermitted = !isOrcOrTroll || draft.draftedStageResources.some(c =>
      getCardEffects(defById(state, c.definitionId)).some(
        eff => eff.type === 'allow-character-play' && matchesDefinition(charDef, eff.filter),
      ),
    );

    const context = {
      card: {
        name: charDef?.name ?? (charCard.instanceId as string),
        isCharacter: isChar,
        mind,
        unique: isChar ? charDef.unique : false,
        cannotBeStartingCharacter: isChar && hasPlayFlag(charDef, 'not-starting-character'),
        isAgent: isAgentCharacter(charDef),
        isOrcOrTroll,
      },
      ctx: {
        opponentHasCard: opponentDrafted.has(charCard.definitionId as string),
        currentMind,
        mindLimit: GENERAL_INFLUENCE,
        projectedMind: currentMind + (mind !== null ? mind : 0),
        fwMindGateActive: fwGateActive,
        fwAgentGateActive: fwGateActive && !summonsAgentAllowed,
        ringwraithAgentGateActive: isRingwraith && !summonsAgentAllowed,
        fwOrcTrollPermitted,
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
