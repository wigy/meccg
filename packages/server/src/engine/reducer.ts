/**
 * @module reducer
 *
 * The core game state reducer implementing the pure `(state, action) → state`
 * pattern. Every game mutation flows through {@link reduce}, which validates
 * the action, checks phase legality, and dispatches to the appropriate
 * phase handler.
 *
 * Currently the character draft phase is fully implemented; the remaining
 * phase handlers (Untap, Organisation, Long-Event, Movement/Hazard, Site,
 * End-of-Turn, Free Council) are stubs awaiting implementation.
 *
 * The reducer never mutates its input — it always returns a new state object
 * (or the original state plus an error string if the action was illegal).
 */

import type { GameState, DraftPlayerState, ItemDraftPlayerState, CardDefinitionId, CharacterInPlay } from '@meccg/shared';
import type { GameAction } from '@meccg/shared';
import { Phase, LEGAL_ACTIONS_BY_PHASE, getAlignmentRules } from '@meccg/shared';
import { applyDraftResults } from './init.js';
import { recomputeDerived } from './recompute-derived.js';

/**
 * Result of applying a {@link GameAction} to a {@link GameState}.
 * If `error` is present, `state` is returned unchanged.
 */
export interface ReducerResult {
  readonly state: GameState;
  /** Human-readable error message if the action was rejected. */
  readonly error?: string;
}

/**
 * Applies a single game action to the current state.
 *
 * Validation pipeline:
 * 1. Verify the action comes from a player allowed to act in the current context.
 * 2. Verify the action type is legal for the current phase.
 * 3. Dispatch to the phase-specific handler for domain logic.
 *
 * @param state - The current authoritative game state.
 * @param action - The player action to apply.
 * @returns A {@link ReducerResult} with the new state or an error.
 */
export function reduce(state: GameState, action: GameAction): ReducerResult {
  // 1. Validate action is from the correct player for the current context
  const validationError = validateActionPlayer(state, action);
  if (validationError) {
    return { state, error: validationError };
  }

  // 2. Validate action type is legal in current phase
  const phase = state.phaseState.phase;
  const legalActions = LEGAL_ACTIONS_BY_PHASE[phase];
  if (!legalActions.includes(action.type)) {
    return { state, error: `Action '${action.type}' is not legal in phase '${phase}'` };
  }

  // 3. Dispatch to phase handler
  let result: ReducerResult;
  switch (phase) {
    case Phase.CharacterDraft:
      result = handleCharacterDraft(state, action);
      break;
    case Phase.ItemDraft:
      result = handleItemDraft(state, action);
      break;
    case Phase.Untap:
      result = handleUntap(state, action);
      break;
    case Phase.Organization:
      result = handleOrganization(state, action);
      break;
    case Phase.LongEvent:
      result = handleLongEvent(state, action);
      break;
    case Phase.MovementHazard:
      result = handleMovementHazard(state, action);
      break;
    case Phase.Site:
      result = handleSite(state, action);
      break;
    case Phase.EndOfTurn:
      result = handleEndOfTurn(state, action);
      break;
    case Phase.FreeCouncil:
      result = handleFreeCouncil(state, action);
      break;
    case Phase.GameOver:
      return { state, error: 'Game is over' };
    default:
      return { state, error: `Unknown phase: ${String(phase satisfies never)}` };
  }

  // 4. Recompute derived values (MPs, general influence) from ground truth
  if (!result.error) {
    result = { state: recomputeDerived(result.state) };
  }

  return result;
}

/**
 * Checks whether the player submitting the action is allowed to act in the
 * current game context.
 *
 * - During the character draft, both players act simultaneously.
 * - During movement/hazard, the *non-active* player plays hazards.
 * - In all other phases, only the active player may act.
 *
 * @returns An error message if the player is not allowed to act, or
 *          `undefined` if the action is permitted.
 */
