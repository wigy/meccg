/**
 * @module reducer-combat
 *
 * Combat handlers for the game reducer. Covers strike assignment,
 * strike resolution, support strikes, body checks, and combat finalization.
 */

import type { GameState, CombatState, StrikeAssignment, GameAction, GameEffect, CardInstanceId, CardDefinitionId, HazardHost } from '../index.js';
import type { PlayerState } from '../types/state-player.js';
import type { ItemInPlay } from '../types/state-cards.js';
import { CardStatus, Phase, isSiteCard, isCharacterCard, isAllyCard, shuffle, Alignment } from '../index.js';
import type { ItemTapStrikeBonusEffect, OnEventEffect, ModifyStrikeEffect, HalveStrikesEffect, TakePrisonerEffect } from '../types/effects.js';
import { getActiveAutoAttacks } from './manifestations.js';
import { matchesCondition } from '../effects/condition-matcher.js';
import type { MovementHazardPhaseState } from '../types/state-phases.js';
import { logDetail } from './legal-actions/log.js';
import { findAllyInCompany, findItemInCompany } from './legal-actions/combat.js';
import { resolveInstanceId } from '../types/state.js';
import type { ReducerResult } from './reducer-utils.js';
import { roll2d6, clonePlayers, updatePlayer, updateCharacter, wrongActionType, getOnEventEffects } from './reducer-utils.js';
import { applyCost } from './cost-evaluator.js';
import { resolveEnemyBody, isWardedAgainst, resolveAttackProwess, resolveAttackStrikes, normalizeCreatureRace } from './effects/index.js';
import { isDetainmentAttack } from './detainment.js';
import { computeCombatProwess, buildInPlayNames } from './recompute-derived.js';
import { enqueueCorruptionCheck, addConstraint, enqueueResolution, sweepExpired, removeConstraint } from './pending.js';
import { initiateChain, pushChainEntry } from './chain-reducer.js';
import { handlePlayResourceShortEvent } from './reducer-events.js';


/**
 * Dispatch a combat action to the appropriate handler based on the
 * current combat sub-phase.
 */
export function handleCombatAction(state: GameState, action: GameAction): ReducerResult {
  const combat = state.combat;
  if (!combat) return { state, error: 'No combat active' };

  switch (action.type) {
    case 'assign-strike':
      return handleAssignStrike(state, action, combat);
    case 'pass':
      return handleCombatPass(state, action, combat);
    case 'choose-strike-order':
      return handleChooseStrikeOrder(state, action, combat);
    case 'resolve-strike':
      return handleResolveStrike(state, action, combat);
    case 'agent-strike-roll':
      return handleAgentStrikeRoll(state, action, combat);
    case 'support-strike':
      return handleSupportStrike(state, action, combat);
    case 'body-check-roll':
      return handleBodyCheckRoll(state, action, combat);
    case 'cancel-attack':
      return handleCancelAttack(state, action, combat);
    case 'cancel-by-tap':
      return handleCancelByTap(state, action, combat);
    case 'play-dodge':
      return handlePlayDodge(state, action, combat);
    case 'play-strike-event':
      return handlePlayStrikeEvent(state, action, combat);
    case 'play-reroll-strike':
      return handlePlayRerollStrike(state, action, combat);
    case 'cancel-strike':
      return handleCancelStrike(state, action, combat);
    case 'halve-strikes':
      return handleHalveStrikes(state, action, combat);
    case 'tap-item-for-strike':
      return handleTapItemForStrike(state, action, combat);
    case 'modify-attack':
      return handleModifyAttack(state, action, combat);
    case 'modify-attack-from-hand':
      return handleModifyAttackFromHand(state, action, combat);
    case 'salvage-item':
      return handleSalvageItem(state, action, combat);
    case 'discard-item-from-company':
      return handleDiscardItemFromCompany(state, action, combat);
    case 'play-hazard':
      return handleCombatPlayHazard(state, action, combat);
    case 'haven-join-attack':
      return handleHavenJoinAttack(state, action, combat);
    // Rule 3.iv / 3.iv.5: resource short-events may be played between strike
    // sequences or during step 5 if they affect the current strike. The
    // event handler applies its effects without touching the combat state.
    case 'play-short-event':
      return handlePlayResourceShortEvent(state, action);
    default:
      return { state, error: `Unexpected action '${action.type}' during combat` };
  }
}

/**
 * Accept a pending haven-join-attack offer.
 *
 * Removes the character from their haven company and inserts them into
 * the attacked company, optionally discarding their allies, marking them
 * as a forced strike target, and scheduling post-attack side-effects.
 * The offer is consumed so it cannot be accepted twice.
 *
 * Implements the reusable side of `on-event: creature-attack-begins` +
 * `apply: offer-char-join-attack` — composable for any card with this pattern
 * (currently Alatar, tw-117).
 */
function handleHavenJoinAttack(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'haven-join-attack') return wrongActionType(state, action, 'haven-join-attack');
  const offers = combat.havenJumpOffers ?? [];
  const offer = offers.find(o => o.characterId === action.characterId && o.bearerPlayerId === action.player);
  if (!offer) return { state, error: 'No matching haven-join offer' };

  const playerIdx = state.players.findIndex(p => p.id === action.player);
  if (playerIdx < 0) return { state, error: 'Player not found' };
  const player = state.players[playerIdx];

  const originCompany = player.companies.find(c => c.id === offer.originCompanyId);
  const targetCompany = player.companies.find(c => c.id === offer.targetCompanyId);
  if (!originCompany || !targetCompany) return { state, error: 'Company not found' };

  const charInPlay = player.characters[action.characterId as string];
  if (!charInPlay) return { state, error: 'Character not in play' };

  // Discard attached allies if configured
  let updatedChar = charInPlay;
  let discardedAllies: { instanceId: CardInstanceId; definitionId: CardDefinitionId }[] = [];
  if (offer.discardOwnedAllies && charInPlay.allies.length > 0) {
    discardedAllies = charInPlay.allies.map(a => ({ instanceId: a.instanceId, definitionId: a.definitionId }));
    updatedChar = { ...charInPlay, allies: [] };
    logDetail(`Haven-join: discarding ${discardedAllies.length} ally card(s) attached to joiner`);
  }

  // Move character: remove from origin company, append to target company.
  const newCompanies = player.companies.map(c => {
    if (c.id === offer.originCompanyId) {
      return { ...c, characters: c.characters.filter(id => id !== action.characterId) };
    }
    if (c.id === offer.targetCompanyId) {
      return { ...c, characters: [...c.characters, action.characterId] };
    }
    return c;
  });

  const newCharacters = { ...player.characters, [action.characterId as string]: updatedChar };

  const newPlayers: [PlayerState, PlayerState] = [state.players[0], state.players[1]];
  newPlayers[playerIdx] = {
    ...player,
    companies: newCompanies,
    characters: newCharacters,
    discardPile: [...player.discardPile, ...discardedAllies],
  };

  logDetail(`Haven-join: character ${action.characterId as string} moved from company ${offer.originCompanyId as string} to attacked company ${offer.targetCompanyId as string}`);

  const newForcedTargets = offer.forceStrike
    ? [...(combat.forcedStrikeTargets ?? []), action.characterId]
    : combat.forcedStrikeTargets;
  const newPostAttack = offer.postAttackEffects.length > 0
    ? [...(combat.postAttackEffects ?? []), ...offer.postAttackEffects]
    : combat.postAttackEffects;
  const newOrigins = [...(combat.havenJumpOrigins ?? []), {
    characterId: action.characterId,
    originCompanyId: offer.originCompanyId,
  }];

  // Consume this offer
  const remainingOffers = offers.filter(o => o !== offer);

  const newCombat: CombatState = {
    ...combat,
    havenJumpOffers: remainingOffers.length > 0 ? remainingOffers : undefined,
    forcedStrikeTargets: newForcedTargets && newForcedTargets.length > 0 ? newForcedTargets : undefined,
    postAttackEffects: newPostAttack && newPostAttack.length > 0 ? newPostAttack : undefined,
    havenJumpOrigins: newOrigins,
  };

  return { state: { ...state, players: newPlayers, combat: newCombat } };
}

/**
 * Compute the next combat phase after all strikes are assigned or a strike finishes resolving.
 * If multiple unresolved strikes remain, enters choose-strike-order so the defender picks.
 * If exactly one remains, auto-selects it and goes to resolve-strike.
 * Returns null if all strikes are resolved (caller should finalize combat).
 */
function nextStrikePhase(combat: CombatState): Partial<CombatState> | null {
  const unresolvedIndices: number[] = [];
  for (let i = 0; i < combat.strikeAssignments.length; i++) {
    if (!combat.strikeAssignments[i].resolved) unresolvedIndices.push(i);
  }
  if (unresolvedIndices.length === 0) return null;
  if (unresolvedIndices.length === 1) {
    logDetail(`One unresolved strike remaining (index ${unresolvedIndices[0]}) — auto-selecting`);
    // Reset the attacker's Step 1 window and agent roll for the new strike sequence.
    return { phase: 'resolve-strike', currentStrikeIndex: unresolvedIndices[0], bodyCheckTarget: null, attackerStep1Done: false, agentRollTotal: undefined };
  }
  logDetail(`${unresolvedIndices.length} unresolved strikes — defender chooses order`);
  return { phase: 'choose-strike-order', bodyCheckTarget: null };
}

/** Handle the defender choosing which strike to resolve next. */
function handleChooseStrikeOrder(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'choose-strike-order') return wrongActionType(state, action, 'choose-strike-order');

  const idx = action.strikeIndex;
  logDetail(`Defender chose to resolve strike ${idx} (character ${combat.strikeAssignments[idx].characterId as string})`);
  // Entering a new strike sequence — reset the attacker's Step 1 window and agent roll.
  return {
    state: { ...state, combat: { ...combat, phase: 'resolve-strike', currentStrikeIndex: idx, attackerStep1Done: false, agentRollTotal: undefined } },
  };
}

/** Assign a strike to a defending character. */
function handleAssignStrike(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'assign-strike') return wrongActionType(state, action, 'assign-strike');

  const existingIdx = combat.strikeAssignments.findIndex(a => a.characterId === action.characterId);

  let newAssignments: StrikeAssignment[];

  // Force-single-target (multi-attack): auto-assign all strikes to the chosen character
  if (combat.forceSingleTarget && combat.strikeAssignments.length === 0 && existingIdx < 0) {
    newAssignments = [];
    for (let i = 0; i < combat.strikesTotal; i++) {
      newAssignments.push({
        characterId: action.characterId,
        excessStrikes: 0,
        resolved: false,
      });
    }
    logDetail(`Multi-attack: all ${combat.strikesTotal} strikes auto-assigned to ${action.characterId as string}`);

    let newCombatState: CombatState = { ...combat, strikeAssignments: newAssignments };

    // If cancel-by-tap is available, transition to cancel-by-tap sub-phase
    if (combat.cancelByTapRemaining && combat.cancelByTapRemaining > 0) {
      logDetail(`Cancel-by-tap window: defender may cancel up to ${combat.cancelByTapRemaining} attack(s)`);
      newCombatState = { ...newCombatState, assignmentPhase: 'cancel-by-tap' };
      return { state: { ...state, combat: newCombatState } };
    }

    // Otherwise proceed to strike resolution
    const next = nextStrikePhase(newCombatState);
    newCombatState = { ...newCombatState, assignmentPhase: 'done', ...next };
    return { state: { ...state, combat: newCombatState } };
  }

  if (existingIdx >= 0) {
    newAssignments = combat.strikeAssignments.map((a, i) =>
      i === existingIdx ? { ...a, excessStrikes: a.excessStrikes + 1 } : a,
    );
    logDetail(`Excess strike assigned to ${action.characterId as string} (now ${newAssignments[existingIdx].excessStrikes} excess)`);
  } else {
    // Normal assignment: new strike to this character
    newAssignments = [...combat.strikeAssignments, {
      characterId: action.characterId,
      excessStrikes: 0,
      resolved: false,
    }];
    logDetail(`Strike assigned to ${action.characterId as string} (${newAssignments.length}/${combat.strikesTotal})`);
  }

  const newTotalAllocated = newAssignments.length
    + newAssignments.reduce((sum, a) => sum + a.excessStrikes, 0);
  const allAssigned = newTotalAllocated >= combat.strikesTotal;

  let newCombatState: CombatState = { ...combat, strikeAssignments: newAssignments };
  if (allAssigned) {
    const next = nextStrikePhase(newCombatState);
    newCombatState = { ...newCombatState, assignmentPhase: 'done', ...next };
  }

  return { state: { ...state, combat: newCombatState } };
}

/** Defender passes during strike assignment — attacker assigns remaining. */


function handleCombatPass(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'pass') return wrongActionType(state, action, 'pass');

  // CoE rule 3.iv.1 — attacker ends their Step 1 priority window, allowing
  // the defender to proceed with strike resolution (Steps 2-7).
  if (combat.phase === 'resolve-strike' && action.player === combat.attackingPlayerId && !combat.attackerStep1Done) {
    logDetail('Attacker passed Step 1 (hazard play window) — defender may resolve the strike');
    return {
      state: { ...state, combat: { ...combat, attackerStep1Done: true } },
    };
  }

  // Pass during item-salvage: player declines further transfers, discard remaining items
  if (combat.phase === 'item-salvage') {
    logDetail('Defender passed item-salvage — discarding remaining items');
    const defIdx = state.players.findIndex(p => p.id === combat.defendingPlayerId);
    const salvageItems = combat.salvageItems ?? [];
    for (const item of salvageItems) {
      logDetail(`Discarding unsalvaged item ${item.instanceId as string}`);
    }
    const nextState = updatePlayer(state, defIdx, p => ({
      ...p,
      discardPile: [
        ...p.discardPile,
        ...salvageItems.map(item => ({ instanceId: item.instanceId, definitionId: item.definitionId })),
      ],
    }));
    return finishSalvage(nextState, combat);
  }

  // Pass during cancel-by-tap sub-phase: proceed to strike resolution
  if (combat.phase === 'assign-strikes' && combat.assignmentPhase === 'cancel-by-tap') {
    logDetail('Defender passed cancel-by-tap — proceeding to strike resolution');
    const next = nextStrikePhase(combat);
    return {
      state: { ...state, combat: { ...combat, assignmentPhase: 'done', ...next } },
    };
  }

  // Pass during cancel-window: defender declined to cancel. If the window was
  // entered due to attacker-chooses-defenders, the attacker assigns next; if
  // it was entered solely for a haven-jump offer (no attacker-chooses), the
  // defender is the normal next assigner. Pending haven-jump offers are
  // consumed on pass — the player declined.
  if (combat.phase === 'assign-strikes' && combat.assignmentPhase === 'cancel-window') {
    const next = combat.attackerChoosesDefenders ? 'attacker' : 'defender';
    logDetail(`Defender passed cancel window — transitioning to ${next} assignment`);
    return {
      state: { ...state, combat: { ...combat, assignmentPhase: next, havenJumpOffers: undefined } },
    };
  }

  const totalAllocated = combat.strikeAssignments.length
    + combat.strikeAssignments.reduce((sum, a) => sum + a.excessStrikes, 0);
  const strikesRemaining = combat.strikesTotal - totalAllocated;

  // If no strikes remain, transition to resolve (via choose-strike-order if multiple)
  if (strikesRemaining <= 0) {
    logDetail('Defender passed with all strikes assigned — transitioning to resolve');
    const next = nextStrikePhase(combat);
    return {
      state: { ...state, combat: { ...combat, assignmentPhase: 'done', ...next } },
    };
  }

  logDetail(`Defender passed — ${strikesRemaining} strike(s) remaining, attacker assigns`);
  return {
    state: { ...state, combat: { ...combat, assignmentPhase: 'attacker' } },
  };
}

/**
 * Core strike resolution shared by `resolve-strike`, `play-dodge`, and
 * `play-reroll-strike`.
 *
 * Rolls 2d6 + prowess vs strike prowess, determines the outcome, applies
 * tap/wound to the character or ally, and advances combat to body-check or
 * the next strike. The four resolution modes differ only in:
 * - prowess modifier (stay-untapped takes -3; tap, dodge, and reroll are full)
 * - whether the character taps on success/tie (reroll taps like tap mode)
 * - dodge adds a body penalty for the resulting body check
 * - reroll makes two 2d6 rolls and keeps the better total
 *
 * `preAppliedDefender` lets callers pre-mutate the defender (e.g. dodge
 * discards a card from hand before resolving); this must NOT alter
 * characters or companies, only piles.
 */
