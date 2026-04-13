/**
 * @module reducer-free-council
 *
 * Free Council phase handlers for the game reducer. Covers corruption checks
 * during Free Council, final scoring, and game completion.
 *
 * Per CoE rule 7.1.1, after a corruption check is declared but before it
 * resolves, other untapped characters in the same company may tap for +1
 * support each. The two-step flow is: declare check (stored in
 * `pendingCheck`) → tap supporters → pass to resolve.
 */

import type { GameState, CardInstance, FreeCouncilPhaseState, PlayerId, GameAction, GameEffect } from '../index.js';
import { Phase, isCharacterCard, Race, getPlayerIndex, CardStatus } from '../index.js';
import { logHeading, logDetail } from './legal-actions/log.js';
import { computeTournamentScore } from '../state-utils.js';
import { resolveInstanceId } from '../types/state.js';
import type { ReducerResult } from './reducer-utils.js';
import { roll2d6, clonePlayers, cleanupEmptyCompanies } from './reducer-utils.js';


/**
 * Handles actions during the Free Council phase.
 *
 * During 'corruption-checks' step, each player performs corruption checks
 * for their characters in turn. When both players have finished (or passed),
 * final scores are computed and the game transitions to Game Over.
 *
 * Corruption checks follow a two-step flow:
 * 1. Player declares a corruption check (stored in `pendingCheck`)
 * 2. Other untapped characters in the same company may tap for +1 support
 * 3. Player passes to resolve the check with accumulated support
 */
export function handleFreeCouncil(state: GameState, action: GameAction): ReducerResult {
  const fcState = state.phaseState as FreeCouncilPhaseState;

  if (fcState.step === 'done') {
    return { state, error: 'Free Council scoring is complete' };
  }

  // Handle support tapping for a pending corruption check (CoE 7.1.1)
  if (action.type === 'support-corruption-check') {
    return handleSupportCorruptionCheck(state, action, fcState);
  }

  // Handle corruption check declaration — enters support window
  if (action.type === 'corruption-check') {
    return handleDeclareCorruptionCheck(state, action, fcState);
  }

  if (action.type === 'pass') {
    // If a check is pending, resolve it with accumulated support
    if (fcState.pendingCheck) {
      return resolveCorruptionCheck(state, fcState);
    }

    if (fcState.firstPlayerDone) {
      // Both players done — compute final scores and transition to Game Over
      logDetail(`Free Council: both players finished corruption checks → computing final scores`);
      return { state: computeFinalScoresAndEnd(state) };
    }

    // Switch to the other player for their corruption checks
    const currentIndex = getPlayerIndex(state, fcState.currentPlayer);
    const otherIndex = currentIndex === 0 ? 1 : 0;
    const otherPlayer = state.players[otherIndex].id;

    logDetail(`Free Council: ${action.player as string} done with corruption checks → switching to ${otherPlayer as string}`);
    return {
      state: {
        ...state,
        phaseState: {
          ...fcState,
          currentPlayer: otherPlayer,
          checkedCharacters: [],
          firstPlayerDone: true,
          pendingCheck: null,
        },
      },
    };
  }

  return { state, error: `Unexpected action '${action.type}' in Free Council phase` };
}

/**
 * Declares a corruption check — stores it as pending so that other
 * untapped characters in the same company can tap for support before
 * the dice roll resolves.
 *
 * If no eligible supporters exist, the check resolves immediately
 * to avoid an unnecessary pass step.
 */
function handleDeclareCorruptionCheck(
  state: GameState,
  action: GameAction,
  fcState: FreeCouncilPhaseState,
): ReducerResult {
  if (action.type !== 'corruption-check') return { state, error: 'Expected corruption-check' };

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const char = player.characters[action.characterId as string];
  if (!char) return { state, error: 'Character not found' };

  const charDefId = resolveInstanceId(state, action.characterId);
  const charDef = charDefId ? state.cardPool[charDefId as string] : undefined;
  const charName = charDef?.name ?? '?';

  logDetail(`Free Council: corruption check declared for ${charName}`);

  const newFcState: FreeCouncilPhaseState = {
    ...fcState,
    pendingCheck: {
      characterId: action.characterId,
      corruptionPoints: action.corruptionPoints,
      corruptionModifier: action.corruptionModifier,
      possessions: action.possessions,
      need: action.need,
      explanation: action.explanation,
      supportCount: 0,
    },
  };

  // Check if there are any eligible supporters (untapped characters in same company)
  const company = player.companies.find(c => c.characters.includes(action.characterId));
  let hasEligibleSupporter = false;
  if (company) {
    for (const cid of company.characters) {
      if (cid === action.characterId) continue;
      const c = player.characters[cid as string];
      if (c && c.status === CardStatus.Untapped) {
        hasEligibleSupporter = true;
        break;
      }
    }
  }

  if (!hasEligibleSupporter) {
    // No supporters available — resolve immediately
    logDetail(`Free Council: no eligible supporters for ${charName} — resolving immediately`);
    return resolveCorruptionCheck({ ...state, phaseState: newFcState }, newFcState);
  }

  logDetail(`Free Council: support window open for ${charName}`);
  return { state: { ...state, phaseState: newFcState } };
}

