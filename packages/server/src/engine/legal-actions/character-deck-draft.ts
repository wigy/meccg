/**
 * @module legal-actions/character-deck-draft
 *
 * Legal actions during the character deck draft phase. Each player may add
 * remaining pool characters to their play deck, up to 10 non-avatar
 * characters total in the deck. After finishing, they must shuffle.
 */

import type { GameState, PlayerId, GameAction } from '@meccg/shared';
import { logDetail } from './log.js';

/** Maximum number of non-avatar characters allowed in the play deck. */
const MAX_NON_AVATAR_IN_DECK = 10;

/** Count non-avatar characters (mind !== null) among a player's play deck cards. */
function countNonAvatarInDeck(state: GameState, playerIndex: number): number {
  const player = state.players[playerIndex];
  let count = 0;
  for (const instId of player.playDeck) {
    const inst = state.instanceMap[instId as string];
    if (!inst) continue;
    const def = state.cardPool[inst.definitionId as string];
    if (def && def.cardType === 'hero-character' && def.mind !== null) {
      count++;
    }
  }
  return count;
}

export function characterDeckDraftActions(state: GameState, playerId: PlayerId): GameAction[] {
  if (state.phaseState.phase !== 'setup' || state.phaseState.setupStep.step !== 'character-deck-draft') return [];

  const playerIndex = state.players[0].id === playerId ? 0 : 1;
  const deckDraft = state.phaseState.setupStep.deckDraftState[playerIndex];

  if (deckDraft.done) {
    logDetail(`Player already finished adding characters to deck`);
    return [];
  }

  const actions: GameAction[] = [];
  const nonAvatarCount = countNonAvatarInDeck(state, playerIndex);
  logDetail(`${deckDraft.remainingPool.length} character(s) remaining in pool, ${nonAvatarCount}/${MAX_NON_AVATAR_IN_DECK} non-avatar in deck`);

  for (const charDefId of deckDraft.remainingPool) {
    const def = state.cardPool[charDefId as string];
    if (!def || def.cardType !== 'hero-character') {
      logDetail(`Skipping ${charDefId as string}: not a hero-character`);
      continue;
    }
    // Non-avatar characters count toward the limit
    if (def.mind !== null && nonAvatarCount >= MAX_NON_AVATAR_IN_DECK) {
      logDetail(`Skipping ${def.name}: non-avatar limit reached (${nonAvatarCount}/${MAX_NON_AVATAR_IN_DECK})`);
      continue;
    }
    logDetail(`Eligible: ${def.name} (${def.mind !== null ? 'non-avatar' : 'avatar'})`);
    actions.push({ type: 'add-character-to-deck', player: playerId, characterDefId: charDefId });
  }

  // Can always pass (done adding characters)
  actions.push({ type: 'pass', player: playerId });

  return actions;
}