function resolveStrikeCore(
  state: GameState,
  combat: CombatState,
  mode: 'tap' | 'untap' | 'dodge' | 'reroll',
  dodgeBodyPenalty: number,
  preAppliedDefender: PlayerState | null,
): ReducerResult {
  const strike = combat.strikeAssignments[combat.currentStrikeIndex];
  if (!strike || strike.resolved) return { state, error: 'Current strike already resolved' };

  // Look up combatant stats — may be a character or an ally (CoE rule 2.V.2.2)
  const defPlayerIndex = state.players.findIndex(p => p.id === combat.defendingPlayerId);
  const defPlayer = preAppliedDefender ?? state.players[defPlayerIndex];
  const charData = defPlayer.characters[strike.characterId as string];
  const company = defPlayer.companies.find(c => c.id === combat.companyId);
  const allyMatch = !charData && company
    ? findAllyInCompany(defPlayer, company.characters, strike.characterId)
    : undefined;
  if (!charData && !allyMatch) return { state, error: 'Character not found' };

  const targetDefId = charData?.definitionId ?? allyMatch!.ally.definitionId;
  const targetStatus = charData?.status ?? allyMatch!.ally.status;
  const charDef = state.cardPool[targetDefId as string];

  // Compute effective prowess
  let prowess: number;
  if (combat.defenderProwessFromMind && !allyMatch && charDef && isCharacterCard(charDef) && charDef.mind !== null) {
    // Neeker-breekers: use the character's mind attribute as base prowess
    prowess = charDef.mind;
    logDetail(`Defender prowess from mind: ${charDef.mind} (${charDef.name ?? targetDefId as string})`);
  } else if (allyMatch) {
    prowess = isAllyCard(charDef) ? charDef.prowess : 0;
  } else if (combat.creatureRace && charDef && isCharacterCard(charDef)) {
    prowess = computeCombatProwess(state, charData, charDef, combat.creatureRace);
  } else {
    prowess = charData.effectiveStats.prowess;
  }
  if (mode === 'untap') prowess -= 3; // Stay untapped penalty
  if (targetStatus === CardStatus.Tapped) prowess -= 1;
  if (targetStatus === CardStatus.Inverted) prowess -= 2; // Wounded
  if (strike.excessStrikes > 0) prowess -= strike.excessStrikes;
  const supportBonus = strike.supportCount ?? 0;
  prowess += supportBonus; // CoE rule 3.iv.4: +1 per supporting character/ally
  const modifyStrikeBonus = strike.strikeProwessBonus ?? 0;
  if (modifyStrikeBonus !== 0) {
    logDetail(`Strike event prowess modifier: ${modifyStrikeBonus >= 0 ? '+' : ''}${modifyStrikeBonus}`);
    prowess += modifyStrikeBonus;
  }

  // Roll dice. Reroll mode makes two rolls and keeps the better total; the
  // discarded roll is logged and emitted as an effect so both rolls appear
  // in history.
  let roll;
  let rng;
  let cheatRollTotal;
  const rollLabel = mode === 'dodge' ? 'Strike (dodge)' : mode === 'reroll' ? 'Strike (reroll)' : 'Strike';
  const charLabel = charDef && 'name' in charDef ? (charDef as { name: string }).name : (targetDefId as string);
  const effects: GameEffect[] = [];

  if (mode === 'reroll') {
    const r1 = roll2d6(state);
    const r2 = roll2d6({ ...state, rng: r1.rng, cheatRollTotal: r1.cheatRollTotal });
    const t1 = r1.roll.die1 + r1.roll.die2;
    const t2 = r2.roll.die1 + r2.roll.die2;
    const firstBetter = t1 >= t2;
    const kept = firstBetter ? r1 : r2;
    const discarded = firstBetter ? r2 : r1;
    roll = kept.roll;
    rng = r2.rng;
    cheatRollTotal = r2.cheatRollTotal;
    logDetail(`${rollLabel}: rolled ${r1.roll.die1}+${r1.roll.die2}=${t1} and ${r2.roll.die1}+${r2.roll.die2}=${t2} → keeping ${kept.roll.die1}+${kept.roll.die2}=${kept.roll.die1 + kept.roll.die2}`);
    effects.push({
      effect: 'dice-roll', playerName: defPlayer.name,
      die1: discarded.roll.die1, die2: discarded.roll.die2, label: `${rollLabel} (discarded): ${charLabel}`,
    });
    effects.push({
      effect: 'dice-roll', playerName: defPlayer.name,
      die1: kept.roll.die1, die2: kept.roll.die2, label: `${rollLabel}: ${charLabel}`,
    });
  } else {
    const single = roll2d6(state);
    roll = single.roll;
    rng = single.rng;
    cheatRollTotal = single.cheatRollTotal;
    effects.push({
      effect: 'dice-roll', playerName: defPlayer.name,
      die1: roll.die1, die2: roll.die2, label: `${rollLabel}: ${charLabel}`,
    });
  }

  const rollTotal = roll.die1 + roll.die2;
  const characterTotal = rollTotal + prowess;
  // For agent attacks, compare against the agent's rolled total (rule 3.iv.6.1).
  const effectiveProwess = combat.attackSource.type === 'agent' && combat.agentRollTotal !== undefined
    ? combat.agentRollTotal
    : combat.strikeProwess;
  logDetail(`${rollLabel} resolution: ${targetDefId as string} rolls ${roll.die1}+${roll.die2}=${rollTotal} + prowess ${prowess} = ${characterTotal} vs ${combat.attackSource.type === 'agent' ? `agent roll ${effectiveProwess}` : `creature prowess ${combat.strikeProwess}`}`);

  // Determine outcome
  let result: 'success' | 'wounded' | 'eliminated';
  let bodyCheckTarget: 'character' | 'creature' | null = null;
  if (characterTotal > effectiveProwess) {
    result = 'success';
    if (combat.creatureBody !== null) bodyCheckTarget = 'creature';
    logDetail(`Character defeats strike — ${bodyCheckTarget ? 'body check vs creature' : 'creature has no body'}`);
  } else if (characterTotal < effectiveProwess) {
    result = 'wounded';
    if (combat.detainment) {
      logDetail('Strike succeeds — detainment: character tapped, no body check');
    } else {
      bodyCheckTarget = 'character';
      logDetail('Strike succeeds — character wounded, body check vs character');
    }
  } else {
    result = 'success';
    logDetail(`Tie — ineffectual${mode === 'dodge' ? ' (dodge: no tap)' : ', character taps'}`);
  }

  // An Article Missing (dm-43): on a successful agent strike the defender is not
  // wounded; the company must instead discard one item of their choice.
  const discardItemEffect = result === 'wounded' && !combat.detainment && combat.strikeEffect === 'discard-item';
  if (discardItemEffect) {
    logDetail('An Article Missing: successful strike — character not wounded; company must discard one item');
    result = 'success';
    bodyCheckTarget = null;
  }

  // take-prisoner (e.g. Flies and Spiders dm-58): if the strike succeeds
  // against a character (not an ally) who has a hazard with a take-prisoner
  // effect, the character is taken prisoner instead of wounded.
  // Rule 8.35: allies cannot be taken prisoner — this only fires for characters.
  const takePrisonerResult = result === 'wounded' && !combat.detainment && !allyMatch && !discardItemEffect && charData
    ? findTakePrisonerHazard(state, defPlayerIndex, charData.hazards)
    : null;

  // Whether the combatant taps on a non-wounded outcome:
  //  - tap:    always (success or tie)
  //  - reroll: always (same as tap)
  //  - untap:  only on tie
  //  - dodge:  never
  const tapOnNonWounded =
    mode === 'tap' ||
    mode === 'reroll' ||
    (mode === 'untap' && characterTotal === effectiveProwess);

  // Record strike assignment. Dodge tags the strike so the body check picks
  // up the body penalty (CoE rule 3.I +1 for already-wounded still applies).
  const wasAlreadyWounded = targetStatus === CardStatus.Inverted;
  const newAssignments = combat.strikeAssignments.map((a, i) =>
    i === combat.currentStrikeIndex
      ? {
          ...a,
          resolved: true,
          result,
          wasAlreadyWounded,
          ...(mode === 'dodge' ? { dodged: true, dodgeBodyPenalty } : {}),
        }
      : a,
  );

  // Apply tap/wound to character or ally
  const newPlayers = clonePlayers(state);
  if (preAppliedDefender) newPlayers[defPlayerIndex] = preAppliedDefender;
  const workingDefender = newPlayers[defPlayerIndex];
  const newCharacters = { ...workingDefender.characters };

  if (allyMatch) {
    const hostChar = newCharacters[allyMatch.hostCharId as string];
    if (hostChar) {
      let newAllyStatus = allyMatch.ally.status;
      if (tapOnNonWounded && newAllyStatus === CardStatus.Untapped) {
        newAllyStatus = CardStatus.Tapped;
      }
      if (result === 'wounded' && !combat.detainment) {
        newAllyStatus = CardStatus.Inverted;
      } else if (result === 'wounded' && combat.detainment) {
        newAllyStatus = CardStatus.Tapped;
      }
      const newAllies = hostChar.allies.map(a =>
        a.instanceId === strike.characterId ? { ...a, status: newAllyStatus } : a,
      );
      newCharacters[allyMatch.hostCharId as string] = { ...hostChar, allies: newAllies };
    }
  } else {
    if (takePrisonerResult) {
      // take-prisoner: character is not wounded; instead they become a prisoner.
      // Status stays as-is (not tapped, not wounded). Rule 8.35.
      logDetail(`take-prisoner: ${strike.characterId as string} is taken prisoner by ${takePrisonerResult.hostCard.instanceId as string}`);
    } else {
      if (tapOnNonWounded && charData.status === CardStatus.Untapped) {
        newCharacters[strike.characterId as string] = { ...charData, status: CardStatus.Tapped };
      }
      if (result === 'wounded' && !combat.detainment) {
        newCharacters[strike.characterId as string] = {
          ...(newCharacters[strike.characterId as string] ?? charData),
          status: CardStatus.Inverted,
        };
      } else if (result === 'wounded' && combat.detainment) {
        newCharacters[strike.characterId as string] = {
          ...(newCharacters[strike.characterId as string] ?? charData),
          status: CardStatus.Tapped,
        };
      }
    }
  }
  newPlayers[defPlayerIndex] = { ...workingDefender, characters: newCharacters, lastDiceRoll: roll };

  // Apply prisoner-taking: discard non-ring items, revert followers to GI,
  // add character-is-prisoner constraint, create HazardHost record.
  let postPrisonerState: GameState = { ...state, players: newPlayers, rng, cheatRollTotal };

  if (takePrisonerResult && charData) {
    postPrisonerState = applyTakePrisoner(
      postPrisonerState,
      defPlayerIndex,
      strike.characterId,
      takePrisonerResult,
    );
    // Override result and bodyCheckTarget: prisoner-taking skips wound/body-check
    bodyCheckTarget = null;
  }

  // Advance combat: body check, next strike, or finalize
  let newCombat: CombatState;
  if (bodyCheckTarget) {
    newCombat = { ...combat, strikeAssignments: newAssignments, phase: 'body-check', bodyCheckTarget };
    return { state: { ...postPrisonerState, combat: newCombat }, effects };
  } else {
    const combatWithAssignments = { ...combat, strikeAssignments: newAssignments };

    // An Article Missing: enter discard-item-from-company phase so the defender
    // must choose one item to discard before combat continues.
    if (discardItemEffect) {
      const companyCharIds = company?.characters ?? [];
      const allItems: ItemInPlay[] = companyCharIds.flatMap(charId => {
        const ch = newPlayers[defPlayerIndex].characters[charId as string];
        return ch ? [...ch.items] : [];
      });
      if (allItems.length > 0) {
        logDetail(`Entering discard-item-from-company phase: ${allItems.length} item(s) available`);
        newCombat = { ...combatWithAssignments, phase: 'discard-item-from-company', discardItemOptions: allItems };
        return { state: { ...postPrisonerState, combat: newCombat }, effects };
      }
      logDetail('An Article Missing: no items in company — discard-item effect skipped');
    }

    const next = nextStrikePhase(combatWithAssignments);
    if (!next) {
      return finalizeCombat({ ...postPrisonerState, combat: combatWithAssignments }, effects);
    }
    newCombat = { ...combatWithAssignments, ...next };
  }

  return {
    state: { ...postPrisonerState, combat: newCombat },
    effects,
  };
}

/** Resolve the current strike — roll dice and determine outcome. */
function handleResolveStrike(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'resolve-strike') return wrongActionType(state, action, 'resolve-strike');
  return resolveStrikeCore(state, combat, action.tapToFight ? 'tap' : 'untap', 0, null);
}

/**
 * Attacker rolls 2d6 for the agent's strike (rule 3.iv.6.1).
 * The total (2d6 + agent's modified prowess) is stored as `agentRollTotal`
 * and becomes the effective prowess the defender must beat.
 */
function handleAgentStrikeRoll(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'agent-strike-roll') return wrongActionType(state, action, 'agent-strike-roll');
  if (combat.attackSource.type !== 'agent') return { state, error: 'agent-strike-roll only valid for agent attacks' };

  const atkPlayerIndex = state.players.findIndex(p => p.id === combat.attackingPlayerId);
  const atkPlayer = state.players[atkPlayerIndex];

  const { roll, rng, cheatRollTotal } = roll2d6(state);
  const rollTotal = roll.die1 + roll.die2;
  const agentRollTotal = rollTotal + combat.strikeProwess;

  // Resolve agent name for the log label
  const agentDefId = resolveInstanceId(state, combat.attackSource.instanceId);
  const agentDef = agentDefId ? state.cardPool[agentDefId as string] : undefined;
  const agentName = agentDef && 'name' in agentDef ? (agentDef as { name: string }).name : 'Agent';

  logDetail(`Agent strike roll: ${agentName} rolls ${roll.die1}+${roll.die2}=${rollTotal} + prowess ${combat.strikeProwess} = ${agentRollTotal}`);

  const effect: GameEffect = {
    effect: 'dice-roll',
    playerName: atkPlayer.name,
    die1: roll.die1,
    die2: roll.die2,
    label: `Agent Strike: ${agentName}`,
  };

  return {
    state: { ...state, rng, cheatRollTotal, combat: { ...combat, agentRollTotal } },
    effects: [effect],
  };
}

/** Tap a supporting character for +1 prowess on the current strike. */
function handleSupportStrike(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'support-strike') return wrongActionType(state, action, 'support-strike');

  const defPlayerIndex = state.players.findIndex(p => p.id === combat.defendingPlayerId);
  const defPlayer = state.players[defPlayerIndex];

  // Bump the supportCount on the current strike so the +1 modifier is
  // visible to the legal-action computer (updates the displayed "need")
  // and applied by `resolveStrikeCore` when the dice are actually rolled.
  const currentStrike = combat.strikeAssignments[combat.currentStrikeIndex];
  const newAssignments = combat.strikeAssignments.map((a, i) =>
    i === combat.currentStrikeIndex
      ? { ...a, supportCount: (a.supportCount ?? 0) + 1 }
      : a,
  );
  const newSupportCount = (currentStrike?.supportCount ?? 0) + 1;
  const newCombat: CombatState = { ...combat, strikeAssignments: newAssignments };

  // Check if supporter is a character
  const supporterChar = defPlayer.characters[action.supportingCharacterId as string];
  if (supporterChar) {
    const nextState = updatePlayer(state, defPlayerIndex, p =>
      updateCharacter(p, action.supportingCharacterId, c => ({ ...c, status: CardStatus.Tapped })),
    );
    logDetail(`${action.supportingCharacterId as string} taps to support — +1 prowess (total support: +${newSupportCount})`);
    return { state: { ...nextState, combat: newCombat } };
  }

  // Check if supporter is an ally
  for (const charId of Object.keys(defPlayer.characters)) {
    const ch = defPlayer.characters[charId];
    const allyIndex = ch.allies.findIndex(a => a.instanceId === action.supportingCharacterId);
    if (allyIndex >= 0) {
      const ally = ch.allies[allyIndex];
      const newAllies = [...ch.allies];
      newAllies[allyIndex] = { ...ally, status: CardStatus.Tapped };
      const nextState = updatePlayer(state, defPlayerIndex, p =>
        updateCharacter(p, charId, c => ({ ...c, allies: newAllies })),
      );
      logDetail(`Ally ${action.supportingCharacterId as string} taps to support — +1 prowess (total support: +${newSupportCount})`);
      return { state: { ...nextState, combat: newCombat } };
    }
  }

  return { state, error: 'Supporting character or ally not found' };
}

/**
 * Cancel the current strike by having another character in the company
 * tap. The strike is marked resolved with result 'canceled' and combat
 * advances to the next strike or finalizes.
 */
function handleCancelStrike(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'cancel-strike') return wrongActionType(state, action, 'cancel-strike');

  const defPlayerIndex = state.players.findIndex(p => p.id === combat.defendingPlayerId);
  const defPlayer = state.players[defPlayerIndex];

  const cancellerChar = defPlayer.characters[action.cancellerInstanceId as string];
  const currentStrike = combat.strikeAssignments[combat.currentStrikeIndex];

  let nextState: GameState;
  if (cancellerChar) {
    const cancellerDef = state.cardPool[cancellerChar.definitionId as string];
    const cancellerName = cancellerDef && 'name' in cancellerDef ? (cancellerDef as { name: string }).name : (action.cancellerInstanceId as string);
    logDetail(`${cancellerName} taps to cancel strike against ${currentStrike.characterId as string}`);

    nextState = updatePlayer(state, defPlayerIndex, p =>
      updateCharacter(p, action.cancellerInstanceId, c => ({ ...c, status: CardStatus.Tapped })),
    );
  } else {
    // The canceller may be an item or ally attached to the struck character (e.g.
    // Enruned Shield taps to cancel a strike against its Warrior bearer, or
    // Noble Steed taps to cancel a non-auto-attack strike against its bearer).

    // Try items first.
    let hostCharId: string | null = null;
    let itemIndex = -1;
    for (const [charKey, ch] of Object.entries(defPlayer.characters)) {
      const idx = ch.items.findIndex(i => i.instanceId === action.cancellerInstanceId);
      if (idx >= 0) {
        hostCharId = charKey;
        itemIndex = idx;
        break;
      }
    }

    if (hostCharId !== null && itemIndex >= 0) {
      const hostChar = defPlayer.characters[hostCharId];
      const item = hostChar.items[itemIndex];
      const itemDef = state.cardPool[item.definitionId as string];
      const itemName = itemDef && 'name' in itemDef ? (itemDef as { name: string }).name : (item.definitionId as string);
      logDetail(`${itemName} taps to cancel strike against ${currentStrike.characterId as string}`);

      const newItems = [...hostChar.items];
      newItems[itemIndex] = { ...item, status: CardStatus.Tapped };
      nextState = updatePlayer(state, defPlayerIndex, p =>
        updateCharacter(p, hostCharId, c => ({ ...c, items: newItems })),
      );
    } else {
      // Try allies.
      let allyHostCharId: string | null = null;
      let allyIndex = -1;
      for (const [charKey, ch] of Object.entries(defPlayer.characters)) {
        const idx = ch.allies.findIndex(a => a.instanceId === action.cancellerInstanceId);
        if (idx >= 0) {
          allyHostCharId = charKey;
          allyIndex = idx;
          break;
        }
      }
      if (allyHostCharId === null || allyIndex < 0) {
        return { state, error: 'Canceller not found as character, item, or ally' };
      }
      const allyHostChar = defPlayer.characters[allyHostCharId];
      const ally = allyHostChar.allies[allyIndex];
      const allyDef = state.cardPool[ally.definitionId as string];
      const allyName = allyDef && 'name' in allyDef ? (allyDef as { name: string }).name : (ally.definitionId as string);
      logDetail(`${allyName} taps to cancel strike against ${currentStrike.characterId as string}`);

      const newAllies = [...allyHostChar.allies];
      newAllies[allyIndex] = { ...ally, status: CardStatus.Tapped };
      nextState = updatePlayer(state, defPlayerIndex, p =>
        updateCharacter(p, allyHostCharId, c => ({ ...c, allies: newAllies })),
      );
    }
  }

  const newAssignments = [...combat.strikeAssignments];
  newAssignments[combat.currentStrikeIndex] = { ...currentStrike, resolved: true, result: 'canceled' };

  const combatWithAssignments = { ...combat, strikeAssignments: newAssignments };
  const next = nextStrikePhase(combatWithAssignments);
  if (!next) {
    return finalizeCombat({ ...nextState, combat: combatWithAssignments });
  }
  return {
    state: { ...nextState, combat: { ...combatWithAssignments, ...next } },
  };
}

/**
 * Play a dodge-strike card from hand during resolve-strike. Moves the
 * card from hand to discard and initiates a chain so the opponent gets
 * priority to respond. On chain resolution, `resolveChainDodgeStrike`
 * applies the actual dodge effect.
 */
