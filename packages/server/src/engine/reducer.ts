import type { GameState, DraftPlayerState, CardDefinitionId } from '@meccg/shared';
import type { GameAction } from '@meccg/shared';
import { Phase, LEGAL_ACTIONS_BY_PHASE } from '@meccg/shared';
import { applyDraftResults } from './init.js';

export interface ReducerResult {
  readonly state: GameState;
  readonly error?: string;
}

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
  switch (phase) {
    case Phase.CharacterDraft:
      return handleCharacterDraft(state, action);
    case Phase.Untap:
      return handleUntap(state, action);
    case Phase.Organization:
      return handleOrganization(state, action);
    case Phase.LongEvent:
      return handleLongEvent(state, action);
    case Phase.MovementHazard:
      return handleMovementHazard(state, action);
    case Phase.Site:
      return handleSite(state, action);
    case Phase.EndOfTurn:
      return handleEndOfTurn(state, action);
    case Phase.FreeCouncil:
      return handleFreeCouncil(state, action);
    case Phase.GameOver:
      return { state, error: 'Game is over' };
    default:
      return { state, error: `Unknown phase: ${phase satisfies never}` };
  }
}

function validateActionPlayer(state: GameState, action: GameAction): string | undefined {
  const phase = state.phaseState.phase;

  // During character draft, both players act simultaneously
  if (phase === 'character-draft') {
    return undefined; // both players can submit picks
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
        return { state, error: 'You already have a pick for this round' };
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
      if (playerDraft.drafted.length >= 5) {
        return { state, error: 'Already have 5 starting characters' };
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
    // Duplicate! Neither gets it
    newSetAside.push(pick0);
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
      if (newDraft[i].drafted.length >= 5 || newDraft[i].pool.length === 0 || mind >= 20) {
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

function finalizeDraft(
  state: GameState,
  draftState: readonly [DraftPlayerState, DraftPlayerState],
): ReducerResult {
  return {
    state: applyDraftResults(state, draftState),
  };
}

// ---- Phase handler stubs ----

function handleUntap(state: GameState, _action: GameAction): ReducerResult {
  // TODO: untap all cards, heal wounded at havens, advance to organization
  return { state };
}

function handleOrganization(state: GameState, _action: GameAction): ReducerResult {
  // TODO: play characters, split/merge companies, transfer items, plan movement
  return { state };
}

function handleLongEvent(state: GameState, _action: GameAction): ReducerResult {
  // TODO: resolve long events, advance to movement/hazard
  return { state };
}

function handleMovementHazard(state: GameState, _action: GameAction): ReducerResult {
  // TODO: reveal destinations, hazard play, combat resolution
  return { state };
}

function handleSite(state: GameState, _action: GameAction): ReducerResult {
  // TODO: automatic attacks, resource play, influence attempts
  return { state };
}

function handleEndOfTurn(state: GameState, _action: GameAction): ReducerResult {
  // TODO: draw/discard to hand size, check free council trigger
  return { state };
}

function handleFreeCouncil(state: GameState, _action: GameAction): ReducerResult {
  // TODO: tally MPs, tiebreaker corruption checks
  return { state };
}
