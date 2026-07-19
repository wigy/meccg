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

import type { GameState, CardInstance, FreeCouncilPhaseState, PlayerId, GameAction, WinReason, CardDefinitionId } from '../index.js';
import { formatSignedNumber } from '../format-helpers.js';
import { getPlayerIndex, computeTournamentScore, requirePhaseState } from '../state-utils.js';
import { CardStatus, Alignment } from '../types/common.js';
import { Phase } from '../types/state-phases.js';
import { logHeading, logDetail } from './legal-actions/log.js';
import { resolveInstanceId, ownerOf } from '../types/state.js';
import { resolveDef } from './effects/index.js';
import { isCharacterCard } from '../types/cards.js';
import type { ReducerResult } from './reducer-utils.js';
import { roll2d6, diceRollEffect, classifyCorruptionOutcome, clonePlayers, cleanupEmptyCompanies, updatePlayer, updateCharacter, findCharacterCompany, playerById, defById, toCardInstance, hasEliminatedAvatar } from './reducer-utils.js';
import { handleGrantActionApply } from './grant-action-apply.js';
import { removeConstraint } from './pending.js';


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
  const fcState = requirePhaseState(state, Phase.FreeCouncil);

  // Handle support tapping for a pending corruption check (CoE 7.1.1)
  if (action.type === 'support-corruption-check') {
    return handleSupportCorruptionCheck(state, action, fcState);
  }

  // A corruption-check-window grant-action (When I Know Anything td-166: tap
  // sage to add +3 to the pending check, then make a check) is activatable
  // during the support window. It rides the shared grant-action reducer,
  // which adds the +3 check-modifier constraint and enqueues the sage's own
  // corruption check; the pending Free Council check stays open and reads the
  // constraint when it resolves.
  if (action.type === 'activate-granted-action') {
    return handleGrantActionApply(state, action);
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
      return { state: endGame(state, { kind: 'marshalling-points' }) };
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

  const player = playerById(state, action.player)!;
  const charDef = resolveDef(state, action.characterId);
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
  const company = findCharacterCompany(player.companies, action.characterId);
  let hasEligibleSupporter = false;
  if (company) {
    for (const cid of company.characters) {
      if (cid === action.characterId) continue;
      const c = player.characters[cid];
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

  const playerIndex = getPlayerIndex(state, action.player);
  const supporterDef = resolveDef(state, action.supportingCharacterId);
  const supporterName = supporterDef?.name ?? (action.supportingCharacterId as string);

  logDetail(`Free Council: ${supporterName} taps to support corruption check — +1`);

  // Tap the supporter
  const newState = updatePlayer(state, playerIndex, p =>
    updateCharacter(p, action.supportingCharacterId, c => ({ ...c, status: CardStatus.Tapped })),
  );

  return {
    state: {
      ...newState,
      phaseState: {
        ...fcState,
        pendingCheck: {
          ...fcState.pendingCheck!,
          supportCount: fcState.pendingCheck!.supportCount + 1,
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

  // Fold in (and consume) any one-shot corruption check-modifier constraints
  // targeting the checked character — e.g. the +3 a sage added via When I Know
  // Anything (td-166). These are added during the support window after the
  // check was declared, so they are read at resolution time rather than from
  // the frozen `pending.corruptionModifier`.
  let effectModifier = 0;
  let autoPass = false;
  for (const constraint of [...state.activeConstraints]) {
    if (constraint.kind.type === 'check-modifier'
        && constraint.kind.check === 'corruption'
        && constraint.target.kind === 'character'
        && constraint.target.characterId === pending.characterId) {
      effectModifier += constraint.kind.value;
      if (constraint.kind.autoPass) autoPass = true;
      logDetail(`Free Council: consuming one-shot check-modifier ${formatSignedNumber(constraint.kind.value)} from constraint ${constraint.id as string}${constraint.kind.autoPass ? ' (auto-pass)' : ''}`);
      state = removeConstraint(state, constraint.id);
    }
  }

  // Company-scoped corruption check-modifier constraints (Ren the Ringwraith
  // le-56: "modify all corruption checks made this turn by minions in any one
  // of your companies by +2"): applied to every corruption check by a minion
  // character in the *targeted* company, and NOT consumed (they persist for
  // their turn scope).
  const fcCompany = findCharacterCompany(
    state.players[playerIndex].companies, pending.characterId,
  );
  const fcCharDef = resolveDef(state, pending.characterId);
  const fcIsMinion = isCharacterCard(fcCharDef) && fcCharDef.cardType === 'minion-character';
  if (fcCompany && fcIsMinion) {
    for (const constraint of state.activeConstraints) {
      if (constraint.kind.type === 'check-modifier'
          && constraint.kind.check === 'corruption'
          && constraint.target.kind === 'company'
          && constraint.target.companyId === fcCompany.id) {
        effectModifier += constraint.kind.value;
        logDetail(`Free Council: company-wide corruption check-modifier ${formatSignedNumber(constraint.kind.value)} from constraint ${constraint.id as string}`);
      }
    }
  }

  const player = state.players[playerIndex];
  const char = player.characters[pending.characterId];
  const charDef = resolveDef(state, pending.characterId);
  const charName = charDef?.name ?? '?';
  const cp = pending.corruptionPoints;
  const modifier = pending.corruptionModifier + pending.supportCount + effectModifier;

  const { roll, rng, cheatRollTotal } = roll2d6(state);
  const total = roll.die1 + roll.die2 + modifier;
  const modStr = modifier !== 0 ? ` ${formatSignedNumber(modifier)}` : '';
  const supportStr = pending.supportCount > 0 ? ` (includes +${pending.supportCount} support)` : '';
  logDetail(`Free Council corruption check for ${charName}: rolled ${roll.die1} + ${roll.die2}${modStr} = ${total} vs CP ${cp}${supportStr}`);

  const rollEffect = diceRollEffect(player.name, roll, `Corruption: ${charName}`);

  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = { ...newPlayers[playerIndex], lastDiceRoll: roll };

  const newChecked = [...fcState.checkedCharacters, pending.characterId as string];
  const newFcBase = { ...fcState, checkedCharacters: newChecked, pendingCheck: null };

  // Classify against the controlling player's alignment (CoE 7.1 / 7.1.F1): a
  // minion character or the Fallen-wizard avatar *taps and succeeds* on a roll
  // of CP or CP-1 rather than failing.
  let outcome = classifyCorruptionOutcome(charDef, player.alignment, total, cp);
  if (autoPass && outcome !== 'success') {
    logDetail(`Free Council corruption check for ${charName} auto-passed (Ancient Black Axe) — overriding outcome '${outcome}' to 'success'`);
    outcome = 'success';
  }

  if (outcome === 'success' || outcome === 'tap-success') {
    if (outcome === 'tap-success') {
      // The character taps but stays in play; the check counts as a success.
      // Only an untapped character changes state — an already-tapped or wounded
      // character stays as it is (you cannot tap it "further").
      const tappedChars = { ...newPlayers[playerIndex].characters };
      const tappedChar = tappedChars[pending.characterId];
      if (tappedChar && tappedChar.status === CardStatus.Untapped) {
        tappedChars[pending.characterId] = { ...tappedChar, status: CardStatus.Tapped };
      }
      newPlayers[playerIndex] = { ...newPlayers[playerIndex], characters: tappedChars };
      logDetail(`Free Council corruption check (${total} within 1 of ${cp}) — ${charName} taps and the check is considered successful (CoE 7.1)`);
    } else {
      logDetail(`Free Council corruption check passed (${total} > ${cp})`);
    }
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
  delete newCharacters[pending.characterId];

  const newCompanies = player.companies.map(c => ({
    ...c,
    characters: c.characters.filter(id => id !== pending.characterId),
  }));

  // Followers promoted to general influence
  for (const followerId of char.followers) {
    const follower = newCharacters[followerId];
    if (follower) {
      newCharacters[followerId] = { ...follower, controlledBy: 'general' };
    }
  }

  // Dispatch hazards on this character to their owner's discard pile
  for (const hazard of char.hazards) {
    logDetail(`Free Council: discarding hazard ${hazard.instanceId as string} from ${charName}`);
    const hazOwner = ownerOf(hazard.instanceId);
    const hazOwnerIdx = newPlayers.findIndex(p => p.id === hazOwner);
    const safeIdx = hazOwnerIdx !== -1 ? hazOwnerIdx : 1 - playerIndex;
    newPlayers[safeIdx] = { ...newPlayers[safeIdx], discardPile: [...newPlayers[safeIdx].discardPile, toCardInstance(hazard)] };
  }

  // Separate hazards (owned by opponent) from non-hazard possessions (owned by resource player)
  const hazardPlayerIndex = playerIndex === 0 ? 1 : 0;
  const hazardPossessions: CardInstance[] = [];
  const nonHazardPossessions: CardInstance[] = [];
  for (const id of pending.possessions) {
    const hazOwner = ownerOf(id) as string;
    const defId = resolveInstanceId(state, id)!;
    if (hazOwner === (state.players[hazardPlayerIndex].id as string)) {
      logDetail(`Discarding hazard ${id as string} to hazard player`);
      hazardPossessions.push({ instanceId: id, definitionId: defId });
    } else {
      nonHazardPossessions.push({ instanceId: id, definitionId: defId });
    }
  }

  // Route hazards to the hazard player's discard
  if (hazardPossessions.length > 0) {
    newPlayers[hazardPlayerIndex] = {
      ...newPlayers[hazardPlayerIndex],
      discardPile: [...newPlayers[hazardPlayerIndex].discardPile, ...hazardPossessions],
    };
  }

  if (outcome === 'discard') {
    // Roll == CP or CP-1 on a hero character: it and its possessions are discarded
    logDetail(`Free Council corruption check FAILED (${total} within 1 of ${cp}) — discarding ${charName}`);
    const toDiscard: CardInstance[] = [
      { instanceId: pending.characterId, definitionId: char.definitionId },
      ...nonHazardPossessions,
    ];
    newPlayers[playerIndex] = {
      ...newPlayers[playerIndex],
      characters: newCharacters,
      companies: newCompanies,
      discardPile: [...newPlayers[playerIndex].discardPile, ...toDiscard],
    };
    // (Attached hazards were already discarded to their owners above.)
  } else {
    // outcome === 'eliminate': hard fail (≥2 below CP) or a Wizard avatar on any
    // failure — character eliminated, possessions discarded.
    logDetail(`Free Council corruption check FAILED (outcome eliminate, ${total} vs CP ${cp}) — eliminating ${charName}`);
    newPlayers[playerIndex] = {
      ...newPlayers[playerIndex],
      characters: newCharacters,
      companies: newCompanies,
      outOfPlayPile: [...player.outOfPlayPile, { instanceId: pending.characterId, definitionId: char.definitionId }],
      discardPile: [...newPlayers[playerIndex].discardPile, ...nonHazardPossessions],
    };
    // (Attached hazards were already discarded to their owners above.)
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
 * Computes final tournament scores for both players.
 *
 * Applies steps 2-4 (via computeTournamentScore), step 6 (avatar elimination
 * penalty), and step 5 (unique card reveal). Returns the per-player adjusted
 * scores keyed by index. The winner determination (step 7) is left to
 * {@link endGame}, which may force a winner on a One Ring win.
 */
function computeFinalScores(state: GameState): { score0: number; score1: number } {
  const p0 = state.players[0];
  const p1 = state.players[1];

  // Step 6: the -5 misc MP penalty for an eliminated avatar (CoE rule 2.2 /
  // 10.3.vi) is already folded into each player's running misc tally by
  // recomputeDerived (see hasEliminatedAvatar), so it flows through
  // computeTournamentScore here without a separate subtraction. Keeping it in a
  // single place means the live MP display and the final score never diverge.
  let score0 = computeTournamentScore(p0.marshallingPoints, p1.marshallingPoints);
  let score1 = computeTournamentScore(p1.marshallingPoints, p0.marshallingPoints);
  if (hasEliminatedAvatar(state, 0)) logDetail(`Player ${p0.name} has an eliminated avatar — -5 misc penalty already in running total`);
  if (hasEliminatedAvatar(state, 1)) logDetail(`Player ${p1.name} has an eliminated avatar — -5 misc penalty already in running total`);

  // MELE §6 step 5: Unique card reveal — scan each player's hand for unique
  // resource cards whose name matches a unique card the *opponent* has in play.
  // Each match reduces the opponent's final total by 1 (automatic, non-interactive).
  const uniqueNamesInPlay0 = new Set<string>();
  const uniqueNamesInPlay1 = new Set<string>();
  for (const card of p0.cardsInPlay) {
    const def = defById(state, card.definitionId);
    if (def && 'name' in def && 'unique' in def && (def as { unique: boolean }).unique) {
      uniqueNamesInPlay0.add((def as { name: string }).name);
    }
  }
  for (const card of p1.cardsInPlay) {
    const def = defById(state, card.definitionId);
    if (def && 'name' in def && 'unique' in def && (def as { unique: boolean }).unique) {
      uniqueNamesInPlay1.add((def as { name: string }).name);
    }
  }
  for (const handCard of p0.hand) {
    const def = defById(state, handCard.definitionId);
    if (!def || !('name' in def) || !('unique' in def) || !(def as { unique: boolean }).unique) continue;
    const name = (def as { name: string }).name;
    if (uniqueNamesInPlay1.has(name)) {
      logDetail(`Unique card reveal: ${p0.name} has unplayed "${name}" matching opponent's in-play — opponent -1 MP`);
      score1 -= 1;
    }
  }
  for (const handCard of p1.hand) {
    const def = defById(state, handCard.definitionId);
    if (!def || !('name' in def) || !('unique' in def) || !(def as { unique: boolean }).unique) continue;
    const name = (def as { name: string }).name;
    if (uniqueNamesInPlay0.has(name)) {
      logDetail(`Unique card reveal: ${p1.name} has unplayed "${name}" matching opponent's in-play — opponent -1 MP`);
      score0 -= 1;
    }
  }

  logHeading(`Final scores: ${p0.name} = ${score0}, ${p1.name} = ${score1}`);

  return { score0, score1 };
}

/**
 * Builds the terminal {@link Phase.GameOver} state and records how the game
 * was decided.
 *
 * Final scores are always computed (for the result screen). For a normal
 * endgame (`forcedWinner` undefined) the higher score wins — the CoE §10.3
 * behaviour. For a One Ring win (`reason.kind === 'one-ring'`) the caller
 * passes `forcedWinner`; that player wins regardless of score, per MELE §1.
 *
 * This is the single, well-logged code path through which every game ends —
 * all four One Ring alignment paths funnel through here with a forced winner.
 */
export function endGame(
  state: GameState,
  reason: WinReason,
  forcedWinner?: PlayerId,
): GameState {
  const p0 = state.players[0];
  const p1 = state.players[1];
  const { score0, score1 } = computeFinalScores(state);

  let winner: PlayerId | null;
  if (forcedWinner !== undefined) {
    winner = forcedWinner;
    const winnerName = playerById(state, winner)?.name ?? '?';
    logHeading(`The One Ring decides the game — ${winnerName} wins (${reason.kind === 'one-ring' ? reason.alignment : reason.kind})`);
  } else {
    winner = null;
    if (score0 > score1) winner = p0.id;
    else if (score1 > score0) winner = p1.id;

    if (winner) {
      const winnerName = playerById(state, winner)?.name ?? '?';
      logDetail(`Winner: ${winnerName}`);
    } else {
      logDetail(`Game ended in a tie`);
    }
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
      winReason: reason,
    },
  };
}

/**
 * Ends the game as a One Ring win (CoE rule 10.39) for `winner`.
 *
 * Convenience wrapper around {@link endGame} that derives the
 * {@link WinReason} alignment from the winning player and records the
 * triggering `card` (or `null` for the Ringwraith positional win). This is
 * the single entry point every alignment's win path funnels through —
 * positional (Ringwraith), card-on-play (Gollum's Fate / Challenge the
 * Power), corruption-check success (Cracks of Doom), and end-of-turn scan
 * (A New Ringlord).
 */
export function oneRingWin(
  state: GameState,
  winner: PlayerId,
  card: CardDefinitionId | null,
): GameState {
  const player = playerById(state, winner);
  const alignment = player?.alignment ?? Alignment.Wizard;
  return endGame(state, { kind: 'one-ring', alignment, card }, winner);
}

// ---- Combat sub-state handlers ----

/**
 * Dispatch a combat action to the appropriate handler based on the
 * current combat sub-phase.
 */