function handlePlayDodge(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'play-dodge') return wrongActionType(state, action, 'play-dodge');

  const defPlayerIndex = state.players.findIndex(p => p.id === combat.defendingPlayerId);
  const defPlayer = state.players[defPlayerIndex];
  const handIndex = defPlayer.hand.findIndex(c => c.instanceId === action.cardInstanceId);
  const handCard = defPlayer.hand[handIndex];
  logDetail(`Playing dodge card ${handCard.definitionId as string}`);

  // Move card from hand to discard pile. The chain holds a reference to the
  // card instance, so the identity becomes public via accrueRevealedInstances.
  let resultState = updatePlayer(state, defPlayerIndex, p => ({
    ...p,
    hand: [...p.hand.slice(0, handIndex), ...p.hand.slice(handIndex + 1)],
    discardPile: [...p.discardPile, { instanceId: handCard.instanceId, definitionId: handCard.definitionId }],
  }));

  // Initiate chain — opponent gets priority to respond. On resolution,
  // the chain resolver applies the dodge effect via resolveChainDodgeStrike.
  const payload: import('../index.js').ChainEntryPayload = { type: 'short-event' };
  if (resultState.chain === null) {
    resultState = initiateChain(resultState, action.player, handCard, payload);
  } else {
    resultState = pushChainEntry(resultState, action.player, handCard, payload);
  }

  return { state: resultState };
}

/**
 * Play a `modify-strike` short event (e.g. Risky Blow) from hand during
 * resolve-strike. Moves the card from hand to discard and initiates a
 * chain so the opponent gets priority to respond. On chain resolution,
 * `resolveChainModifyStrike` applies the prowess/body modifiers.
 *
 * The `requiredSkillEventPlayed` flag is set at DECLARATION time so that
 * CoE rule 3.iv.5 blocks a second skill-required event from being
 * declared while the first is still on the chain.
 */
function handlePlayStrikeEvent(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'play-strike-event') return { state, error: 'Expected play-strike-event' };

  const defPlayerIndex = state.players.findIndex(p => p.id === combat.defendingPlayerId);
  const defPlayer = state.players[defPlayerIndex];
  const handIndex = defPlayer.hand.findIndex(c => c.instanceId === action.cardInstanceId);
  if (handIndex < 0) return { state, error: 'Card not found in hand' };
  const handCard = defPlayer.hand[handIndex];
  const cardDef = state.cardPool[handCard.definitionId as string];
  const effects = (cardDef as { effects?: readonly import('../types/effects.js').CardEffect[] } | undefined)?.effects ?? [];
  const modifyEffect = effects.find((e): e is ModifyStrikeEffect => e.type === 'modify-strike');
  if (!modifyEffect) return { state, error: 'Card has no modify-strike effect' };

  const currentStrike = combat.strikeAssignments[combat.currentStrikeIndex];
  if (modifyEffect.requiredSkill && currentStrike?.requiredSkillEventPlayed) {
    return { state, error: 'Only one resource that requires a skill may be played per strike (CoE 3.iv.5)' };
  }

  const cardName = (cardDef as { name?: string } | undefined)?.name ?? (handCard.definitionId as string);
  const prowessBonus = modifyEffect.prowessBonus ?? 0;
  const bodyPenalty = modifyEffect.bodyPenalty ?? 0;
  logDetail(`Playing strike event ${cardName}: prowess ${prowessBonus >= 0 ? '+' : ''}${prowessBonus}, body ${bodyPenalty >= 0 ? '+' : ''}${bodyPenalty}`);

  // Move card from hand to discard pile. The chain holds a reference to the
  // card instance, so the identity becomes public via accrueRevealedInstances.
  let resultState = updatePlayer(state, defPlayerIndex, p => ({
    ...p,
    hand: [...p.hand.slice(0, handIndex), ...p.hand.slice(handIndex + 1)],
    discardPile: [...p.discardPile, { instanceId: handCard.instanceId, definitionId: handCard.definitionId }],
  }));

  // Set requiredSkillEventPlayed at declaration time (CoE 3.iv.5): this
  // blocks a second skill-required event from being declared while this
  // card is still on the chain waiting to resolve.
  if (modifyEffect.requiredSkill) {
    const newAssignments = combat.strikeAssignments.map((a, i) =>
      i === combat.currentStrikeIndex ? { ...a, requiredSkillEventPlayed: true } : a,
    );
    resultState = { ...resultState, combat: { ...combat, strikeAssignments: newAssignments } };
  }

  // Apply the modify-strike bonuses immediately and return to resolve-strike
  // so the defender can still choose tap-to-fight or stay-untapped.
  const finalState = resolveChainModifyStrike(resultState, prowessBonus, bodyPenalty, !!modifyEffect.requiredSkill);
  return { state: finalState };
}

/**
 * Play a reroll-strike card from hand during resolve-strike (e.g. Lucky
 * Strike). Moves the card from hand to discard and initiates a chain so
 * the opponent gets priority to respond. On chain resolution,
 * `resolveChainRerollStrike` applies the reroll effect.
 */
function handlePlayRerollStrike(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'play-reroll-strike') return { state, error: 'Expected play-reroll-strike' };

  const defPlayerIndex = state.players.findIndex(p => p.id === combat.defendingPlayerId);
  const defPlayer = state.players[defPlayerIndex];
  const handIndex = defPlayer.hand.findIndex(c => c.instanceId === action.cardInstanceId);
  const handCard = defPlayer.hand[handIndex];

  logDetail(`Playing reroll-strike card ${handCard.definitionId as string}`);

  // Move card from hand to discard pile. The chain holds a reference to the
  // card instance, so the identity becomes public via accrueRevealedInstances.
  const resultState = updatePlayer(state, defPlayerIndex, p => ({
    ...p,
    hand: [...p.hand.slice(0, handIndex), ...p.hand.slice(handIndex + 1)],
    discardPile: [...p.discardPile, { instanceId: handCard.instanceId, definitionId: handCard.definitionId }],
  }));

  // Resolve the reroll immediately — two rolls are made and the better
  // result is used; the strike resolves without waiting for a chain.
  return resolveChainRerollStrike(resultState);
}

/** Roll body check — attacker rolls 2d6 vs body value. */
function handleBodyCheckRoll(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'body-check-roll') return wrongActionType(state, action, 'body-check-roll');

  const { roll, rng, cheatRollTotal } = roll2d6(state);
  const rollTotal = roll.die1 + roll.die2;
  const atkPlayerIndex = state.players.findIndex(p => p.id === combat.attackingPlayerId);
  const effects: GameEffect[] = [{
    effect: 'dice-roll', playerName: state.players[atkPlayerIndex].name,
    die1: roll.die1, die2: roll.die2, label: `Body check: ${combat.bodyCheckTarget}`,
  }];

  // Update lastDiceRoll on the attacking player
  const stateWithRoll: GameState = {
    ...updatePlayer(state, atkPlayerIndex, p => ({ ...p, lastDiceRoll: roll })),
    rng,
    cheatRollTotal,
  };

  if (combat.bodyCheckTarget === 'creature') {
    // Body check against creature — apply enemy-modifier effects (e.g. Éowyn halves Nazgûl body)
    let body = combat.creatureBody ?? 0;
    const strike2 = combat.strikeAssignments[combat.currentStrikeIndex];
    if (strike2 && combat.creatureRace) {
      const defIdx2 = stateWithRoll.players.findIndex(p => p.id === combat.defendingPlayerId);
      const charData2 = stateWithRoll.players[defIdx2].characters[strike2.characterId as string];
      if (charData2) {
        const inPlayNames2 = buildInPlayNames(stateWithRoll);
        const enemy2 = { race: combat.creatureRace, name: '', prowess: combat.strikeProwess, body: combat.creatureBody };
        const modifiedBody = resolveEnemyBody(stateWithRoll, charData2, enemy2, body, inPlayNames2);
        if (modifiedBody !== body) {
          logDetail(`Enemy body modified by character effects: ${body} → ${modifiedBody}`);
          body = modifiedBody;
        }
      }
    }
    logDetail(`Body check vs creature: roll ${rollTotal} vs body ${body}`);
    if (rollTotal > body) {
      logDetail('Creature body check failed — creature defeated');
      // Mark in strike assignment that the creature was defeated on this strike
    } else {
      logDetail('Creature body check passed — creature survives');
    }

    // Advance to next strike or finalize
    const next1 = nextStrikePhase(combat);
    if (next1) {
      return { state: { ...stateWithRoll, combat: { ...combat, ...next1 } }, effects };
    }
    return finalizeCombat(stateWithRoll, effects);
  }

  if (combat.bodyCheckTarget === 'character') {
    // Body check against character or ally (CoE rule 2.V.2.2)
    const strike = combat.strikeAssignments[combat.currentStrikeIndex];
    const defPlayerIndex = stateWithRoll.players.findIndex(p => p.id === combat.defendingPlayerId);
    const defPlayer = stateWithRoll.players[defPlayerIndex];
    const charData = defPlayer.characters[strike.characterId as string];
    const company = defPlayer.companies.find(c => c.id === combat.companyId);
    const allyMatch = !charData && company
      ? findAllyInCompany(defPlayer, company.characters, strike.characterId)
      : undefined;
    if (!charData && !allyMatch) return { state, error: 'Character not found for body check' };

    const targetDefId = charData?.definitionId ?? allyMatch!.ally.definitionId;
    const charDef2 = stateWithRoll.cardPool[targetDefId as string] as { body?: number } | undefined;
    let body = charDef2?.body ?? 9; // Default body if not specified
    // Dodge body penalty: if the character was dodging and got wounded, apply body modifier
    if (strike.dodged && strike.dodgeBodyPenalty) {
      logDetail(`Dodge body penalty: body ${body} + (${strike.dodgeBodyPenalty}) = ${body + strike.dodgeBodyPenalty}`);
      body = body + strike.dodgeBodyPenalty;
    }
    // Modify-strike body penalty (e.g. Risky Blow's -1).
    if (strike.strikeBodyPenalty) {
      logDetail(`Strike event body penalty: body ${body} + (${strike.strikeBodyPenalty}) = ${body + strike.strikeBodyPenalty}`);
      body = body + strike.strikeBodyPenalty;
    }
    const woundedBonus = strike.wasAlreadyWounded ? 1 : 0;
    const effectiveRoll = rollTotal + woundedBonus;

    logDetail(`Body check vs ${allyMatch ? 'ally' : 'character'}: roll ${rollTotal}${woundedBonus ? '+1(wounded)' : ''} = ${effectiveRoll} vs body ${body}`);

    if (effectiveRoll > body) {
      // Combatant eliminated
      logDetail(`${allyMatch ? 'Ally' : 'Character'} eliminated`);
      // Per CoE rule 3.i.5: remaining unresolved strikes assigned to the
      // same combatant are considered successful (defeated by the defender).
      const newAssignments = combat.strikeAssignments.map((a, i) => {
        if (i === combat.currentStrikeIndex) return { ...a, result: 'eliminated' as const };
        if (!a.resolved && a.characterId === strike.characterId) {
          logDetail(`Strike ${i} auto-resolved as successful (eliminated combatant, CoE 3.i.5)`);
          return { ...a, resolved: true, result: 'success' as const };
        }
        return a;
      });

      const newPlayers2 = clonePlayers(stateWithRoll);
      const newPlayerData = { ...defPlayer };
      const combatWithElim = { ...combat, strikeAssignments: newAssignments };

      if (allyMatch) {
        // Ally eliminated — remove from host character and send to eliminated
        // pile. Per CoE 2.V.2.2 allies are treated as characters for combat,
        // so a failed body check eliminates them (to outOfPlayPile) rather
        // than discarding (which is what happens when the host leaves play
        // per CoE 2.V.2.3).
        const hostChar = newPlayerData.characters[allyMatch.hostCharId as string];
        if (hostChar) {
          const newAllies = hostChar.allies.filter(a => a.instanceId !== strike.characterId);
          newPlayerData.characters = {
            ...newPlayerData.characters,
            [allyMatch.hostCharId as string]: { ...hostChar, allies: newAllies },
          };
        }
        newPlayerData.outOfPlayPile = [...newPlayerData.outOfPlayPile, {
          instanceId: strike.characterId,
          definitionId: allyMatch.ally.definitionId,
        }];
        newPlayers2[defPlayerIndex] = newPlayerData;

        // Allies don't have items to salvage — advance to next strike or finalize
        const next2a = nextStrikePhase(combatWithElim);
        if (next2a) {
          return { state: { ...stateWithRoll, players: newPlayers2, combat: { ...combatWithElim, ...next2a } }, effects };
        }
        return finalizeCombat({ ...stateWithRoll, players: newPlayers2, combat: combatWithElim }, effects);
      }

      // Character eliminated — remove from company and add to eliminated pile
      if (company) {
        const newCompanies = newPlayerData.companies.map(c =>
          c.id === combat.companyId
            ? { ...c, characters: c.characters.filter(ch => ch !== strike.characterId) }
            : c,
        );
        newPlayerData.companies = newCompanies;
      }
      // Move character to eliminated pile
      const elimCharDefId = resolveInstanceId(state, strike.characterId);
      newPlayerData.outOfPlayPile = [...newPlayerData.outOfPlayPile, { instanceId: strike.characterId, definitionId: elimCharDefId! }];

      // Discard allies and hazards on the eliminated character immediately
      for (const ally of charData.allies) {
        logDetail(`Discarding ally ${ally.instanceId as string} from eliminated character`);
        newPlayerData.discardPile = [...newPlayerData.discardPile, { instanceId: ally.instanceId, definitionId: ally.definitionId }];
      }

      const { [strike.characterId as string]: _, ...remainingChars } = newPlayerData.characters;
      newPlayerData.characters = remainingChars;
      newPlayers2[defPlayerIndex] = newPlayerData;

      // Per CoE rule 3.I.2: for each unwounded character in the same company,
      // an item the eliminated character controlled may be transferred (one per recipient).
      const salvageItems = charData.items;
      const unwoundedRecipients: CardInstanceId[] = company
        ? company.characters
          .filter(ch => ch !== strike.characterId)
          .filter(ch => {
            const cd = newPlayerData.characters[ch as string];
            return cd && cd.status !== CardStatus.Inverted;
          })
        : [];

      if (salvageItems.length > 0 && unwoundedRecipients.length > 0) {
        logDetail(`Entering item-salvage phase: ${salvageItems.length} item(s) available, ${unwoundedRecipients.length} unwounded recipient(s)`);
        const combatWithSalvage: CombatState = {
          ...combatWithElim,
          phase: 'item-salvage',
          salvageItems,
          salvageRecipients: unwoundedRecipients,
        };
        return { state: { ...stateWithRoll, players: newPlayers2, combat: combatWithSalvage }, effects };
      }

      // No items or no recipients — discard all items immediately
      for (const item of salvageItems) {
        logDetail(`Discarding item ${item.instanceId as string} (no salvage possible)`);
        newPlayers2[defPlayerIndex] = {
          ...newPlayers2[defPlayerIndex],
          discardPile: [...newPlayers2[defPlayerIndex].discardPile, { instanceId: item.instanceId, definitionId: item.definitionId }],
        };
      }

      // Advance to next strike or finalize
      const next2 = nextStrikePhase(combatWithElim);
      if (next2) {
        return { state: { ...stateWithRoll, players: newPlayers2, combat: { ...combatWithElim, ...next2 } }, effects };
      }
      return finalizeCombat({ ...stateWithRoll, players: newPlayers2, combat: combatWithElim }, effects);
    }

    // Check for on-event: character-body-check-equals-body on the attack source.
    // Example: Giant Spiders discards non-Wizard/non-Ringwraith characters when
    // the body check roll exactly equals (not exceeds) the character's body.
    if (effectiveRoll === body && charData && !allyMatch) {
      const sourceCard = getAttackSourceCard(stateWithRoll, combat);
      const equalsBodyEvent = getOnEventEffects(sourceCard, 'character-body-check-equals-body')[0];
      if (equalsBodyEvent) {
        const targetCharDef = stateWithRoll.cardPool[targetDefId as string];
        const targetRace = isCharacterCard(targetCharDef) ? targetCharDef.race : undefined;
        const condContext: Record<string, unknown> = { target: { race: targetRace } };
        const conditionMet = !equalsBodyEvent.when || matchesCondition(equalsBodyEvent.when, condContext);
        if (conditionMet && equalsBodyEvent.apply.type === 'discard-character') {
          logDetail(`Body check equals body — character discarded to discard pile (not eliminated)`);
          const newAssignments2 = combat.strikeAssignments.map((a, i) => {
            if (i === combat.currentStrikeIndex) return { ...a, result: 'eliminated' as const };
            if (!a.resolved && a.characterId === strike.characterId) {
              logDetail(`Strike ${i} auto-resolved (discarded combatant, CoE 3.i.5)`);
              return { ...a, resolved: true, result: 'success' as const };
            }
            return a;
          });
          const newPlayers3 = clonePlayers(stateWithRoll);
          const newPlayerData2 = { ...defPlayer };
          const combatWithDiscard = { ...combat, strikeAssignments: newAssignments2 };
          if (company) {
            newPlayerData2.companies = newPlayerData2.companies.map(c =>
              c.id === combat.companyId
                ? { ...c, characters: c.characters.filter(ch => ch !== strike.characterId) }
                : c,
            );
          }
          const discardedCharDefId = resolveInstanceId(state, strike.characterId);
          newPlayerData2.discardPile = [...newPlayerData2.discardPile, { instanceId: strike.characterId, definitionId: discardedCharDefId! }];
          for (const ally of charData.allies) {
            logDetail(`Discarding ally ${ally.instanceId as string} from discarded character`);
            newPlayerData2.discardPile = [...newPlayerData2.discardPile, { instanceId: ally.instanceId, definitionId: ally.definitionId }];
          }
          for (const item of charData.items) {
            logDetail(`Discarding item ${item.instanceId as string} from discarded character`);
            newPlayerData2.discardPile = [...newPlayerData2.discardPile, { instanceId: item.instanceId, definitionId: item.definitionId }];
          }
          const { [strike.characterId as string]: _disc, ...remainingCharsDisc } = newPlayerData2.characters;
          newPlayerData2.characters = remainingCharsDisc;
          newPlayers3[defPlayerIndex] = newPlayerData2;
          const next4 = nextStrikePhase(combatWithDiscard);
          if (next4) {
            return { state: { ...stateWithRoll, players: newPlayers3, combat: { ...combatWithDiscard, ...next4 } }, effects };
          }
          return finalizeCombat({ ...stateWithRoll, players: newPlayers3, combat: combatWithDiscard }, effects);
        }
      }
    }

    logDetail(`${allyMatch ? 'Ally' : 'Character'} survives body check`);
    // Advance to next strike or finalize
    const next3 = nextStrikePhase(combat);
    if (next3) {
      return { state: { ...stateWithRoll, combat: { ...combat, ...next3 } }, effects };
    }
    return finalizeCombat(stateWithRoll, effects);
  }

  return { state, error: 'Invalid body check target' };
}

/**
 * Declare a cancel-attack action by playing a short-event card from hand.
 *
 * Follows the MECCG chain-of-effects rule: playing a cancel-attack card
 * declares a chain entry rather than immediately cancelling combat. The
 * opponent has priority to respond (e.g. with a hazard that cancels the
 * cancellation). When both players pass chain priority, the chain
 * auto-resolves and the cancel-attack entry applies its effect to the
 * active combat via {@link resolveCancelAttackEntry}.
 *
 * Costs (tapping a scout or enqueuing a corruption check) are paid
 * immediately at declaration per CoE rule 9.5.2 — active conditions do
 * not initiate their own chain and cannot be refunded by negation.
 * The card itself moves from hand to discard pile at declaration, matching
 * the behaviour of other short events.
 */
