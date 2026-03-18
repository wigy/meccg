import type { GameState } from '@meccg/shared';
import type { GameAction } from '@meccg/shared';
import { Phase, LEGAL_ACTIONS_BY_PHASE } from '@meccg/shared';

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
