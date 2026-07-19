/**
 * @module wh-29.test
 *
 * Card test: Rolled down to the Sea (wh-29)
 * Type: hazard-event (short), unique
 * Effects: 1
 *   1. force-opponent-discard — match: ring, sources: [hand, carried],
 *      fallbackRevealHand: true
 *
 * Card text: "Unique. Opponent must discard a ring from his hand or from one
 *  of his companies if available. If no rings are available as such, he must
 *  reveal his hand to you."
 *
 * When the hazard player plays this short-event, the card resolves on the
 * chain and forces the card-player's opponent (the resource/active player) to
 * discard one "ring". A ring is any card carrying the `ring` keyword or the
 * `gold-ring` subtype. Candidates are gathered from the opponent's hand and
 * from the rings carried by their in-play characters ("from one of his
 * companies"). The opponent chooses which ring to discard via a
 * `force-discard-card` pending resolution. If the opponent has no ring
 * anywhere, their current hand identities are instead revealed to the
 * card-player (recorded in `revealedInstances`).
 *
 * Engine Support:
 * | # | Feature                                         | Status      | Notes                                              |
 * |---|-------------------------------------------------|-------------|----------------------------------------------------|
 * | 1 | Play from hand as an untargeted hazard short    | IMPLEMENTED | generic play-hazards fallthrough                   |
 * | 2 | Force opponent to discard a ring (their choice) | IMPLEMENTED | force-discard-card pending resolution              |
 * | 3 | Rings sourced from hand and carried items       | IMPLEMENTED | sources: [hand, carried]                           |
 * | 4 | Ring = `ring` keyword OR `gold-ring` subtype    | IMPLEMENTED | matcher in chain resolution                        |
 * | 5 | No ring available → reveal hand                 | IMPLEMENTED | revealInstances over opponent hand                 |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI, PRECIOUS_GOLD_RING,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  buildTestState, resetMint, makeMHState,
  viableActions, dispatch, resolveChain,
  handCardId, findHandCardId, getCharacter,
} from '../test-helpers.js';
import { Phase } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, GameState, ForceDiscardCardAction } from '../../index.js';

const ROLLED_DOWN_TO_THE_SEA = 'wh-29' as CardDefinitionId;
/** A Little Gold Ring — subtype gold-ring but WITHOUT the `ring` keyword. */
const A_LITTLE_GOLD_RING = 'le-297' as CardDefinitionId;

/**
 * Build an M/H state with PLAYER_1 (resource) active at Moria and PLAYER_2
 * (hazard) holding a single copy of Rolled down to the Sea. The resource
 * player's hand and Aragorn's carried items are configured by the caller.
 */
function buildRolled(opts: {
  resourceHand?: CardDefinitionId[];
  aragornItems?: CardDefinitionId[];
}): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      {
        id: PLAYER_1,
        companies: [{
          site: MORIA,
          characters: [
            { defId: ARAGORN, items: opts.aragornItems ?? [] },
            LEGOLAS,
          ],
        }],
        hand: opts.resourceHand ?? [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [] }],
        hand: [ROLLED_DOWN_TO_THE_SEA],
        siteDeck: [RIVENDELL],
      },
    ],
  });
  return { ...base, phaseState: makeMHState() };
}