/**
 * Handle cancel-attack sourced from an in-play ally (e.g. The Warg-king's
 * "tap to cancel a Wolf or Animal attack"). Unlike a hand-played short event,
 * no chain entry is pushed — tapping the ally pays the cost and the
 * cancellation applies immediately via {@link resolveCancelAttackEntry}.
 */
function handleCancelAttackByInPlayAlly(
  state: GameState,
  action: GameAction,
  combat: CombatState,
): ReducerResult {
  if (action.type !== 'cancel-attack') return wrongActionType(state, action, 'cancel-attack');

  const defPlayerIndex = state.players.findIndex(p => p.id === action.player);
  const defPlayer = state.players[defPlayerIndex];
  const company = defPlayer.companies.find(c => c.id === combat.companyId);
  if (!company) return { state, error: 'Defending company not found' };

  const found = findAllyInCompany(defPlayer, company.characters, action.cardInstanceId);
  if (!found) return { state, error: 'Cancel-attack source not in hand or defending company allies' };
  if (found.ally.status !== CardStatus.Untapped) {
    return { state, error: 'Ally must be untapped to cancel attack' };
  }

  const allyDef = state.cardPool[found.ally.definitionId as string];
  const allyName = allyDef && 'name' in allyDef ? allyDef.name : String(found.ally.definitionId);
  logDetail(`Cancel-attack declared: tapping ${allyName} to cancel ${combat.creatureRace ?? 'attack'}`);

  const tappedState = updatePlayer(state, defPlayerIndex, p =>
    updateCharacter(p, found.hostCharId, c => ({
      ...c,
      allies: c.allies.map(a =>
        a.instanceId === action.cardInstanceId ? { ...a, status: CardStatus.Tapped } : a,
      ),
    })),
  );
  return { state: resolveCancelAttackEntry(tappedState) };
}

/**
 * Handle cancel-attack sourced from an in-play character (e.g. Adûnaphel
 * the Ringwraith's Darkhaven tap). Mirrors {@link handleCancelAttackByInPlayAlly}
 * but taps the character directly.
 */
function handleCancelAttackByInPlayCharacter(
  state: GameState,
  action: GameAction,
  combat: CombatState,
): ReducerResult {
  if (action.type !== 'cancel-attack') return wrongActionType(state, action, 'cancel-attack');

  const defPlayerIndex = state.players.findIndex(p => p.id === action.player);
  const defPlayer = state.players[defPlayerIndex];
  const company = defPlayer.companies.find(c => c.id === combat.companyId);
  if (!company) return { state, error: 'Defending company not found' };

  const charData = defPlayer.characters[action.cardInstanceId as string];
  if (!charData) return { state, error: 'Cancel-attack source character not found' };
  if (!company.characters.includes(action.cardInstanceId)) {
    return { state, error: 'Cancel-attack character is not in the defending company' };
  }
  if (charData.status !== CardStatus.Untapped) {
    return { state, error: 'Character must be untapped to cancel attack' };
  }

  const charDef = state.cardPool[charData.definitionId as string];
  const charName = charDef && 'name' in charDef ? charDef.name : String(charData.definitionId);
  logDetail(`Cancel-attack declared: tapping ${charName} to cancel ${combat.creatureRace ?? 'attack'}`);

  const tappedState = updatePlayer(state, defPlayerIndex, p =>
    updateCharacter(p, action.cardInstanceId, c => ({ ...c, status: CardStatus.Tapped })),
  );
  return { state: resolveCancelAttackEntry(tappedState) };
}

/**
 * Handle cancel-attack sourced from an in-play item with cost "self-and-bearer"
 * (e.g. Torque of Hues: tap item AND its bearer to cancel an attack; bearer
 * makes a corruption check afterward).
 */
function handleCancelAttackByInPlayItem(
  state: GameState,
  action: GameAction,
  combat: CombatState,
): ReducerResult {
  if (action.type !== 'cancel-attack') return wrongActionType(state, action, 'cancel-attack');

  const defPlayerIndex = state.players.findIndex(p => p.id === action.player);
  const defPlayer = state.players[defPlayerIndex];
  const company = defPlayer.companies.find(c => c.id === combat.companyId);
  if (!company) return { state, error: 'Defending company not found' };

  const found = findItemInCompany(defPlayer, company.characters, action.cardInstanceId);
  if (!found) return { state, error: 'Cancel-attack source item not found in defending company' };

  const { item, hostCharId } = found;
  if (item.status !== CardStatus.Untapped) {
    return { state, error: 'Item must be untapped to cancel attack' };
  }

  const bearerData = defPlayer.characters[hostCharId as string];
  if (!bearerData) return { state, error: 'Bearer character not found' };
  if (bearerData.status !== CardStatus.Untapped) {
    return { state, error: 'Bearer must be untapped to cancel attack with this item' };
  }

  const itemDef = state.cardPool[item.definitionId as string] as { name?: string; effects?: readonly import('../types/effects.js').CardEffect[] } | undefined;
  const itemName = itemDef?.name ?? (item.definitionId as string);
  const cancelEffect = itemDef?.effects?.find(
    (e): e is import('../types/effects.js').CancelAttackEffect => e.type === 'cancel-attack',
  );

  logDetail(`Cancel-attack declared: tapping item ${itemName} and bearer ${hostCharId as string} to cancel ${combat.creatureRace ?? 'attack'}`);

  // Tap the item and its bearer.
  let tappedState = updatePlayer(state, defPlayerIndex, p =>
    updateCharacter(p, hostCharId, c => ({
      ...c,
      status: CardStatus.Tapped,
      items: c.items.map(i =>
        i.instanceId === item.instanceId ? { ...i, status: CardStatus.Tapped } : i,
      ),
    })),
  );

  // Cancel the attack immediately (items, like allies, don't push a chain entry).
  tappedState = resolveCancelAttackEntry(tappedState);

  // Enqueue corruption check on bearer if effect declares it.
  if (cancelEffect?.enqueueCorruptionCheck) {
    const phase = state.phaseState.phase;
    const companyId = company.id;
    const scope = phase === Phase.MovementHazard
      ? ({ kind: 'company-mh-subphase' as const, companyId })
      : ({ kind: 'company-site-subphase' as const, companyId });
    logDetail(`Cancel-attack: enqueuing corruption check on bearer ${hostCharId as string} (${itemName})`);
    tappedState = enqueueCorruptionCheck(tappedState, {
      source: item.instanceId,
      actor: action.player,
      scope,
      characterId: hostCharId,
      reason: itemName,
    });
  }

  return { state: tappedState };
}

function handleCancelAttack(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'cancel-attack') return wrongActionType(state, action, 'cancel-attack');

  const defPlayerIndex = state.players.findIndex(p => p.id === action.player);
  const defPlayer = state.players[defPlayerIndex];

  const cardIndex = defPlayer.hand.findIndex(c => c.instanceId === action.cardInstanceId);
  if (cardIndex < 0) {
    // Source may be an in-play character tapping to cancel (e.g. Adûnaphel
    // the Ringwraith's Darkhaven tap), an in-play ally (e.g. The Warg-king),
    // or an in-play item with self-and-bearer cost (e.g. Torque of Hues).
    if (defPlayer.characters[action.cardInstanceId as string]) {
      return handleCancelAttackByInPlayCharacter(state, action, combat);
    }
    // Check items before falling through to ally handler.
    const defCompany = defPlayer.companies.find(c => c.id === combat.companyId);
    if (defCompany && findItemInCompany(defPlayer, defCompany.characters, action.cardInstanceId)) {
      return handleCancelAttackByInPlayItem(state, action, combat);
    }
    return handleCancelAttackByInPlayAlly(state, action, combat);
  }
  const handCard = defPlayer.hand[cardIndex];

  // Look up the cancel-attack effect to determine cost type.
  const cardDef = state.cardPool[handCard.definitionId as string];
  const effects = (cardDef as { effects?: readonly import('../types/effects.js').CardEffect[] } | undefined)?.effects;
  const cancelEffect = effects?.find(
    (e): e is import('../types/effects.js').CancelAttackEffect => e.type === 'cancel-attack',
  );

  // Pay character cost via cost-evaluator: tap or enqueue corruption check.
  let resultState: GameState = state;
  if (action.scoutInstanceId && cancelEffect?.cost) {
    const company = defPlayer.companies.find(c => c.id === combat.companyId);
    const companyId = company?.id;
    const scopeKind = state.phaseState.phase === Phase.MovementHazard
      ? 'company-mh-subphase' as const
      : 'company-site-subphase' as const;
    const costResult = applyCost(state, cancelEffect.cost, action.scoutInstanceId, {
      playerIndex: defPlayerIndex,
      sourceCardId: action.cardInstanceId,
      companyId,
      checkScopeKind: scopeKind,
      label: cardDef?.name ?? '?',
    });
    if ('error' in costResult) return { state, error: costResult.error };
    resultState = costResult.state;
  } else {
    logDetail(`Cancel-attack declared: ${handCard.definitionId as string} played via chain (no cost)`);
  }

  // Move card from hand to discard pile — short events are physically
  // discarded at play time; the chain holds only a reference.
  const newHand = [...defPlayer.hand];
  newHand.splice(cardIndex, 1);
  const newDiscard = [...defPlayer.discardPile, { instanceId: handCard.instanceId, definitionId: handCard.definitionId }];

  resultState = updatePlayer(resultState, defPlayerIndex, p => ({
    ...p,
    hand: newHand,
    discardPile: newDiscard,
  }));

  // Push/initiate chain entry — opponent gets priority to respond. On
  // resolution, the chain resolver applies the combat cancellation via
  // resolveCancelAttackEntry.
  const payload: import('../index.js').ChainEntryPayload = action.targetCharacterId
    ? { type: 'short-event', targetCharacterId: action.targetCharacterId }
    : { type: 'short-event' };
  if (resultState.chain === null) {
    resultState = initiateChain(resultState, action.player, handCard, payload);
  } else {
    resultState = pushChainEntry(resultState, action.player, handCard, payload);
  }

  return { state: resultState };
}

/**
 * Apply the cancel-attack effect when its chain entry resolves.
 *
 * Called from the chain resolver when a short-event entry with a
 * `cancel-attack` effect is resolved (and not negated). Applies the
 * combat-cancellation logic that previously ran immediately in
 * {@link handleCancelAttack}:
 *
 * - For multi-attack creatures (e.g. Assassin), reduce `strikesTotal` by
 *   one rather than ending combat — each multi-attack sub-attack is a
 *   separate "attack".
 * - Otherwise, clear `state.combat` and move the attacking creature from
 *   the attacker's cardsInPlay to their discard pile.
 *
 * Returns the unchanged state if combat is no longer active (fizzle).
 */
export function resolveCancelAttackEntry(state: GameState): GameState {
  const combat = state.combat;
  if (!combat) {
    logDetail('Cancel-attack resolves: no active combat — fizzle');
    return state;
  }

  const newPlayers = clonePlayers(state);

  // For multi-attack creatures (e.g. Assassin), cancelling one attack
  // removes one strike rather than ending the entire combat.
  if (combat.forceSingleTarget && combat.strikesTotal > 1) {
    const newStrikesTotal = combat.strikesTotal - 1;
    logDetail(`Multi-attack: one attack canceled, strikes reduced ${combat.strikesTotal} → ${newStrikesTotal}`);
    const newCancelByTap = combat.cancelByTapRemaining !== undefined
      ? Math.min(combat.cancelByTapRemaining, newStrikesTotal)
      : undefined;
    return {
      ...state,
      players: newPlayers,
      combat: {
        ...combat,
        strikesTotal: newStrikesTotal,
        cancelByTapRemaining: newCancelByTap,
        multiAttackCount: combat.multiAttackCount !== undefined ? combat.multiAttackCount - 1 : undefined,
      },
    };
  }

  // If this was a creature attack, move creature card from attacker's
  // cardsInPlay to discard.
  const atkIdx = state.players.findIndex(p => p.id === combat.attackingPlayerId);
  const creatureInstanceId =
    combat.attackSource.type === 'creature' ? combat.attackSource.instanceId
      : combat.attackSource.type === 'on-guard-creature' ? combat.attackSource.cardInstanceId
        : combat.attackSource.type === 'played-auto-attack' ? combat.attackSource.instanceId
          : null;
  if (creatureInstanceId) {
    const creatureInPlay = newPlayers[atkIdx].cardsInPlay.find(c => c.instanceId === creatureInstanceId);
    if (creatureInPlay) {
      newPlayers[atkIdx] = {
        ...newPlayers[atkIdx],
        cardsInPlay: newPlayers[atkIdx].cardsInPlay.filter(c => c.instanceId !== creatureInstanceId),
        discardPile: [...newPlayers[atkIdx].discardPile, { instanceId: creatureInPlay.instanceId, definitionId: creatureInPlay.definitionId }],
      };
    }
  }

  // card-triggered-attack cancelled: the attack never resolved, so treat all
  // characters as having survived untapped. Queue bearer selection if any
  // untapped characters remain; otherwise discard the card.
  let stateWithCancelledPlayers: GameState = { ...state, players: newPlayers, combat: null };
  if (combat.attackSource.type === 'card-triggered-attack') {
    const { cardInstanceId } = combat.attackSource;
    const defIdx = stateWithCancelledPlayers.players.findIndex(p => p.id === combat.defendingPlayerId);
    const defPlayer = stateWithCancelledPlayers.players[defIdx];
    const company = defPlayer.companies.find(co => co.id === combat.companyId);
    const anyUntapped = company
      ? company.characters.some(charId => {
          const ch = defPlayer.characters[charId as string];
          return ch && ch.status === CardStatus.Untapped;
        })
      : false;
    const cardDefId = resolveInstanceId(stateWithCancelledPlayers, cardInstanceId);
    const cardName = cardDefId
      ? (stateWithCancelledPlayers.cardPool[cardDefId as string] as { name?: string })?.name ?? '?'
      : '?';
    if (!anyUntapped) {
      logDetail(`Card-auto-attack cancelled: no untapped characters — discarding "${cardName}"`);
      stateWithCancelledPlayers = discardCardTriggeredCard(stateWithCancelledPlayers, cardInstanceId, defIdx);
    } else {
      logDetail(
        `Card-auto-attack cancelled: untapped characters remain — queuing select-card-bearer for "${cardName}"`,
      );
      stateWithCancelledPlayers = enqueueResolution(stateWithCancelledPlayers, {
        source: cardInstanceId,
        actor: combat.defendingPlayerId,
        scope: { kind: 'phase', phase: stateWithCancelledPlayers.phaseState.phase },
        kind: {
          type: 'select-card-bearer',
          cardInstanceId,
          companyId: combat.companyId,
        },
      });
    }
  }

  logDetail('Combat canceled by chain resolution — returning to enclosing phase');
  return stateWithCancelledPlayers;
}

/**
 * Apply a dodge-strike card's effect when its chain entry resolves.
 *
 * Called from the chain resolver when a short-event entry carrying a
 * `dodge-strike` effect resolves un-negated. Delegates to
 * {@link resolveStrikeCore} in dodge mode. The card was already removed
 * from hand when the chain was initiated, so `preAppliedDefender` is null.
 *
 * @param state - Current game state (must have active combat).
 * @param bodyPenalty - The body modifier applied if the character is wounded.
 */
export function resolveChainDodgeStrike(state: GameState, bodyPenalty: number): ReducerResult {
  const combat = state.combat;
  if (!combat) return { state, error: 'No active combat' };
  return resolveStrikeCore(state, combat, 'dodge', bodyPenalty, null);
}

/**
 * Apply a reroll-strike card's effect when its chain entry resolves.
 *
 * Called from the chain resolver when a short-event entry carrying a
 * `reroll-strike` effect resolves un-negated. Delegates to
 * {@link resolveStrikeCore} in reroll mode. The card was already removed
 * from hand when the chain was initiated, so `preAppliedDefender` is null.
 *
 * @param state - Current game state (must have active combat).
 */
export function resolveChainRerollStrike(state: GameState): ReducerResult {
  const combat = state.combat;
  if (!combat) return { state, error: 'No active combat' };
  return resolveStrikeCore(state, combat, 'reroll', 0, null);
}

/**
 * Apply a modify-strike card's accumulated bonuses when its chain entry resolves.
 *
 * Called from the chain resolver when a short-event entry carrying a
 * `modify-strike` effect resolves un-negated. Accumulates prowess and body
 * modifiers on the current strike assignment. (The `requiredSkillEventPlayed`
 * flag was already set at declaration time in {@link handlePlayStrikeEvent}.)
 *
 * @param state - Current game state (must have active combat).
 * @param prowessBonus - Bonus added to the character's prowess for the strike roll.
 * @param bodyPenalty - Penalty applied to the character's body on the body check.
 * @param requiredSkill - Whether the card required a skill (already recorded at declaration).
 */
export function resolveChainModifyStrike(
  state: GameState,
  prowessBonus: number,
  bodyPenalty: number,
  _requiredSkill: boolean,
): GameState {
  const combat = state.combat;
  if (!combat) return state;
  const newAssignments = combat.strikeAssignments.map((a, i) =>
    i === combat.currentStrikeIndex
      ? {
          ...a,
          strikeProwessBonus: (a.strikeProwessBonus ?? 0) + prowessBonus,
          strikeBodyPenalty: (a.strikeBodyPenalty ?? 0) + bodyPenalty,
        }
      : a,
  );
  return { ...state, combat: { ...combat, strikeAssignments: newAssignments } };
}

/**
 * Cancel one strike by tapping a non-target character in the defending
 * company. Used by the `cancel-attack-by-tap` combat rule (e.g. Assassin).
 * Removes one strike assignment and decrements cancelByTapRemaining.
 */