function validateActionPlayer(state: GameState, action: GameAction): string | undefined {
  const phase = state.phaseState.phase;

  // No active player during simultaneous phases (e.g. draft)
  if (state.activePlayer === null) {
    return undefined;
  }

  // During movement/hazard phase, the non-active player plays hazards
  if (phase === 'movement-hazard' && action.type === 'play-hazard') {
    if (action.player === state.activePlayer) {
      return 'Active player cannot play hazards';
    }
    return undefined;
  }

  // Most actions are taken by the active player
  if (action.player !== state.activePlayer) {
    return 'It is not your turn';
  }

  return undefined;
}

// ---- Character draft handler ----

/**
 * Handles actions during the simultaneous character draft phase.
 *
 * Both players secretly choose one character per round (`draft-pick`) or
 * stop drafting (`draft-stop`). When both have submitted for a round, picks
 * are revealed: if they chose the same character, neither gets it (set aside).
 * The draft ends when both players stop or hit the 5-character / 20-mind
 * limit, at which point {@link applyDraftResults} places characters on the
 * board and transitions to the first Untap phase.
 */
function handleCharacterDraft(state: GameState, action: GameAction): ReducerResult {
  if (state.phaseState.phase !== Phase.CharacterDraft) {
    return { state, error: 'Not in character draft phase' };
  }

  const draft = state.phaseState;
  const playerIndex = state.players[0].id === action.player ? 0 : 1;
  const playerDraft = draft.draftState[playerIndex];

  switch (action.type) {
    case 'draft-pick': {
      if (playerDraft.stopped) {
        return { state, error: 'You have already stopped drafting' };
      }
      if (playerDraft.currentPick !== null) {
        return { state, error: 'Waiting for opponent to pick' };
      }
      if (!playerDraft.pool.includes(action.characterDefId)) {
        return { state, error: 'Character not in your draft pool' };
      }
      // Check mind constraint
      const charDef = state.cardPool[action.characterDefId as string];
      if (!charDef || charDef.cardType !== 'hero-character') {
        return { state, error: 'Invalid character' };
      }
      const currentMind = playerDraft.drafted.reduce((sum, defId) => {
        const def = state.cardPool[defId as string];
        return sum + (def && def.cardType === 'hero-character' && def.mind !== null ? def.mind : 0);
      }, 0);
      if (charDef.mind !== null && currentMind + charDef.mind > 20) {
        return { state, error: 'Would exceed mind limit of 20' };
      }
      const { maxStartingCompanySize } = getAlignmentRules(state.players[playerIndex].alignment);
      if (playerDraft.drafted.length >= maxStartingCompanySize) {
        return { state, error: `Already have ${maxStartingCompanySize} starting characters` };
      }

      // Set the pick
      const newDraftState = [...draft.draftState] as [DraftPlayerState, DraftPlayerState];
      newDraftState[playerIndex] = {
        ...playerDraft,
        currentPick: action.characterDefId,
        pool: playerDraft.pool.filter(id => id !== action.characterDefId),
      };

      // Check if both players have submitted (or the other has stopped)
      const otherIndex = 1 - playerIndex;
      const otherDraft = newDraftState[otherIndex];
      if (otherDraft.currentPick !== null || otherDraft.stopped) {
        return resolveDraftRound(state, newDraftState, draft.round, draft.setAside);
      }

      // Wait for other player
      return {
        state: {
          ...state,
          phaseState: { ...draft, draftState: newDraftState },
        },
      };
    }

    case 'draft-stop': {
      if (playerDraft.stopped) {
        return { state, error: 'You have already stopped drafting' };
      }

      const newDraftState = [...draft.draftState] as [DraftPlayerState, DraftPlayerState];
      newDraftState[playerIndex] = { ...playerDraft, stopped: true };

      // If both stopped, end draft
      const otherIndex = 1 - playerIndex;
      if (newDraftState[otherIndex].stopped) {
        return finalizeDraft(state, newDraftState);
      }

      // If other player has a pending pick, resolve the round
      if (newDraftState[otherIndex].currentPick !== null) {
        return resolveDraftRound(state, newDraftState, draft.round, draft.setAside);
      }

      return {
        state: {
          ...state,
          phaseState: { ...draft, draftState: newDraftState },
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
function resolveDraftRound(
  state: GameState,
  draftState: [DraftPlayerState, DraftPlayerState],
  round: number,
  setAside: readonly CardDefinitionId[],
): ReducerResult {
  const pick0 = draftState[0].currentPick;
  const pick1 = draftState[1].currentPick;
  const newSetAside = [...setAside];

  // Resolve each player's pick
  const newDraft: [DraftPlayerState, DraftPlayerState] = [
    { ...draftState[0], currentPick: null },
    { ...draftState[1], currentPick: null },
  ];

  if (pick0 !== null && pick1 !== null && pick0 === pick1) {
    // Duplicate! Neither gets it — also remove from both pools
    newSetAside.push(pick0);
    newDraft[0] = { ...newDraft[0], pool: newDraft[0].pool.filter(id => id !== pick0) };
    newDraft[1] = { ...newDraft[1], pool: newDraft[1].pool.filter(id => id !== pick0) };
  } else {
    if (pick0 !== null) {
      newDraft[0] = { ...newDraft[0], drafted: [...newDraft[0].drafted, pick0] };
    }
    if (pick1 !== null) {
      newDraft[1] = { ...newDraft[1], drafted: [...newDraft[1].drafted, pick1] };
    }
  }

  // Auto-stop players who hit limits
  for (let i = 0; i < 2; i++) {
    if (!newDraft[i].stopped) {
      const mind = newDraft[i].drafted.reduce((sum, defId) => {
        const def = state.cardPool[defId as string];
        return sum + (def && def.cardType === 'hero-character' && def.mind !== null ? def.mind : 0);
      }, 0);
      const { maxStartingCompanySize: max } = getAlignmentRules(state.players[i].alignment);
      if (newDraft[i].drafted.length >= max || newDraft[i].pool.length === 0 || mind >= 20) {
        newDraft[i] = { ...newDraft[i], stopped: true };
      }
    }
  }

  // If both stopped, finalize
  if (newDraft[0].stopped && newDraft[1].stopped) {
    return finalizeDraft(state, newDraft);
  }

  return {
    state: {
      ...state,
      phaseState: {
        phase: Phase.CharacterDraft,
        round: round + 1,
        draftState: newDraft,
        setAside: newSetAside,
      },
    },
  };
}

/**
 * Delegates to {@link applyDraftResults} to place drafted characters on the
 * board and transition the game to the Untap phase.
 */
function finalizeDraft(
  state: GameState,
  draftState: readonly [DraftPlayerState, DraftPlayerState],
): ReducerResult {
  return {
    state: applyDraftResults(state, draftState),
  };
}

// ---- Item draft handler ----

/**
 * Handles the item draft phase where players assign their starting minor
 * items to characters in their starting company. Both players act
 * simultaneously. When all items are assigned, the game transitions to
 * the first Untap phase.
 */
function handleItemDraft(state: GameState, action: GameAction): ReducerResult {
  if (state.phaseState.phase !== Phase.ItemDraft) {
    return { state, error: 'Not in item draft phase' };
  }

  const playerIndex = state.players[0].id === action.player ? 0 : 1;
  const itemDraft = state.phaseState.itemDraftState[playerIndex];

  if (itemDraft.done) {
    return { state, error: 'You have already finished item assignment' };
  }

  // Pass: skip remaining item assignments
  if (action.type === 'pass') {
    const newItemDraftState = [...state.phaseState.itemDraftState] as [ItemDraftPlayerState, ItemDraftPlayerState];
    newItemDraftState[playerIndex] = { unassignedItems: [], done: true };

    if (newItemDraftState[0].done && newItemDraftState[1].done) {
      return {
        state: {
          ...state,
          activePlayer: state.players[0].id,
          phaseState: { phase: Phase.Untap },
          turnNumber: 1,
        },
      };
    }

    return {
      state: {
        ...state,
        phaseState: { ...state.phaseState, itemDraftState: newItemDraftState },
      },
    };
  }

  if (action.type !== 'assign-starting-item') {
    return { state, error: `Unexpected action in item draft: ${action.type}` };
  }

  // Resolve definition ID to the first matching unassigned instance
  const itemInstanceId = itemDraft.unassignedItems.find(instId => {
    const inst = state.instanceMap[instId as string];
    return inst && inst.definitionId === action.itemDefId;
  });
  if (!itemInstanceId) {
    return { state, error: 'Item is not in your unassigned items' };
  }

  // Validate character belongs to this player's company
  const player = state.players[playerIndex];
  const allCharIds = player.companies.flatMap(c => c.characters);
  if (!allCharIds.includes(action.characterInstanceId)) {
    return { state, error: 'Character is not in your starting company' };
  }

  // Assign the item to the character
  const charKey = action.characterInstanceId as string;
  const existingChar = player.characters[charKey];
  if (!existingChar) {
    return { state, error: 'Character not found' };
  }

  const updatedChar: CharacterInPlay = {
    ...existingChar,
    items: [...existingChar.items, itemInstanceId],
  };
  const updatedCharacters = { ...player.characters, [charKey]: updatedChar };
  const updatedPlayer = { ...player, characters: updatedCharacters };

  // Remove item from unassigned list
  const newUnassigned = itemDraft.unassignedItems.filter(id => id !== itemInstanceId);
  const newItemDraft: ItemDraftPlayerState = {
    unassignedItems: newUnassigned,
    done: newUnassigned.length === 0,
  };

  const newItemDraftState = [...state.phaseState.itemDraftState] as [ItemDraftPlayerState, ItemDraftPlayerState];
  newItemDraftState[playerIndex] = newItemDraft;

  const newPlayers = [...state.players] as unknown as [typeof state.players[0], typeof state.players[1]];
  newPlayers[playerIndex] = updatedPlayer;

  // If both players are done, transition to Untap
  if (newItemDraftState[0].done && newItemDraftState[1].done) {
    return {
      state: {
        ...state,
        players: newPlayers as unknown as readonly [typeof state.players[0], typeof state.players[1]],
        activePlayer: newPlayers[0].id,
        phaseState: { phase: Phase.Untap },
        turnNumber: 1,
      },
    };
  }

  return {
    state: {
      ...state,
      players: newPlayers as unknown as readonly [typeof state.players[0], typeof state.players[1]],
      phaseState: { ...state.phaseState, itemDraftState: newItemDraftState },
    },
  };
}

// ---- Phase handler stubs ----
// Each stub below corresponds to a game phase that is not yet implemented.
// They accept the action but return the state unmodified.

/** Stub: untap all characters, heal wounded at havens. */
function handleUntap(state: GameState, _action: GameAction): ReducerResult {
  // TODO: untap all cards, heal wounded at havens, advance to organization
  return { state };
}

/** Stub: play characters, split/merge companies, transfer items, plan movement. */
function handleOrganization(state: GameState, _action: GameAction): ReducerResult {
  // TODO: play characters, split/merge companies, transfer items, plan movement
  return { state };
}

/** Stub: resolve long events, then advance to movement/hazard. */
function handleLongEvent(state: GameState, _action: GameAction): ReducerResult {
  // TODO: resolve long events, advance to movement/hazard
  return { state };
}

/** Stub: reveal destinations, opponent plays hazards, resolve combat. */
function handleMovementHazard(state: GameState, _action: GameAction): ReducerResult {
  // TODO: reveal destinations, hazard play, combat resolution
  return { state };
}

/** Stub: automatic attacks at site, resource play, influence attempts. */
function handleSite(state: GameState, _action: GameAction): ReducerResult {
  // TODO: automatic attacks, resource play, influence attempts
  return { state };
}

/** Stub: draw/discard to hand size, check Free Council trigger. */
function handleEndOfTurn(state: GameState, _action: GameAction): ReducerResult {
  // TODO: draw/discard to hand size, check free council trigger
  return { state };
}

/** Stub: tally marshalling points, run tiebreaker corruption checks. */
function handleFreeCouncil(state: GameState, _action: GameAction): ReducerResult {
  // TODO: tally MPs, tiebreaker corruption checks
  return { state };
}
