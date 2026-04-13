/**
 * @module reducer-combat
 *
 * Combat handlers for the game reducer. Covers strike assignment,
 * strike resolution, support strikes, body checks, and combat finalization.
 */

import type { GameState, CombatState, StrikeAssignment, GameAction, GameEffect, CardInstanceId, CardDefinitionId } from '../index.js';
import { CardStatus, Phase, isSiteCard, isCharacterCard, isAllyCard } from '../index.js';
import type { OnEventEffect, DodgeStrikeEffect } from '../types/effects.js';
import { matchesCondition } from '../effects/condition-matcher.js';
import type { MovementHazardPhaseState } from '../types/state-phases.js';
import type { HeroItemCard, MinionItemCard } from '../types/cards-resources.js';
import { logDetail } from './legal-actions/log.js';
import { findAllyInCompany } from './legal-actions/combat.js';
import { resolveInstanceId } from '../types/state.js';
import type { ReducerResult } from './reducer-utils.js';
import { roll2d6, clonePlayers } from './reducer-utils.js';
import { resolveEnemyBody } from './effects/index.js';
import { computeCombatProwess, buildInPlayNames } from './recompute-derived.js';
import { enqueueResolution } from './pending.js';


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
    case 'halve-strikes':
      return handleHalveStrikes(state, action, combat);
    case 'salvage-item':
      return handleSalvageItem(state, action, combat);
    default:
      return { state, error: `Unexpected action '${action.type}' during combat` };
  }
}

/**
 * Compute the next combat phase after all strikes are assigned or a strike finishes resolving.
 * If multiple unresolved strikes remain, enters choose-strike-order so the defender picks.
 * If exactly one remains, auto-selects it and goes to resolve-strike.
 * Returns null if all strikes are resolved (caller should finalize combat).
 */


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
    return { phase: 'resolve-strike', currentStrikeIndex: unresolvedIndices[0], bodyCheckTarget: null };
  }
  logDetail(`${unresolvedIndices.length} unresolved strikes — defender chooses order`);
  return { phase: 'choose-strike-order', bodyCheckTarget: null };
}

/** Handle the defender choosing which strike to resolve next. */


function handleChooseStrikeOrder(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'choose-strike-order') return { state, error: 'Expected choose-strike-order' };
  if (combat.phase !== 'choose-strike-order') return { state, error: 'Not in choose-strike-order phase' };
  if (action.player !== combat.defendingPlayerId) return { state, error: 'Only defending player can choose strike order' };

  const idx = action.strikeIndex;
  if (idx < 0 || idx >= combat.strikeAssignments.length) return { state, error: 'Invalid strike index' };
  if (combat.strikeAssignments[idx].resolved) return { state, error: 'Strike already resolved' };

  logDetail(`Defender chose to resolve strike ${idx} (character ${combat.strikeAssignments[idx].characterId as string})`);
  return {
    state: { ...state, combat: { ...combat, phase: 'resolve-strike', currentStrikeIndex: idx } },
  };
}

/** Assign a strike to a defending character. */