function handleCancelByTap(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'cancel-by-tap') return wrongActionType(state, action, 'cancel-by-tap');
  if (combat.phase !== 'assign-strikes' || combat.assignmentPhase !== 'cancel-by-tap') {
    return { state, error: 'Can only cancel-by-tap during cancel-by-tap sub-phase' };
  }
  if (action.player !== combat.defendingPlayerId) {
    return { state, error: 'Only defending player can cancel-by-tap' };
  }
  if (!combat.cancelByTapRemaining || combat.cancelByTapRemaining <= 0) {
    return { state, error: 'No cancel-by-tap opportunities remaining' };
  }

  const defPlayerIndex = state.players.findIndex(p => p.id === action.player);
  const defPlayer = state.players[defPlayerIndex];
  const company = defPlayer.companies.find(c => c.id === combat.companyId);
  if (!company || !company.characters.includes(action.characterId)) {
    return { state, error: 'Character not in defending company' };
  }

  // By default the target character cannot tap to cancel (Assassin: "not the defending character").
  // When cancelByTapAllowTarget is set (Slayer: "any one character"), the target may also tap.
  const targetCharId = combat.strikeAssignments[0]?.characterId;
  if (!combat.cancelByTapAllowTarget && action.characterId === targetCharId) {
    return { state, error: 'Cannot tap the defending character to cancel' };
  }

  const charData = defPlayer.characters[action.characterId as string];
  if (!charData || charData.status !== CardStatus.Untapped) {
    return { state, error: 'Character must be untapped' };
  }

  logDetail(`Cancel-by-tap: ${action.characterId as string} tapped to cancel one attack against ${targetCharId as string}`);

  // Tap the character
  const newPlayers = clonePlayers(state);
  const newCharacters = { ...defPlayer.characters };
  newCharacters[action.characterId as string] = { ...charData, status: CardStatus.Tapped };
  newPlayers[defPlayerIndex] = { ...defPlayer, characters: newCharacters };

  // Remove one strike assignment (the last one assigned to the target)
  const newAssignments = [...combat.strikeAssignments];
  newAssignments.pop();

  const newCancelRemaining = combat.cancelByTapRemaining - 1;
  const newStrikesTotal = combat.strikesTotal - 1;

  logDetail(`Strikes reduced: ${combat.strikesTotal} → ${newStrikesTotal}, cancels remaining: ${newCancelRemaining}`);

  // If no strikes remain, cancel combat entirely
  if (newAssignments.length === 0) {
    logDetail('All strikes canceled — combat ends');
    // Move creature to discard
    const atkIdx = state.players.findIndex(p => p.id === combat.attackingPlayerId);
    const creatureInstanceId =
      combat.attackSource.type === 'creature' ? combat.attackSource.instanceId
        : combat.attackSource.type === 'on-guard-creature' ? combat.attackSource.cardInstanceId
          : combat.attackSource.type === 'played-auto-attack' ? combat.attackSource.instanceId
            : null;
    if (creatureInstanceId) {
      const creatureInPlay = newPlayers[atkIdx].cardsInPlay.find(c => c.instanceId === creatureInstanceId);
      if (creatureInPlay) {
        newPlayers[atkIdx] = {
          ...newPlayers[atkIdx],
          cardsInPlay: newPlayers[atkIdx].cardsInPlay.filter(c => c.instanceId !== creatureInstanceId),
          discardPile: [...newPlayers[atkIdx].discardPile, { instanceId: creatureInPlay.instanceId, definitionId: creatureInPlay.definitionId }],
        };
      }
    }
    return { state: { ...state, players: newPlayers, combat: null } };
  }

  let newCombat: CombatState = {
    ...combat,
    strikeAssignments: newAssignments,
    strikesTotal: newStrikesTotal,
    cancelByTapRemaining: newCancelRemaining > 0 ? newCancelRemaining : undefined,
    multiAttackCount: combat.multiAttackCount !== undefined ? combat.multiAttackCount - 1 : undefined,
  };

  // If no more cancels available, proceed to strike resolution
  if (newCancelRemaining <= 0) {
    logDetail('No more cancel-by-tap opportunities — proceeding to resolution');
    const next = nextStrikePhase(newCombat);
    newCombat = { ...newCombat, assignmentPhase: 'done', ...next };
  }

  return { state: { ...state, players: newPlayers, combat: newCombat } };
}

/**
 * Halve the number of strikes in the current attack (rounded up) by
 * discarding a short event card from hand. Only allowed during the
 * assign-strikes phase before any strikes have been assigned.
 */
function handleHalveStrikes(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'halve-strikes') return wrongActionType(state, action, 'halve-strikes');
  if (combat.phase !== 'assign-strikes') return { state, error: 'Can only halve strikes before strikes are assigned' };
  if (combat.strikeAssignments.length > 0) return { state, error: 'Strikes already assigned — too late to halve' };
  if (action.player !== combat.defendingPlayerId) return { state, error: 'Only defending player can halve strikes' };

  const defPlayerIndex = state.players.findIndex(p => p.id === action.player);
  const defPlayer = state.players[defPlayerIndex];

  const cardIndex = defPlayer.hand.findIndex(c => c.instanceId === action.cardInstanceId);
  if (cardIndex < 0) return { state, error: 'Card not in hand' };

  const originalStrikes = combat.strikesTotal;
  const cardDef = state.cardPool[defPlayer.hand[cardIndex].definitionId as string];
  const halveEffect = cardDef && 'effects' in cardDef && cardDef.effects
    ? cardDef.effects.find(
        (e): e is HalveStrikesEffect => e.type === 'halve-strikes',
      )
    : undefined;
  const op = halveEffect?.op ?? 'halve';
  let newStrikes: number;
  if (op === 'subtract') {
    const subtractValue = halveEffect?.value ?? 2;
    const min = halveEffect?.min ?? 1;
    newStrikes = Math.max(min, originalStrikes - subtractValue);
    logDetail(`Strikes reduced by ${subtractValue} (min ${min}): ${originalStrikes} → ${newStrikes} (${defPlayer.hand[cardIndex].definitionId as string} played)`);
  } else {
    newStrikes = Math.ceil(originalStrikes / 2);
    logDetail(`Strikes halved: ${originalStrikes} → ${newStrikes} (${defPlayer.hand[cardIndex].definitionId as string} played)`);
  }

  const newHand = [...defPlayer.hand];
  const [discardedCard] = newHand.splice(cardIndex, 1);
  const newDiscard = [...defPlayer.discardPile, { instanceId: discardedCard.instanceId, definitionId: discardedCard.definitionId }];

  return {
    state: {
      ...updatePlayer(state, defPlayerIndex, p => ({ ...p, hand: newHand, discardPile: newDiscard })),
      combat: { ...combat, strikesTotal: newStrikes },
    },
  };
}

/**
 * Tap an in-play item to boost the bearer's prowess for the one strike
 * currently being resolved. The item must be untapped and belong to the
 * character assigned the current strike. Tapping it accumulates
 * `prowessBonus` onto `StrikeAssignment.strikeProwessBonus`, benefiting
 * only that one defender for that one strike.
 *
 * Used by Shield of Iron-bound Ash (tw-327).
 */
function handleTapItemForStrike(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'tap-item-for-strike') return wrongActionType(state, action, 'tap-item-for-strike');
  if (combat.phase !== 'resolve-strike') return { state, error: 'Can only tap item for strike during resolve-strike phase' };

  const currentStrike = combat.strikeAssignments[combat.currentStrikeIndex];
  if (!currentStrike || currentStrike.resolved) return { state, error: 'No active unresolved strike' };
  if (currentStrike.characterId !== action.characterInstanceId) return { state, error: 'Item bearer is not the current strike target' };

  const defPlayerIndex = state.players.findIndex(p => p.id === action.player);
  const defPlayer = state.players[defPlayerIndex];

  const charData = defPlayer.characters[action.characterInstanceId as string];
  if (!charData) return { state, error: 'Character not found' };

  const itemIndex = charData.items.findIndex(it => it.instanceId === action.cardInstanceId);
  if (itemIndex < 0) return { state, error: 'Item not found on character' };
  const item = charData.items[itemIndex];
  if (item.status !== CardStatus.Untapped) return { state, error: 'Item must be untapped to activate' };

  const itemDef = state.cardPool[item.definitionId as string];
  if (!itemDef || !('effects' in itemDef) || !itemDef.effects) return { state, error: 'Item has no effects' };
  const effect = itemDef.effects.find(
    (e): e is ItemTapStrikeBonusEffect => e.type === 'item-tap-strike-bonus',
  );
  if (!effect) return { state, error: 'Item has no item-tap-strike-bonus effect' };

  const itemName = 'name' in itemDef ? (itemDef as { name: string }).name : (item.definitionId as string);
  logDetail(`Item-tap-strike-bonus: tapping ${itemName} on ${action.characterInstanceId as string} (+${effect.prowessBonus} prowess for current strike)`);

  const newPlayers = clonePlayers(state);
  newPlayers[defPlayerIndex] = {
    ...newPlayers[defPlayerIndex],
    characters: {
      ...newPlayers[defPlayerIndex].characters,
      [action.characterInstanceId as string]: {
        ...charData,
        items: charData.items.map((it, i) =>
          i === itemIndex ? { ...it, status: CardStatus.Tapped } : it,
        ),
      },
    },
  };

  const newAssignments = combat.strikeAssignments.map((a, i) =>
    i === combat.currentStrikeIndex
      ? { ...a, strikeProwessBonus: (a.strikeProwessBonus ?? 0) + effect.prowessBonus }
      : a,
  );

  return {
    state: {
      ...state,
      players: newPlayers,
      combat: { ...combat, strikeAssignments: newAssignments },
    },
  };
}

/**
 * Activate an in-play item's `modify-attack` effect to adjust the
 * current attack's prowess and/or body. The item pays its `tap: "self"`
 * cost by tapping — unless its `discardIfBearerNot` clause fires (bearer
 * race mismatch), in which case the item is discarded instead. The
 * modifiers are applied uniformly: prowess to every strike (via
 * `combat.strikeProwess`) and body to the creature body check (via
 * `combat.creatureBody`).
 *
 * Used by Black Arrow (tw-494).
 */
function handleModifyAttack(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'modify-attack') return wrongActionType(state, action, 'modify-attack');
  if (combat.phase !== 'assign-strikes') return { state, error: 'Can only modify attack before strikes are assigned' };
  if (combat.strikeAssignments.length > 0) return { state, error: 'Strikes already assigned — too late to modify attack' };
  if (action.player !== combat.defendingPlayerId) return { state, error: 'Only defending player can modify attack' };

  const defPlayerIndex = state.players.findIndex(p => p.id === action.player);
  const defPlayer = state.players[defPlayerIndex];

  const charData = defPlayer.characters[action.characterInstanceId as string];
  if (!charData) return { state, error: 'Character not found' };

  const itemIndex = charData.items.findIndex(it => it.instanceId === action.cardInstanceId);
  if (itemIndex < 0) return { state, error: 'Item not found on character' };
  const item = charData.items[itemIndex];
  if (item.status !== CardStatus.Untapped) return { state, error: 'Item must be untapped to activate' };

  const itemDef = state.cardPool[item.definitionId as string];
  if (!itemDef || !('effects' in itemDef) || !itemDef.effects) return { state, error: 'Item has no effects' };
  const effect = itemDef.effects.find(
    (e): e is import('../types/effects.js').ModifyAttackEffect => e.type === 'modify-attack',
  );
  if (!effect) return { state, error: 'Item has no modify-attack effect' };

  const charDef = state.cardPool[charData.definitionId as string];
  if (!charDef || !isCharacterCard(charDef)) return { state, error: 'Bearer is not a character' };

  const prowessModifier = effect.prowessModifier ?? 0;
  const bodyModifier = effect.bodyModifier ?? 0;
  const strikesModifier = effect.strikesModifier ?? 0;
  const itemName = 'name' in itemDef ? (itemDef as { name: string }).name : item.definitionId as string;

  const shouldDiscard = effect.discardIfBearerNot
    ? !effect.discardIfBearerNot.race.includes(charDef.race as string)
    : false;

  let updatedChar;
  if (shouldDiscard) {
    logDetail(`Modify-attack: ${itemName} tapped — bearer ${charDef.name ?? ''} is not a ${effect.discardIfBearerNot?.race.join('/') ?? ''}, discarding item`);
    updatedChar = {
      ...charData,
      items: charData.items.filter((_, i) => i !== itemIndex),
    };
  } else {
    logDetail(`Modify-attack: tapping ${itemName} on ${charDef.name ?? ''} (prowess ${prowessModifier >= 0 ? '+' : ''}${prowessModifier}, body ${bodyModifier >= 0 ? '+' : ''}${bodyModifier}, strikes ${strikesModifier >= 0 ? '+' : ''}${strikesModifier})`);
    updatedChar = {
      ...charData,
      items: charData.items.map((it, i) =>
        i === itemIndex ? { ...it, status: CardStatus.Tapped } : it,
      ),
    };
  }

  const newPlayers = clonePlayers(state);
  newPlayers[defPlayerIndex] = {
    ...newPlayers[defPlayerIndex],
    characters: {
      ...newPlayers[defPlayerIndex].characters,
      [action.characterInstanceId as string]: updatedChar,
    },
  };

  if (shouldDiscard) {
    newPlayers[defPlayerIndex] = {
      ...newPlayers[defPlayerIndex],
      discardPile: [
        ...newPlayers[defPlayerIndex].discardPile,
        { instanceId: item.instanceId, definitionId: item.definitionId },
      ],
    };
  }

  const newStrikeProwess = combat.strikeProwess + prowessModifier;
  const newCreatureBody = combat.creatureBody === null ? null : combat.creatureBody + bodyModifier;
  const newStrikesTotal = strikesModifier !== 0
    ? Math.max(1, combat.strikesTotal + strikesModifier)
    : combat.strikesTotal;
  logDetail(`Modify-attack applied: strike prowess ${combat.strikeProwess} → ${newStrikeProwess}, creature body ${combat.creatureBody ?? 'n/a'} → ${newCreatureBody ?? 'n/a'}, strikes ${combat.strikesTotal} → ${newStrikesTotal}`);

  return {
    state: {
      ...state,
      players: newPlayers,
      combat: {
        ...combat,
        strikeProwess: newStrikeProwess,
        creatureBody: newCreatureBody,
        strikesTotal: newStrikesTotal,
      },
    },
  };
}

/**
 * Discard a short event card from hand to modify the current attack's
 * strike prowess and/or creature body. Applies the modifiers uniformly:
 * prowess to every strike (via `combat.strikeProwess`) and body to the
 * creature body check (via `combat.creatureBody`). Either the attacker
 * or the defender may play such an event, per the card's effect
 * declaration.
 *
 * Used by Dragon's Desolation (tw-29) Mode A — hazard-side short event
 * that boosts one Dragon attack by +2 prowess.
 */
function handleModifyAttackFromHand(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'modify-attack-from-hand') return wrongActionType(state, action, 'modify-attack-from-hand');
  if (combat.phase !== 'assign-strikes') return { state, error: 'Can only modify attack before strikes are assigned' };
  if (combat.strikeAssignments.length > 0) return { state, error: 'Strikes already assigned — too late to modify attack' };

  const playerIndex = state.players.findIndex(p => p.id === action.player);
  if (playerIndex < 0) return { state, error: 'Player not found' };
  const player = state.players[playerIndex];

  const cardIndex = player.hand.findIndex(c => c.instanceId === action.cardInstanceId);
  if (cardIndex < 0) return { state, error: 'Card not in hand' };

  const handCard = player.hand[cardIndex];
  const cardDef = state.cardPool[handCard.definitionId as string];
  if (!cardDef || !('effects' in cardDef) || !cardDef.effects) return { state, error: 'Card has no effects' };
  const effect = cardDef.effects.find(
    (e): e is import('../types/effects.js').ModifyAttackFromHandEffect => e.type === 'modify-attack-from-hand',
  );
  if (!effect) return { state, error: 'Card has no modify-attack-from-hand effect' };

  const expectedPlayerId = effect.player === 'attacker'
    ? combat.attackingPlayerId
    : combat.defendingPlayerId;
  if (action.player !== expectedPlayerId) {
    return { state, error: `Only ${effect.player === 'attacker' ? 'attacking' : 'defending'} player can play this card` };
  }

  const prowessModifier = effect.prowessModifier ?? 0;
  const bodyModifier = effect.bodyModifier ?? 0;

  const newHand = [...player.hand];
  const [discardedCard] = newHand.splice(cardIndex, 1);
  const newDiscard = [...player.discardPile, { instanceId: discardedCard.instanceId, definitionId: discardedCard.definitionId }];

  const newStrikeProwess = combat.strikeProwess + prowessModifier;
  const newCreatureBody = combat.creatureBody === null ? null : combat.creatureBody + bodyModifier;
  const cardName = 'name' in cardDef ? (cardDef as { name: string }).name : handCard.definitionId as string;
  logDetail(`Modify-attack-from-hand: ${cardName} played — strike prowess ${combat.strikeProwess} → ${newStrikeProwess}, creature body ${combat.creatureBody ?? 'n/a'} → ${newCreatureBody ?? 'n/a'}`);

  let newState: GameState = {
    ...updatePlayer(state, playerIndex, p => ({ ...p, hand: newHand, discardPile: newDiscard })),
    combat: {
      ...combat,
      strikeProwess: newStrikeProwess,
      creatureBody: newCreatureBody,
    },
  };

  // If the card has a duplication-limit scoped to "attack", record a marker
  // constraint so the legal-action generator can suppress re-plays.
  const attackDupLimit = (cardDef as { effects?: readonly import('../types/effects.js').CardEffect[] }).effects?.find(
    (e): e is import('../types/effects.js').DuplicationLimitEffect =>
      e.type === 'duplication-limit' && (e as { scope: string }).scope === 'attack',
  );
  if (attackDupLimit) {
    newState = addConstraint(newState, {
      source: handCard.instanceId,
      sourceDefinitionId: handCard.definitionId,
      scope: { kind: 'attack' },
      target: { kind: 'player', playerId: action.player },
      kind: { type: 'attack-card-played' },
    });
    logDetail(`${cardName}: added attack-card-played marker (duplication-limit scope attack)`);
  }

  return { state: newState };
}

/**
 * Transfer one item from an eliminated character to an unwounded companion.
 * Available during the 'item-salvage' combat phase (CoE rule 3.I.2).
 */
function handleSalvageItem(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'salvage-item') return wrongActionType(state, action, 'salvage-item');
  if (combat.phase !== 'item-salvage') return { state, error: 'Not in item-salvage phase' };
  if (action.player !== combat.defendingPlayerId) return { state, error: 'Only defending player can salvage items' };

  const { salvageItems, salvageRecipients } = combat;
  if (!salvageItems || !salvageRecipients) return { state, error: 'No salvage state' };

  // Validate the item exists in salvage pool
  const itemIndex = salvageItems.findIndex(it => it.instanceId === action.itemInstanceId);
  if (itemIndex < 0) return { state, error: 'Item not available for salvage' };

  // Validate the recipient is eligible
  if (!salvageRecipients.includes(action.recipientCharacterId)) {
    return { state, error: 'Character not eligible to receive salvaged item' };
  }

  const item = salvageItems[itemIndex];
  const newPlayers = clonePlayers(state);
  const defIdx = state.players.findIndex(p => p.id === combat.defendingPlayerId);
  const recipientChar = newPlayers[defIdx].characters[action.recipientCharacterId as string];
  if (!recipientChar) return { state, error: 'Recipient character not found' };

  logDetail(`Salvaging item ${item.instanceId as string} to character ${action.recipientCharacterId as string}`);

  // Transfer the item to the recipient character
  const newCharacters = { ...newPlayers[defIdx].characters };
  newCharacters[action.recipientCharacterId as string] = {
    ...recipientChar,
    items: [...recipientChar.items, item],
  };
  newPlayers[defIdx] = { ...newPlayers[defIdx], characters: newCharacters };

  // Remove item from salvage pool and recipient from eligible list
  const remainingItems = salvageItems.filter((_, i) => i !== itemIndex);
  const remainingRecipients = salvageRecipients.filter(r => r !== action.recipientCharacterId);

  // If no more items or no more recipients, finish salvage
  if (remainingItems.length === 0 || remainingRecipients.length === 0) {
    // Discard any remaining unsalvaged items
    for (const leftover of remainingItems) {
      logDetail(`Discarding unsalvaged item ${leftover.instanceId as string}`);
      newPlayers[defIdx] = {
        ...newPlayers[defIdx],
        discardPile: [...newPlayers[defIdx].discardPile, { instanceId: leftover.instanceId, definitionId: leftover.definitionId }],
      };
    }
    return finishSalvage({ ...state, players: newPlayers }, combat);
  }

  // More items and recipients available — stay in salvage phase
  logDetail(`Item salvage continues: ${remainingItems.length} item(s) remaining, ${remainingRecipients.length} recipient(s) remaining`);
  return {
    state: {
      ...state,
      players: newPlayers,
      combat: { ...combat, salvageItems: remainingItems, salvageRecipients: remainingRecipients },
    },
  };
}