/**
 * Taps a character to support a pending corruption check.
 * The supporter must be untapped and in the same company as the
 * character making the check. Each supporter adds +1 to the roll.
 */
function handleSupportCorruptionCheck(
  state: GameState,
  action: GameAction,
  fcState: FreeCouncilPhaseState,
): ReducerResult {
  if (action.type !== 'support-corruption-check') return { state, error: 'Expected support-corruption-check' };
  if (!fcState.pendingCheck) return { state, error: 'No pending corruption check to support' };

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const supporter = player.characters[action.supportingCharacterId as string];
  if (!supporter) return { state, error: 'Supporting character not found' };
  if (supporter.status !== CardStatus.Untapped) return { state, error: 'Supporting character must be untapped' };

  // Verify supporter is in the same company as the check target
  const company = player.companies.find(c => c.characters.includes(fcState.pendingCheck!.characterId));
  if (!company || !company.characters.includes(action.supportingCharacterId)) {
    return { state, error: 'Supporting character must be in the same company' };
  }

  const supporterDefId = resolveInstanceId(state, action.supportingCharacterId);
  const supporterDef = supporterDefId ? state.cardPool[supporterDefId as string] : undefined;
  const supporterName = supporterDef?.name ?? (action.supportingCharacterId as string);

  logDetail(`Free Council: ${supporterName} taps to support corruption check — +1`);

  // Tap the supporter
  const newPlayers = clonePlayers(state);
  const newCharacters = { ...player.characters };
  newCharacters[action.supportingCharacterId as string] = { ...supporter, status: CardStatus.Tapped };
  newPlayers[playerIndex] = { ...player, characters: newCharacters };

  return {
    state: {
      ...state,
      players: newPlayers,
      phaseState: {
        ...fcState,
        pendingCheck: {
          ...fcState.pendingCheck,
          supportCount: fcState.pendingCheck.supportCount + 1,
        },
      },
    },
  };
}

/**
 * Resolves a pending corruption check by rolling 2d6 with the
 * accumulated support modifier. The character is checked off and
 * the result applied (pass, discard, or eliminate).
 */
