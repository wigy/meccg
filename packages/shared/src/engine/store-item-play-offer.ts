/**
 * @module store-item-play-offer
 *
 * The `store-item-play-offer` pending resolution — the follow-up raised by a
 * `play-item-on-store` effect once its card is successfully stored during the
 * organization phase (Gems of Arda dm-170: "During any organization phase in
 * which you store Gems of Arda, you may immediately tap a character in the
 * same company and play a non-special item with him from your hand or
 * discard pile. This item must be identical to an item that your opponent
 * has already stored. Your opponent's stored item is discarded, and you may
 * never store the item you played.").
 *
 * The offer is raised from the store corruption check's `onSuccess` hook
 * (`pending-reducers.ts`), so a failed store never produces it. The actor
 * either declines (generic `pass`) or plays one candidate item
 * (`play-store-item-offer`). Candidate enumeration is shared between the
 * legal-action emitter and the reducer so both agree on what is playable.
 */

import type { GameState, PlayerState, PendingResolution, CardInstanceId, CardInstance, GameAction, PlayerId, EvaluatedAction } from '../index.js';
import { CardStatus } from '../types/common.js';
import { isItemCard } from '../types/cards.js';
import { getPlayerIndex } from '../state-utils.js';
import type { ReducerResult } from './reducer-utils.js';
import { companyById, countCopiesInPlay, defById, matchesDefinition, tapCompanyCardsOnItemPlay, updateCharacter, updatePlayer } from './reducer-utils.js';
import { dequeueResolution } from './pending.js';
import { logDetail } from './legal-actions/log.js';

type StoreItemPlayOfferKind = Extract<PendingResolution['kind'], { readonly type: 'store-item-play-offer' }>;

/** One playable (character, item, source pile, opponent copy) combination. */
interface StoreItemPlayCandidate {
  readonly characterId: CardInstanceId;
  readonly cardInstanceId: CardInstanceId;
  readonly source: 'hand' | 'discard-pile';
  readonly opponentStoredInstanceId?: CardInstanceId;
}

/**
 * The opponent's stored items (item cards in their marshalling-point pile)
 * whose name is `name`.
 */
function opponentStoredCopies(state: GameState, opponent: PlayerState, name: string): CardInstance[] {
  return opponent.killPile.filter(c => {
    const def = defById(state, c.definitionId);
    return isItemCard(def) && def.name === name;
  });
}

/**
 * Every legal way to accept the offer: an untapped character in the storing
 * company, a matching item in hand or discard pile, and — when the offer
 * demands it — an identical item the opponent has stored. Unique items with a
 * copy already in play are excluded. Only the first opponent copy of a given
 * name is offered (identical copies are interchangeable).
 */
export function storeItemPlayCandidates(
  state: GameState,
  playerIndex: number,
  kind: StoreItemPlayOfferKind,
): StoreItemPlayCandidate[] {
  const player = state.players[playerIndex];
  const opponent = state.players[playerIndex === 0 ? 1 : 0];
  const company = companyById(player.companies, kind.companyId);
  if (!company) return [];
  const tappers = company.characters.filter(id => player.characters[id]?.status === CardStatus.Untapped);
  if (tappers.length === 0) {
    logDetail('store-item-play-offer: no untapped character in the storing company');
    return [];
  }

  const out: StoreItemPlayCandidate[] = [];
  const piles: readonly ['hand' | 'discard-pile', readonly CardInstance[]][] = [
    ['hand', player.hand],
    ['discard-pile', player.discardPile],
  ];
  for (const [source, pile] of piles) {
    for (const card of pile) {
      const def = defById(state, card.definitionId);
      if (!def || !isItemCard(def)) continue;
      if (kind.itemFilter && !matchesDefinition(def, kind.itemFilter)) continue;
      if (def.unique && countCopiesInPlay(state, def.name) > 0) {
        logDetail(`store-item-play-offer: ${def.name} is unique and already in play`);
        continue;
      }
      let opponentStoredInstanceId: CardInstanceId | undefined;
      if (kind.matchOpponentStored) {
        const copy = opponentStoredCopies(state, opponent, def.name)[0];
        if (!copy) continue;
        opponentStoredInstanceId = copy.instanceId;
      }
      for (const characterId of tappers) {
        out.push({
          characterId,
          cardInstanceId: card.instanceId,
          source,
          ...(opponentStoredInstanceId ? { opponentStoredInstanceId } : {}),
        });
      }
    }
  }
  return out;
}

