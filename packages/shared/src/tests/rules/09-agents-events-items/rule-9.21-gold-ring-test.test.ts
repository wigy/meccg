/**
 * @module rule-9.21-gold-ring-test
 *
 * CoE Rules — Section 9: Agents, Events, Items & Rings
 * Rule 9.21: Gold Ring Test
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * When a rule or effect causes a gold ring item to be "tested," the item's player makes a ring test roll, applies any modifications, and may then immediately play a special ring item that matches the final result as listed on the gold ring item. The special ring item replaces the gold ring item, which is immediately discarded regardless of whether a special ring item was played to replace it.
 * Playing a special ring as the result of a gold ring test counts as "playing an item," but is not restricted to the site phase, doesn't tap a site, and doesn't require an untapped site nor an untapped character.
 * When a gold ring item is tested, it can only be replaced with a special ring item of the same alignment.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { CardDefinitionId } from '../../../index.js';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  Phase,
  buildTestState, resetMint,
  findCharInstanceId, viableActions, dispatchResult, dispatch,
  attachItemToChar, findHandCardId,
  expectInDiscardPile,
  RESOURCE_PLAYER,
  enqueueGoldRingTest, addCardToHand,
} from '../../test-helpers.js';

const PRECIOUS_GOLD_RING = 'tw-306' as CardDefinitionId;
const LESSER_RING = 'tw-266' as CardDefinitionId;
const MAGIC_RING_OF_STEALTH = 'tw-274' as CardDefinitionId;

function baseState() {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
}

describe('Rule 9.21 — Gold Ring Test', () => {
  beforeEach(() => resetMint());

  test('gold ring tested: gold-ring-test-roll offered; ring discarded and dice-roll emitted after rolling', () => {
    const base = baseState();
    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, PRECIOUS_GOLD_RING);
    const ringId = withRing.players[RESOURCE_PLAYER].characters[aragornId as string].items[0].instanceId;

    const withPending = enqueueGoldRingTest(withRing, PLAYER_1, ringId, aragornId);

    const rollActions = viableActions(withPending, PLAYER_1, 'gold-ring-test-roll');
    expect(rollActions).toHaveLength(1);

    const result = dispatchResult({ ...withPending, cheatRollTotal: 7 }, rollActions[0].action);
    expect(result.effects?.some(e => e.effect === 'dice-roll')).toBe(true);
    expectInDiscardPile(result.state, RESOURCE_PLAYER, PRECIOUS_GOLD_RING);
  });

  test('roll result 7 on Precious Gold Ring: lesser-ring and magic-ring eligible — both offered', () => {
    // Precious Gold Ring table: lesser-ring=any, magic-ring=1-5, dwarven-ring=8+, the-one-ring=10+
    // Wait — tw-306 has magic-ring: 1-5. Roll 7 gives lesser-ring (any) only, not magic-ring.
    // To get both: need a roll in 1-5 range (magic-ring AND lesser-ring).
    const base = baseState();
    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, PRECIOUS_GOLD_RING);
    const ringId = withRing.players[RESOURCE_PLAYER].characters[aragornId as string].items[0].instanceId;
    // Add both eligible ring types to hand
    let state = addCardToHand(withRing, RESOURCE_PLAYER, LESSER_RING);
    state = addCardToHand(state, RESOURCE_PLAYER, MAGIC_RING_OF_STEALTH);

    const withPending = enqueueGoldRingTest(state, PLAYER_1, ringId, aragornId);
    // Roll 4: matches magic-ring (1-5) and lesser-ring (any)
    const afterRoll = dispatch({ ...withPending, cheatRollTotal: 4 }, viableActions(withPending, PLAYER_1, 'gold-ring-test-roll')[0].action);

    const playActions = viableActions(afterRoll, PLAYER_1, 'play-ring-after-test');
    expect(playActions).toHaveLength(2);

    const passActions = viableActions(afterRoll, PLAYER_1, 'pass');
    expect(passActions).toHaveLength(1);
  });

  test('roll result 7 on Precious Gold Ring: only lesser-ring eligible (magic-ring needs 1-5)', () => {
    const base = baseState();
    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, PRECIOUS_GOLD_RING);
    const ringId = withRing.players[RESOURCE_PLAYER].characters[aragornId as string].items[0].instanceId;
    let state = addCardToHand(withRing, RESOURCE_PLAYER, LESSER_RING);
    state = addCardToHand(state, RESOURCE_PLAYER, MAGIC_RING_OF_STEALTH);

    const withPending = enqueueGoldRingTest(state, PLAYER_1, ringId, aragornId);
    // Roll 7: magic-ring needs 1-5, so only lesser-ring eligible
    const afterRoll = dispatch({ ...withPending, cheatRollTotal: 7 }, viableActions(withPending, PLAYER_1, 'gold-ring-test-roll')[0].action);

    const playActions = viableActions(afterRoll, PLAYER_1, 'play-ring-after-test');
    expect(playActions).toHaveLength(1);
    // The offered action targets the Lesser Ring
    const lesserRingId = findHandCardId(afterRoll, RESOURCE_PLAYER, LESSER_RING);
    expect((playActions[0].action as { ringInstanceId: string }).ringInstanceId).toBe(lesserRingId);
  });

  test('player plays eligible ring: ring moves from hand onto character', () => {
    const base = baseState();
    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, PRECIOUS_GOLD_RING);
    const ringId = withRing.players[RESOURCE_PLAYER].characters[aragornId as string].items[0].instanceId;
    const withHand = addCardToHand(withRing, RESOURCE_PLAYER, LESSER_RING);

    const withPending = enqueueGoldRingTest(withHand, PLAYER_1, ringId, aragornId);
    const afterRoll = dispatch({ ...withPending, cheatRollTotal: 7 }, viableActions(withPending, PLAYER_1, 'gold-ring-test-roll')[0].action);

    const playAction = viableActions(afterRoll, PLAYER_1, 'play-ring-after-test')[0].action;
    const afterPlay = dispatch(afterRoll, playAction);

    // Lesser Ring is now in Aragorn's items, not in hand
    expect(afterPlay.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === LESSER_RING)).toBeUndefined();
    expect(afterPlay.players[RESOURCE_PLAYER].characters[aragornId as string].items.find(i => i.definitionId === LESSER_RING)).toBeDefined();
  });

  test('player passes: gold ring discarded, hand unchanged', () => {
    const base = baseState();
    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, PRECIOUS_GOLD_RING);
    const ringId = withRing.players[RESOURCE_PLAYER].characters[aragornId as string].items[0].instanceId;
    const withHand = addCardToHand(withRing, RESOURCE_PLAYER, LESSER_RING);

    const withPending = enqueueGoldRingTest(withHand, PLAYER_1, ringId, aragornId);
    const afterRoll = dispatch({ ...withPending, cheatRollTotal: 7 }, viableActions(withPending, PLAYER_1, 'gold-ring-test-roll')[0].action);

    const passAction = viableActions(afterRoll, PLAYER_1, 'pass')[0].action;
    const afterPass = dispatch(afterRoll, passAction);

    // Gold ring discarded, lesser ring stays in hand
    expectInDiscardPile(afterPass, RESOURCE_PLAYER, PRECIOUS_GOLD_RING);
    expect(afterPass.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === LESSER_RING)).toBeDefined();
  });

  test('negative roll modifier: lesser-ring still eligible even when total is below 1', () => {
    // lesser-ring has null min/max — it is always eligible regardless of roll total.
    const base = baseState();
    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, PRECIOUS_GOLD_RING);
    const ringId = withRing.players[RESOURCE_PLAYER].characters[aragornId as string].items[0].instanceId;
    const withHand = addCardToHand(withRing, RESOURCE_PLAYER, LESSER_RING);

    // Roll 2 - modifier 5 = -3 total: still eligible because lesser-ring is any result
    const withPending = enqueueGoldRingTest(withHand, PLAYER_1, ringId, aragornId, -5);
    const afterRoll = dispatch({ ...withPending, cheatRollTotal: 2 }, viableActions(withPending, PLAYER_1, 'gold-ring-test-roll')[0].action);

    const playActions = viableActions(afterRoll, PLAYER_1, 'play-ring-after-test');
    expect(playActions).toHaveLength(1);
  });
});
