/**
 * @module tw-274.test
 *
 * Card test: Magic Ring of Stealth (tw-274)
 * Type: hero-resource-item (subtype: special)
 * Keywords: ring, magic-ring
 *
 * "Tap to give bearer +1 prowess during a strike. ...cancel one
 *  automatic-attack strike."
 * (Magic rings are eligible replacement rings for gold-ring results
 *  matching the magic-ring row in the gold ring's test table.)
 *
 * Engine support:
 * | # | Feature                                              | Status      | Notes                                         |
 * |---|------------------------------------------------------|-------------|-----------------------------------------------|
 * | 1 | Eligible as replacement for matching gold-ring result| IMPLEMENTED | keyword magic-ring matched against test table |
 * | 2 | Tap for +1 prowess during a strike                   | TODO        | not yet implemented                           |
 * | 3 | Cancel one automatic-attack strike                   | TODO        | not yet implemented                           |
 *
 * Fixture alignment: hero (wizard), using Aragorn (tw-173) at Rivendell.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { CardDefinitionId } from '../../index.js';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  Phase,
  buildTestState, resetMint,
  findCharInstanceId, viableActions, dispatch,
  attachItemToChar,
  RESOURCE_PLAYER,
  enqueueGoldRingTest, addCardToHand,
} from '../test-helpers.js';

const MAGIC_RING_OF_STEALTH = 'tw-274' as CardDefinitionId;
const PRECIOUS_GOLD_RING = 'tw-306' as CardDefinitionId;

describe('Magic Ring of Stealth (tw-274)', () => {
  beforeEach(() => resetMint());

  test('magic-ring offered when roll total matches magic-ring range (1–5 on Precious Gold Ring)', () => {
    // tw-306 table: magic-ring range is 1-5
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, PRECIOUS_GOLD_RING);
    const ringId = withRing.players[RESOURCE_PLAYER].characters[aragornId as string].items[0].instanceId;
    const withHand = addCardToHand(withRing, RESOURCE_PLAYER, MAGIC_RING_OF_STEALTH);

    const withPending = enqueueGoldRingTest(withHand, PLAYER_1, ringId, aragornId);
    // Roll 3: within magic-ring range 1-5
    const afterRoll = dispatch(
      { ...withPending, cheatRollTotal: 3 },
      viableActions(withPending, PLAYER_1, 'gold-ring-test-roll')[0].action,
    );

    const playActions = viableActions(afterRoll, PLAYER_1, 'play-ring-after-test');
    expect(playActions).toHaveLength(1);
    expect((playActions[0].action as { ringInstanceId: string }).ringInstanceId).toBeDefined();
  });

  test('magic-ring NOT offered when roll total is outside magic-ring range', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, PRECIOUS_GOLD_RING);
    const ringId = withRing.players[RESOURCE_PLAYER].characters[aragornId as string].items[0].instanceId;
    const withHand = addCardToHand(withRing, RESOURCE_PLAYER, MAGIC_RING_OF_STEALTH);

    const withPending = enqueueGoldRingTest(withHand, PLAYER_1, ringId, aragornId);
    // Roll 7: outside magic-ring range (1-5) — no play-ring-after-test offered
    const afterRoll = dispatch(
      { ...withPending, cheatRollTotal: 7 },
      viableActions(withPending, PLAYER_1, 'gold-ring-test-roll')[0].action,
    );

    const playActions = viableActions(afterRoll, PLAYER_1, 'play-ring-after-test');
    expect(playActions).toHaveLength(0);
  });

  test('magic-ring played: moves from hand onto the character after the test', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, PRECIOUS_GOLD_RING);
    const ringId = withRing.players[RESOURCE_PLAYER].characters[aragornId as string].items[0].instanceId;
    const withHand = addCardToHand(withRing, RESOURCE_PLAYER, MAGIC_RING_OF_STEALTH);

    const withPending = enqueueGoldRingTest(withHand, PLAYER_1, ringId, aragornId);
    const afterRoll = dispatch(
      { ...withPending, cheatRollTotal: 4 },
      viableActions(withPending, PLAYER_1, 'gold-ring-test-roll')[0].action,
    );

    const playAction = viableActions(afterRoll, PLAYER_1, 'play-ring-after-test')[0].action;
    const afterPlay = dispatch(afterRoll, playAction);

    expect(afterPlay.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === MAGIC_RING_OF_STEALTH)).toBeUndefined();
    expect(
      afterPlay.players[RESOURCE_PLAYER].characters[aragornId as string].items.find(i => i.definitionId === MAGIC_RING_OF_STEALTH),
    ).toBeDefined();
  });

  test.todo('tap for +1 prowess during a strike');
  test.todo('cancel one automatic-attack strike');
});