/** Play Rolled down to the Sea (by the hazard player) and resolve the chain. */
function playRolled(state: GameState): GameState {
  const cardId = handCardId(state, HAZARD_PLAYER);
  const play = viableActions(state, PLAYER_2, 'play-hazard')
    .find(a => (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === cardId);
  expect(play).toBeDefined();
  return resolveChain(dispatch(state, play!.action));
}

describe('Rolled down to the Sea (wh-29)', () => {
  beforeEach(() => resetMint());

  test('the hazard player may play it as an untargeted hazard short-event', () => {
    const state = buildRolled({ resourceHand: [A_LITTLE_GOLD_RING] });
    const cardId = handCardId(state, HAZARD_PLAYER);
    const play = viableActions(state, PLAYER_2, 'play-hazard')
      .find(a => (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === cardId);
    expect(play).toBeDefined();
  });

  test('forces the opponent to discard a ring from hand (subtype gold-ring, no keyword)', () => {
    const state = buildRolled({ resourceHand: [A_LITTLE_GOLD_RING, GIMLI] });
    const ringId = findHandCardId(state, RESOURCE_PLAYER, A_LITTLE_GOLD_RING);
    const gimliId = findHandCardId(state, RESOURCE_PLAYER, GIMLI);

    const resolved = playRolled(state);

    // A force-discard-card pending resolution is enqueued for the opponent,
    // listing only the ring (not the non-ring hand card).
    const pending = resolved.pendingResolutions.find(r => r.kind.type === 'force-discard-card');
    expect(pending).toBeDefined();
    expect(pending!.actor).toBe(PLAYER_1);
    const candidates = (pending!.kind as { candidateInstanceIds: readonly CardInstanceId[] }).candidateInstanceIds;
    expect(candidates).toContain(ringId);
    expect(candidates).not.toContain(gimliId);

    // The opponent is offered exactly one discard action (for the ring).
    const discardActions = viableActions(resolved, PLAYER_1, 'force-discard-card');
    expect(discardActions).toHaveLength(1);
    expect((discardActions[0].action as ForceDiscardCardAction).cardInstanceId).toBe(ringId);

    // Discarding the ring moves it from hand to the opponent's discard pile.
    const after = dispatch(resolved, discardActions[0].action);
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === ringId)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === ringId)).toBe(true);
    // The non-ring hand card is untouched.
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === gimliId)).toBe(true);
    // The resolution is consumed.
    expect(after.pendingResolutions.some(r => r.kind.type === 'force-discard-card')).toBe(false);
  });

  test('forces the opponent to discard a ring carried by a character (keyword ring)', () => {
    const state = buildRolled({ resourceHand: [GIMLI], aragornItems: [PRECIOUS_GOLD_RING] });
    const carriedRingId = getCharacter(state, RESOURCE_PLAYER, ARAGORN).items[0].instanceId;

    const resolved = playRolled(state);

    const pending = resolved.pendingResolutions.find(r => r.kind.type === 'force-discard-card');
    expect(pending).toBeDefined();
    const candidates = (pending!.kind as { candidateInstanceIds: readonly CardInstanceId[] }).candidateInstanceIds;
    expect(candidates).toEqual([carriedRingId]);

    const discardActions = viableActions(resolved, PLAYER_1, 'force-discard-card');
    expect(discardActions).toHaveLength(1);

    const after = dispatch(resolved, discardActions[0].action);
    // The carried ring is removed from Aragorn and lands in the discard pile.
    expect(getCharacter(after, RESOURCE_PLAYER, ARAGORN).items.some(i => i.instanceId === carriedRingId)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === carriedRingId)).toBe(true);
  });

  test('offers every ring in hand AND carried by characters as a discard choice', () => {
    const state = buildRolled({ resourceHand: [A_LITTLE_GOLD_RING], aragornItems: [PRECIOUS_GOLD_RING] });
    const handRingId = findHandCardId(state, RESOURCE_PLAYER, A_LITTLE_GOLD_RING);
    const carriedRingId = getCharacter(state, RESOURCE_PLAYER, ARAGORN).items[0].instanceId;

    const resolved = playRolled(state);

    const discardActions = viableActions(resolved, PLAYER_1, 'force-discard-card');
    const offered = discardActions.map(a => (a.action as ForceDiscardCardAction).cardInstanceId);
    expect(offered).toContain(handRingId);
    expect(offered).toContain(carriedRingId);
    expect(offered).toHaveLength(2);
  });

  test('reveals the opponent hand when no ring is available anywhere', () => {
    const state = buildRolled({ resourceHand: [GIMLI, LEGOLAS] });
    const gimliId = findHandCardId(state, RESOURCE_PLAYER, GIMLI);
    const legolasId = findHandCardId(state, RESOURCE_PLAYER, LEGOLAS);

    const resolved = playRolled(state);

    // No discard resolution — nothing to discard.
    expect(resolved.pendingResolutions.some(r => r.kind.type === 'force-discard-card')).toBe(false);
    // The opponent's current hand identities are revealed to the card-player.
    expect(resolved.revealedInstances[gimliId]).toBe(GIMLI);
    expect(resolved.revealedInstances[legolasId]).toBe(LEGOLAS);
    // The hand itself is not discarded.
    expect(resolved.players[RESOURCE_PLAYER].hand).toHaveLength(2);
  });
});
