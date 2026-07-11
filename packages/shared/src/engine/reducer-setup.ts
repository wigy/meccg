/**
 * @module reducer-setup
 *
 * Setup phase handlers for the game reducer. Covers character draft,
 * item draft, character deck draft, starting site selection,
 * character placement, deck shuffle, initial draw, and initiative roll.
 */

import type { GameState, DraftPlayerState, ItemDraftPlayerState, CharacterDeckDraftPlayerState, SetupStepState, CardInstance, CardInstanceId, GameAction, TwoDiceSix, SiteSelectionPlayerState } from '../index.js';
import type { CardInPlay } from '../types/state-cards.js';
import { getAlignmentRules } from '../alignment-rules.js';
import { shuffle } from '../rng.js';
import { MAX_STARTING_ITEMS } from '../rules/definitions/item-draft.js';
import { getPlayerIndex } from '../state-utils.js';
import { isCharacterCard } from '../types/cards.js';
import { hasPlayFlag } from '../effects/play-flags.js';
import { Alignment, CardStatus } from '../types/common.js';
import { Phase, SetupStep } from '../types/state-phases.js';
import { logDetail } from './legal-actions/log.js';
import { applyDraftResults, transitionAfterItemDraft, enterSiteSelection, startFirstTurn } from './init.js';
import type { ReducerResult } from './reducer-utils.js';
import { roll2d6, diceRollEffect, clonePlayers, cleanupEmptyCompanies, nextCompanyId, updatePlayer, updateCharacter, wrongActionType, findById, defById, isStageResourceCard, isAgentCharacter, hasRecruitmentVehicleEffect, hasAgentSummonsEffect, countStartingMinorItems, countAgentSummonsEnablersInDeck, countDraftedAgents } from './reducer-utils.js';
import { stageResourceNeedsSite, siteMatchesStageResourceTarget, blockingSiteStageResources } from './stage-resource-sites.js';
import { sameManifestationEntity } from './manifestations.js';


export function handleSetup(state: GameState, action: GameAction): ReducerResult {
  if (state.phaseState.phase !== Phase.Setup) {
    return { state, error: 'Not in setup phase' };
  }
  let result: ReducerResult;
  switch (state.phaseState.setupStep.step) {
    case SetupStep.CharacterDraft:
      result = handleCharacterDraft(state, action, state.phaseState.setupStep); break;
    case SetupStep.ItemDraft:
      result = handleItemDraft(state, action, state.phaseState.setupStep); break;
    case SetupStep.CharacterDeckDraft:
      result = handleCharacterDeckDraft(state, action, state.phaseState.setupStep); break;
    case SetupStep.StartingSiteSelection:
      result = handleStartingSiteSelection(state, action, state.phaseState.setupStep); break;
    case SetupStep.CharacterPlacement:
      result = handleCharacterPlacement(state, action, state.phaseState.setupStep); break;
    case SetupStep.DeckShuffle:
      result = handleDeckShuffle(state, action, state.phaseState.setupStep); break;
    case SetupStep.InitialDraw:
      result = handleInitialDraw(state, action, state.phaseState.setupStep); break;
    case SetupStep.InitiativeRoll:
      result = handleInitiativeRoll(state, action, state.phaseState.setupStep); break;
    default:
      return { state, error: 'Unknown setup step' };
  }
  // Whenever a setup action lands in the starting-site-selection step, auto-skip
  // it for any player whose starting site was fixed by a Hidden Haven (wh-75)
  // draft pairing. Applied here (once, centrally) so every path that reaches the
  // step is covered — including the draft-finalize-with-no-items shortcut in
  // applyDraftResults. Idempotent and a no-op outside the step.
  if (result.error) return result;
  return { ...result, state: applySiteSelectionAutoSkip(result.state) };
}

/** Helper to wrap a setup step state into a full phase state. */


function setupPhase(setupStep: SetupStepState): { readonly phase: Phase.Setup; readonly setupStep: SetupStepState } {
  return { phase: Phase.Setup, setupStep };
}

/**
 * Whether `draft` has completed its action for the current draft round. A round
 * resolves once BOTH players have completed theirs. A player completes a round
 * by: stopping, making a face-down character pick, or drafting a Stage resource
 * this round (CoE 1.9.F4 — the user-chosen model where a Stage resource counts
 * as that round's action, no character pick forced). A Stage resource that still
 * needs its site brought out (Hidden Haven, wh-75) is NOT complete until the
 * site is paired (CRF 22), so the round waits for the pairing.
 */
function completedRoundAction(state: GameState, draft: DraftPlayerState, playerIndex: number): boolean {
  if (draft.stopped) return true;
  if (draft.currentPick !== null) return true;
  if (draft.stageResourcePickedThisRound) {
    return blockingSiteStageResources(state, draft, state.players[playerIndex].siteDeck).length === 0;
  }
  return false;
}

// ---- Character draft handler ----

/**
 * Handles actions during the simultaneous character draft step.
 */


/**
 * Handles actions during the simultaneous character draft step.
 */