function handleAssignStrike(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'assign-strike') return { state, error: 'Expected assign-strike' };
  if (combat.phase !== 'assign-strikes') return { state, error: 'Not in assign-strikes phase' };

  const totalAllocated = combat.strikeAssignments.length
    + combat.strikeAssignments.reduce((sum, a) => sum + a.excessStrikes, 0);
  const strikesRemaining = combat.strikesTotal - totalAllocated;
  if (strikesRemaining <= 0) return { state, error: 'All strikes already assigned' };

  // Validate character or ally is in the defending company (CoE rule 2.V.2.2)
  const defPlayerIndex = state.players.findIndex(p => p.id === combat.defendingPlayerId);
  const defPlayer = state.players[defPlayerIndex];
  const company = defPlayer.companies.find(c => c.id === combat.companyId);
  if (!company) return { state, error: 'Defending company not found' };
  const isCharInCompany = company.characters.includes(action.characterId);
  const isAllyInCompany = !isCharInCompany && !!findAllyInCompany(defPlayer, company.characters, action.characterId);
  if (!isCharInCompany && !isAllyInCompany) {
    return { state, error: 'Character not in defending company' };
  }

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
    // Excess strike: character already has a strike, add -1 prowess penalty
    if (combat.assignmentPhase !== 'attacker') {
      return { state, error: 'Only attacker can assign excess strikes' };
    }
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
  if (action.type !== 'pass') return { state, error: 'Expected pass' };

  // Pass during item-salvage: player declines further transfers, discard remaining items
  if (combat.phase === 'item-salvage') {
    if (action.player !== combat.defendingPlayerId) {
      return { state, error: 'Only the defending player can pass during item salvage' };
    }
    logDetail('Defender passed item-salvage — discarding remaining items');
    const newPlayers = clonePlayers(state);
    const defIdx = state.players.findIndex(p => p.id === combat.defendingPlayerId);
    for (const item of combat.salvageItems ?? []) {
      logDetail(`Discarding unsalvaged item ${item.instanceId as string}`);
      newPlayers[defIdx] = {
        ...newPlayers[defIdx],
        discardPile: [...newPlayers[defIdx].discardPile, { instanceId: item.instanceId, definitionId: item.definitionId }],
      };
    }
    return finishSalvage({ ...state, players: newPlayers }, combat);
  }

  // Pass during cancel-by-tap sub-phase: proceed to strike resolution
  if (combat.phase === 'assign-strikes' && combat.assignmentPhase === 'cancel-by-tap') {
    logDetail('Defender passed cancel-by-tap — proceeding to strike resolution');
    const next = nextStrikePhase(combat);
    return {
      state: { ...state, combat: { ...combat, assignmentPhase: 'done', ...next } },
    };
  }

  // Pass during cancel-window: defender declined to cancel — proceed to attacker assignment
  if (combat.phase === 'assign-strikes' && combat.assignmentPhase === 'cancel-window') {
    if (action.player !== combat.defendingPlayerId) {
      return { state, error: 'Only the defending player can pass during cancel window' };
    }
    logDetail('Defender passed cancel window — attacker assigns strikes');
    return {
      state: { ...state, combat: { ...combat, assignmentPhase: 'attacker' } },
    };
  }

  if (combat.phase !== 'assign-strikes' || combat.assignmentPhase !== 'defender') {
    return { state, error: 'Can only pass during defender strike assignment, cancel-window, cancel-by-tap, or item-salvage' };
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

/** Resolve the current strike — roll dice and determine outcome. */


function handleResolveStrike(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'resolve-strike') return { state, error: 'Expected resolve-strike' };
  if (combat.phase !== 'resolve-strike') return { state, error: 'Not in resolve-strike phase' };

  const strike = combat.strikeAssignments[combat.currentStrikeIndex];
  if (!strike || strike.resolved) return { state, error: 'Current strike already resolved' };

  // Look up combatant stats — may be a character or an ally (CoE rule 2.V.2.2)
  const defPlayerIndex = state.players.findIndex(p => p.id === combat.defendingPlayerId);
  const defPlayer = state.players[defPlayerIndex];
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
  if (allyMatch) {
    // Allies use prowess from card definition directly
    prowess = isAllyCard(charDef) ? (charDef).prowess : 0;
  } else if (combat.creatureRace && charDef && isCharacterCard(charDef)) {
    prowess = computeCombatProwess(state, charData, charDef, combat.creatureRace);
  } else {
    prowess = charData.effectiveStats.prowess;
  }
  if (!action.tapToFight) prowess -= 3;  // Stay untapped penalty
  if (targetStatus === CardStatus.Tapped) prowess -= 1;
  if (targetStatus === CardStatus.Inverted) prowess -= 2; // Wounded
  if (strike.excessStrikes > 0) prowess -= strike.excessStrikes; // Excess strikes penalty

  // Roll dice
  const { roll, rng, cheatRollTotal } = roll2d6(state);
  const rollTotal = roll.die1 + roll.die2;
  const characterTotal = rollTotal + prowess;

  const defPlayer2 = state.players[defPlayerIndex];
  logDetail(`Strike resolution: ${targetDefId as string} rolls ${roll.die1}+${roll.die2}=${rollTotal} + prowess ${prowess} = ${characterTotal} vs creature prowess ${combat.strikeProwess}`);

  const charLabel = charDef && 'name' in charDef ? (charDef as { name: string }).name : (targetDefId as string);
  const effects: GameEffect[] = [{
    effect: 'dice-roll', playerName: defPlayer2.name,
    die1: roll.die1, die2: roll.die2, label: `Strike: ${charLabel}`,
  }];

  // Determine outcome
  let result: 'success' | 'wounded' | 'eliminated';
  let bodyCheckTarget: 'character' | 'creature' | null = null;

  if (characterTotal > combat.strikeProwess) {
    // Character wins — strike defeated
    result = 'success';
    if (combat.creatureBody !== null) {
      bodyCheckTarget = 'creature'; // Body check against creature
    }
    logDetail(`Character defeats strike — ${bodyCheckTarget ? 'body check vs creature' : 'creature has no body'}`);
  } else if (characterTotal < combat.strikeProwess) {
    // Strike wins — character wounded
    result = 'wounded';
    bodyCheckTarget = 'character'; // Body check against character
    logDetail('Strike succeeds — character wounded, body check vs character');
  } else {
    // Tie — ineffectual
    result = 'success'; // Character survives
    logDetail('Tie — ineffectual, character taps');
  }

  // Update strike assignment — record whether the combatant was already wounded
  // before this strike so the body check can apply +1 correctly (CoE rule 3.I).
  const wasAlreadyWounded = targetStatus === CardStatus.Inverted;
  const newAssignments = combat.strikeAssignments.map((a, i) =>
    i === combat.currentStrikeIndex ? { ...a, resolved: true, result, wasAlreadyWounded } : a,
  );

  // Tap or wound combatant (character or ally)
  const newPlayers = clonePlayers(state);
  const newCharacters = { ...defPlayer.characters };

  if (allyMatch) {
    // Target is an ally — update ally status on its host character
    const hostChar = newCharacters[allyMatch.hostCharId as string];
    if (hostChar) {
      let newAllyStatus = allyMatch.ally.status;
      if (action.tapToFight || characterTotal === combat.strikeProwess) {
        if (newAllyStatus === CardStatus.Untapped) newAllyStatus = CardStatus.Tapped;
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
    if (action.tapToFight || characterTotal === combat.strikeProwess) {
      // Tap character (unless staying untapped)
      if (charData.status === CardStatus.Untapped) {
        newCharacters[strike.characterId as string] = { ...charData, status: CardStatus.Tapped };
      }
    }
    if (result === 'wounded' && !combat.detainment) {
      // Wound (invert) character
      newCharacters[strike.characterId as string] = {
        ...(newCharacters[strike.characterId as string] ?? charData),
        status: CardStatus.Inverted,
      };
    } else if (result === 'wounded' && combat.detainment) {
      // Detainment: tap instead of wound
      newCharacters[strike.characterId as string] = {
        ...(newCharacters[strike.characterId as string] ?? charData),
        status: CardStatus.Tapped,
      };
    }
  }
  newPlayers[defPlayerIndex] = { ...defPlayer, characters: newCharacters, lastDiceRoll: roll };

  // Determine next phase
  let newCombat: CombatState;
  if (bodyCheckTarget) {
    newCombat = {
      ...combat,
      strikeAssignments: newAssignments,
      phase: 'body-check',
      bodyCheckTarget,
    };
  } else {
    // No body check — advance to next strike or finish combat
    const combatWithAssignments = { ...combat, strikeAssignments: newAssignments };
    const next = nextStrikePhase(combatWithAssignments);
    if (!next) {
      return finalizeCombat({ ...state, players: newPlayers, rng, cheatRollTotal, combat: combatWithAssignments }, effects);
    }
    newCombat = { ...combatWithAssignments, ...next };
  }

  return {
    state: { ...state, players: newPlayers, rng, cheatRollTotal, combat: newCombat },
    effects,
  };
}

/** Tap a supporting character for +1 prowess on the current strike. */


function handleSupportStrike(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'support-strike') return { state, error: 'Expected support-strike' };
  if (combat.phase !== 'resolve-strike') return { state, error: 'Not in resolve-strike phase' };

  const defPlayerIndex = state.players.findIndex(p => p.id === combat.defendingPlayerId);
  const defPlayer = state.players[defPlayerIndex];

  // Check if supporter is a character
  const supporterChar = defPlayer.characters[action.supportingCharacterId as string];
  if (supporterChar) {
    if (supporterChar.status !== CardStatus.Untapped) return { state, error: 'Supporting character must be untapped' };
    const newPlayers = clonePlayers(state);
    const newCharacters = { ...defPlayer.characters };
    newCharacters[action.supportingCharacterId as string] = { ...supporterChar, status: CardStatus.Tapped };
    newPlayers[defPlayerIndex] = { ...defPlayer, characters: newCharacters };
    logDetail(`${action.supportingCharacterId as string} taps to support — +1 prowess`);
    return { state: { ...state, players: newPlayers } };
  }

  // Check if supporter is an ally
  for (const charId of Object.keys(defPlayer.characters)) {
    const ch = defPlayer.characters[charId];
    const allyIndex = ch.allies.findIndex(a => a.instanceId === action.supportingCharacterId);
    if (allyIndex >= 0) {
      const ally = ch.allies[allyIndex];
      if (ally.status !== CardStatus.Untapped) return { state, error: 'Supporting ally must be untapped' };
      const newPlayers = clonePlayers(state);
      const newAllies = [...ch.allies];
      newAllies[allyIndex] = { ...ally, status: CardStatus.Tapped };
      const newCharacters = { ...defPlayer.characters };
      newCharacters[charId] = { ...ch, allies: newAllies };
      newPlayers[defPlayerIndex] = { ...defPlayer, characters: newCharacters };
      logDetail(`Ally ${action.supportingCharacterId as string} taps to support — +1 prowess`);
      return { state: { ...state, players: newPlayers } };
    }
  }

  return { state, error: 'Supporting character or ally not found' };
}

/**
 * Play a dodge-strike card from hand during resolve-strike.
 * Discards the card, then resolves the strike at full prowess without
 * tapping the character (unless wounded). If wounded, records the body
 * penalty for the subsequent body check.
 */


function handlePlayDodge(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'play-dodge') return { state, error: 'Expected play-dodge' };
  if (combat.phase !== 'resolve-strike') return { state, error: 'Not in resolve-strike phase' };

  const strike = combat.strikeAssignments[combat.currentStrikeIndex];
  if (!strike || strike.resolved) return { state, error: 'Current strike already resolved' };

  // Validate card in hand and has dodge-strike effect
  const defPlayerIndex = state.players.findIndex(p => p.id === combat.defendingPlayerId);
  const defPlayer = state.players[defPlayerIndex];
  const handIndex = defPlayer.hand.findIndex(c => c.instanceId === action.cardInstanceId);
  if (handIndex < 0) return { state, error: 'Card not found in hand' };

  const handCard = defPlayer.hand[handIndex];
  const cardDef = state.cardPool[handCard.definitionId as string];
  if (!cardDef || !('effects' in cardDef)) return { state, error: 'Card has no effects' };
  const cardWithEffects = cardDef as { effects?: readonly import('../types/effects.js').CardEffect[] };
  const dodgeEffect = cardWithEffects.effects?.find(
    (e): e is DodgeStrikeEffect => e.type === 'dodge-strike',
  );
  if (!dodgeEffect) return { state, error: 'Card has no dodge-strike effect' };

  logDetail(`Playing dodge card ${handCard.definitionId as string} for strike on ${strike.characterId as string}`);

  // Discard the dodge card from hand
  const newHand = [...defPlayer.hand];
  newHand.splice(handIndex, 1);

  // Look up combatant stats (character or ally)
  const charData = defPlayer.characters[strike.characterId as string];
  const company = defPlayer.companies.find(c => c.id === combat.companyId);
  const allyMatch = !charData && company
    ? findAllyInCompany(defPlayer, company.characters, strike.characterId)
    : undefined;
  if (!charData && !allyMatch) return { state, error: 'Character not found' };

  const targetDefId = charData?.definitionId ?? allyMatch!.ally.definitionId;
  const targetStatus = charData?.status ?? allyMatch!.ally.status;
  const charDef2 = state.cardPool[targetDefId as string];

  // Compute effective prowess (full prowess, like tap-to-fight)
  let prowess: number;
  if (allyMatch) {
    prowess = isAllyCard(charDef2) ? charDef2.prowess : 0;
  } else if (combat.creatureRace && charDef2 && isCharacterCard(charDef2)) {
    prowess = computeCombatProwess(state, charData, charDef2, combat.creatureRace);
  } else {
    prowess = charData.effectiveStats.prowess;
  }
  if (targetStatus === CardStatus.Tapped) prowess -= 1;
  if (targetStatus === CardStatus.Inverted) prowess -= 2;
  if (strike.excessStrikes > 0) prowess -= strike.excessStrikes;

  // Roll dice
  const { roll, rng, cheatRollTotal } = roll2d6(state);
  const rollTotal = roll.die1 + roll.die2;
  const characterTotal = rollTotal + prowess;

  logDetail(`Dodge strike resolution: ${targetDefId as string} rolls ${roll.die1}+${roll.die2}=${rollTotal} + prowess ${prowess} = ${characterTotal} vs creature prowess ${combat.strikeProwess}`);

  const charLabel = charDef2 && 'name' in charDef2 ? (charDef2 as { name: string }).name : (targetDefId as string);
  const effects: GameEffect[] = [{
    effect: 'dice-roll', playerName: defPlayer.name,
    die1: roll.die1, die2: roll.die2, label: `Strike (dodge): ${charLabel}`,
  }];

  // Determine outcome
  let result: 'success' | 'wounded' | 'eliminated';
  let bodyCheckTarget: 'character' | 'creature' | null = null;

  if (characterTotal > combat.strikeProwess) {
    result = 'success';
    if (combat.creatureBody !== null) bodyCheckTarget = 'creature';
    logDetail(`Dodge: character defeats strike — no tap${bodyCheckTarget ? ', body check vs creature' : ''}`);
  } else if (characterTotal < combat.strikeProwess) {
    result = 'wounded';
    bodyCheckTarget = 'character';
    logDetail(`Dodge: strike succeeds — character wounded, body check with ${dodgeEffect.bodyPenalty} penalty`);
  } else {
    result = 'success';
    logDetail('Dodge: tie — ineffectual, character does NOT tap (dodge)');
  }

  const wasAlreadyWounded = targetStatus === CardStatus.Inverted;
  const newAssignments = combat.strikeAssignments.map((a, i) =>
    i === combat.currentStrikeIndex
      ? { ...a, resolved: true, result, wasAlreadyWounded, dodged: true, dodgeBodyPenalty: dodgeEffect.bodyPenalty }
      : a,
  );

  // Update character status: dodge means NO tap on success/tie
  const newPlayers = clonePlayers(state);
  const newCharacters = { ...defPlayer.characters };

  if (allyMatch) {
    const hostChar = newCharacters[allyMatch.hostCharId as string];
    if (hostChar) {
      let newAllyStatus = allyMatch.ally.status;
      // Dodge: do NOT tap on success/tie (unlike normal resolve)
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
    // Dodge: only change status if wounded (no tap on success/tie)
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

  // Update player: new hand (card discarded) + new character statuses
  newPlayers[defPlayerIndex] = {
    ...defPlayer,
    characters: newCharacters,
    hand: newHand,
    discardPile: [...defPlayer.discardPile, { instanceId: handCard.instanceId, definitionId: handCard.definitionId }],
    lastDiceRoll: roll,
  };

  // Determine next phase
  let newCombat: CombatState;
  if (bodyCheckTarget) {
    newCombat = {
      ...combat,
      strikeAssignments: newAssignments,
      phase: 'body-check',
      bodyCheckTarget,
    };
  } else {
    const combatWithAssignments = { ...combat, strikeAssignments: newAssignments };
    const next = nextStrikePhase(combatWithAssignments);
    if (!next) {
      return finalizeCombat({ ...state, players: newPlayers, rng, cheatRollTotal, combat: combatWithAssignments }, effects);
    }
    newCombat = { ...combatWithAssignments, ...next };
  }

  return {
    state: { ...state, players: newPlayers, rng, cheatRollTotal, combat: newCombat },
    effects,
  };
}

/** Roll body check — attacker rolls 2d6 vs body value. */


function handleBodyCheckRoll(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'body-check-roll') return { state, error: 'Expected body-check-roll' };
  if (combat.phase !== 'body-check') return { state, error: 'Not in body-check phase' };

  const { roll, rng, cheatRollTotal } = roll2d6(state);
  const rollTotal = roll.die1 + roll.die2;
  const atkPlayerIndex = state.players.findIndex(p => p.id === combat.attackingPlayerId);
  const effects: GameEffect[] = [{
    effect: 'dice-roll', playerName: state.players[atkPlayerIndex].name,
    die1: roll.die1, die2: roll.die2, label: `Body check: ${combat.bodyCheckTarget}`,
  }];

  // Update lastDiceRoll on the attacking player
  const basePlayers = clonePlayers(state);
  basePlayers[atkPlayerIndex] = { ...basePlayers[atkPlayerIndex], lastDiceRoll: roll };
  const stateWithRoll: GameState = { ...state, players: basePlayers, rng, cheatRollTotal };

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
        // Ally eliminated — remove from host character and discard
        const hostChar = newPlayerData.characters[allyMatch.hostCharId as string];
        if (hostChar) {
          const newAllies = hostChar.allies.filter(a => a.instanceId !== strike.characterId);
          newPlayerData.characters = {
            ...newPlayerData.characters,
            [allyMatch.hostCharId as string]: { ...hostChar, allies: newAllies },
          };
        }
        newPlayerData.discardPile = [...newPlayerData.discardPile, {
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
      newPlayerData.eliminatedPile = [...newPlayerData.eliminatedPile, { instanceId: strike.characterId, definitionId: elimCharDefId! }];

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
 * Cancel an entire attack by tapping a scout and discarding a cancel-attack
 * card from hand. Only allowed during the assign-strikes phase before any
 * strikes have been assigned.
 */
function handleCancelAttack(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'cancel-attack') return { state, error: 'Expected cancel-attack' };
  if (combat.phase !== 'assign-strikes') return { state, error: 'Can only cancel attack before strikes are assigned' };
  if (combat.strikeAssignments.length > 0) return { state, error: 'Strikes already assigned — too late to cancel' };
  if (action.player !== combat.defendingPlayerId) return { state, error: 'Only defending player can cancel an attack' };

  const defPlayerIndex = state.players.findIndex(p => p.id === action.player);
  const defPlayer = state.players[defPlayerIndex];

  // Validate the card is in hand
  const cardIndex = defPlayer.hand.findIndex(c => c.instanceId === action.cardInstanceId);
  if (cardIndex < 0) return { state, error: 'Card not in hand' };

  const newPlayers = clonePlayers(state);
  const newCharacters = { ...defPlayer.characters };

  // Tap the scout if a skill cost is required
  if (action.scoutInstanceId) {
    const company = defPlayer.companies.find(c => c.id === combat.companyId);
    if (!company || !company.characters.includes(action.scoutInstanceId)) {
      return { state, error: 'Scout not in defending company' };
    }
    const scoutData = defPlayer.characters[action.scoutInstanceId as string];
    if (!scoutData || scoutData.status !== CardStatus.Untapped) {
      return { state, error: 'Scout must be untapped' };
    }
    logDetail(`Attack canceled: ${defPlayer.hand[cardIndex].definitionId as string} played, tapping ${scoutData.definitionId as string}`);
    newCharacters[action.scoutInstanceId as string] = { ...scoutData, status: CardStatus.Tapped };
  } else {
    logDetail(`Attack canceled: ${defPlayer.hand[cardIndex].definitionId as string} played (no cost)`);
  }

  // Move card from hand to discard
  const newHand = [...defPlayer.hand];
  const [discardedCard] = newHand.splice(cardIndex, 1);
  const newDiscard = [...defPlayer.discardPile, { instanceId: discardedCard.instanceId, definitionId: discardedCard.definitionId }];

  newPlayers[defPlayerIndex] = {
    ...defPlayer,
    characters: newCharacters,
    hand: newHand,
    discardPile: newDiscard,
  };

  // For multi-attack creatures (e.g. Assassin), cancelling one attack removes
  // one strike rather than ending the entire combat. Concealment says "cancel
  // one attack" — each multi-attack sub-attack counts as a separate attack.
  if (combat.forceSingleTarget && combat.strikesTotal > 1) {
    const newStrikesTotal = combat.strikesTotal - 1;
    logDetail(`Multi-attack: one attack canceled, strikes reduced ${combat.strikesTotal} → ${newStrikesTotal}`);
    // Also reduce cancelByTapRemaining if present, since there's one fewer attack to cancel
    const newCancelByTap = combat.cancelByTapRemaining !== undefined
      ? Math.min(combat.cancelByTapRemaining, newStrikesTotal)
      : undefined;
    return {
      state: {
        ...state,
        players: newPlayers,
        combat: { ...combat, strikesTotal: newStrikesTotal, cancelByTapRemaining: newCancelByTap },
      },
    };
  }

  // If this was a creature attack, move creature card from attacker's cardsInPlay to discard
  const atkIdx = state.players.findIndex(p => p.id === combat.attackingPlayerId);
  const creatureInstanceId =
    combat.attackSource.type === 'creature' ? combat.attackSource.instanceId
      : combat.attackSource.type === 'on-guard-creature' ? combat.attackSource.cardInstanceId
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

  logDetail('Combat canceled — returning to enclosing phase');
  return { state: { ...state, players: newPlayers, combat: null } };
}

/**
 * Cancel one strike by tapping a non-target character in the defending
 * company. Used by the `cancel-attack-by-tap` combat rule (e.g. Assassin).
 * Removes one strike assignment and decrements cancelByTapRemaining.
 */
function handleCancelByTap(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'cancel-by-tap') return { state, error: 'Expected cancel-by-tap' };
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

  // Cannot tap the target character
  const targetCharId = combat.strikeAssignments[0]?.characterId;
  if (action.characterId === targetCharId) {
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
  if (action.type !== 'halve-strikes') return { state, error: 'Expected halve-strikes' };
  if (combat.phase !== 'assign-strikes') return { state, error: 'Can only halve strikes before strikes are assigned' };
  if (combat.strikeAssignments.length > 0) return { state, error: 'Strikes already assigned — too late to halve' };
  if (action.player !== combat.defendingPlayerId) return { state, error: 'Only defending player can halve strikes' };

  const defPlayerIndex = state.players.findIndex(p => p.id === action.player);
  const defPlayer = state.players[defPlayerIndex];

  const cardIndex = defPlayer.hand.findIndex(c => c.instanceId === action.cardInstanceId);
  if (cardIndex < 0) return { state, error: 'Card not in hand' };

  const originalStrikes = combat.strikesTotal;
  const newStrikes = Math.ceil(originalStrikes / 2);
  logDetail(`Strikes halved: ${originalStrikes} → ${newStrikes} (${defPlayer.hand[cardIndex].definitionId as string} played)`);

  const newPlayers = clonePlayers(state);
  const newHand = [...defPlayer.hand];
  const [discardedCard] = newHand.splice(cardIndex, 1);
  const newDiscard = [...defPlayer.discardPile, { instanceId: discardedCard.instanceId, definitionId: discardedCard.definitionId }];

  newPlayers[defPlayerIndex] = {
    ...defPlayer,
    hand: newHand,
    discardPile: newDiscard,
  };

  return {
    state: {
      ...state,
      players: newPlayers,
      combat: { ...combat, strikesTotal: newStrikes },
    },
  };
}

/**
 * Transfer one item from an eliminated character to an unwounded companion.
 * Available during the 'item-salvage' combat phase (CoE rule 3.I.2).
 */
function handleSalvageItem(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'salvage-item') return { state, error: 'Expected salvage-item' };
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
 * Finalize combat after all strikes are resolved.
 *
 * If all strikes were defeated (result === 'success'), the creature card
 * moves from the hazard player's discard pile to the defending player's
 * marshalling point pile. Otherwise it stays in discard.
 */


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
  const creatureInstanceId =
    combat.attackSource.type === 'creature' ? combat.attackSource.instanceId
      : combat.attackSource.type === 'on-guard-creature' ? combat.attackSource.cardInstanceId
        : null;

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

    if (allDefeated && creatureCard) {
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
  let stateAfterCombat: GameState = { ...state, players: newPlayers, combat: null };
  const woundedCharIds = combat.strikeAssignments
    .filter(a => a.result === 'wounded')
    .map(a => a.characterId);

  if (
    woundedCharIds.length > 0 &&
    (state.phaseState.phase === Phase.Site || state.phaseState.phase === Phase.MovementHazard)
  ) {
    const sourceCard = getAttackSourceCard(state, combat);
    const sourceName = (sourceCard as { name?: string } | undefined)?.name ?? 'Wound';
    const woundEvents = (sourceCard?.effects ?? []).filter(
      (e): e is OnEventEffect => e.type === 'on-event' && e.event === 'character-wounded-by-self',
    );
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
            stateAfterCombat = enqueueResolution(stateAfterCombat, {
              source,
              actor,
              scope,
              kind: {
                type: 'corruption-check',
                characterId,
                modifier,
                reason: sourceName,
                possessions: [],
                transferredItemId: null,
              },
            });
          }
        }
      } else if (woundEvent.apply.type === 'discard-non-special-items') {
        stateAfterCombat = discardNonSpecialItems(stateAfterCombat, combat, woundedCharIds, sourceName);
      }
    }
  }

  stateAfterCombat = recordHazardEncountered(stateAfterCombat, state, combat);

  return {
    state: stateAfterCombat,
    effects,
  };
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
 * Discard all non-special items from each wounded character.
 * Items are moved to the defending player's discard pile.
 */
