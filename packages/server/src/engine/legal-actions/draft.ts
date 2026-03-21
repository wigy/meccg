/**
 * @module legal-actions/draft
 *
 * Legal actions during the character draft phase. Both players act
 * simultaneously, picking characters from their pool or stopping.
 *
 * Uses the rules engine to evaluate each pool character's eligibility,
 * producing both viable picks and non-viable picks with human-readable
 * reasons explaining why they can't be selected.
 */

import type { GameState, PlayerId, EvaluatedAction } from '@meccg/shared';
import { GENERAL_INFLUENCE, getAlignmentRules, isCharacterCard, evaluateAction, CHARACTER_DRAFT_RULES, getPlayerIndex } from '@meccg/shared';
import { logDetail } from './log.js';

export function draftActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  if (state.phaseState.phase !== 'setup' || state.phaseState.setupStep.step !== 'character-draft') return [];

  const playerIndex = getPlayerIndex(state, playerId);
  const draft = state.phaseState.setupStep.draftState[playerIndex];

  // Phase-level guards — not per-card, stay imperative
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

  // Pre-compute context values shared across all candidates
  const opponentIndex = 1 - playerIndex;
  const opponentDrafted = new Set(
    state.phaseState.phase === 'setup' && state.phaseState.setupStep.step === 'character-draft'
      ? state.phaseState.setupStep.draftState[opponentIndex].drafted.map(id => id as string)
      : [],
  );
  const currentMind = draft.drafted.reduce((sum, defId) => {
    const def = state.cardPool[defId as string];
    return sum + (isCharacterCard(def) && def.mind !== null ? def.mind : 0);
  }, 0);

  logDetail(`Current total mind: ${currentMind}/${GENERAL_INFLUENCE}, pool size: ${draft.pool.length}`);

  const evaluated: EvaluatedAction[] = [];

  for (const charDefId of draft.pool) {
    const charDef = state.cardPool[charDefId as string];
    const isChar = isCharacterCard(charDef);
    const mind = isChar ? charDef.mind : null;

    const context = {
      card: {
        name: charDef?.name ?? (charDefId as string),
        isCharacter: isChar,
        mind,
        unique: isChar ? charDef.unique : false,
      },
      ctx: {
        opponentHasCard: opponentDrafted.has(charDefId as string),
        currentMind,
        mindLimit: GENERAL_INFLUENCE,
        projectedMind: currentMind + (mind !== null ? mind : 0),
      },
    };

    const action = { type: 'draft-pick' as const, player: playerId, characterDefId: charDefId };
    const result = evaluateAction(action, CHARACTER_DRAFT_RULES, context);

    logDetail(`${context.card.name}: ${result.viable ? 'eligible' : result.reason}`);
    evaluated.push(result);
  }

  // Can always stop — always viable
  evaluated.push({ action: { type: 'draft-stop', player: playerId }, viable: true });

  return evaluated;
}