function handleCharacterDraft(
  state: GameState,
  action: GameAction,
  draft: SetupStepState & { step: SetupStep.CharacterDraft },
): ReducerResult {
  const playerIndex = getPlayerIndex(state, action.player);
  const playerDraft = draft.draftState[playerIndex];

  switch (action.type) {
    case 'select-stage-resource-site': {
      // Pair a drafted site-targeting Stage resource (Hidden Haven, wh-75) with
      // a Ruins & Lairs site from the player's own site deck. The site stays in
      // the deck for now; the pairing is resolved at draft finalize.
      const player = state.players[playerIndex];
      const stageResource = findById(playerDraft.draftedStageResources, action.stageResourceInstanceId);
      if (!stageResource) {
        return { state, error: 'Stage resource not drafted' };
      }
      const stageResourceDef = defById(state, stageResource.definitionId);
      if (!stageResourceNeedsSite(stageResourceDef)) {
        return { state, error: 'This Stage resource does not take a site' };
      }
      const siteCard = findById(player.siteDeck, action.siteInstanceId);
      if (!siteCard) {
        return { state, error: 'Site is not in your site deck' };
      }
      if (!siteMatchesStageResourceTarget(state, stageResourceDef, siteCard)) {
        return { state, error: 'Site is not a valid Ruins & Lairs for Hidden Haven' };
      }
      const existingPairings = playerDraft.stageResourceSites ?? [];
      if (existingPairings.some(p => p.stageResourceInstanceId === action.stageResourceInstanceId
        || p.siteInstanceId === action.siteInstanceId)) {
        return { state, error: 'Already paired' };
      }
      logDetail(`${stageResourceDef?.name ?? (stageResource.definitionId as string)} paired with site ${defById(state, siteCard.definitionId)?.name ?? (siteCard.definitionId as string)}`);
      const newDraftState = [...draft.draftState] as [DraftPlayerState, DraftPlayerState];
      newDraftState[playerIndex] = {
        ...playerDraft,
        stageResourceSites: [
          ...existingPairings,
          { stageResourceInstanceId: action.stageResourceInstanceId, siteInstanceId: action.siteInstanceId },
        ],
      };
      // Bringing out the site completes the Stage-resource player's round action
      // (the card was their pick this round). If the opponent has also completed
      // their action, resolve the round now — the game proceeds without forcing
      // this player to also draft a character (CoE 1.9.F4, user-chosen model).
      const otherIdx = 1 - playerIndex;
      if (completedRoundAction(state, newDraftState[playerIndex], playerIndex)
        && completedRoundAction(state, newDraftState[otherIdx], otherIdx)) {
        return resolveDraftRound(state, newDraftState, draft.round, draft.setAside);
      }
      return {
        state: {
          ...state,
          phaseState: setupPhase({ ...draft, draftState: newDraftState }),
        },
      };
    }

    case 'draft-pick': {
      if (playerDraft.stopped) {
        return { state, error: 'You have already stopped drafting' };
      }
      // One character pick per round: a character is picked face-down and
      // revealed simultaneously with the opponent's pick when the round resolves.
      // (Fallen-wizard Stage resources are NOT face-down round picks — see the
      // immediate-resolution branch below — so this guard only ever holds a
      // pending character pick.)
      if (playerDraft.currentPick !== null) {
        return { state, error: 'Waiting for opponent to pick' };
      }
      // CRF 22: a revealed Hidden Haven (wh-75) must have its site brought out
      // when it is revealed — the draft cannot move forward with another pick
      // while one that can still be paired (the site deck holds an eligible
      // Ruins & Lairs) is unpaired. (Mirrors the legal-action gate in
      // `legal-actions/draft.ts`; the reducer is the authority.)
      if (blockingSiteStageResources(state, playerDraft, state.players[playerIndex].siteDeck).length > 0) {
        return { state, error: 'You must choose a site for your Hidden Haven before drafting further' };
      }
      // Drafting a Stage resource is this player's whole action for the round
      // (user-chosen model): once taken (and its site paired), the round resolves
      // and they add no character. So no further pick is allowed this round.
      if (playerDraft.stageResourcePickedThisRound) {
        return { state, error: 'You have already drafted a Stage resource this round' };
      }
      const poolCard = findById(playerDraft.pool, action.characterInstanceId);
      if (!poolCard) {
        return { state, error: 'Character not in your draft pool' };
      }
      // Resolve definition from instance
      const charDefId = poolCard.definitionId;
      const charDef = charDefId ? defById(state, charDefId) : undefined;

      const isFallenWizard = state.players[playerIndex].alignment === Alignment.FallenWizard;

      if (isStageResourceCard(charDef)) {
        // Stage resources are Fallen-wizard-only (CoE 1.9.F4). Drafting one is
        // this player's action for the round: it resolves the round without
        // forcing a separate character pick (user-chosen model). The character-
        // only gates (mind > 5, agent, mind limit, 5-character cap) do not apply,
        // and an enabling Stage resource (Thrall) becomes active at once, so a
        // character it enables can be drafted in a later round. A Stage resource
        // needing a site (Hidden Haven) does not complete the round until its
        // site is brought out — resolution is deferred to select-stage-resource-site.
        if (!isFallenWizard) {
          return { state, error: 'Only a Fallen-wizard may draft a Stage resource' };
        }
        logDetail(`${charDef?.name ?? (charDefId as string)} drafted as a Stage resource (completes this player's round action)`);
        const newStageDraftState = [...draft.draftState] as [DraftPlayerState, DraftPlayerState];
        newStageDraftState[playerIndex] = {
          ...playerDraft,
          draftedStageResources: [...playerDraft.draftedStageResources, poolCard],
          pool: playerDraft.pool.filter(c => c.instanceId !== action.characterInstanceId),
          stageResourcePickedThisRound: true,
        };
        // Resolve the round now if this Stage resource needs no site pairing
        // (Thrall) and the opponent has completed their action; otherwise wait
        // (for the Hidden Haven site pairing, or for the opponent).
        const otherIdx = 1 - playerIndex;
        if (completedRoundAction(state, newStageDraftState[playerIndex], playerIndex)
          && completedRoundAction(state, newStageDraftState[otherIdx], otherIdx)) {
          return resolveDraftRound(state, newStageDraftState, draft.round, draft.setAside);
        }
        return {
          state: {
            ...state,
            phaseState: setupPhase({ ...draft, draftState: newStageDraftState }),
          },
        };
      } else {
        if (!isCharacterCard(charDef)) {
          return { state, error: 'Invalid character' };
        }

        // Pure "Hazard Agent" cards (Lobelia dm-28, My Precious dm-29) are
        // deploy-only — never drafted or played as company characters by any player.
        if (hasPlayFlag(charDef, 'hazard-agent-only')) {
          logDetail(`${charDef.name} blocked: a hazard-only agent cannot be drafted as a character`);
          return { state, error: 'A hazard agent cannot be drafted as a character' };
        }

        // Open to the Summons (wh-46): each copy held in the play deck lets a
        // Ringwraith or Fallen-wizard draft ONE agent as a starting character
        // (rules 1.41/1.42). The gate is lifted while fewer agents have been
        // drafted than enablers held.
        const agentSummonsEnablers = countAgentSummonsEnablersInDeck(state, state.players[playerIndex]);
        const agentsDrafted = countDraftedAgents(state, playerDraft.drafted);
        const summonsAgentAllowed = agentsDrafted < agentSummonsEnablers;

        // Fallen-wizard draft gate (rules 1.42, 1.44): without an enabling Stage
        // resource (Thrall), a Fallen-wizard cannot draft a mind > 5 or agent
        // character. The enabler must already be revealed (in draftedStageResources).
        const enablerDrafted = playerDraft.draftedStageResources.some(c => hasRecruitmentVehicleEffect(defById(state, c.definitionId)));
        if (isFallenWizard && !enablerDrafted) {
          if (charDef.mind !== null && charDef.mind > 5) {
            logDetail(`${charDef.name} (mind ${charDef.mind}) blocked: Fallen-wizard mind > 5 requires an enabling Stage resource`);
            return { state, error: 'A Fallen-wizard cannot draft a character with mind > 5 without an enabling Stage resource' };
          }
          if (isAgentCharacter(charDef) && !summonsAgentAllowed) {
            logDetail(`${charDef.name} (agent) blocked: Fallen-wizard agent draft requires an enabling Stage resource or Open to the Summons`);
            return { state, error: 'A Fallen-wizard cannot draft an agent character without an enabling Stage resource' };
          }
        }

        // Ringwraith draft gate (rule 1.41, CoE 1.9.R2): a Ringwraith cannot draft
        // agent characters unless an enabling resource (Open to the Summons,
        // wh-46) in the play deck lifts the gate for one agent.
        if (state.players[playerIndex].alignment === Alignment.Ringwraith && isAgentCharacter(charDef) && !summonsAgentAllowed) {
          logDetail(`${charDef.name} (agent) blocked: a Ringwraith cannot draft agent characters`);
          return { state, error: 'A Ringwraith cannot draft an agent character during the character draft' };
        }

        const currentMind = playerDraft.drafted.reduce((sum, card) => {
          const def = defById(state, card.definitionId);
          return sum + (isCharacterCard(def) && def.mind !== null ? def.mind : 0);
        }, 0);
        if (charDef.mind !== null && currentMind + charDef.mind > 20) {
          return { state, error: 'Would exceed mind limit of 20' };
        }
        const { maxStartingCompanySize } = getAlignmentRules(state.players[playerIndex].alignment);
        if (playerDraft.drafted.length >= maxStartingCompanySize) {
          return { state, error: `Already have ${maxStartingCompanySize} starting characters` };
        }
      }

      // Set the (face-down) pick
      const newDraftState = [...draft.draftState] as [DraftPlayerState, DraftPlayerState];
      newDraftState[playerIndex] = {
        ...playerDraft,
        currentPick: poolCard,
        pool: playerDraft.pool.filter(c => c.instanceId !== action.characterInstanceId),
      };

      // Resolve the round once the opponent has also completed their action
      // (a pick, a stop, or a fully-paired Stage resource this round).
      const otherIndex = 1 - playerIndex;
      const otherDraft = newDraftState[otherIndex];
      if (completedRoundAction(state, otherDraft, otherIndex)) {
        return resolveDraftRound(state, newDraftState, draft.round, draft.setAside);
      }

      // Wait for other player
      return {
        state: {
          ...state,
          phaseState: setupPhase({ ...draft, draftState: newDraftState }),
        },
      };
    }

    case 'draft-stop': {
      if (playerDraft.stopped) {
        return { state, error: 'You have already stopped drafting' };
      }
      // CRF 22: a revealed Hidden Haven (wh-75) must have its site brought out —
      // the player cannot stop drafting while one that can still be paired (the
      // site deck holds an eligible Ruins & Lairs) is unpaired.
      if (blockingSiteStageResources(state, playerDraft, state.players[playerIndex].siteDeck).length > 0) {
        return { state, error: 'You must choose a site for your Hidden Haven before stopping' };
      }

      const newDraftState = [...draft.draftState] as [DraftPlayerState, DraftPlayerState];
      newDraftState[playerIndex] = { ...playerDraft, stopped: true };

      // If both stopped, end draft
      const otherIndex = 1 - playerIndex;
      if (newDraftState[otherIndex].stopped) {
        return finalizeDraft(state, newDraftState, draft.setAside);
      }

      // If the other player has already completed their action (a pending pick
      // or a fully-paired Stage resource this round), resolve the round.
      if (completedRoundAction(state, newDraftState[otherIndex], otherIndex)) {
        return resolveDraftRound(state, newDraftState, draft.round, draft.setAside);
      }

      return {
        state: {
          ...state,
          phaseState: setupPhase({ ...draft, draftState: newDraftState }),
        },
      };
    }

    default:
      return { state, error: `Unexpected action in draft: ${action.type}` };
  }
}

