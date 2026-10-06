/**
 * @module end-of-turn-return
 *
 * "If still in play at the end of the turn, place <character> in your hand."
 *
 * A `return-to-hand-at-end-of-turn` constraint (installed on a character by a
 * short event such as Skin-changer td-152) is honoured as the turn enters its
 * end-of-turn phase: the character, if still in play, goes back to his owner's
 * hand via {@link returnCharacterToHand} (items discarded, allies/hazards
 * discarded, followers to general influence). Before the discarded items are
 * lost, the owner is offered a repeatable `transfer-returned-item` resolution
 * (`anyNumberToUnwounded`) to move any of them onto unwounded characters left
 * in the company — an automatic transfer, so no corruption checks follow.
 */

import type { GameState } from '../index.js';
import { Phase } from '../types/state-phases.js';
import { logDetail } from './legal-actions/log.js';
import { defById } from './reducer-utils.js';
import { enqueueResolution } from './pending.js';
import { returnCharacterToHand } from './pending-reducers.js';

/** Fire every active `return-to-hand-at-end-of-turn` constraint. */
export function fireEndOfTurnCharacterReturns(state: GameState): GameState {
  let newState = state;
  for (const constraint of state.activeConstraints) {
    if (constraint.kind.type !== 'return-to-hand-at-end-of-turn') continue;
    if (constraint.target.kind !== 'character') continue;
    const characterId = constraint.target.characterId;
    const playerIndex = newState.players.findIndex(p => p.characters[characterId]);
    if (playerIndex < 0) {
      logDetail(`end-of-turn: return-to-hand target ${characterId as string} no longer in play — no effect`);
      continue;
    }
    const player = newState.players[playerIndex];
    const charInPlay = player.characters[characterId];
    const company = player.companies.find(c => c.characters.includes(characterId));
    const charName = defById(newState, charInPlay.definitionId)?.name ?? (characterId as string);
    logDetail(`end-of-turn: ${charName} still in play — returning to ${player.id as string}'s hand`);

    const returned = returnCharacterToHand(newState, playerIndex, characterId, charInPlay);
    if (returned.players[playerIndex].characters[characterId]) continue;
    newState = returned;

    const remainingMates = company ? company.characters.filter(id => id !== characterId) : [];
    if (!company || remainingMates.length === 0 || charInPlay.items.length === 0) continue;
    logDetail(`end-of-turn: offering transfer of ${charName}'s ${charInPlay.items.length} item(s) to unwounded characters in ${company.id as string}`);
    newState = enqueueResolution(newState, {
      source: constraint.source,
      actor: player.id,
      scope: { kind: 'phase', phase: Phase.EndOfTurn },
      kind: {
        type: 'transfer-returned-item',
        itemInstanceIds: charInPlay.items.map(i => i.instanceId),
        companyId: company.id,
        ownerPlayerIndex: playerIndex,
        sourceDefinitionId: constraint.sourceDefinitionId,
        anyNumberToUnwounded: true,
      },
    });
  }
  return newState;
}