/** Legal actions for a queued `store-item-play-offer`: `pass` plus one per candidate. */
export function storeItemPlayOfferActions(
  state: GameState,
  playerId: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'store-item-play-offer') return [];
  const actions: EvaluatedAction[] = [{ action: { type: 'pass', player: playerId }, viable: true }];
  const playerIndex = getPlayerIndex(state, playerId);
  for (const c of storeItemPlayCandidates(state, playerIndex, top.kind)) {
    actions.push({
      action: { type: 'play-store-item-offer', player: playerId, ...c },
      viable: true,
    });
  }
  return actions;
}

/**
 * Resolve a queued `store-item-play-offer`. `pass` dequeues it; a
 * `play-store-item-offer` taps the chosen character, moves the item from the
 * named pile onto him (flagged `neverStorable` when the effect says so) and
 * discards the opponent's identical stored item to the opponent's discard
 * pile.
 */
export function applyStoreItemPlayOfferResolution(
  state: GameState,
  rawAction: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  if (top.kind.type !== 'store-item-play-offer') return null;
  if (rawAction.type === 'pass') {
    logDetail('store-item-play-offer: player declines');
    return { state: dequeueResolution(state, top.id) };
  }
  if (rawAction.type !== 'play-store-item-offer') {
    return { state, error: `Pending store-item-play-offer requires 'play-store-item-offer' or pass, got '${rawAction.type}'` };
  }
  if (rawAction.player !== top.actor) {
    return { state, error: 'Wrong player for pending store-item-play-offer' };
  }
  const kind = top.kind;
  const playerIndex = getPlayerIndex(state, rawAction.player);
  const opponentIndex = playerIndex === 0 ? 1 : 0;
  const legal = storeItemPlayCandidates(state, playerIndex, kind).some(c =>
    c.characterId === rawAction.characterId
    && c.cardInstanceId === rawAction.cardInstanceId
    && c.source === rawAction.source
    && (!kind.matchOpponentStored || rawAction.opponentStoredInstanceId !== undefined));
  if (!legal) return { state, error: 'store-item-play-offer: that item cannot be played onto that character' };

  const player = state.players[playerIndex];
  const pile = rawAction.source === 'hand' ? player.hand : player.discardPile;
  const card = pile.find(c => c.instanceId === rawAction.cardInstanceId)!;
  const def = defById(state, card.definitionId);
  const itemName = def?.name ?? (card.definitionId as string);

  let opponentCopy: CardInstance | undefined;
  if (kind.matchOpponentStored) {
    opponentCopy = state.players[opponentIndex].killPile.find(c => c.instanceId === rawAction.opponentStoredInstanceId);
    const copyDef = opponentCopy ? defById(state, opponentCopy.definitionId) : undefined;
    if (!opponentCopy || !isItemCard(copyDef) || copyDef.name !== itemName) {
      return { state, error: `store-item-play-offer: opponent has no stored ${itemName} matching that instance` };
    }
  }

  logDetail(`store-item-play-offer: tapping ${rawAction.characterId as string} to play ${itemName} from ${rawAction.source}${kind.playedItemNoStore ? ' (may never be stored)' : ''}`);
  const newItem = {
    instanceId: card.instanceId,
    definitionId: card.definitionId,
    status: CardStatus.Untapped,
    ...(kind.playedItemNoStore ? { neverStorable: true as const } : {}),
  };
  let next = updatePlayer(state, playerIndex, p => {
    const removed = rawAction.source === 'hand'
      ? { ...p, hand: p.hand.filter(c => c.instanceId !== card.instanceId) }
      : { ...p, discardPile: p.discardPile.filter(c => c.instanceId !== card.instanceId) };
    return updateCharacter(removed, rawAction.characterId, c => ({
      ...c,
      status: CardStatus.Tapped,
      items: [...c.items, newItem],
    }));
  });
  if (opponentCopy) {
    const copy = opponentCopy;
    logDetail(`store-item-play-offer: discarding opponent's stored ${itemName} (${copy.instanceId as string})`);
    next = updatePlayer(next, opponentIndex, p => ({
      ...p,
      killPile: p.killPile.filter(c => c.instanceId !== copy.instanceId),
      discardPile: [...p.discardPile, { instanceId: copy.instanceId, definitionId: copy.definitionId }],
    }));
  }
  next = tapCompanyCardsOnItemPlay(next, playerIndex, rawAction.characterId, def);
  return { state: dequeueResolution(next, top.id) };
}