/**
 * Resolves a completed draft round after both players have submitted picks.
 *
 * If both players picked the same character, it is set aside and neither
 * receives it. Otherwise each player adds their pick to their drafted list.
 * Players who hit the 5-character limit, exhaust their pool, or reach 20
 * total mind are auto-stopped. If both are stopped, the draft is finalised.
 */


/**
 * Resolves a completed draft round after both players have submitted picks.
 *
 * If both players picked the same character, it is set aside and neither
 * receives it. Otherwise each player adds their pick to their drafted list.
 * Players who hit the 5-character limit, exhaust their pool, or reach 20
 * total mind are auto-stopped. If both are stopped, the draft is finalised.
 */
function resolveDraftRound(
  state: GameState,
  draftState: [DraftPlayerState, DraftPlayerState],
  round: number,
  setAside: readonly [readonly CardInstance[], readonly CardInstance[]],
): ReducerResult {
  const pick0 = draftState[0].currentPick;
  const pick1 = draftState[1].currentPick;
  const newSetAside: [CardInstance[], CardInstance[]] = [[...setAside[0]], [...setAside[1]]];

  // Resolve each player's pick. Clear the per-round Stage-resource marker too:
  // a player whose action this round was a Stage resource has now had it counted
  // (it lives in draftedStageResources) and adds no character below.
  const newDraft: [DraftPlayerState, DraftPlayerState] = [
    { ...draftState[0], currentPick: null, stageResourcePickedThisRound: false },
    { ...draftState[1], currentPick: null, stageResourcePickedThisRound: false },
  ];

  // A face-down round pick is always a character: Fallen-wizard Stage resources
  // resolve immediately when drafted (CoE 1.9.F4) and never occupy a currentPick
  // slot. Identical character reveals collide and are set aside; otherwise each
  // player adds their revealed character to their starting company.
  const def0 = pick0 !== null ? pick0.definitionId : null;
  const def1 = pick1 !== null ? pick1.definitionId : null;

  // Rule 1.9: "Players set aside duplicated unique characters with the same
  // name or manifestation." Beyond an identical card (same definition), a
  // collision also occurs when the two picks are distinct manifestations of
  // the same entity (e.g. Strider ba-1 vs Aragorn II tw-120, linked by
  // `manifestId`) or same-named unique reprints.
  const def0Card = def0 !== null ? defById(state, def0) : undefined;
  const def1Card = def1 !== null ? defById(state, def1) : undefined;
  const entityCollision = def0 !== def1 && def0Card !== undefined && def1Card !== undefined
    && (sameManifestationEntity(def0Card, def1Card)
      || (isCharacterCard(def0Card) && isCharacterCard(def1Card)
        && def0Card.name === def1Card.name && def0Card.unique === true && def1Card.unique === true));

  if (pick0 !== null && pick1 !== null && (def0 === def1 || entityCollision)) {
    // Duplicate! Neither gets it — set aside both instances (one per player, so no instance ID is shared).
    // Remove each player's collided definition from their pool. (For an
    // identical-card collision the two definitions coincide; for a
    // manifestation collision each player only loses the card they revealed —
    // the entity may still be drafted later since it is no longer duplicated.)
    if (entityCollision) {
      logDetail(`Character draft collision: ${def0Card && 'name' in def0Card ? def0Card.name : String(def0)} and ${def1Card && 'name' in def1Card ? def1Card.name : String(def1)} are manifestations of the same entity (rule 1.9) — both set aside`);
    }
    newSetAside[0].push(pick0);
    newSetAside[1].push(pick1);
    newDraft[0] = { ...newDraft[0], pool: newDraft[0].pool.filter(c => c.definitionId !== def0) };
    newDraft[1] = { ...newDraft[1], pool: newDraft[1].pool.filter(c => c.definitionId !== def1) };
  } else {
    if (pick0 !== null) newDraft[0] = { ...newDraft[0], drafted: [...newDraft[0].drafted, pick0] };
    if (pick1 !== null) newDraft[1] = { ...newDraft[1], drafted: [...newDraft[1].drafted, pick1] };
  }

  // Auto-stop players who hit limits — but never while a site-targeting Stage
  // resource (Hidden Haven, wh-75) still needs its site paired (CRF 22: the site
  // must be brought out when the card is revealed). Such a player keeps the
  // draft open so they are still offered (and required to take) the pairing.
  for (let i = 0; i < 2; i++) {
    if (!newDraft[i].stopped) {
      if (blockingSiteStageResources(state, newDraft[i], state.players[i].siteDeck).length > 0) {
        logDetail(`Player ${i} not auto-stopped: a Stage resource still needs a paired site`);
        continue;
      }
      const mind = newDraft[i].drafted.reduce((sum, card) => {
        const def = defById(state, card.definitionId);
        return sum + (isCharacterCard(def) && def.mind !== null ? def.mind : 0);
      }, 0);
      const { maxStartingCompanySize: max } = getAlignmentRules(state.players[i].alignment);
      if (newDraft[i].drafted.length >= max || newDraft[i].pool.length === 0 || mind >= 20) {
        newDraft[i] = { ...newDraft[i], stopped: true };
      }
    }
  }

  // If both stopped, finalize
  if (newDraft[0].stopped && newDraft[1].stopped) {
    return finalizeDraft(state, newDraft, newSetAside);
  }

  return {
    state: {
      ...state,
      phaseState: {
        phase: Phase.Setup,
        setupStep: {
          step: SetupStep.CharacterDraft,
          round: round + 1,
          draftState: newDraft,
          setAside: newSetAside,
        },
      },
    },
  };
}