function discardNonSpecialItems(
  state: GameState,
  combat: CombatState,
  woundedCharIds: readonly CardInstanceId[],
  sourceName: string,
): GameState {
  const defIdx = state.players.findIndex(p => p.id === combat.defendingPlayerId);
  const cloned = clonePlayers(state);
  const newCharacters = { ...cloned[defIdx].characters };
  const discarded: { instanceId: CardInstanceId; definitionId: string }[] = [];

  for (const charId of woundedCharIds) {
    const charData = newCharacters[charId as string];
    if (!charData) continue;

    const nonSpecial = charData.items.filter(item => {
      const def = state.cardPool[item.definitionId as string] as HeroItemCard | MinionItemCard | undefined;
      return def && 'subtype' in def && def.subtype !== 'special';
    });

    if (nonSpecial.length === 0) continue;

    const specialOnly = charData.items.filter(item => !nonSpecial.some(ns => ns.instanceId === item.instanceId));
    newCharacters[charId as string] = { ...charData, items: specialOnly };

    for (const item of nonSpecial) {
      discarded.push({ instanceId: item.instanceId, definitionId: item.definitionId as string });
      logDetail(`${sourceName}: discarding non-special item ${item.definitionId as string} from wounded character ${charId as string}`);
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
  if (combat.attackSource.type === 'creature') {
    const creatureDefId = resolveInstanceId(state, combat.attackSource.instanceId);
    if (!creatureDefId) return undefined;
    return state.cardPool[creatureDefId as string] as { effects?: readonly import('../types/effects.js').CardEffect[] } | undefined;
  }
  return undefined;
}