/**
 * Transition out of item-salvage phase back to the normal combat flow.
 * Clears salvage fields and advances to the next strike or finalizes combat.
 */
function finishSalvage(state: GameState, combat: CombatState): ReducerResult {
  const cleanCombat: CombatState = { ...combat, phase: 'body-check', salvageItems: undefined, salvageRecipients: undefined };
  const next = nextStrikePhase(cleanCombat);
  if (next) {
    return { state: { ...state, combat: { ...cleanCombat, ...next } } };
  }
  return finalizeCombat({ ...state, combat: cleanCombat });
}

/**
 * Defender discards one item from the company after a successful agent strike
 * with strikeEffect: 'discard-item' (An Article Missing, dm-43).
 * Once the item is discarded, combat advances to the next strike or finalizes.
 */
function handleDiscardItemFromCompany(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'discard-item-from-company') return wrongActionType(state, action, 'discard-item-from-company');
  if (combat.phase !== 'discard-item-from-company') return { state, error: 'Not in discard-item-from-company phase' };
  if (action.player !== combat.defendingPlayerId) return { state, error: 'Only defending player can discard the item' };

  const { discardItemOptions } = combat;
  if (!discardItemOptions) return { state, error: 'No discard-item options in combat state' };

  const itemIndex = discardItemOptions.findIndex(it => it.instanceId === action.itemInstanceId);
  if (itemIndex < 0) return { state, error: 'Item not available for discard' };

  const item = discardItemOptions[itemIndex];
  const defIdx = state.players.findIndex(p => p.id === combat.defendingPlayerId);
  const newPlayers = clonePlayers(state);

  // Remove item from its bearer and add to discard pile
  let itemRemoved = false;
  const newCharacters = { ...newPlayers[defIdx].characters };
  for (const [charId, charData] of Object.entries(newCharacters)) {
    const idx = charData.items.findIndex(it => it.instanceId === item.instanceId);
    if (idx >= 0) {
      newCharacters[charId] = { ...charData, items: charData.items.filter((_, i) => i !== idx) };
      itemRemoved = true;
      break;
    }
  }
  if (!itemRemoved) return { state, error: 'Item not found on any character in company' };

  logDetail(`An Article Missing: discarding item ${item.instanceId as string} from company`);
  newPlayers[defIdx] = {
    ...newPlayers[defIdx],
    characters: newCharacters,
    discardPile: [...newPlayers[defIdx].discardPile, { instanceId: item.instanceId, definitionId: item.definitionId }],
  };

  const cleanCombat: CombatState = { ...combat, phase: 'resolve-strike', discardItemOptions: undefined };
  const next = nextStrikePhase(cleanCombat);
  if (!next) {
    return finalizeCombat({ ...state, players: newPlayers, combat: cleanCombat });
  }
  return { state: { ...state, players: newPlayers, combat: { ...cleanCombat, ...next } } };
}

/**
 * Remove a card-triggered-attack card from cardsInPlay and send it to the
 * defending player's discard pile. Used when no untapped characters survive
 * the attack (or the attack is cancelled) so the card cannot be assigned.
 */
function discardCardTriggeredCard(
  state: GameState,
  cardInstanceId: import('../index.js').CardInstanceId,
  defPlayerIdx: number,
): GameState {
  const newPlayers: [import('../index.js').PlayerState, import('../index.js').PlayerState] = [
    state.players[0],
    state.players[1],
  ];
  for (let pi = 0; pi < 2; pi++) {
    const inPlay = newPlayers[pi].cardsInPlay.find(c => c.instanceId === cardInstanceId);
    if (inPlay) {
      newPlayers[pi] = {
        ...newPlayers[pi],
        cardsInPlay: newPlayers[pi].cardsInPlay.filter(c => c.instanceId !== cardInstanceId),
      };
      newPlayers[defPlayerIdx] = {
        ...newPlayers[defPlayerIdx],
        discardPile: [
          ...newPlayers[defPlayerIdx].discardPile,
          { instanceId: inPlay.instanceId, definitionId: inPlay.definitionId },
        ],
      };
      return { ...state, players: newPlayers };
    }
  }
  return state;
}

/**
 * Finalize combat after all strikes are resolved.
 *
 * If all strikes were defeated (result === 'success'), the creature card
 * moves from the hazard player's discard pile to the defending player's
 * marshalling point pile. Otherwise it stays in discard.
 */