/**
 * Delegates to {@link applyDraftResults} to place drafted characters on the
 * board and transition to item draft. Set-aside characters from draft
 * collisions are returned to both players' remaining pools.
 */


/**
 * Delegates to {@link applyDraftResults} to place drafted characters on the
 * board and transition to item draft. Set-aside characters from draft
 * collisions are returned to both players' remaining pools.
 */
function finalizeDraft(
  state: GameState,
  draftState: readonly [DraftPlayerState, DraftPlayerState],
  setAside: readonly [readonly CardInstance[], readonly CardInstance[]],
): ReducerResult {
  return {
    state: applyDraftResults(state, draftState, setAside),
  };
}

// ---- Item draft handler ----

/**
 * Handles the item draft phase where players assign their starting minor
 * items to characters in their starting company. Both players act
 * simultaneously. When all items are assigned, the game transitions to
 * the first Untap phase.
 */


/**
 * Handles the item draft phase where players assign their starting minor
 * items to characters in their starting company. Both players act
 * simultaneously. When all items are assigned, the game transitions to
 * the first Untap phase.
 */
function handleItemDraft(
  state: GameState,
  action: GameAction,
  stepState: SetupStepState & { step: SetupStep.ItemDraft },
): ReducerResult {
  const playerIndex = getPlayerIndex(state, action.player);
  const itemDraft = stepState.itemDraftState[playerIndex];

  if (itemDraft.done) {
    return { state, error: 'You have already finished item assignment' };
  }

  // Pass: skip remaining item assignments
  if (action.type === 'pass') {
    const newItemDraftState = [...stepState.itemDraftState] as [ItemDraftPlayerState, ItemDraftPlayerState];
    newItemDraftState[playerIndex] = { unassignedItems: [], done: true };

    if (newItemDraftState[0].done && newItemDraftState[1].done) {
      return {
        state: transitionAfterItemDraft(state, stepState.remainingPool),
      };
    }

    return {
      state: {
        ...state,
        phaseState: setupPhase({ ...stepState, itemDraftState: newItemDraftState }),
      },
    };
  }

  // Only true minor items count toward the two-item budget; Stage resources
  // placed with a character (e.g. Thrall of the Voice) do not (CoE 1.7.F1 /
  // 1.9.F4 — see countStartingMinorItems).
  const player = state.players[playerIndex];
  const assignedCount = countStartingMinorItems(state, player);

  // Handle place-starting-company-event
  if (action.type === 'place-starting-company-event') {
    if (assignedCount >= MAX_STARTING_ITEMS) {
      return { state, error: `Already at starting item limit (${assignedCount}/${MAX_STARTING_ITEMS})` };
    }
    const deckCard = player.playDeck.find(c => c.definitionId === action.cardDefId);
    if (!deckCard) {
      return { state, error: 'Card not found in play deck' };
    }
    const targetCompany = player.companies.find(c => c.id === action.companyId);
    if (!targetCompany) {
      return { state, error: 'Company not found' };
    }
    const newPlayDeck = player.playDeck.filter(c => c.instanceId !== deckCard.instanceId);
    const newItemDraft: ItemDraftPlayerState = {
      ...itemDraft,
      startingEventsPlaced: (itemDraft.startingEventsPlaced ?? 0) + 1,
    };
    const newItemDraftState = [...stepState.itemDraftState] as [ItemDraftPlayerState, ItemDraftPlayerState];
    newItemDraftState[playerIndex] = newItemDraft;

    // Recruitment vehicle (Thrall of the Voice, wh-82): "place this card with
    // the character" — when a target starting character is named, attach the
    // event to that character (so its "-1 to his mind" applies and such a
    // character may be in the starting company) rather than binding it to the
    // company at large.
    const eventDef = defById(state, deckCard.definitionId);
    const isRecruitmentVehicle = (eventDef as { effects?: readonly { type: string }[] } | undefined)?.effects?.some(
      e => e.type === 'recruitment-vehicle',
    ) ?? false;
    const targetCharId = action.targetCharacterInstanceId;
    const targetChar = targetCharId ? player.characters[targetCharId] : undefined;
    // Open to the Summons (wh-46) is an agent-summons vehicle: "place this card
    // with the agent" — it may only be placed with an agent character.
    if (isRecruitmentVehicle && targetChar && hasAgentSummonsEffect(eventDef)
      && !isAgentCharacter(defById(state, targetChar.definitionId))) {
      return { state, error: 'Open to the Summons may only be placed with an agent character' };
    }

    const stateWithCard = (isRecruitmentVehicle && targetChar)
      ? updatePlayer(state, playerIndex, p => ({
          ...p,
          playDeck: newPlayDeck,
          characters: {
            ...p.characters,
            [targetCharId as string]: {
              ...targetChar,
              items: [
                ...targetChar.items,
                { instanceId: deckCard.instanceId, definitionId: deckCard.definitionId, status: CardStatus.Untapped },
              ],
            },
          },
        }))
      : updatePlayer(state, playerIndex, p => ({
          ...p,
          playDeck: newPlayDeck,
          cardsInPlay: [...p.cardsInPlay, {
            instanceId: deckCard.instanceId,
            definitionId: deckCard.definitionId,
            status: CardStatus.Untapped,
            companyId: action.companyId,
          } as CardInPlay],
        }));
    if (newItemDraftState[0].done && newItemDraftState[1].done) {
      return { state: transitionAfterItemDraft(stateWithCard, stepState.remainingPool) };
    }
    return {
      state: {
        ...stateWithCard,
        phaseState: setupPhase({ ...stepState, itemDraftState: newItemDraftState }),
      },
    };
  }

  if (action.type !== 'assign-starting-item') {
    return wrongActionType(state, action, 'assign-starting-item', 'item draft');
  }

  // Enforce starting item limit
  if (assignedCount >= MAX_STARTING_ITEMS) {
    return { state, error: `Already at starting item limit (${assignedCount}/${MAX_STARTING_ITEMS})` };
  }

  // Resolve definition ID to the first matching unassigned instance
  const itemCard = itemDraft.unassignedItems.find(card => card.definitionId === action.itemDefId);
  if (!itemCard) {
    return { state, error: 'Item is not in your unassigned items' };
  }
  const itemInstanceId = itemCard.instanceId;

  // Validate character belongs to this player's company
  const allCharIds = player.companies.flatMap(c => c.characters);
  if (!allCharIds.includes(action.characterInstanceId)) {
    return { state, error: 'Character is not in your starting company' };
  }
  const charKey = action.characterInstanceId;
  const existingChar = player.characters[charKey];
  if (!existingChar) {
    return { state, error: 'Character not found' };
  }

  // Remove item from unassigned list
  const newUnassigned = itemDraft.unassignedItems.filter(c => c.instanceId !== itemInstanceId);
  const newItemDraft: ItemDraftPlayerState = {
    unassignedItems: newUnassigned,
    done: newUnassigned.length === 0,
  };

  const newItemDraftState = [...stepState.itemDraftState] as [ItemDraftPlayerState, ItemDraftPlayerState];
  newItemDraftState[playerIndex] = newItemDraft;

  const stateWithChar = updatePlayer(state, playerIndex, p => updateCharacter(p, charKey, c => ({
    ...c,
    items: [...c.items, { instanceId: itemInstanceId, definitionId: itemCard.definitionId, status: CardStatus.Untapped }],
  })));

  // If both players are done, transition to character deck draft (or Untap)
  if (newItemDraftState[0].done && newItemDraftState[1].done) {
    return {
      state: transitionAfterItemDraft(
        stateWithChar,
        stepState.remainingPool,
      ),
    };
  }

  return {
    state: {
      ...stateWithChar,
      phaseState: setupPhase({ ...stepState, itemDraftState: newItemDraftState }),
    },
  };
}

