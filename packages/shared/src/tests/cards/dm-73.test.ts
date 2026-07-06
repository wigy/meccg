/**
 * @module dm-73.test
 *
 * Card test: Neither so Ancient Nor so Potent (dm-73)
 * Type: hazard-event (permanent)
 *
 * Text: "Playable on a stored item. Return item to opponent's hand (discarding
 * all attached cards). Place this card in opponent's marshalling point pile.
 * It gives 2 item marshalling points."
 *
 * Card shape (effects):
 *   - play-target: target "stored-item" — the hazard player targets one of the
 *     opponent's stored items (an item sitting in the opponent's
 *     marshalling-point pile / `killPile`).
 *   - displace-stored-item: on resolution the targeted item returns to its
 *     owner's hand (discarding any attached cards) and this card is placed into
 *     that owner's marshalling-point pile.
 *   - mp-in-pile: while in the marshalling-point pile the card is worth 2 item
 *     marshalling points.
 *
 * Engine support:
 *   - Legal actions: `play-target: stored-item` emits one `play-hazard` per
 *     opponent stored item during the M/H play-hazards step
 *     (`legal-actions/movement-hazard.ts`), carrying `targetStoredItemInstanceId`.
 *   - Resolution: `resolveDisplaceStoredItem` in `chain-reducer.ts` moves the
 *     stored item killPile → owner hand and the resolving card chain → owner
 *     killPile (no instance is lost).
 *   - Marshalling points: the `mp-in-pile` effect is scored in the killPile loop
 *     of `recompute-derived.ts`.
 *
 * MP math: the opponent stores Book of Mazarbul (tw-201, worth 5 item MP when
 * stored). Before dm-73 the opponent has 5 item MP from the pile; after dm-73
 * the book is back in hand (0 from the pile) and dm-73 grants 2 → the opponent
 * nets 2 item MP, a three-MP denial plus the tempo cost of re-storing the book.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS, RIVENDELL, LORIEN,
  buildTestState, resetMint, makeMHState,
  addToPile, mint, viableActions, dispatch, resolveChain, recomputeDerived,
} from '../test-helpers.js';
import { Phase } from '../../index.js';
import type { GameState, CardDefinitionId, CardInstance, MovementHazardPhaseState, PlayHazardAction } from '../../index.js';

const NEITHER_SO_ANCIENT = 'dm-73' as CardDefinitionId;
const BOOK_OF_MAZARBUL = 'tw-201' as CardDefinitionId; // hero item, 5 item MP when stored

describe('Neither so Ancient Nor so Potent (dm-73)', () => {
  beforeEach(() => resetMint());

  /**
   * PLAYER_1 (active/resource) has Book of Mazarbul stored in their
   * marshalling-point pile; PLAYER_2 (hazard) holds dm-73. The M/H play-hazards
   * step is processing PLAYER_1's company. Returns { state, item }.
   */
  function baseState(withStoredItem = true): { state: GameState; item: CardInstance } {
    let state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [NEITHER_SO_ANCIENT], siteDeck: [LORIEN] },
      ],
    });
    // Mint the stored item AFTER buildTestState (which resets the mint counter)
    // so its instance ID does not collide with a character/site instance.
    const item: CardInstance = { instanceId: mint(), definitionId: BOOK_OF_MAZARBUL };
    if (withStoredItem) state = addToPile(state, RESOURCE_PLAYER, 'killPile', item);
    state = recomputeDerived({ ...state, phaseState: makeMHState() });
    return { state, item };
  }

  test('offered as a viable play-hazard targeting the opponent stored item', () => {
    const { state, item } = baseState();
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    const onItem = plays.find(a => (a.action as PlayHazardAction).targetStoredItemInstanceId === item.instanceId);
    expect(onItem).toBeDefined();
  });

  test('NOT playable when the opponent has no stored items', () => {
    const { state } = baseState(false);
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    const onStoredItem = plays.filter(a => (a.action as PlayHazardAction).targetStoredItemInstanceId !== undefined);
    expect(onStoredItem).toHaveLength(0);
  });

  test('baseline: the stored Book of Mazarbul gives the opponent 5 item marshalling points', () => {
    const { state } = baseState();
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(5);
  });

  test('resolving returns the stored item to the opponent hand and removes it from the pile', () => {
    const { state, item } = baseState();
    const play = viableActions(state, PLAYER_2, 'play-hazard')
      .find(a => (a.action as PlayHazardAction).targetStoredItemInstanceId === item.instanceId)!;
    const after = resolveChain(dispatch(state, play.action));

    expect(after.chain).toBeNull();
    // Item no longer in the opponent's marshalling-point pile...
    expect(after.players[RESOURCE_PLAYER].killPile.some(c => c.instanceId === item.instanceId)).toBe(false);
    // ...and back in the opponent's hand.
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === item.instanceId)).toBe(true);
  });

  test('resolving places dm-73 in the opponent pile worth 2 item marshalling points', () => {
    const { state, item } = baseState();
    const play = viableActions(state, PLAYER_2, 'play-hazard')
      .find(a => (a.action as PlayHazardAction).targetStoredItemInstanceId === item.instanceId)!;
    const after = resolveChain(dispatch(state, play.action));

    // The card itself now sits in the opponent's marshalling-point pile.
    expect(after.players[RESOURCE_PLAYER].killPile.some(c => c.definitionId === NEITHER_SO_ANCIENT)).toBe(true);
    // Item MP dropped from 5 (stored book) to 2 (dm-73 in the pile).
    expect(after.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(2);
  });

  test('the card leaves the hazard player hand and never enters their cards in play', () => {
    const { state, item } = baseState();
    const play = viableActions(state, PLAYER_2, 'play-hazard')
      .find(a => (a.action as PlayHazardAction).targetStoredItemInstanceId === item.instanceId)!;
    const after = resolveChain(dispatch(state, play.action));

    expect(after.players[HAZARD_PLAYER].hand.some(c => c.definitionId === NEITHER_SO_ANCIENT)).toBe(false);
    expect(after.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === NEITHER_SO_ANCIENT)).toBe(false);
    expect(after.players[HAZARD_PLAYER].killPile.some(c => c.definitionId === NEITHER_SO_ANCIENT)).toBe(false);
  });

  test('playing the card counts one against the hazard limit', () => {
    const { state, item } = baseState();
    const before = (state.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany;
    const play = viableActions(state, PLAYER_2, 'play-hazard')
      .find(a => (a.action as PlayHazardAction).targetStoredItemInstanceId === item.instanceId)!;
    const after = dispatch(state, play.action);

    expect((after.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany).toBe(before + 1);
  });
});