function finalizeCombat(state: GameState, effects: GameEffect[] = []): ReducerResult {
  const combat = state.combat;
  if (!combat) return { state, error: 'No combat to finalize' };

  const allDefeated = combat.strikeAssignments.length > 0
    && combat.strikeAssignments.every(a => a.result === 'success');

  const newPlayers = clonePlayers(state);

  // Creature attacks (M/H or on-guard): the creature card is in the
  // attacker's cardsInPlay during combat. After combat it moves to:
  // - defender's kill pile (all strikes defeated) for marshalling points
  // - attacker's discard pile (any strike not defeated)
  //
  // Played-auto-attacks (site `dynamic-auto-attack` effect, e.g. Framsburg
  // td-175) are a special case: the creature is "treated in all ways as
  // the site's automatic-attack", which means it is discarded after
  // combat regardless of outcome — the resource player does NOT gain
  // kill-MP, mirroring standard auto-attacks.
  const creatureInstanceId =
    combat.attackSource.type === 'creature' ? combat.attackSource.instanceId
      : combat.attackSource.type === 'on-guard-creature' ? combat.attackSource.cardInstanceId
        : combat.attackSource.type === 'played-auto-attack' ? combat.attackSource.instanceId
          : null;
  const isPlayedAutoAttack = combat.attackSource.type === 'played-auto-attack';

  if (creatureInstanceId) {
    const atkIdx = state.players.findIndex(p => p.id === combat.attackingPlayerId);
    const defIdx = state.players.findIndex(p => p.id === combat.defendingPlayerId);

    // Remove creature from attacker's cardsInPlay
    const creatureInPlay = newPlayers[atkIdx].cardsInPlay.find(c => c.instanceId === creatureInstanceId);
    const creatureCard = creatureInPlay
      ? { instanceId: creatureInPlay.instanceId, definitionId: creatureInPlay.definitionId }
      : undefined;
    newPlayers[atkIdx] = {
      ...newPlayers[atkIdx],
      cardsInPlay: newPlayers[atkIdx].cardsInPlay.filter(c => c.instanceId !== creatureInstanceId),
    };

    if (isPlayedAutoAttack && creatureCard) {
      newPlayers[atkIdx] = {
        ...newPlayers[atkIdx],
        discardPile: [...newPlayers[atkIdx].discardPile, creatureCard],
      };
      logDetail(`Played-auto-attack creature discarded (no kill-MP awarded — treated as site's automatic-attack)`);
    } else if (allDefeated && creatureCard && combat.detainment) {
      // CoE rule 3.II.3 — defeated detainment creature is discarded instead
      // of going to the attacked player's MP pile (0 kill-MP awarded).
      newPlayers[atkIdx] = {
        ...newPlayers[atkIdx],
        discardPile: [...newPlayers[atkIdx].discardPile, creatureCard],
      };
      logDetail(`All strikes defeated (detainment) — creature discarded instead of kill pile (§3.II.3)`);
    } else if (allDefeated && creatureCard) {
      newPlayers[defIdx] = {
        ...newPlayers[defIdx],
        killPile: [...newPlayers[defIdx].killPile, creatureCard],
      };
      logDetail(`All strikes defeated — creature moved to defender's kill pile`);
    } else if (creatureCard) {
      newPlayers[atkIdx] = {
        ...newPlayers[atkIdx],
        discardPile: [...newPlayers[atkIdx].discardPile, creatureCard],
      };
      logDetail(`Combat ended — creature moved to attacker's discard`);
    }
  }

  logDetail('Combat finalized — returning to enclosing phase');

  // Check for on-event: character-wounded-by-self effects on the attack source.
  // If any characters were wounded (not eliminated) and the attack source card
  // has this effect, enqueue a pending corruption-check resolution per
  // wounded character via the unified pending-resolution system.
  //
  // Under detainment (CoE rule 3.II.1.1), successful strikes tap rather than
  // wound — the character "is not considered to have been wounded and
  // passive conditions that depend on a character being wounded are not
  // initiated". Skip the on-wounded trigger entirely.
  let stateAfterCombat: GameState = { ...state, players: newPlayers, combat: null };
  const woundedCharIds = combat.detainment
    ? []
    : combat.strikeAssignments
        .filter(a => a.result === 'wounded')
        .map(a => a.characterId);

  if (
    woundedCharIds.length > 0 &&
    (state.phaseState.phase === Phase.Site || state.phaseState.phase === Phase.MovementHazard)
  ) {
    const sourceCard = getAttackSourceCard(state, combat);
    const sourceName = (sourceCard as { name?: string } | undefined)?.name ?? 'Wound';
    const woundEvents = getOnEventEffects(sourceCard, 'character-wounded-by-self');
    for (const woundEvent of woundEvents) {
      const conditionContext = buildOnEventContext(state);
      if (woundEvent.when && !matchesCondition(woundEvent.when, conditionContext)) {
        logDetail(`On-event condition not met for ${sourceName} — skipping`);
        continue;
      }

      if (woundEvent.apply.type === 'force-check') {
        const modifier = woundEvent.apply.modifier ?? 0;
        const actor = combat.defendingPlayerId;
        const actorIndex = stateAfterCombat.players.findIndex(p => p.id === actor);
        const phaseStateActive = state.phaseState as { activeCompanyIndex: number };
        const company = stateAfterCombat.players[actorIndex].companies[phaseStateActive.activeCompanyIndex];
        const companyId = company?.id;
        logDetail(`Wound corruption checks queued for ${woundedCharIds.length} character(s) (${sourceName}, modifier ${modifier})`);
        if (companyId) {
          const scope = state.phaseState.phase === Phase.MovementHazard
            ? ({ kind: 'company-mh-subphase' as const, companyId })
            : ({ kind: 'company-site-subphase' as const, companyId });
          const source = combat.attackSource.type === 'creature' ? combat.attackSource.instanceId : null;
          for (const characterId of woundedCharIds) {
            stateAfterCombat = enqueueCorruptionCheck(stateAfterCombat, {
              source,
              actor,
              scope,
              characterId,
              modifier,
              reason: sourceName,
            });
          }
        }
      } else if (
        woundEvent.apply.type === 'move'
        && woundEvent.apply.select === 'filter-all'
        && woundEvent.apply.from === 'items-on-wounded'
        && woundEvent.apply.to === 'discard'
      ) {
        const filter = woundEvent.apply.filter;
        stateAfterCombat = discardWoundedItems(stateAfterCombat, combat, woundedCharIds, sourceName, filter);
      } else if (woundEvent.apply.type === 'force-discard-one-company-item') {
        // Brigands: fires once per attack (not per wound). Company must discard one item.
        const actor = combat.defendingPlayerId;
        const companyId = combat.companyId;
        const actorIndex = stateAfterCombat.players.findIndex(p => p.id === actor);
        const defPlayer = stateAfterCombat.players[actorIndex];
        const company = defPlayer?.companies.find(c => c.id === companyId);
        const hasItems = (company?.characters ?? []).some(charId => {
          const ch = defPlayer.characters[charId as string];
          return ch && ch.items.length > 0;
        });
        if (hasItems) {
          const scope = state.phaseState.phase === Phase.MovementHazard
            ? ({ kind: 'company-mh-subphase' as const, companyId })
            : ({ kind: 'company-site-subphase' as const, companyId });
          const source = combat.attackSource.type === 'creature' ? combat.attackSource.instanceId : null;
          logDetail(`${sourceName}: wound triggers discard-one-company-item for company ${companyId as string}`);
          stateAfterCombat = enqueueResolution(stateAfterCombat, {
            source,
            actor,
            scope,
            kind: { type: 'discard-one-company-item', companyId },
          });
        } else {
          logDetail(`${sourceName}: discard-one-company-item triggered but company has no items — skipping`);
        }
      } else if (woundEvent.apply.type === 'discard-character') {
        stateAfterCombat = discardWoundedCharacters(stateAfterCombat, combat, woundedCharIds, sourceName, woundEvent.when);
      }
    }
  }

  // Check for on-event: company-member-wounded effects on characters' attached
  // hazard events. When any characters were wounded, scan every character in
  // the defending company for attached hazards carrying this event; for each
  // match, enqueue a corruption check on the bearer (the character bearing the
  // hazard, not necessarily the wounded character). Used by Despair of the Heart.
  if (
    woundedCharIds.length > 0 &&
    (state.phaseState.phase === Phase.Site || state.phaseState.phase === Phase.MovementHazard)
  ) {
    const defPlayerIdx = stateAfterCombat.players.findIndex(p => p.id === combat.defendingPlayerId);
    const defPlayer = stateAfterCombat.players[defPlayerIdx];
    const company = defPlayer?.companies.find(c => c.id === combat.companyId);
    if (company) {
      const companyId = company.id;
      const scope = state.phaseState.phase === Phase.MovementHazard
        ? ({ kind: 'company-mh-subphase' as const, companyId })
        : ({ kind: 'company-site-subphase' as const, companyId });
      for (const bearerInstId of company.characters) {
        const bearer = defPlayer.characters[bearerInstId as string];
        if (!bearer) continue;
        for (const hazard of bearer.hazards) {
          const hazardDef = stateAfterCombat.cardPool[hazard.definitionId as string] as
            { name?: string; effects?: readonly import('../types/effects.js').CardEffect[] } | undefined;
          if (!hazardDef) continue;
          const companyMemberWoundedEvents = getOnEventEffects(hazardDef, 'company-member-wounded');
          for (const evt of companyMemberWoundedEvents) {
            if (evt.apply.type === 'force-check') {
              const modifier = evt.apply.modifier ?? 0;
              const hazardName = hazardDef.name ?? hazard.definitionId as string;
              logDetail(`Company-member-wounded: ${hazardName} triggers corruption check on bearer ${bearerInstId as string} (modifier ${modifier})`);
              stateAfterCombat = enqueueCorruptionCheck(stateAfterCombat, {
                source: hazard.instanceId,
                actor: combat.defendingPlayerId,
                scope,
                characterId: bearerInstId,
                modifier,
                reason: hazardName,
              });
            }
          }
        }
      }
    }
  }

  // Check for on-event: attack-not-defeated effects on the attack source.
  // If the attack was NOT fully defeated and the creature card carries this
  // event, apply its constraint to the defending company.
  if (!allDefeated) {
    const sourceCardForNotDefeated = getAttackSourceCard(state, combat);
    const notDefeatedEvents = getOnEventEffects(sourceCardForNotDefeated, 'attack-not-defeated');
    for (const nde of notDefeatedEvents) {
      if (nde.apply.type === 'add-constraint' && nde.apply.constraint === 'deny-scout-resources') {
        const creatureSource =
          combat.attackSource.type === 'creature' ? combat.attackSource.instanceId
            : combat.attackSource.type === 'on-guard-creature' ? combat.attackSource.cardInstanceId
              : combat.attackSource.type === 'played-auto-attack' ? combat.attackSource.instanceId
                : null;
        if (creatureSource) {
          const creatureDefId = resolveInstanceId(state, creatureSource);
          const creatureName = creatureDefId
            ? (state.cardPool[creatureDefId as string]?.name ?? 'creature')
            : 'creature';
          logDetail(`Attack not defeated — ${creatureName} fires deny-scout-resources on company ${combat.companyId as string}`);
          stateAfterCombat = addConstraint(stateAfterCombat, {
            source: creatureSource,
            sourceDefinitionId: (creatureDefId ?? creatureSource) as import('../types/common.js').CardDefinitionId,
            scope: { kind: 'turn' },
            target: { kind: 'company', companyId: combat.companyId },
            kind: { type: 'deny-scout-resources' },
          });
        }
      }
    }
  }

  // Check for on-event: attack-not-canceled effects on the attack source.
  // All resolved combats were by definition not canceled (cancellation prevents
  // combat resolution entirely), so this fires unconditionally after any attack.
  const sourceCardForNotCanceled = getAttackSourceCard(state, combat);
  const notCanceledEvents = getOnEventEffects(sourceCardForNotCanceled, 'attack-not-canceled');
  for (const nce of notCanceledEvents) {
    if (nce.apply.type === 'add-constraint' && nce.apply.constraint === 'creature-attack-boost') {
      const creatureSource =
        combat.attackSource.type === 'creature' ? combat.attackSource.instanceId
          : combat.attackSource.type === 'on-guard-creature' ? combat.attackSource.cardInstanceId
            : combat.attackSource.type === 'played-auto-attack' ? combat.attackSource.instanceId
              : null;
      if (creatureSource) {
        const creatureDefId = resolveInstanceId(state, creatureSource);
        const creatureName = creatureDefId
          ? (state.cardPool[creatureDefId as string]?.name ?? 'creature')
          : 'creature';
        const boostRace = nce.apply.race ?? '';
        const boostStrikes = nce.apply.strikes ?? 0;
        const boostProwess = nce.apply.prowess ?? 0;
        logDetail(`Attack not canceled — ${creatureName} fires creature-attack-boost (race=${boostRace}, +${boostStrikes} strikes, +${boostProwess} prowess) on company ${combat.companyId as string}`);
        stateAfterCombat = addConstraint(stateAfterCombat, {
          source: creatureSource,
          sourceDefinitionId: (creatureDefId ?? creatureSource) as import('../types/common.js').CardDefinitionId,
          scope: { kind: 'turn' },
          target: { kind: 'company', companyId: combat.companyId },
          kind: {
            type: 'creature-attack-boost',
            race: boostRace,
            strikes: boostStrikes,
            prowess: boostProwess,
          },
        });
      }
    }
  }

  // Check for on-event: attack-defeated effects on permanent events in play.
  // When all strikes were defeated, scan every player's cardsInPlay for
  // permanent events whose on-event condition matches the attack's race
  // (e.g. The Moon Is Dead: discard when an Undead attack is defeated).
  if (allDefeated && combat.creatureRace) {
    const attackCtx = {
      enemy: { race: combat.creatureRace },
      attack: { isolated: combat.isolated ?? false },
      inPlay: buildInPlayNames(stateAfterCombat),
    };
    const updatedPlayersAD = stateAfterCombat.players.map(player => {
      const toDiscard: import('../types/state-cards.js').CardInPlay[] = [];
      const remaining: import('../types/state-cards.js').CardInPlay[] = [];
      for (const card of player.cardsInPlay) {
        const def = stateAfterCombat.cardPool[card.definitionId as string] as { name?: string; effects?: readonly import('../types/effects.js').CardEffect[] } | undefined;
        const defeatedEvents = getOnEventEffects(def, 'attack-defeated');
        let shouldDiscard = false;
        for (const ev of defeatedEvents) {
          if (!ev.when || matchesCondition(ev.when, attackCtx as unknown as Record<string, unknown>)) {
            if (ev.apply.type === 'discard-self') {
              shouldDiscard = true;
              break;
            }
          }
        }
        if (shouldDiscard) { toDiscard.push(card); } else { remaining.push(card); }
      }
      if (toDiscard.length === 0) return player;
      const discarded = toDiscard.map(c => ({ instanceId: c.instanceId, definitionId: c.definitionId }));
      for (const c of toDiscard) {
        const defName = (stateAfterCombat.cardPool[c.definitionId as string] as { name?: string })?.name ?? '?';
        logDetail(`Attack-defeated: discarding "${defName}" from cardsInPlay (on-event: attack-defeated)`);
      }
      return { ...player, cardsInPlay: remaining, discardPile: [...player.discardPile, ...discarded] };
    }) as unknown as typeof stateAfterCombat.players;
    stateAfterCombat = { ...stateAfterCombat, players: updatedPlayersAD };
  }

  // Handle permanent-event auto-attack onDefeat:'remove-from-play' (e.g. Balrog of Moria TW-12).
  // When all strikes of a site automatic-attack are defeated and the attack's source
  // is a permanent-event carrying this flag, remove the event from the hazard player's
  // cardsInPlay and move it to the defending player's killPile to award kill MPs.
  if (allDefeated && combat.attackSource.type === 'automatic-attack') {
    const { siteInstanceId, attackIndex } = combat.attackSource;
    const siteDefId = resolveInstanceId(state, siteInstanceId);
    const siteDef = siteDefId ? state.cardPool[siteDefId as string] : undefined;
    if (siteDef && isSiteCard(siteDef)) {
      const autoAttacks = getActiveAutoAttacks(state, siteDef);
      const aa = autoAttacks[attackIndex];
      const sourceInstId = aa?.sourceInstanceId;
      if (sourceInstId) {
        const sourceDefId = resolveInstanceId(state, sourceInstId);
        const sourceDef = sourceDefId ? state.cardPool[sourceDefId as string] : undefined;
        const effects = (sourceDef as { effects?: readonly import('../types/effects.js').CardEffect[] } | undefined)?.effects ?? [];
        for (const eff of effects) {
          if (eff.type !== 'permanent-event-auto-attack') continue;
          const peaEff = eff;
          if (peaEff.onDefeat !== 'remove-from-play') continue;
          const sourceName = (sourceDef as { name?: string } | undefined)?.name ?? '?';
          const hazardIdx = stateAfterCombat.players.findIndex(p => p.id === combat.attackingPlayerId);
          const defIdx = stateAfterCombat.players.findIndex(p => p.id === combat.defendingPlayerId);
          const sourceCard = stateAfterCombat.players[hazardIdx]?.cardsInPlay.find(c => c.instanceId === sourceInstId);
          if (sourceCard) {
            const cardRef = { instanceId: sourceCard.instanceId, definitionId: sourceCard.definitionId };
            const updatedPlayersOD = stateAfterCombat.players.map((p, idx) => {
              if (idx === hazardIdx) return { ...p, cardsInPlay: p.cardsInPlay.filter(c => c.instanceId !== sourceInstId) };
              if (idx === defIdx) return { ...p, killPile: [...p.killPile, cardRef] };
              return p;
            }) as unknown as typeof stateAfterCombat.players;
            stateAfterCombat = { ...stateAfterCombat, players: updatedPlayersOD };
            logDetail(`Permanent-event "${sourceName}" defeated — removed from play, kill MPs awarded to defender`);
          }
          break;
        }
      }
    }
  }

  // Handle permanent-event auto-attack discardAfterUse (e.g. Witch-king at Iron-deeps / Under-leas).
  // Fires regardless of outcome (win or lose). When a site auto-attack's source is a permanent
  // event with discardAfterUse: true, move the card from the hazard player's cardsInPlay to their
  // discard pile. No kill MPs are awarded ("ignore result of defeat").
  if (combat.attackSource.type === 'automatic-attack') {
    const { siteInstanceId: dauSiteInstId, attackIndex: dauAttackIdx } = combat.attackSource;
    const dauSiteDefId = resolveInstanceId(state, dauSiteInstId);
    const dauSiteDef = dauSiteDefId ? state.cardPool[dauSiteDefId as string] : undefined;
    if (dauSiteDef && isSiteCard(dauSiteDef)) {
      const dauAttacks = getActiveAutoAttacks(state, dauSiteDef);
      const dauAa = dauAttacks[dauAttackIdx];
      const dauSourceInstId = dauAa?.sourceInstanceId;
      if (dauSourceInstId) {
        const dauSourceDefId = resolveInstanceId(state, dauSourceInstId);
        const dauSourceDef = dauSourceDefId ? state.cardPool[dauSourceDefId as string] : undefined;
        const dauEffects = (dauSourceDef as { effects?: readonly import('../types/effects.js').CardEffect[] } | undefined)?.effects ?? [];
        for (const dauEff of dauEffects) {
          if (dauEff.type !== 'permanent-event-auto-attack') continue;
          if (!dauEff.discardAfterUse) continue;
          const dauSourceName = (dauSourceDef as { name?: string } | undefined)?.name ?? '?';
          const dauHazardIdx = stateAfterCombat.players.findIndex(p => p.id === combat.attackingPlayerId);
          const dauSourceCard = stateAfterCombat.players[dauHazardIdx]?.cardsInPlay.find(c => c.instanceId === dauSourceInstId);
          if (dauSourceCard) {
            const dauCardRef = { instanceId: dauSourceCard.instanceId, definitionId: dauSourceCard.definitionId };
            const dauUpdatedPlayers = stateAfterCombat.players.map((p, idx) => {
              if (idx === dauHazardIdx) return { ...p, cardsInPlay: p.cardsInPlay.filter(c => c.instanceId !== dauSourceInstId), discardPile: [...p.discardPile, dauCardRef] };
              return p;
            }) as unknown as typeof stateAfterCombat.players;
            stateAfterCombat = { ...stateAfterCombat, players: dauUpdatedPlayers };
            logDetail(`Permanent-event "${dauSourceName}" used as extra auto-attack (discardAfterUse) — moved to discard pile`);
          }
          break;
        }
      }
    }
  }

  stateAfterCombat = recordHazardEncountered(stateAfterCombat, state, combat);

  // Apply post-attack effects scheduled by accepted haven-join offers
  // (e.g. Alatar's "following the attack, tap + corruption check").
  // Effects fire regardless of outcome. After effects, any haven-jumped
  // character is restored to their original company.
  stateAfterCombat = applyPostAttackEffects(stateAfterCombat, state, combat);
  stateAfterCombat = restoreHavenJumpOrigins(stateAfterCombat, combat);

  // card-triggered-attack finalization (e.g. Rescue Prisoners, The Windlord Found Me):
  // The card sits in cardsInPlay during the attack. After combat, check for untapped
  // characters to determine whether to discard or queue bearer selection.
  if (combat.attackSource.type === 'card-triggered-attack') {
    const { cardInstanceId } = combat.attackSource;
    const defIdx = stateAfterCombat.players.findIndex(p => p.id === combat.defendingPlayerId);
    const defPlayer = stateAfterCombat.players[defIdx];
    const company = defPlayer.companies.find(co => co.id === combat.companyId);
    const anyUntapped = company
      ? company.characters.some(charId => {
          const ch = defPlayer.characters[charId as string];
          return ch && ch.status === CardStatus.Untapped;
        })
      : false;
    const cardDefId = resolveInstanceId(stateAfterCombat, cardInstanceId);
    const cardName = cardDefId
      ? (stateAfterCombat.cardPool[cardDefId as string] as { name?: string })?.name ?? '?'
      : '?';

    if (!anyUntapped) {
      // No untapped characters — discard the card from cardsInPlay
      logDetail(
        `Card-auto-attack: no untapped characters after combat — discarding "${cardName}" from cardsInPlay`,
      );
      stateAfterCombat = discardCardTriggeredCard(stateAfterCombat, cardInstanceId, defIdx);
    } else {
      // Untapped characters remain — queue bearer selection for the resource player
      logDetail(
        `Card-auto-attack: untapped characters remain — queuing select-card-bearer for "${cardName}" ` +
        `(company ${combat.companyId as string})`,
      );
      stateAfterCombat = enqueueResolution(stateAfterCombat, {
        source: cardInstanceId,
        actor: combat.defendingPlayerId,
        scope: { kind: 'phase', phase: stateAfterCombat.phaseState.phase },
        kind: {
          type: 'select-card-bearer',
          cardInstanceId,
          companyId: combat.companyId,
        },
      });
    }
  }

  // lucky-search-attack finalization (Lucky Search tw-269):
  // After combat, move the found item to the scout or discard it if the scout
  // was wounded. Reshuffle all non-item revealed cards back into the play deck.
  if (combat.attackSource.type === 'lucky-search-attack') {
    const { scoutInstanceId, foundItemInstanceId, revealedCardInstanceIds } = combat.attackSource;
    const defIdx = stateAfterCombat.players.findIndex(p => p.id === combat.defendingPlayerId);

    const scoutWounded = combat.strikeAssignments.some(
      a => a.characterId === scoutInstanceId && a.result === 'wounded',
    );

    // Partition the deck: revealed cards vs remainder
    const revealedSet = new Set(revealedCardInstanceIds.map(id => id as string));
    const allRevealedCards = stateAfterCombat.players[defIdx].playDeck.filter(
      c => revealedSet.has(c.instanceId as string),
    );
    const remainingDeck = stateAfterCombat.players[defIdx].playDeck.filter(
      c => !revealedSet.has(c.instanceId as string),
    );

    const foundCard = foundItemInstanceId
      ? allRevealedCards.find(c => c.instanceId === foundItemInstanceId)
      : null;
    const nonItemRevealed = foundCard
      ? allRevealedCards.filter(c => c.instanceId !== foundItemInstanceId)
      : allRevealedCards;

    if (foundCard && !scoutWounded) {
      // Scout takes control: attach item to scout
      logDetail(`Lucky Search: scout not wounded — ${String(foundCard.definitionId)} attached to scout ${String(scoutInstanceId)}`);
      stateAfterCombat = updatePlayer(stateAfterCombat, defIdx, p =>
        updateCharacter(p, scoutInstanceId as string, ch => ({
          ...ch,
          items: [...ch.items, { instanceId: foundCard.instanceId, definitionId: foundCard.definitionId, status: CardStatus.Untapped }],
        })),
      );
    } else if (foundCard && scoutWounded) {
      logDetail(`Lucky Search: scout wounded — discarding found item ${String(foundCard.definitionId)}`);
      stateAfterCombat = updatePlayer(stateAfterCombat, defIdx, p => ({
        ...p,
        discardPile: [...p.discardPile, { instanceId: foundCard.instanceId, definitionId: foundCard.definitionId }],
      }));
    } else {
      logDetail(`Lucky Search: no item found in deck`);
    }

    // Reshuffle non-item revealed cards back into the remaining deck
    const [reshuffled, newRng] = shuffle([...nonItemRevealed, ...remainingDeck], stateAfterCombat.rng);
    logDetail(`Lucky Search: reshuffling ${nonItemRevealed.length} revealed card(s) back into deck (${remainingDeck.length} remaining)`);
    stateAfterCombat = { ...updatePlayer(stateAfterCombat, defIdx, p => ({ ...p, playDeck: reshuffled })), rng: newRng };
  }

  // Clear attack-scoped constraints (e.g. company-combat-boost stat modifiers
  // from short events like "The Dwarves Are upon You!").
  stateAfterCombat = sweepExpired(stateAfterCombat, { kind: 'attack-end' });

  // Tidings of Bold Spies (le-143): if the company being attacked has a
  // tidings-attacks-queue constraint with remaining attacks, initiate the next
  // combat immediately. Each queued attack mirrors the site's auto-attack stats
  // but is NOT itself an automatic-attack.
  const tidingsConstraint = stateAfterCombat.activeConstraints.find(
    c => c.target.kind === 'company'
      && c.target.companyId === combat.companyId
      && c.kind.type === 'tidings-attacks-queue',
  );
  if (tidingsConstraint && tidingsConstraint.kind.type === 'tidings-attacks-queue') {
    const { attacks, attackIndex } = tidingsConstraint.kind;
    if (attackIndex < attacks.length) {
      const aa = attacks[attackIndex];
      const race = normalizeCreatureRace(aa.creatureType);
      const inPlayNames2 = buildInPlayNames(stateAfterCombat);
      const activeIdx2 = stateAfterCombat.players.findIndex(p => p.id === combat.defendingPlayerId);
      const siteDef2 = (() => {
        const company2 = activeIdx2 >= 0 ? stateAfterCombat.players[activeIdx2].companies.find(c => c.id === combat.companyId) : undefined;
        const destInst2 = company2?.destinationSite ?? company2?.currentSite ?? null;
        const destDefId2 = destInst2 ? resolveInstanceId(stateAfterCombat, destInst2.instanceId) : null;
        const def2 = destDefId2 ? stateAfterCombat.cardPool[destDefId2 as string] : undefined;
        return def2 && isSiteCard(def2) ? def2 : undefined;
      })();
      const prowess2 = resolveAttackProwess(stateAfterCombat, aa.prowess, inPlayNames2, race, true, undefined, { companyId: combat.companyId });
      const strikes2 = resolveAttackStrikes(stateAfterCombat, aa.strikes, inPlayNames2, race, { companyId: combat.companyId });
      const aaAttackerChooses2 = aa.combatRules?.includes('attacker-chooses-defenders') ?? false;
      logDetail(`Tidings of Bold Spies: initiating attack ${attackIndex + 1}/${attacks.length}: ${aa.creatureType} (${strikes2} strikes, ${prowess2} prowess)`);
      const nextCombat: CombatState = {
        attackSource: { type: 'tidings-attack', eventInstanceId: tidingsConstraint.source, attackIndex },
        companyId: combat.companyId,
        defendingPlayerId: combat.defendingPlayerId,
        attackingPlayerId: combat.attackingPlayerId,
        strikesTotal: strikes2,
        strikeProwess: prowess2,
        creatureBody: aa.body ?? null,
        creatureRace: race,
        strikeAssignments: [],
        currentStrikeIndex: 0,
        phase: 'assign-strikes',
        assignmentPhase: aaAttackerChooses2 ? 'cancel-window' : 'defender',
        bodyCheckTarget: null,
        detainment: isDetainmentAttack({
          attackEffects: siteDef2?.effects,
          attackRace: race as import('../index.js').Race | null,
          defendingAlignment: activeIdx2 >= 0 ? stateAfterCombat.players[activeIdx2].alignment : Alignment.Wizard,
          defendingSiteEffects: siteDef2?.effects,
        }),
        ...(aaAttackerChooses2 ? { attackerChoosesDefenders: true } : {}),
      };
      // Update the queue constraint to point to the next attack.
      stateAfterCombat = removeConstraint(stateAfterCombat, tidingsConstraint.id);
      if (attackIndex + 1 < attacks.length) {
        stateAfterCombat = addConstraint(stateAfterCombat, {
          source: tidingsConstraint.source,
          sourceDefinitionId: tidingsConstraint.sourceDefinitionId,
          scope: { kind: 'company-mh-phase', companyId: combat.companyId },
          target: { kind: 'company', companyId: combat.companyId },
          kind: {
            type: 'tidings-attacks-queue',
            attacks,
            attackIndex: attackIndex + 1,
          },
        });
      }
      return { state: { ...stateAfterCombat, combat: nextCombat }, effects };
    }
    // Queue exhausted — remove the constraint.
    stateAfterCombat = removeConstraint(stateAfterCombat, tidingsConstraint.id);
  }

  return {
    state: stateAfterCombat,
    effects,
  };
}

/**
 * Apply each {@link PostAttackEffect} in order at combat finalization.
 *
 * For each targeted character, optionally tap them if they are still
 * untapped, then enqueue a corruption check if configured. Enqueued via
 * the unified pending-resolution system scoped to the company's current
 * sub-phase (M/H or Site) so it auto-clears when the sub-phase ends.
 *
 * Reusable by any card that schedules post-attack side-effects via
 * `on-event: creature-attack-begins` + `apply.postAttack`.
 */
function applyPostAttackEffects(
  stateAfterCombat: GameState,
  stateBeforeFinalize: GameState,
  combat: CombatState,
): GameState {
  const effects = combat.postAttackEffects ?? [];
  if (effects.length === 0) return stateAfterCombat;

  let s = stateAfterCombat;
  const defIdx = s.players.findIndex(p => p.id === combat.defendingPlayerId);
  if (defIdx < 0) return s;

  const phaseStateActive = stateBeforeFinalize.phaseState as { activeCompanyIndex?: number };
  const activeCompanyIndex = phaseStateActive.activeCompanyIndex ?? -1;
  // The scope-anchor company is the post-combat active company — i.e. the
  // company the M/H or Site sub-phase is currently servicing. Haven-jumped
  // characters are still attached there at this point (restore runs after).
  const scopeCompany = activeCompanyIndex >= 0
    ? s.players[defIdx].companies[activeCompanyIndex]
    : undefined;
  const scopeCompanyId = scopeCompany?.id;

  for (const effect of effects) {
    // Tap if untapped
    if (effect.tapIfUntapped) {
      const char = s.players[defIdx].characters[effect.targetCharacterId as string];
      if (char && char.status === CardStatus.Untapped) {
        const newPlayers: [PlayerState, PlayerState] = [s.players[0], s.players[1]];
        newPlayers[defIdx] = {
          ...s.players[defIdx],
          characters: {
            ...s.players[defIdx].characters,
            [effect.targetCharacterId as string]: { ...char, status: CardStatus.Tapped },
          },
        };
        s = { ...s, players: newPlayers };
        logDetail(`Post-attack: tapped ${effect.targetCharacterId as string}`);
      }
    }
    // Corruption check
    if (effect.corruptionCheck && scopeCompanyId) {
      const modifier = effect.corruptionCheck.modifier ?? 0;
      const scope = stateBeforeFinalize.phaseState.phase === Phase.MovementHazard
        ? ({ kind: 'company-mh-subphase' as const, companyId: scopeCompanyId })
        : ({ kind: 'company-site-subphase' as const, companyId: scopeCompanyId });
      s = enqueueCorruptionCheck(s, {
        source: null,
        actor: combat.defendingPlayerId,
        scope,
        characterId: effect.targetCharacterId,
        modifier,
        reason: 'post-attack corruption check',
      });
      logDetail(`Post-attack: corruption check queued on ${effect.targetCharacterId as string} (mod ${modifier})`);
    }
  }

  return s;
}