function resolveCorruptionCheck(
  state: GameState,
  fcState: FreeCouncilPhaseState,
): ReducerResult {
  const pending = fcState.pendingCheck!;
  const playerIndex = getPlayerIndex(state, fcState.currentPlayer);
  const player = state.players[playerIndex];
  const char = player.characters[pending.characterId as string];
  if (!char) return { state, error: 'Character not found' };

  const fcCharDefId = resolveInstanceId(state, pending.characterId);
  const charDef = fcCharDefId ? state.cardPool[fcCharDefId as string] : undefined;
  const charName = charDef?.name ?? '?';
  const cp = pending.corruptionPoints;
  const modifier = pending.corruptionModifier + pending.supportCount;

  const { roll, rng, cheatRollTotal } = roll2d6(state);
  const total = roll.die1 + roll.die2 + modifier;
  const modStr = modifier !== 0 ? ` ${modifier >= 0 ? '+' : ''}${modifier}` : '';
  const supportStr = pending.supportCount > 0 ? ` (includes +${pending.supportCount} support)` : '';
  logDetail(`Free Council corruption check for ${charName}: rolled ${roll.die1} + ${roll.die2}${modStr} = ${total} vs CP ${cp}${supportStr}`);

  const rollEffect: GameEffect = {
    effect: 'dice-roll',
    playerName: player.name,
    die1: roll.die1,
    die2: roll.die2,
    label: `Corruption: ${charName}`,
  };

  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = { ...newPlayers[playerIndex], lastDiceRoll: roll };

  const newChecked = [...fcState.checkedCharacters, pending.characterId as string];
  const newFcBase = { ...fcState, checkedCharacters: newChecked, pendingCheck: null };

  if (total > cp) {
    // Passed
    logDetail(`Free Council corruption check passed (${total} > ${cp})`);
    return {
      state: {
        ...state,
        players: newPlayers,
        rng, cheatRollTotal,
        phaseState: newFcBase,
      },
      effects: [rollEffect],
    };
  }

  // Failed — character is discarded or eliminated
  const newCharacters = { ...player.characters };
  delete newCharacters[pending.characterId as string];

  const newCompanies = player.companies.map(c => ({
    ...c,
    characters: c.characters.filter(id => id !== pending.characterId),
  }));

  // Followers promoted to general influence
  for (const followerId of char.followers) {
    const follower = newCharacters[followerId as string];
    if (follower) {
      newCharacters[followerId as string] = { ...follower, controlledBy: 'general' };
    }
  }

  if (total >= cp - 1) {
    // Roll == CP or CP-1: character and possessions discarded
    logDetail(`Free Council corruption check FAILED (${total} within 1 of ${cp}) — discarding ${charName}`);
    const toDiscard: CardInstance[] = [
      { instanceId: pending.characterId, definitionId: char.definitionId },
      ...pending.possessions.map(id => ({ instanceId: id, definitionId: resolveInstanceId(state, id)! })),
    ];
    newPlayers[playerIndex] = {
      ...newPlayers[playerIndex],
      characters: newCharacters,
      companies: newCompanies,
      discardPile: [...player.discardPile, ...toDiscard],
    };
  } else {
    // Roll < CP-1: character eliminated, possessions discarded
    logDetail(`Free Council corruption check FAILED (${total} < ${cp - 1}) — eliminating ${charName}`);
    newPlayers[playerIndex] = {
      ...newPlayers[playerIndex],
      characters: newCharacters,
      companies: newCompanies,
      outOfPlayPile: [...player.outOfPlayPile, { instanceId: pending.characterId, definitionId: char.definitionId }],
      discardPile: [...player.discardPile, ...pending.possessions.map(id => ({ instanceId: id, definitionId: resolveInstanceId(state, id)! }))],
    };
  }

  return {
    state: cleanupEmptyCompanies({
      ...state,
      players: newPlayers,
      rng, cheatRollTotal,
      phaseState: newFcBase,
    }),
    effects: [rollEffect],
  };
}

/**
 * Computes final tournament scores for both players and transitions to Game Over.
 * Applies steps 2-4 (via computeTournamentScore), step 6 (avatar elimination penalty),
 * and determines the winner (step 7).
 */
function computeFinalScoresAndEnd(state: GameState): GameState {
  const p0 = state.players[0];
  const p1 = state.players[1];

  let score0 = computeTournamentScore(p0.marshallingPoints, p1.marshallingPoints);
  let score1 = computeTournamentScore(p1.marshallingPoints, p0.marshallingPoints);

  // Step 6: -5 misc MP penalty if avatar is eliminated
  // Avatar is the first character in the eliminated pile that matches the player's avatar type
  // For simplicity, check if any character in outOfPlayPile was an avatar (wizard/ringwraith)
  if (hasEliminatedAvatar(state, 0)) {
    logDetail(`Player ${p0.name} has eliminated avatar — applying -5 penalty`);
    score0 -= 5;
  }
  if (hasEliminatedAvatar(state, 1)) {
    logDetail(`Player ${p1.name} has eliminated avatar — applying -5 penalty`);
    score1 -= 5;
  }

  logHeading(`Final scores: ${p0.name} = ${score0}, ${p1.name} = ${score1}`);

  let winner: PlayerId | null = null;
  if (score0 > score1) winner = p0.id;
  else if (score1 > score0) winner = p1.id;

  if (winner) {
    const winnerName = state.players.find(p => p.id === winner)?.name ?? '?';
    logDetail(`Winner: ${winnerName}`);
  } else {
    logDetail(`Game ended in a tie`);
  }

  return {
    ...state,
    phaseState: {
      phase: Phase.GameOver,
      winner,
      finalScores: {
        [p0.id as string]: score0,
        [p1.id as string]: score1,
      },
      finishedPlayers: [],
    },
  };
}

/**
 * Checks whether a player's avatar (wizard or ringwraith) has been eliminated.
 * Looks through the eliminated pile for any character with the avatar flag.
 */
function hasEliminatedAvatar(state: GameState, playerIndex: 0 | 1): boolean {
  const player = state.players[playerIndex];
  for (const card of player.outOfPlayPile) {
    const def = state.cardPool[card.definitionId as string];
    if (def && isCharacterCard(def) && (def.race === Race.Wizard || def.race === Race.Ringwraith)) {
      return true;
    }
  }
  return false;
}

// ---- Combat sub-state handlers ----

/**
 * Dispatch a combat action to the appropriate handler based on the
 * current combat sub-phase.
 */