// ---- Character deck draft handler ----

/**
 * Handles the character deck draft phase where players add remaining pool
 * characters to their play deck (max 10 non-avatar characters).
 * Both players act simultaneously. After finishing, each must shuffle
 * their play deck before the game transitions to Untap (turn 1).
 */


/**
 * Handles the character deck draft phase where players add remaining pool
 * characters to their play deck (max 10 non-avatar characters).
 * Both players act simultaneously. After finishing, each must shuffle
 * their play deck before the game transitions to Untap (turn 1).
 */
function handleCharacterDeckDraft(
  state: GameState,
  action: GameAction,
  stepState: SetupStepState & { step: SetupStep.CharacterDeckDraft },
): ReducerResult {
  const playerIndex = getPlayerIndex(state, action.player);
  const deckDraft = stepState.deckDraftState[playerIndex];

  if (deckDraft.done) {
    return { state, error: 'You have already finished adding characters' };
  }

  // Pass: done adding characters
  if (action.type === 'pass') {
    const newDeckDraftState = [...stepState.deckDraftState] as [CharacterDeckDraftPlayerState, CharacterDeckDraftPlayerState];
    newDeckDraftState[playerIndex] = { remainingPool: [], done: true };

    // Both done → enter site selection
    if (newDeckDraftState[0].done && newDeckDraftState[1].done) {
      return { state: enterSiteSelection(state) };
    }

    return {
      state: {
        ...state,
        phaseState: setupPhase({ ...stepState, deckDraftState: newDeckDraftState }),
      },
    };
  }

  if (action.type !== 'add-character-to-deck') {
    return wrongActionType(state, action, 'add-character-to-deck', 'character deck draft');
  }

  // Validate character is in remaining pool
  const poolCard = findById(deckDraft.remainingPool, action.characterInstanceId);
  if (!poolCard) {
    return { state, error: 'Character is not in your remaining pool' };
  }

  // Resolve definition from draft instance
  const draftDefId = poolCard.definitionId;
  const def = draftDefId ? defById(state, draftDefId) : undefined;

  // Validate non-avatar limit
  if (isCharacterCard(def) && def.mind !== null) {
    let nonAvatarCount = 0;
    for (const card of state.players[playerIndex].playDeck) {
      const d = defById(state, card.definitionId);
      if (isCharacterCard(d) && d.mind !== null) nonAvatarCount++;
    }
    if (nonAvatarCount >= 10) {
      return { state, error: 'Already have 10 non-avatar characters in play deck' };
    }
  }

  // Transfer the existing draft-pool instance directly into the play deck — never re-mint.
  // Instance IDs must remain stable for the lifetime of the game.
  if (!draftDefId) return { state, error: 'Invalid character instance' };

  // Remove from remaining pool
  const newPool = deckDraft.remainingPool.filter(c => c.instanceId !== action.characterInstanceId);
  const newDeckDraftState = [...stepState.deckDraftState] as [CharacterDeckDraftPlayerState, CharacterDeckDraftPlayerState];
  newDeckDraftState[playerIndex] = {
    remainingPool: newPool,
    done: newPool.length === 0,
  };

  const newState = {
    ...updatePlayer(state, playerIndex, p => ({ ...p, playDeck: [...p.playDeck, poolCard] })),
    phaseState: setupPhase({ ...stepState, deckDraftState: newDeckDraftState }),
  };

  // Both done → enter site selection (pool exhausted for both players)
  if (newDeckDraftState[0].done && newDeckDraftState[1].done) {
    return { state: enterSiteSelection(newState) };
  }

  return { state: newState };
}

