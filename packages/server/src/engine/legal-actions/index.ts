/**
 * @module legal-actions
 *
 * Computes the complete list of concrete legal actions a player can take
 * given the current game state. Each phase has its own module under this
 * directory. This index dispatches to the appropriate phase module.
 *
 * The function is pure: `(GameState, PlayerId) → GameAction[]`.
 */

import type { GameState, PlayerId, GameAction } from '@meccg/shared';
import { setupActions } from './setup.js';
import { untapActions } from './untap.js';
import { organizationActions } from './organization.js';
import { longEventActions } from './long-event.js';
import { movementHazardActions } from './movement-hazard.js';
import { siteActions } from './site.js';
import { endOfTurnActions } from './end-of-turn.js';
import { freeCouncilActions } from './free-council.js';
import { logHeading, logResult } from './log.js';

/**
 * Returns every concrete action the given player can legally submit
 * in the current game state. Each returned action is a complete
 * {@link GameAction} with all fields populated.
 */
export function computeLegalActions(state: GameState, playerId: PlayerId): GameAction[] {
  const phase = state.phaseState.phase;
  logHeading(`Computing legal actions for player ${playerId as string} in phase '${phase}'`);

  let actions: GameAction[];
  switch (phase) {
    case 'setup':             actions = setupActions(state, playerId); break;
    case 'untap':             actions = untapActions(state, playerId); break;
    case 'organization':      actions = organizationActions(state, playerId); break;
    case 'long-event':        actions = longEventActions(state, playerId); break;
    case 'movement-hazard':   actions = movementHazardActions(state, playerId); break;
    case 'site':              actions = siteActions(state, playerId); break;
    case 'end-of-turn':       actions = endOfTurnActions(state, playerId); break;
    case 'free-council':      actions = freeCouncilActions(state, playerId); break;
    case 'game-over':         actions = []; break;
    default:                  actions = []; break;
  }

  const types = actions.map(a => a.type);
  logResult(actions.length, types);
  return actions;
}
