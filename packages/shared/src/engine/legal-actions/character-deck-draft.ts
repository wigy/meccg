/**
 * @module legal-actions/character-deck-draft
 *
 * Legal actions during the character deck draft phase. Each player may add
 * remaining pool characters to their play deck, up to 10 non-avatar
 * characters total in the deck. After finishing, they must shuffle.
 *
 * Uses the rules engine for per-card eligibility with human-readable reasons.
 */

import type { GameState, PlayerId, EvaluatedAction } from '../../index.js';
import { CHARACTER_DECK_DRAFT_RULES } from '../../rules/definitions/character-deck-draft.js';
import { evaluateAction } from '../../rules/evaluator.js';
import { setupStepContext } from '../../state-utils.js';
import { isCharacterCard, isAvatarCharacter } from '../../types/cards.js';
import { SetupStep } from '../../types/state-phases.js';
import { logDetail } from './log.js';
import { defById } from '../reducer-utils.js';

/** Maximum number of non-avatar characters allowed in the play deck. */
const MAX_NON_AVATAR_IN_DECK = 10;

/** Count non-avatar characters (mind !== null) among a player's play deck cards. */
function countNonAvatarInDeck(state: GameState, playerIndex: number): number {
  const player = state.players[playerIndex];
  let count = 0;
  for (const card of player.playDeck) {
    const def = defById(state, card.definitionId);
    if (def && isCharacterCard(def) && def.mind !== null) {
      count++;
    }
  }
  return count;
}

export function characterDeckDraftActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const ctx = setupStepContext(state, playerId, SetupStep.CharacterDeckDraft);
  if (!ctx) return [];
  const { step: setupStep, playerIndex } = ctx;
  const deckDraft = setupStep.deckDraftState[playerIndex];

  if (deckDraft.done) {
    logDetail(`Player already finished adding characters to deck`);
    return [];
  }

  const nonAvatarCount = countNonAvatarInDeck(state, playerIndex);
  logDetail(`${deckDraft.remainingPool.length} character(s) remaining in pool, ${nonAvatarCount}/${MAX_NON_AVATAR_IN_DECK} non-avatar in deck`);

  const evaluated: EvaluatedAction[] = [];

  for (const charCard of deckDraft.remainingPool) {
    const def = defById(state, charCard.definitionId);
    const isChar = isCharacterCard(def);

    const context = {
      card: {
        name: def?.name ?? (charCard.instanceId as string),
        isCharacter: isChar,
        isAvatar: isAvatarCharacter(def),
      },
      ctx: {
        nonAvatarCount,
        nonAvatarLimit: MAX_NON_AVATAR_IN_DECK,
      },
    };

    const action = { type: 'add-character-to-deck' as const, player: playerId, characterInstanceId: charCard.instanceId };
    const result = evaluateAction(action, CHARACTER_DECK_DRAFT_RULES, context);

    logDetail(`${context.card.name}: ${result.viable ? 'eligible' : result.reason}`);
    evaluated.push(result);
  }

  // Can always pass (done adding characters)
  evaluated.push({ action: { type: 'pass', player: playerId }, viable: true });

  return evaluated;
}