// ---- Starting site selection handler ----


/**
 * Handles the starting site selection step. Each player selects one or two
 * sites from their site deck and forms empty companies at those sites.
 */


/**
 * Handles the starting site selection step. Each player selects one or two
 * sites from their site deck and forms empty companies at those sites.
 */
function handleStartingSiteSelection(
  state: GameState,
  action: GameAction,
  stepState: SetupStepState & { step: SetupStep.StartingSiteSelection },
): ReducerResult {
  const playerIndex = getPlayerIndex(state, action.player);
  const siteSelection = stepState.siteSelectionState[playerIndex];

  if (siteSelection.done) {
    return { state, error: 'You have already finished site selection' };
  }

  // Pass: done selecting (must have at least one site, unless a company already
  // has a starting site pre-placed by a Hidden Haven (wh-75) draft pairing).
  if (action.type === 'pass') {
    const hasPrePlacedSite = state.players[playerIndex].companies.some(c => c.currentSite != null);
    if (siteSelection.selectedSites.length === 0 && !hasPrePlacedSite) {
      return { state, error: 'You must select at least one starting site' };
    }

    const newSiteSelectionState = [...stepState.siteSelectionState] as [SiteSelectionPlayerState, SiteSelectionPlayerState];
    newSiteSelectionState[playerIndex] = { ...siteSelection, done: true };

    if (newSiteSelectionState[0].done && newSiteSelectionState[1].done) {
      return { state: finalizeSiteSelection(state, newSiteSelectionState) };
    }

    return {
      state: {
        ...state,
        phaseState: setupPhase({ ...stepState, siteSelectionState: newSiteSelectionState }),
      },
    };
  }

  if (action.type !== 'select-starting-site') {
    return wrongActionType(state, action, 'select-starting-site', 'site selection');
  }

  // Validate site is in player's site deck and not already selected
  const player = state.players[playerIndex];
  const siteCard = findById(player.siteDeck, action.siteInstanceId);
  if (!siteCard) {
    return { state, error: 'Site is not in your site deck' };
  }
  if (siteSelection.selectedSites.some(s => s.instanceId === action.siteInstanceId)) {
    return { state, error: 'Site already selected' };
  }
  if (siteSelection.selectedSites.length >= 2) {
    return { state, error: 'Already selected 2 starting sites' };
  }

  // Remove site from site deck
  const newSiteDeck = player.siteDeck.filter(c => c.instanceId !== action.siteInstanceId);

  const newSiteSelectionState = [...stepState.siteSelectionState] as [SiteSelectionPlayerState, SiteSelectionPlayerState];
  newSiteSelectionState[playerIndex] = {
    ...siteSelection,
    selectedSites: [...siteSelection.selectedSites, {
      instanceId: action.siteInstanceId,
      definitionId: siteCard.definitionId,
    }],
  };

  return {
    state: {
      ...updatePlayer(state, playerIndex, p => ({ ...p, siteDeck: newSiteDeck })),
      phaseState: setupPhase({ ...stepState, siteSelectionState: newSiteSelectionState }),
    },
  };
}

/**
 * Assigns the first selected site to the existing company (created during
 * draft with null site). If a second site was selected, creates an
 * additional empty company at that site. Transitions to the first Untap phase.
 */


/**
 * Assigns the first selected site to the existing company (created during
 * draft with null site). If a second site was selected, creates an
 * additional empty company at that site. Transitions to the first Untap phase.
 */
