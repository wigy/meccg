/**
 * @module move-primitive
 *
 * Tests for the two in-play destinations of the generic move primitive
 * (`applyMove`, engine/reducer-move.ts) plus the `chain` source — the
 * groundwork that lets permanent/long event "enter play" placement migrate
 * onto the move primitive (unblocking the apply-effect unification, P06).
 *
 * `in-play-general` pushes into a player's `cardsInPlay`; `in-play-on-character`
 * attaches to a bearer's `items` (resource events) or `hazards` (hazard events).
 * `from: 'chain'` sources the resolving event card, which lives on the chain
 * entry and is in no pile. The destinations are additive — no card JSON or
 * engine handler emits them yet — so this verifies the primitive in isolation.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { applyMove } from '../../engine/reducer-move.js';
import type { MoveContext } from '../../engine/reducer-move.js';
import type { MoveEffect, CardInstanceId, CardDefinitionId } from '../../index.js';
import { Phase } from '../../index.js';
import {
  buildTestState, resetMint, findCharInstanceId, getCharacter,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, ARAGORN, RIVENDELL, LORIEN, MINAS_TIRITH, LEGOLAS,
} from '../test-helpers.js';

const ALIGN_PALANTIR = 'tw-190' as CardDefinitionId; // hero-resource-event (permanent) → items slot
const THRICE_OUTNUMBERED = 'le-142' as CardDefinitionId; // hazard-event (permanent) → hazards slot

describe('move primitive — in-play destinations + chain source', () => {
  beforeEach(() => resetMint());

  test('from:hand to:in-play-general lands the card Untapped in the owner cardsInPlay', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [ALIGN_PALANTIR], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const cardId = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const move: MoveEffect = { type: 'move', select: 'self', from: 'hand', to: 'in-play-general' };
    const ctx: MoveContext = { sourceCardId: cardId, sourcePlayerIndex: RESOURCE_PLAYER };

    const res = applyMove(state, move, ctx);
    expect('error' in res).toBe(false);
    if ('error' in res) return;
    expect(res.state.players[RESOURCE_PLAYER].hand.find(c => c.instanceId === cardId)).toBeUndefined();
    const inPlay = res.state.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.instanceId === cardId);
    expect(inPlay).toBeDefined();
    expect(inPlay!.status).toBe('untapped');
  });

  test('from:chain to:in-play-general places the resolving (pile-less) chain card', () => {
    // The resolving event lives only on the chain entry — in no pile.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const chainCard = { instanceId: 'chain-evt-1' as CardInstanceId, definitionId: ALIGN_PALANTIR };
    const move: MoveEffect = { type: 'move', select: 'self', from: 'chain', to: 'in-play-general' };
    const ctx: MoveContext = { sourceCardId: chainCard.instanceId, sourcePlayerIndex: RESOURCE_PLAYER, chainCard };

    const res = applyMove(state, move, ctx);
    expect('error' in res).toBe(false);
    if ('error' in res) return;
    expect(res.state.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.instanceId === chainCard.instanceId)).toBeDefined();
  });

  test('from:chain requires ctx.chainCard (error if absent)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const move: MoveEffect = { type: 'move', select: 'self', from: 'chain', to: 'in-play-general' };
    const res = applyMove(state, move, { sourceCardId: 'x' as CardInstanceId, sourcePlayerIndex: RESOURCE_PLAYER });
    expect('error' in res).toBe(true);
  });

  test('to:in-play-on-character routes a resource event into the bearer items', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [ALIGN_PALANTIR], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const cardId = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const bearerId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const move: MoveEffect = { type: 'move', select: 'self', from: 'hand', to: 'in-play-on-character' };
    const ctx: MoveContext = { sourceCardId: cardId, sourcePlayerIndex: RESOURCE_PLAYER, targetCharacterId: bearerId };

    const res = applyMove(state, move, ctx);
    expect('error' in res).toBe(false);
    if ('error' in res) return;
    const bearer = getCharacter(res.state, RESOURCE_PLAYER, ARAGORN);
    expect(bearer.items.find(i => i.instanceId === cardId)).toBeDefined();
    expect(bearer.hazards.find(h => h.instanceId === cardId)).toBeUndefined();
  });

  test('to:in-play-on-character routes a hazard event into the bearer hazards', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [THRICE_OUTNUMBERED], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const cardId = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const bearerId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const move: MoveEffect = { type: 'move', select: 'self', from: 'hand', to: 'in-play-on-character' };
    const ctx: MoveContext = { sourceCardId: cardId, sourcePlayerIndex: RESOURCE_PLAYER, targetCharacterId: bearerId };

    const res = applyMove(state, move, ctx);
    expect('error' in res).toBe(false);
    if ('error' in res) return;
    const bearer = getCharacter(res.state, RESOURCE_PLAYER, ARAGORN);
    expect(bearer.hazards.find(h => h.instanceId === cardId)).toBeDefined();
    expect(bearer.items.find(i => i.instanceId === cardId)).toBeUndefined();
  });

  test('to:in-play-on-character with a missing bearer fails closed — no card removed', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [ALIGN_PALANTIR], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const cardId = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const move: MoveEffect = { type: 'move', select: 'self', from: 'hand', to: 'in-play-on-character' };
    const ctx: MoveContext = { sourceCardId: cardId, sourcePlayerIndex: RESOURCE_PLAYER, targetCharacterId: 'no-such-char' as CardInstanceId };

    const res = applyMove(state, move, ctx);
    expect('error' in res).toBe(true);
    // The source card must remain in hand — no card vanished.
    expect(state.players[RESOURCE_PLAYER].hand.find(c => c.instanceId === cardId)).toBeDefined();
  });
});
