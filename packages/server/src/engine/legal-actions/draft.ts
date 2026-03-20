/**
 * @module legal-actions/draft
 *
 * Legal actions during the character draft phase. Both players act
 * simultaneously, picking characters from their pool or stopping.
 */

import type { GameState, PlayerId, GameAction } from '@meccg/shared';
import { GENERAL_INFLUENCE, getAlignmentRules } from '@meccg/shared';
import { logDetail } from './log.js';

export function draftActions(state: GameState, playerId: PlayerId): GameAction[] {
  if (state.phaseState.phase !== 'setup' || state.phaseState.setupStep.step !== 'character-draft') return [];

  const playerIndex = state.players[0].id === playerId ? 0 : 1;
  const draft = state.phaseState.setupStep.draftState[playerIndex];

  // Already stopped or already picked this round (waiting for opponent)
  if (draft.stopped) {
    logDetail(`Player already stopped drafting`);
    return [];
  }
  if (draft.currentPick !== null) {
    logDetail(`Player already picked this round, waiting for opponent`);
    return [];
  }

  const { maxStartingCompanySize } = getAlignmentRules(state.players[playerIndex].alignment);
  if (draft.drafted.length >= maxStartingCompanySize) {
    logDetail(`Already at max starting company size (${maxStartingCompanySize})`);
    return [];
  }

  logDetail(`Draft round ${state.phaseState.setupStep.round}, drafted ${draft.drafted.length}/${maxStartingCompanySize} characters`);

  const actions: GameAction[] = [];

  // Characters already drafted by the opponent are unavailable (unique)
  const opponentIndex = 1 - playerIndex;
  const opponentDrafted = new Set(
    state.phaseState.phase === 'setup' && state.phaseState.setupStep.step === 'character-draft'
      ? state.phaseState.setupStep.draftState[opponentIndex].drafted.map(id => id as string)
      : [],
  );

  // Calculate current total mind
  const currentMind = draft.drafted.reduce((sum, defId) => {
    const def = state.cardPool[defId as string];
    return sum + (def && def.cardType === 'hero-character' && def.mind !== null ? def.mind : 0);
  }, 0);

  logDetail(`Current total mind: ${currentMind}/${GENERAL_INFLUENCE}, pool size: ${draft.pool.length}`);

  // One draft-pick per eligible character in the pool
  for (const charDefId of draft.pool) {
    const charDef = state.cardPool[charDefId as string];
    if (!charDef || charDef.cardType !== 'hero-character') {
      logDetail(`Skipping ${charDefId as string}: not a hero-character`);
      continue;
    }

    // Unique characters already drafted by opponent are unavailable
    if (charDef.unique && opponentDrafted.has(charDefId as string)) {
      logDetail(`Skipping ${charDef.name}: unique and already drafted by opponent`);
      continue;
    }

    // Check mind constraint
    if (charDef.mind !== null && currentMind + charDef.mind > GENERAL_INFLUENCE) {
      logDetail(`Skipping ${charDef.name}: mind ${charDef.mind} would exceed limit (${currentMind} + ${charDef.mind} > ${GENERAL_INFLUENCE})`);
      continue;
    }

    logDetail(`Eligible: ${charDef.name} (mind ${charDef.mind ?? 'null'})`);
    actions.push({ type: 'draft-pick', player: playerId, characterDefId: charDefId });
  }

  // Can always stop
  actions.push({ type: 'draft-stop', player: playerId });

  return actions;
}