function finalizeSiteSelection(
  state: GameState,
  siteSelectionState: readonly [SiteSelectionPlayerState, SiteSelectionPlayerState],
): GameState {
  const newPlayers = clonePlayers(state);

  for (let i = 0; i < 2; i++) {
    const player = newPlayers[i];
    const selectedSites = siteSelectionState[i].selectedSites;
    const companies = [...player.companies];

    // A Hidden Haven (wh-75) pairing may have pre-placed a starting site on the
    // base company during draft finalize. In that case every selected site
    // creates a new company — the pre-placed company must not be overwritten.
    // Otherwise (no pre-placed site) the first selected site fills the base
    // company and any further selections create new companies.
    const basePrePlaced = companies.length > 0 && companies[0].currentSite != null;
    const startIdx = (!basePrePlaced && selectedSites.length > 0 && companies.length > 0) ? 1 : 0;

    if (startIdx === 1) {
      // No pre-placed site: first selected site fills the existing base company.
      companies[0] = { ...companies[0], currentSite: { ...selectedSites[0], status: CardStatus.Untapped } };
    }

    // Each remaining selected site creates an additional empty company.
    for (let s = startIdx; s < selectedSites.length; s++) {
      companies.push({
        id: nextCompanyId({ ...player, companies }),
        characters: [],
        currentSite: { ...selectedSites[s], status: CardStatus.Untapped },
        siteCardOwned: true,
        destinationSite: null,
        movementPath: [],
        moved: false,
        siteOfOrigin: null,
        onGuardCards: [],
        hazards: [],
      });
    }

    newPlayers[i] = { ...player, companies };
  }

  const newState = {
    ...state,
    players: newPlayers,
  };

  const p1NeedsPlacement = newPlayers[0].companies.length > 1;
  const p2NeedsPlacement = newPlayers[1].companies.length > 1;

  // Skip character placement entirely if neither player has multiple companies
  const nextStep = (p1NeedsPlacement || p2NeedsPlacement)
    ? setupPhase({
      step: SetupStep.CharacterPlacement,
      placementDone: [!p1NeedsPlacement, !p2NeedsPlacement],
      placed: [[], []],
    })
    : setupPhase({ step: SetupStep.DeckShuffle, shuffled: [false, false] });

  return {
    ...newState,
    activePlayer: null,
    phaseState: nextStep,
    turnNumber: 0,
  };
}

/**
 * Auto-completes the starting-site-selection step for any player whose starting
 * site is already determined by a Hidden Haven (wh-75) draft pairing: that
 * player's company already sits at the brought-out site (CRF 22, rule 1.10.F1),
 * so there is nothing for them to select and the step is skipped for them. If
 * BOTH players are so determined, the step is skipped entirely (finalised at
 * once). A no-op unless `state` is in the starting-site-selection step — so it is
 * safe to wrap around any transition that may or may not land there.
 */
function applySiteSelectionAutoSkip(state: GameState): GameState {
  if (state.phaseState.phase !== Phase.Setup
    || state.phaseState.setupStep.step !== SetupStep.StartingSiteSelection) {
    return state;
  }
  const step = state.phaseState.setupStep;
  const newSel = [...step.siteSelectionState] as [SiteSelectionPlayerState, SiteSelectionPlayerState];
  let changed = false;
  for (let i = 0; i < 2; i++) {
    const hasPrePlacedSite = state.players[i].companies.some(c => c.currentSite != null);
    if (hasPrePlacedSite && !newSel[i].done) {
      newSel[i] = { ...newSel[i], done: true };
      changed = true;
      logDetail(`Player ${i}'s starting site is set by a Hidden Haven pairing — skipping site selection`);
    }
  }
  if (!changed) return state;
  if (newSel[0].done && newSel[1].done) {
    return finalizeSiteSelection(state, newSel);
  }
  return { ...state, phaseState: setupPhase({ ...step, siteSelectionState: newSel }) };
}

/**
 * Removes companies with no characters and returns their site cards
 * to the player's site deck.
 */


/**
 * Handles the character placement step where players distribute their
 * characters between starting companies (only when 2 sites were selected).
 */
function handleCharacterPlacement(
  state: GameState,
  action: GameAction,
  stepState: SetupStepState & { step: SetupStep.CharacterPlacement },
): ReducerResult {
  const playerIndex = getPlayerIndex(state, action.player);

  if (stepState.placementDone[playerIndex]) {
    return { state, error: 'You have already finished placement' };
  }

  if (action.type === 'pass') {
    const newDone = [...stepState.placementDone] as [boolean, boolean];
    newDone[playerIndex] = true;

    // Both done → advance to deck shuffle
    if (newDone[0] && newDone[1]) {
      return {
        state: {
          ...state,
          phaseState: setupPhase({ step: SetupStep.DeckShuffle, shuffled: [false, false] }),
        },
      };
    }

    return {
      state: {
        ...state,
        phaseState: setupPhase({ ...stepState, placementDone: newDone }),
      },
    };
  }

  if (action.type !== 'place-character') {
    return wrongActionType(state, action, 'place-character', 'character placement');
  }

  const player = state.players[playerIndex];

  // Validate character belongs to this player
  if (!player.characters[action.characterInstanceId]) {
    return { state, error: 'Character not found' };
  }

  // A character may be placed at most once. Re-placing an already-placed
  // character is what let players (AIs in particular) shuffle characters
  // between companies without ever finishing, so it is rejected here.
  if (stepState.placed[playerIndex].includes(action.characterInstanceId)) {
    return { state, error: 'Character has already been placed' };
  }

  // Validate target company belongs to this player
  const targetIdx = player.companies.findIndex(c => c.id === action.companyId);
  if (targetIdx < 0) {
    return { state, error: 'Company not found' };
  }

  // Remove character from current company
  const newCompanies = player.companies.map(c => ({
    ...c,
    characters: c.characters.filter(id => id !== action.characterInstanceId),
  }));

  // Add to target company
  newCompanies[targetIdx] = {
    ...newCompanies[targetIdx],
    characters: [...newCompanies[targetIdx].characters, action.characterInstanceId],
  };

  // Mark the character as placed so it is no longer offered a move.
  const newPlaced = [...stepState.placed] as [readonly CardInstanceId[], readonly CardInstanceId[]];
  newPlaced[playerIndex] = [...newPlaced[playerIndex], action.characterInstanceId];

  return {
    state: {
      ...updatePlayer(state, playerIndex, p => ({ ...p, companies: newCompanies })),
      phaseState: setupPhase({ ...stepState, placed: newPlaced }),
    },
  };
}

/** Handles the deck shuffle step. Both players shuffle their play decks. */


