/**
 * @module reducer-combat
 *
 * Combat handlers for the game reducer. Covers strike assignment,
 * strike resolution, support strikes, body checks, and combat finalization.
 */

import type { GameState, CombatState, StrikeAssignment, GameAction, GameEffect } from '../index.js';
import { CardStatus, Phase, isSiteCard, isCharacterCard } from '../index.js';
import type { OnEventEffect } from '../types/effects.js';
import { logDetail } from './legal-actions/log.js';
import { resolveInstanceId } from '../types/state.js';
import type { ReducerResult } from './reducer-utils.js';
import { roll2d6, clonePlayers } from './reducer-utils.js';
import { resolveEnemyBody } from './effects/index.js';
import { computeCombatProwess, buildInPlayNames } from './recompute-derived.js';


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

  // Validate character is in the defending company
  const defPlayerIndex = state.players.findIndex(p => p.id === combat.defendingPlayerId);
  const defPlayer = state.players[defPlayerIndex];
  const company = defPlayer.companies.find(c => c.id === combat.companyId);
  if (!company) return { state, error: 'Defending company not found' };
  if (!company.characters.includes(action.characterId)) {
    return { state, error: 'Character not in defending company' };
  }

  const existingIdx = combat.strikeAssignments.findIndex(a => a.characterId === action.characterId);

  let newAssignments: StrikeAssignment[];
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
  if (combat.phase !== 'assign-strikes' || combat.assignmentPhase !== 'defender') {
    return { state, error: 'Can only pass during defender strike assignment' };
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

  // Look up character stats
  const defPlayerIndex = state.players.findIndex(p => p.id === combat.defendingPlayerId);
  const defPlayer = state.players[defPlayerIndex];
  const charData = defPlayer.characters[strike.characterId as string];
  if (!charData) return { state, error: 'Character not found' };

  // Compute effective prowess — recompute with combat context when creature race
  // is known so that combat-conditional weapon effects (e.g. Glamdring vs Orcs, Éowyn vs Nazgûl) apply.
  const charDef = state.cardPool[charData.definitionId as string];
  let prowess: number;
  if (combat.creatureRace && charDef && isCharacterCard(charDef)) {
    prowess = computeCombatProwess(state, charData, charDef, combat.creatureRace);
  } else {
    prowess = charData.effectiveStats.prowess;
  }
  if (!action.tapToFight) prowess -= 3;  // Stay untapped penalty
  if (charData.status === CardStatus.Tapped) prowess -= 1;
  if (charData.status === CardStatus.Inverted) prowess -= 2; // Wounded
  if (strike.excessStrikes > 0) prowess -= strike.excessStrikes; // Excess strikes penalty

  // Roll dice
  const { roll, rng, cheatRollTotal } = roll2d6(state);
  const rollTotal = roll.die1 + roll.die2;
  const characterTotal = rollTotal + prowess;

  const defPlayer2 = state.players[defPlayerIndex];
  logDetail(`Strike resolution: ${charData.definitionId as string} rolls ${roll.die1}+${roll.die2}=${rollTotal} + prowess ${prowess} = ${characterTotal} vs creature prowess ${combat.strikeProwess}`);

  const charLabel = charDef && 'name' in charDef ? (charDef as { name: string }).name : (charData.definitionId as string);
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

  // Update strike assignment — record whether the character was already wounded
  // before this strike so the body check can apply +1 correctly (CoE rule 3.I).
  const wasAlreadyWounded = charData.status === CardStatus.Inverted;
  const newAssignments = combat.strikeAssignments.map((a, i) =>
    i === combat.currentStrikeIndex ? { ...a, resolved: true, result, wasAlreadyWounded } : a,
  );

  // Tap or wound character
  const newPlayers = clonePlayers(state);
  const newCharacters = { ...defPlayer.characters };
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
    // Body check against character
    const strike = combat.strikeAssignments[combat.currentStrikeIndex];
    const defPlayerIndex = stateWithRoll.players.findIndex(p => p.id === combat.defendingPlayerId);
    const defPlayer = stateWithRoll.players[defPlayerIndex];
    const charData = defPlayer.characters[strike.characterId as string];
    if (!charData) return { state, error: 'Character not found for body check' };

    const charDef2 = stateWithRoll.cardPool[charData.definitionId as string] as { body?: number } | undefined;
    const body = charDef2?.body ?? 9; // Default body if not specified
    const woundedBonus = strike.wasAlreadyWounded ? 1 : 0;
    const effectiveRoll = rollTotal + woundedBonus;

    logDetail(`Body check vs character: roll ${rollTotal}${woundedBonus ? '+1(wounded)' : ''} = ${effectiveRoll} vs body ${body}`);

    if (effectiveRoll > body) {
      // Character eliminated
      logDetail('Character eliminated');
      const newAssignments = combat.strikeAssignments.map((a, i) =>
        i === combat.currentStrikeIndex ? { ...a, result: 'eliminated' as const } : a,
      );

      // Remove character from company and add to eliminated pile
      const newPlayers2 = clonePlayers(stateWithRoll);
      const newPlayerData = { ...defPlayer };
      const company = newPlayerData.companies.find(c => c.id === combat.companyId);
      if (company) {
        const newCompanies = newPlayerData.companies.map(c =>
          c.id === combat.companyId
            ? { ...c, characters: c.characters.filter(ch => ch !== strike.characterId) }
            : c,
        );
        newPlayerData.companies = newCompanies;
      }
      // Move to eliminated pile (full item transfer deferred to Phase 4)
      const elimCharDefId = resolveInstanceId(state, strike.characterId);
      newPlayerData.eliminatedPile = [...newPlayerData.eliminatedPile, { instanceId: strike.characterId, definitionId: elimCharDefId! }];
      const { [strike.characterId as string]: _, ...remainingChars } = newPlayerData.characters;
      newPlayerData.characters = remainingChars;
      newPlayers2[defPlayerIndex] = newPlayerData;

      // Advance to next strike or finalize
      const combatWithElim = { ...combat, strikeAssignments: newAssignments };
      const next2 = nextStrikePhase(combatWithElim);
      if (next2) {
        return { state: { ...stateWithRoll, players: newPlayers2, combat: { ...combatWithElim, ...next2 } }, effects };
      }
      return finalizeCombat({ ...stateWithRoll, players: newPlayers2, combat: combatWithElim }, effects);
    }

    logDetail('Character survives body check');
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
  // has this effect, queue corruption checks in the site phase state.
  let newPhaseState = state.phaseState;
  const woundedCharIds = combat.strikeAssignments
    .filter(a => a.result === 'wounded')
    .map(a => a.characterId);

  if (woundedCharIds.length > 0 && (state.phaseState.phase === Phase.Site || state.phaseState.phase === Phase.MovementHazard)) {
    const phaseWithChecks = state.phaseState;
    const sourceCard = getAttackSourceCard(state, combat);
    if (sourceCard?.effects) {
      const woundEvent = sourceCard.effects.find(
        (e): e is OnEventEffect => e.type === 'on-event' && e.event === 'character-wounded-by-self',
      );
      if (woundEvent) {
        const modifier = woundEvent.apply.modifier ?? 0;
        const checks = woundedCharIds.map(characterId => ({ characterId, modifier }));
        logDetail(`Wound corruption checks queued for ${checks.length} character(s) (modifier ${modifier})`);
        newPhaseState = { ...phaseWithChecks, pendingWoundCorruptionChecks: [...phaseWithChecks.pendingWoundCorruptionChecks, ...checks] };
      }
    }
  }

  return {
    state: { ...state, players: newPlayers, combat: null, phaseState: newPhaseState },
    effects,
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

