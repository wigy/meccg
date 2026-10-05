/**
 * @module tap-take-item
 *
 * Resolution of one pick of a `tap-take-item` sub-flow (Old Cache le-213,
 * Swag le-236): "one or two characters in that company may each tap to take
 * control of a non-unique, non-hoard minor item ... You may take these items
 * from your play deck (reshuffle if used), discard pile, and/or sideboard."
 *
 * The sub-flow is queued by `handlePlayResourceShortEvent` as a `card-effect`
 * pending effect bound to the playing company; legal picks are enumerated by
 * `tapTakeItemLegalActions` (legal-actions/index.ts).
 */

import type { GameState, GameAction } from '../index.js';
import { CardStatus } from '../types/common.js';
import { getPlayerIndex } from '../state-utils.js';
import { shuffle } from '../rng.js';
import { logDetail } from './legal-actions/log.js';
import { forgetDeckReveals } from './visibility.js';
import type { ReducerResult } from './reducer-utils.js';
import { collectTapTakeItemCandidates, defById, discardEventCard, updateCharacter, updatePlayer } from './reducer-utils.js';

/**
 * Tap the chosen untapped character of the bound company and attach the
 * chosen matching item to him (untapped). A play-deck pick reshuffles the
 * deck. The pending effect's remaining pick count is decremented; once it
 * reaches zero the sub-flow ends and the spent event card is discarded
 * (`pass` ends it earlier via the shared `resolvePendingEffect`).
 */
export function applyTapTakeItem(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'tap-take-item') return { state, error: 'Expected tap-take-item action' };
  if (state.pendingEffects.length === 0) return { state, error: 'No effect sub-flow active' };
  const current = state.pendingEffects[0];
  if (current.type !== 'card-effect' || current.effect.type !== 'tap-take-item') {
    return { state, error: `Expected tap-take-item effect, got ${current.type}` };
  }
  const effect = current.effect;

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const company = player.companies.find(c => c.id === current.companyId);
  if (!company || !company.characters.includes(action.characterId)) {
    return { state, error: `Character ${action.characterId as string} is not in the company ${current.companyId as string ?? '?'}` };
  }
  const char = player.characters[action.characterId];
  if (!char || char.status !== CardStatus.Untapped) {
    return { state, error: `Character ${action.characterId as string} is not untapped` };
  }
  const candidate = collectTapTakeItemCandidates(state, player, effect)
    .find(c => c.cardInstanceId === action.cardInstanceId && c.source === action.source);
  if (!candidate) {
    return { state, error: `Card ${action.cardInstanceId as string} cannot be taken from ${action.source}` };
  }

  const pile = action.source === 'sideboard' ? player.sideboard
    : action.source === 'deck' ? player.playDeck
    : player.discardPile;
  const card = pile.find(c => c.instanceId === action.cardInstanceId)!;
  const remainingPile = pile.filter(c => c.instanceId !== action.cardInstanceId);

  let rng = state.rng;
  let newPile = remainingPile;
  if (action.source === 'deck') {
    [newPile, rng] = shuffle(remainingPile, state.rng);
  }
  const pileKey = action.source === 'sideboard' ? 'sideboard'
    : action.source === 'deck' ? 'playDeck'
    : 'discardPile';

  let newState: GameState = updatePlayer({ ...state, rng }, playerIndex, p => updateCharacter(
    { ...p, [pileKey]: newPile },
    action.characterId,
    c => ({
      ...c,
      status: CardStatus.Tapped,
      items: [...c.items, { instanceId: card.instanceId, definitionId: card.definitionId, status: CardStatus.Untapped }],
    }),
  ));
  if (action.source === 'deck') newState = forgetDeckReveals(newState, playerIndex);

  const itemName = defById(state, card.definitionId)?.name ?? (card.definitionId as string);
  const charName = defById(state, char.definitionId)?.name ?? (action.characterId as string);
  logDetail(`tap-take-item: ${charName} taps and takes control of ${itemName} from ${action.source}${action.source === 'deck' ? ' (deck reshuffled)' : ''}`);

  const picksLeft = effect.count - 1;
  if (picksLeft > 0) {
    return {
      state: {
        ...newState,
        pendingEffects: [{ ...current, effect: { ...effect, count: picksLeft } }, ...state.pendingEffects.slice(1)],
      },
    };
  }
  newState = { ...newState, pendingEffects: state.pendingEffects.slice(1) };
  if (newState.pendingEffects.length === 0) {
    newState = discardEventCard(newState, current.cardInstanceId, playerIndex);
  }
  return { state: newState };
}