function handleDeckShuffle(
  state: GameState,
  action: GameAction,
  stepState: SetupStepState & { step: SetupStep.DeckShuffle },
): ReducerResult {
  const playerIndex = getPlayerIndex(state, action.player);

  if (stepState.shuffled[playerIndex]) {
    return { state, error: 'You have already shuffled' };
  }

  if (action.type !== 'shuffle-play-deck') {
    return wrongActionType(state, action, 'shuffle-play-deck', 'deck shuffle');
  }

  const player = state.players[playerIndex];
  let rng = state.rng;
  const [shuffled, nextRng] = shuffle([...player.playDeck], rng);
  rng = nextRng;

  const stateWithShuffle = updatePlayer(state, playerIndex, p => ({ ...p, playDeck: shuffled }));

  const newShuffled = [...stepState.shuffled] as [boolean, boolean];
  newShuffled[playerIndex] = true;

  // Both shuffled → advance to initial draw
  if (newShuffled[0] && newShuffled[1]) {
    return {
      state: {
        ...stateWithShuffle,
        phaseState: setupPhase({ step: SetupStep.InitialDraw, drawn: [false, false] }),
        rng,
      },
    };
  }

  return {
    state: {
      ...stateWithShuffle,
      phaseState: setupPhase({ ...stepState, shuffled: newShuffled }),
      rng,
    },
  };
}

/** Handles the initial draw step. Both players draw their starting hand. */


function handleInitialDraw(
  state: GameState,
  action: GameAction,
  stepState: SetupStepState & { step: SetupStep.InitialDraw },
): ReducerResult {
  const playerIndex = getPlayerIndex(state, action.player);

  if (stepState.drawn[playerIndex]) {
    return { state, error: 'You have already drawn' };
  }

  if (action.type !== 'draw-cards') {
    return wrongActionType(state, action, 'draw-cards', 'initial draw');
  }

  const player = state.players[playerIndex];
  const hand = player.playDeck.slice(0, action.count);
  const playDeck = player.playDeck.slice(action.count);

  const stateWithDraw = updatePlayer(state, playerIndex, p => ({ ...p, hand, playDeck }));

  const newDrawn = [...stepState.drawn] as [boolean, boolean];
  newDrawn[playerIndex] = true;

  // Both drawn → initiative roll
  if (newDrawn[0] && newDrawn[1]) {
    return {
      state: {
        ...cleanupEmptyCompanies(stateWithDraw),
        phaseState: setupPhase({
          step: SetupStep.InitiativeRoll,
          rolls: [null, null],
        }),
      },
    };
  }

  return {
    state: {
      ...stateWithDraw,
      phaseState: setupPhase({ ...stepState, drawn: newDrawn }),
    },
  };
}

// ---- Initiative roll handler ----

/**
 * Handles the initiative roll step. Each player rolls 2d6. Results are
 * shown immediately (no waiting for opponent). If tied, both rolls are
 * cleared for a reroll. The higher roller goes first.
 */


/**
 * Handles the initiative roll step. Each player rolls 2d6. Results are
 * shown immediately (no waiting for opponent). If tied, both rolls are
 * cleared for a reroll. The higher roller goes first.
 */
function handleInitiativeRoll(
  state: GameState,
  action: GameAction,
  stepState: SetupStepState & { step: SetupStep.InitiativeRoll },
): ReducerResult {
  if (action.type !== 'roll-initiative') {
    return wrongActionType(state, action, 'roll-initiative', 'initiative roll');
  }

  const playerIndex = getPlayerIndex(state, action.player);
  if (stepState.rolls[playerIndex] !== null) {
    return { state, error: 'You have already rolled' };
  }

  // Roll 2d6
  const { roll, rng, cheatRollTotal } = roll2d6(state);
  const d1 = roll.die1;
  const d2 = roll.die2;
  logDetail(`${state.players[playerIndex].name} rolls initiative: ${d1} + ${d2} = ${d1 + d2}`);
  const rollEffect = diceRollEffect(state.players[playerIndex].name, roll, 'First turn');

  // Store the roll in the player's state
  const stateWithRoll: GameState = {
    ...updatePlayer(state, playerIndex, p => ({ ...p, lastDiceRoll: roll })),
    rng,
    cheatRollTotal,
  };

  const newRolls = [...stepState.rolls] as [TwoDiceSix | null, TwoDiceSix | null];
  newRolls[playerIndex] = roll;

  // If opponent hasn't rolled yet, just record and wait
  if (newRolls[0] === null || newRolls[1] === null) {
    return {
      state: {
        ...stateWithRoll,
        phaseState: setupPhase({ ...stepState, rolls: newRolls }),
      },
      effects: [rollEffect],
    };
  }

  // Both rolled — compare
  const total0 = newRolls[0].die1 + newRolls[0].die2;
  const total1 = newRolls[1].die1 + newRolls[1].die2;

  if (total0 === total1) {
    logDetail(`Tie (${total0} vs ${total1}) — rerolling`);
    return {
      state: {
        ...stateWithRoll,
        phaseState: setupPhase({ ...stepState, rolls: [null, null] }),
      },
      effects: [rollEffect],
    };
  }

  // Winner goes first
  const winner = total0 > total1 ? stateWithRoll.players[0] : stateWithRoll.players[1];
  logDetail(`${winner.name} wins initiative (${total0} vs ${total1}) — goes first`);
  const firstPlayer = winner.id;

  // The game now begins — announce each player's alignment in the text log.
  const alignmentEffects = stateWithRoll.players.map(p => {
    logDetail(`${p.name} is playing as ${alignmentLabel(p.alignment)}`);
    return {
      effect: 'text-notification' as const,
      message: `${p.name} is playing as ${alignmentLabel(p.alignment)}`,
    };
  });

  return {
    state: startFirstTurn({ ...stateWithRoll, activePlayer: firstPlayer, startingPlayer: firstPlayer }),
    effects: [rollEffect, ...alignmentEffects],
  };
}

/**
 * Renders an {@link Alignment} as a human-readable label for the text log
 * (e.g. `fallen-wizard` → "Fallen-wizard").
 */
function alignmentLabel(alignment: Alignment): string {
  switch (alignment) {
    case Alignment.Wizard:
      return 'Wizard';
    case Alignment.Ringwraith:
      return 'Ringwraith';
    case Alignment.FallenWizard:
      return 'Fallen-wizard';
    case Alignment.Balrog:
      return 'Balrog';
  }
}

// ---- Phase handler stubs ----
// Each stub below corresponds to a game phase that is not yet implemented.
// They accept the action but return the state unmodified.

/**
 * Handles the Untap phase. Both players must pass to advance.
 * Actual untapping of cards will be implemented later.
 */

