/**
 * @module legal-actions
 *
 * Computes the complete list of candidate actions a player can take
 * given the current game state. Each phase has its own module under this
 * directory. This index dispatches to the appropriate phase module.
 *
 * Setup phases return {@link EvaluatedAction} with viability and reasons
 * via the rules engine. Other phases wrap their actions as viable.
 *
 * The function is pure: `(GameState, PlayerId) → EvaluatedAction[]`.
 */

import type { GameState, PlayerId, GameAction, EvaluatedAction } from '../../index.js';
import { setupActions } from './setup.js';
import { untapActions } from './untap.js';
import { organizationActions } from './organization.js';
import { longEventActions } from './long-event.js';
import { movementHazardActions } from './movement-hazard.js';
import { siteActions } from './site.js';
import { endOfTurnActions } from './end-of-turn.js';
import { freeCouncilActions } from './free-council.js';
import { logHeading, logResult } from './log.js';

/** Wraps plain GameActions as viable EvaluatedActions (for non-setup phases). */
function asViable(actions: GameAction[]): EvaluatedAction[] {
  return actions.map(action => ({ action, viable: true }));
}

/**
 * Returns every candidate action the given player could take in the current
 * game state, annotated with viability. Non-viable actions include a
 * human-readable reason explaining why they cannot be taken.
 */
export function computeLegalActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const phase = state.phaseState.phase;
  logHeading(`Computing legal actions for player ${playerId as string} in phase '${phase}'`);

  let evaluated: EvaluatedAction[];
  switch (phase) {
    case 'setup':             evaluated = setupActions(state, playerId); break;
    case 'untap':             evaluated = untapActions(state, playerId); break;
    case 'organization':      evaluated = organizationActions(state, playerId); break;
    case 'long-event':        evaluated = longEventActions(state, playerId); break;
    case 'movement-hazard':   evaluated = movementHazardActions(state, playerId); break;
    case 'site':              evaluated = siteActions(state, playerId); break;
    case 'end-of-turn':       evaluated = asViable(endOfTurnActions(state, playerId)); break;
    case 'free-council':      evaluated = asViable(freeCouncilActions(state, playerId)); break;
    case 'game-over':         evaluated = []; break;
    default:                  evaluated = []; break;
  }

  const viableCount = evaluated.filter(e => e.viable).length;
  logResult(viableCount, evaluated.filter(e => e.viable).map(e => e.action) as unknown as Record<string, unknown>[]);
  return evaluated;
}
