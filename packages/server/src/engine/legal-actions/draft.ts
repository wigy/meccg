/**
 * @module legal-actions/draft
 *
 * Legal actions during the character draft phase. Both players act
 * simultaneously, picking characters from their pool or stopping.
 */

import type { GameState, PlayerId, GameAction } from '@meccg/shared';
import { GENERAL_INFLUENCE } from '@meccg/shared';

export function draftActions(state: GameState, playerId: PlayerId): GameAction[] {
  if (state.phaseState.phase !== 'character-draft') return [];

  const playerIndex = state.players[0].id === playerId ? 0 : 1;
  const draft = state.phaseState.draftState[playerIndex];

  // Already stopped or already picked this round (waiting for opponent)
  if (draft.stopped || draft.currentPick !== null) return [];

  // Already at 5 characters
  if (draft.drafted.length >= 5) return [];

  const actions: GameAction[] = [];

  // Characters already drafted by the opponent are unavailable (unique)
  const opponentIndex = 1 - playerIndex;
  const opponentDrafted = new Set(
    state.phaseState.phase === 'character-draft'
      ? state.phaseState.draftState[opponentIndex].drafted.map(id => id as string)
      : [],
  );

  // Calculate current total mind
  const currentMind = draft.drafted.reduce((sum, defId) => {
    const def = state.cardPool[defId as string];
    return sum + (def && def.cardType === 'hero-character' && def.mind !== null ? def.mind : 0);
  }, 0);

  // One draft-pick per eligible character in the pool
  for (const charDefId of draft.pool) {
    const charDef = state.cardPool[charDefId as string];
    if (!charDef || charDef.cardType !== 'hero-character') continue;

    // Unique characters already drafted by opponent are unavailable
    if (charDef.unique && opponentDrafted.has(charDefId as string)) continue;

    // Check mind constraint
    if (charDef.mind !== null && currentMind + charDef.mind > GENERAL_INFLUENCE) continue;

    actions.push({ type: 'draft-pick', player: playerId, characterDefId: charDefId });
  }

  // Can always stop
  actions.push({ type: 'draft-stop', player: playerId });

  return actions;
}
