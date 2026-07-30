/**
 * @module tutorial/driver
 *
 * Executes a tutorial script (an ordered list of {@link TutorialBeat}s)
 * against the real engine. Used by the headless integration test to prove
 * the whole scripted game is legal, and by the game-server
 * TutorialController to play the Mentor's beats.
 *
 * The driver applies exactly the scripted actions — plus chain-priority
 * passes, which are auto-resolved for both seats because chains are
 * narrated as part of the surrounding step rather than scripted beat by
 * beat. Any other divergence (the expected action is not legal) throws a
 * {@link TutorialScriptError} carrying full diagnostics: that is a script
 * bug, never a user error.
 */

import type { GameState } from '../types/state.js';
import type { PlayerId } from '../index.js';
import { reduce } from '../engine/reducer.js';
import { computeLegalActions } from '../engine/legal-actions/index.js';
import type { TutorialBeat } from './match.js';
import { findMatchingAction } from './match.js';

/** The two seats of a tutorial game. */
export interface TutorialSeats {
  readonly human: PlayerId;
  readonly mentor: PlayerId;
}

/** Thrown when a scripted beat cannot be performed — a script bug. */
export class TutorialScriptError extends Error {
  constructor(beatIndex: number, beat: TutorialBeat, state: GameState, seats: TutorialSeats) {
    const actorId = beat.actor === 'human' ? seats.human : seats.mentor;
    const phase = JSON.stringify(state.phaseState.phase);
    const detail = 'setupStep' in state.phaseState
      ? ` step=${JSON.stringify((state.phaseState as { setupStep: { step: string } }).setupStep.step)}`
      : 'step' in state.phaseState
        ? ` step=${JSON.stringify((state.phaseState as { step: string }).step)}`
        : '';
    const viable = computeLegalActions(state, actorId)
      .filter(a => a.viable === true)
      .map(a => JSON.stringify(a.action))
      .join('\n    ');
    super(
      `Tutorial beat #${beatIndex} (step "${beat.stepId}", ${beat.actor}) has no matching legal action.\n` +
      `  wanted: ${JSON.stringify(beat.match)}\n` +
      `  phase=${phase}${detail} turn=${state.turnNumber} combat=${state.combat ? 'yes' : 'no'} chain=${state.chain ? 'yes' : 'no'}\n` +
      `  viable for ${beat.actor}:\n    ${viable || '(none)'}`,
    );
    this.name = 'TutorialScriptError';
  }
}

/**
 * Auto-resolve any open chain by passing priority for whichever seats have
 * a viable `pass-chain-priority`, until the chain clears or nothing changes.
 */
function resolveChainPasses(state: GameState, seats: TutorialSeats): GameState {
  for (let guard = 0; guard < 32 && state.chain !== null; guard++) {
    let advanced = false;
    for (const id of [seats.human, seats.mentor]) {
      const pass = computeLegalActions(state, id)
        .find(a => a.viable === true && a.action.type === 'pass-chain-priority');
      if (pass) {
        const result = reduce(state, pass.action);
        if (result.error) throw new Error(`pass-chain-priority failed: ${result.error}`);
        state = result.state;
        advanced = true;
        break;
      }
    }
    if (!advanced) break;
  }
  return state;
}

/**
 * Apply one beat: optionally force the dice, find the matching legal action
 * of the beat's actor, and reduce it. Chain-priority passes are resolved
 * before matching (so a beat can follow a chain-opening beat directly) —
 * a mismatch throws {@link TutorialScriptError}.
 */
export function applyBeat(
  state: GameState,
  beat: TutorialBeat,
  seats: TutorialSeats,
  beatIndex = -1,
): GameState {
  const actorId = beat.actor === 'human' ? seats.human : seats.mentor;

  let action = findMatchingAction(state, actorId, beat.match);
  if (!action && state.chain !== null) {
    state = resolveChainPasses(state, seats);
    action = findMatchingAction(state, actorId, beat.match);
  }
  if (!action) throw new TutorialScriptError(beatIndex, beat, state, seats);

  if (beat.cheatRoll !== undefined) {
    state = { ...state, cheatRollTotal: beat.cheatRoll };
  }
  const result = reduce(state, action);
  if (result.error) {
    throw new Error(
      `Tutorial beat #${beatIndex} (step "${beat.stepId}") action ${JSON.stringify(action)} was rejected: ${result.error}`,
    );
  }
  return result.state;
}

/**
 * Run a slice of the script from `state`. Returns the state after the last
 * beat (with any trailing chain passes resolved).
 */
export function runBeats(
  state: GameState,
  beats: readonly TutorialBeat[],
  seats: TutorialSeats,
  startIndex = 0,
): GameState {
  for (let i = startIndex; i < beats.length; i++) {
    state = applyBeat(state, beats[i], seats, i);
  }
  return resolveChainPasses(state, seats);
}