/**
 * After combat, return any haven-jumped characters to their original
 * company. The character's CharacterInPlay stays unchanged; only the
 * companies' `characters` membership lists are rewritten.
 */
function restoreHavenJumpOrigins(
  stateAfterCombat: GameState,
  combat: CombatState,
): GameState {
  const origins = combat.havenJumpOrigins ?? [];
  if (origins.length === 0) return stateAfterCombat;

  const defIdx = stateAfterCombat.players.findIndex(p => p.id === combat.defendingPlayerId);
  if (defIdx < 0) return stateAfterCombat;

  const player = stateAfterCombat.players[defIdx];
  const newCompanies = player.companies.map(c => {
    let chars = c.characters;
    for (const o of origins) {
      if (chars.includes(o.characterId) && c.id !== o.originCompanyId) {
        chars = chars.filter(id => id !== o.characterId);
      }
      if (c.id === o.originCompanyId && !chars.includes(o.characterId)) {
        chars = [...chars, o.characterId];
      }
    }
    return chars === c.characters ? c : { ...c, characters: chars };
  });

  const newPlayers: [PlayerState, PlayerState] = [stateAfterCombat.players[0], stateAfterCombat.players[1]];
  newPlayers[defIdx] = { ...player, companies: newCompanies };
  for (const o of origins) {
    logDetail(`Haven-jump finalize: ${o.characterId as string} returned to company ${o.originCompanyId as string}`);
  }
  return { ...stateAfterCombat, players: newPlayers };
}

/**
 * Build an on-event condition context from the current game state.
 * Includes `company.hazardsEncountered` for troll-trio condition checks.
 */
function buildOnEventContext(state: GameState): Record<string, unknown> {
  const ctx: Record<string, unknown> = {};
  if (state.phaseState.phase === Phase.MovementHazard) {
    ctx.company = { hazardsEncountered: state.phaseState.hazardsEncountered };
  }
  return ctx;
}

/**
 * Discard items on wounded characters matching the move filter to the
 * defending player's discard pile. Implements the combat-specific
 * `move { select: 'filter-all', from: 'items-on-wounded', to: 'discard',
 * toOwner: 'defender', filter }` shape used by creatures like Balrog
 * of Moria to strip non-special items from their victims.
 */
function discardWoundedItems(
  state: GameState,
  combat: CombatState,
  woundedCharIds: readonly CardInstanceId[],
  sourceName: string,
  filter: import('../types/effects.js').Condition | undefined,
): GameState {
  const defIdx = state.players.findIndex(p => p.id === combat.defendingPlayerId);
  const cloned = clonePlayers(state);
  const newCharacters = { ...cloned[defIdx].characters };
  const discarded: { instanceId: CardInstanceId; definitionId: string }[] = [];

  for (const charId of woundedCharIds) {
    const charData = newCharacters[charId as string];
    if (!charData) continue;

    const matching = charData.items.filter(item => {
      const def = state.cardPool[item.definitionId as string];
      if (!def) return false;
      if (!filter) return true;
      return matchesCondition(filter, def as unknown as Record<string, unknown>);
    });

    if (matching.length === 0) continue;

    const remaining = charData.items.filter(item => !matching.some(m => m.instanceId === item.instanceId));
    newCharacters[charId as string] = { ...charData, items: remaining };

    for (const item of matching) {
      discarded.push({ instanceId: item.instanceId, definitionId: item.definitionId as string });
      logDetail(`${sourceName}: discarding item ${item.definitionId as string} from wounded character ${charId as string}`);
    }
  }

  cloned[defIdx] = {
    ...cloned[defIdx],
    characters: newCharacters,
    discardPile: [
      ...cloned[defIdx].discardPile,
      ...discarded.map(d => ({ instanceId: d.instanceId, definitionId: d.definitionId as unknown as CardDefinitionId })),
    ],
  };

  return { ...state, players: cloned };
}

/**
 * Discard wounded characters to the defending player's discard pile when the
 * per-character condition (evaluated against `{ target: { race } }`) is met.
 * Implements the `discard-character` apply type for `character-wounded-by-self`.
 * Used by Abductor (tw-1): discards every non-Wizard/non-Ringwraith character it wounds.
 */
function discardWoundedCharacters(
  state: GameState,
  combat: CombatState,
  woundedCharIds: readonly CardInstanceId[],
  sourceName: string,
  when: import('../types/effects.js').Condition | undefined,
): GameState {
  const defIdx = state.players.findIndex(p => p.id === combat.defendingPlayerId);
  let stateOut = state;

  for (const charId of woundedCharIds) {
    const player = stateOut.players[defIdx];
    const charData = player?.characters[charId as string];
    if (!charData) continue;

    const charDefId = resolveInstanceId(stateOut, charId);
    const charDef = charDefId ? stateOut.cardPool[charDefId as string] : undefined;
    const charRace = charDef && isCharacterCard(charDef) ? charDef.race : undefined;
    const perCharContext: Record<string, unknown> = { target: { race: charRace } };

    if (when && !matchesCondition(when, perCharContext)) {
      logDetail(`${sourceName}: discard-character excluded for ${charId as string} (race ${String(charRace)})`);
      continue;
    }

    logDetail(`${sourceName}: discarding wounded character ${charId as string} to discard pile`);
    const cloned = clonePlayers(stateOut);
    const newPlayerData = { ...cloned[defIdx] };

    newPlayerData.companies = newPlayerData.companies.map(c => ({
      ...c,
      characters: c.characters.filter(ch => ch !== charId),
    }));
    newPlayerData.discardPile = [
      ...newPlayerData.discardPile,
      { instanceId: charId, definitionId: charDefId! },
    ];
    for (const ally of charData.allies) {
      logDetail(`${sourceName}: discarding ally ${ally.instanceId as string} from discarded character`);
      newPlayerData.discardPile = [...newPlayerData.discardPile, { instanceId: ally.instanceId, definitionId: ally.definitionId }];
    }
    for (const item of charData.items) {
      logDetail(`${sourceName}: discarding item ${item.instanceId as string} from discarded character`);
      newPlayerData.discardPile = [...newPlayerData.discardPile, { instanceId: item.instanceId, definitionId: item.definitionId }];
    }
    const { [charId as string]: _removed, ...remainingChars } = newPlayerData.characters;
    newPlayerData.characters = remainingChars;

    cloned[defIdx] = newPlayerData;
    stateOut = { ...stateOut, players: cloned };
  }

  return stateOut;
}

/**
 * After combat finalization, record the creature name in the M/H phase
 * state's `hazardsEncountered` list for troll-trio condition checks.
 */
function recordHazardEncountered(
  stateAfterCombat: GameState,
  originalState: GameState,
  combat: CombatState,
): GameState {
  if (originalState.phaseState.phase !== Phase.MovementHazard) return stateAfterCombat;
  if (combat.attackSource.type !== 'creature') return stateAfterCombat;

  const creatureDefId = resolveInstanceId(originalState, combat.attackSource.instanceId);
  if (!creatureDefId) return stateAfterCombat;

  const creatureDef = originalState.cardPool[creatureDefId as string] as { name?: string } | undefined;
  const creatureName = creatureDef?.name;
  if (!creatureName) return stateAfterCombat;

  const mhState = stateAfterCombat.phaseState as MovementHazardPhaseState;
  logDetail(`Recording hazard "${creatureName}" in hazardsEncountered`);
  return {
    ...stateAfterCombat,
    phaseState: {
      ...mhState,
      hazardsEncountered: [...mhState.hazardsEncountered, creatureName],
    },
  };
}

/**
 * Look up the card definition for the attack source in combat.
 * For automatic attacks, returns the site card. For creature attacks,
 * returns the creature card definition.
 */
function getAttackSourceCard(
  state: GameState,
  combat: CombatState,
): { effects?: readonly import('../types/effects.js').CardEffect[] } | undefined {
  if (combat.attackSource.type === 'automatic-attack') {
    const siteInstanceId = combat.attackSource.siteInstanceId;
    const siteDefId = resolveInstanceId(state, siteInstanceId);
    if (!siteDefId) return undefined;
    const siteDef = state.cardPool[siteDefId as string];
    return siteDef && isSiteCard(siteDef) ? siteDef : undefined;
  }
  if (combat.attackSource.type === 'creature' || combat.attackSource.type === 'played-auto-attack') {
    const creatureDefId = resolveInstanceId(state, combat.attackSource.instanceId);
    if (!creatureDefId) return undefined;
    return state.cardPool[creatureDefId as string] as { effects?: readonly import('../types/effects.js').CardEffect[] } | undefined;
  }
  return undefined;
}

/**
 * Play a hazard permanent-event from the attacker's hand during a
 * combat window (currently `resolve-strike`). Attaches the card to the
 * defender identified by `targetCharacterId` and applies any
 * `self-enters-play-combat` on-event effects it declares — notably
 * `modify-current-strike-prowess`, which adjusts the current strike's
 * prowess (Dragon's Curse: -1).
 *
 * The card's `play-window`, `play-condition` (combat-creature-race),
 * and `play-target.filter` are evaluated by the legal-action emitter
 * in `legal-actions/combat.ts`; the reducer trusts the action to be
 * legal and focuses on state transitions.
 */
function handleCombatPlayHazard(
  state: GameState,
  action: GameAction,
  combat: CombatState,
): ReducerResult {
  if (action.type !== 'play-hazard') return wrongActionType(state, action, 'play-hazard');
  if (combat.phase !== 'resolve-strike') {
    return { state, error: `play-hazard during combat is only valid in resolve-strike (current: ${combat.phase})` };
  }
  if (action.player !== combat.attackingPlayerId) {
    return { state, error: 'only the attacking player may play hazards during combat' };
  }

  const hazardIndex = state.players.findIndex(p => p.id === action.player);
  const hazardPlayer = state.players[hazardIndex];
  const cardIdx = hazardPlayer.hand.findIndex(c => c.instanceId === action.cardInstanceId);
  if (cardIdx === -1) return { state, error: 'card not in hand' };
  const handCard = hazardPlayer.hand[cardIdx];
  const def = state.cardPool[handCard.definitionId as string];
  if (!def || def.cardType !== 'hazard-event' || def.eventType !== 'permanent') {
    return { state, error: 'only hazard permanent-events may be played during combat' };
  }

  const defenderIndex = state.players.findIndex(p => p.id === combat.defendingPlayerId);
  const defenderPlayer = state.players[defenderIndex];
  const targetCharId = action.targetCharacterId;
  if (!targetCharId) return { state, error: 'targetCharacterId required for combat hazard play' };
  const targetChar = defenderPlayer.characters[targetCharId as string];
  if (!targetChar) return { state, error: 'target character not in defending player' };

  // Remove card from hand
  const newHand = [...hazardPlayer.hand];
  newHand.splice(cardIdx, 1);
  let newState: GameState = updatePlayer(state, hazardIndex, p => ({ ...p, hand: newHand }));

  // Ward check: a matching ward on the target discards the curse to
  // the hazard player's discard pile instead of attaching it.
  if (isWardedAgainst(newState, defenderIndex, targetCharId, def)) {
    logDetail(`Combat play-hazard: "${def.name}" cancelled by ward on target — routing to attacker's discard`);
    newState = updatePlayer(newState, hazardIndex, p => ({
      ...p,
      discardPile: [...p.discardPile, { instanceId: handCard.instanceId, definitionId: handCard.definitionId }],
    }));
    return { state: newState };
  }

  // Attach to target's hazards
  logDetail(`Combat play-hazard: attaching "${def.name}" to ${targetCharId as string}`);
  newState = updatePlayer(newState, defenderIndex, p => updateCharacter(p, targetCharId as string, c => ({
    ...c,
    hazards: [...c.hazards, { instanceId: handCard.instanceId, definitionId: handCard.definitionId, status: CardStatus.Untapped }],
  })));

  // Apply self-enters-play-combat on-event effects declared by the card.
  // Currently supports `modify-current-strike-prowess` which adjusts
  // the current strike's prowess via combat.strikeAssignments[i].strikeProwessBonus.
  // The bonus is added to the defender's effective prowess (a -1 to
  // the attacker's strike prowess is equivalent to +1 to the defender),
  // so the data carries a negative `value` and the reducer flips sign.
  {
    for (const eff of getOnEventEffects(def as { effects?: readonly import('../types/effects.js').CardEffect[] }, 'self-enters-play-combat')) {
      if (eff.apply.type === 'modify-current-strike-prowess') {
        const strikeDelta = eff.apply.value ?? 0;
        const defenderProwessDelta = -strikeDelta;
        logDetail(`Combat play-hazard: "${def.name}" modifies current strike's prowess by ${strikeDelta} (defender +${defenderProwessDelta})`);
        const newAssignments = combat.strikeAssignments.map((a, i) =>
          i === combat.currentStrikeIndex
            ? { ...a, strikeProwessBonus: (a.strikeProwessBonus ?? 0) + defenderProwessDelta }
            : a,
        );
        newState = { ...newState, combat: { ...combat, strikeAssignments: newAssignments } };
      }
    }
  }

  return { state: newState };
}

// ---- Prisoner-taking helpers (Rule 8.35) ----

/**
 * Search `hazards` for a hazard card that carries a `take-prisoner` effect.
 * Returns the host card instance and the effect, or null if not found.
 */
function findTakePrisonerHazard(
  state: GameState,
  _defPlayerIndex: number,
  hazards: readonly import('../types/state-cards.js').CardInPlay[],
): { hostCard: import('../types/state-cards.js').CardInstance; effect: TakePrisonerEffect } | null {
  for (const h of hazards) {
    const def = state.cardPool[h.definitionId as string];
    if (!def || !('effects' in def) || !def.effects) continue;
    const eff = (def.effects).find(
      (e): e is TakePrisonerEffect => e.type === 'take-prisoner',
    );
    if (eff) return { hostCard: { instanceId: h.instanceId, definitionId: h.definitionId }, effect: eff };
  }
  return null;
}

/**
 * Apply the prisoner-taking outcome for a character (CoE rule 8.35):
 *
 * 1. Draw the rescue site card from the hazard player's location deck
 *    (first matching site type found).
 * 2. Discard all non-ring items from the prisoner immediately.
 * 3. Revert followers to general influence (mind subtraction deferred
 *    to the next org phase — tracked by the constraint).
 * 4. Add `character-is-prisoner` active constraint on the character.
 * 5. Add the HazardHost record to `state.hazardHosts`.
 * 6. Remove the host card from the character's `hazards` list
 *    (it now lives in the HazardHost record).
 */
function applyTakePrisoner(
  state: GameState,
  defPlayerIndex: number,
  charInstanceId: CardInstanceId,
  takePrisonerResult: { hostCard: import('../types/state-cards.js').CardInstance; effect: TakePrisonerEffect },
): GameState {
  const { hostCard, effect } = takePrisonerResult;
  const hazardPlayerIndex = 1 - defPlayerIndex;
  const hazardPlayer = state.players[hazardPlayerIndex];

  // Find the rescue site card in the hazard player's location deck.
  const rescueSiteIdx = hazardPlayer.siteDeck.findIndex(site => {
    const siteDef = state.cardPool[site.definitionId as string];
    if (!siteDef || !('siteType' in siteDef)) return false;
    return effect.rescueSiteTypes.includes((siteDef as { siteType: string }).siteType);
  });
  if (rescueSiteIdx === -1) {
    // No rescue site available — this shouldn't happen if legal-action checks passed,
    // but handle gracefully by skipping prisoner-taking.
    logDetail(`take-prisoner: no rescue site found in hazard player's location deck — skipping`);
    return state;
  }

  const rescueSiteCard = hazardPlayer.siteDeck[rescueSiteIdx];
  logDetail(`take-prisoner: rescue site is ${rescueSiteCard.definitionId as string} (drawn from hazard player's location deck)`);

  // Remove rescue site from hazard player's location deck.
  const newHazardSiteDeck = [
    ...hazardPlayer.siteDeck.slice(0, rescueSiteIdx),
    ...hazardPlayer.siteDeck.slice(rescueSiteIdx + 1),
  ];

  const defPlayer = state.players[defPlayerIndex];
  const charData = defPlayer.characters[charInstanceId as string];
  if (!charData) return state;

  // Discard all non-ring items from the prisoner (rule 8.35).
  const retainedItems = charData.items.filter(item => {
    const itemDef = state.cardPool[item.definitionId as string];
    return itemDef && 'cardType' in itemDef
      && typeof (itemDef as { cardType: string }).cardType === 'string'
      && (itemDef as { cardType: string }).cardType.includes('ring-item');
  });
  const discardedItems = charData.items.filter(item => !retainedItems.includes(item));
  if (discardedItems.length > 0) {
    logDetail(`take-prisoner: discarding ${discardedItems.length} non-ring item(s) from prisoner ${charInstanceId as string}`);
  }

  // Remove host card from the character's hazards list (it moves to HazardHost record).
  const updatedHazards = charData.hazards.filter(h => h.instanceId !== hostCard.instanceId);

  // Revert followers to general influence (rule 8.35).
  // Followers are referenced by CardInstanceId in charData.followers; their
  // controlledBy is updated on their own CharacterInPlay entries.
  const followerIds = charData.followers;

  // Update the prisoner character.
  const newCharData = {
    ...charData,
    items: retainedItems,
    hazards: updatedHazards,
    controlledBy: 'general' as const,
  };

  let newState = updatePlayer(state, defPlayerIndex, p => {
    // Revert each follower to general influence.
    const updatedChars = { ...p.characters, [charInstanceId as string]: newCharData };
    for (const followerId of followerIds) {
      const follower = updatedChars[followerId as string];
      if (follower && follower.controlledBy === charInstanceId) {
        updatedChars[followerId as string] = { ...follower, controlledBy: 'general' };
      }
    }
    return {
      ...p,
      characters: updatedChars,
      discardPile: [...p.discardPile, ...discardedItems.map(i => ({ instanceId: i.instanceId, definitionId: i.definitionId }))],
    };
  });
  newState = updatePlayer(newState, hazardPlayerIndex, p => ({
    ...p,
    siteDeck: newHazardSiteDeck,
  }));

  // Add character-is-prisoner active constraint.
  newState = addConstraint(newState, {
    source: hostCard.instanceId,
    sourceDefinitionId: hostCard.definitionId,
    scope: { kind: 'until-cleared' },
    target: { kind: 'character', characterId: charInstanceId },
    kind: { type: 'character-is-prisoner', hostInstanceId: hostCard.instanceId },
  });

  // Create HazardHost record.
  const newHost: HazardHost = {
    hostCard,
    rescueSiteCard: { instanceId: rescueSiteCard.instanceId, definitionId: rescueSiteCard.definitionId },
    prisoners: [charInstanceId],
    ownedBy: hazardPlayer.id,
  };
  newState = { ...newState, hazardHosts: [...newState.hazardHosts, newHost] };

  logDetail(`take-prisoner: ${charInstanceId as string} is now a prisoner of ${hostCard.instanceId as string} at rescue site ${rescueSiteCard.definitionId as string}`);
  return newState;
}
