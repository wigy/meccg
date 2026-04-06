/**
 * @module reducer-free-council
 *
 * Free Council phase handlers for the game reducer. Covers corruption checks
 * during Free Council, final scoring, and game completion.
 */

import type { GameState, CardInstance, FreeCouncilPhaseState, PlayerId, GameAction, GameEffect } from '../index.js';
import { Phase, isCharacterCard, Race, getPlayerIndex } from '../index.js';
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
 */
export function handleFreeCouncil(state: GameState, action: GameAction): ReducerResult {
  const fcState = state.phaseState as FreeCouncilPhaseState;

  if (fcState.step === 'done') {
    return { state, error: 'Free Council scoring is complete' };
  }

  // Handle corruption check (reuse the same dice logic as organization phase)
  if (action.type === 'corruption-check') {
    const playerIndex = getPlayerIndex(state, action.player);
    const player = state.players[playerIndex];
    const char = player.characters[action.characterId as string];
    if (!char) return { state, error: 'Character not found' };

    const fcCharDefId = resolveInstanceId(state, action.characterId);
    const charDef = fcCharDefId ? state.cardPool[fcCharDefId as string] : undefined;
    const charName = charDef?.name ?? '?';
    const cp = action.corruptionPoints;
    const modifier = action.corruptionModifier;

    const { roll, rng, cheatRollTotal } = roll2d6(state);
    const total = roll.die1 + roll.die2 + modifier;
    const modStr = modifier !== 0 ? ` ${modifier >= 0 ? '+' : ''}${modifier}` : '';
    logDetail(`Free Council corruption check for ${charName}: rolled ${roll.die1} + ${roll.die2}${modStr} = ${total} vs CP ${cp}`);

    const rollEffect: GameEffect = {
      effect: 'dice-roll',
      playerName: player.name,
      die1: roll.die1,
      die2: roll.die2,
      label: `Corruption: ${charName}`,
    };

    const newPlayers = clonePlayers(state);
    newPlayers[playerIndex] = { ...newPlayers[playerIndex], lastDiceRoll: roll };

    const newChecked = [...fcState.checkedCharacters, action.characterId as string];

    if (total > cp) {
      // Passed
      logDetail(`Free Council corruption check passed (${total} > ${cp})`);
      return {
        state: {
          ...state,
          players: newPlayers,
          rng, cheatRollTotal,
          phaseState: { ...fcState, checkedCharacters: newChecked },
        },
        effects: [rollEffect],
      };
    }

    // Failed — character is discarded or eliminated
    const newCharacters = { ...player.characters };
    delete newCharacters[action.characterId as string];

    const newCompanies = player.companies.map(c => ({
      ...c,
      characters: c.characters.filter(id => id !== action.characterId),
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
        { instanceId: action.characterId, definitionId: char.definitionId },
        ...action.possessions.map(id => ({ instanceId: id, definitionId: resolveInstanceId(state, id)! })),
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
        eliminatedPile: [...player.eliminatedPile, { instanceId: action.characterId, definitionId: char.definitionId }],
        discardPile: [...player.discardPile, ...action.possessions.map(id => ({ instanceId: id, definitionId: resolveInstanceId(state, id)! }))],
      };
    }

    return {
      state: cleanupEmptyCompanies({
        ...state,
        players: newPlayers,
        rng, cheatRollTotal,
        phaseState: { ...fcState, checkedCharacters: newChecked },
      }),
      effects: [rollEffect],
    };
  }

  if (action.type === 'pass') {
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
        phaseState: { ...fcState, currentPlayer: otherPlayer, checkedCharacters: [], firstPlayerDone: true },
      },
    };
  }

  return { state, error: `Unexpected action '${action.type}' in Free Council phase` };
}

/**
 * Computes final tournament scores for both players and transitions to Game Over.
 * Applies steps 2-4 (via computeTournamentScore), step 6 (avatar elimination penalty),
 * and determines the winner (step 7).
 */


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
  // For simplicity, check if any character in eliminatedPile was an avatar (wizard/ringwraith)
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


/**
 * Checks whether a player's avatar (wizard or ringwraith) has been eliminated.
 * Looks through the eliminated pile for any character with the avatar flag.
 */
function hasEliminatedAvatar(state: GameState, playerIndex: 0 | 1): boolean {
  const player = state.players[playerIndex];
  for (const card of player.eliminatedPile) {
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

