/**
 * @module tw-266.test
 *
 * Card test: Lesser Ring (tw-266)
 * Type: hero-resource-item (subtype: special)
 * Keywords: ring, lesser-ring
 *
 * "Lesser Ring. Playable only with a gold ring and after a test indicates
 *  Lesser Ring. +2 to direct influence."
 *
 * Engine support:
 * | # | Feature                                          | Status      | Notes                                     |
 * |---|--------------------------------------------------|-------------|-------------------------------------------|
 * | 1 | +2 to direct influence                           | IMPLEMENTED | stat-modifier effect                      |
 * | 2 | Eligible as replacement for any gold-ring result | IMPLEMENTED | keyword lesser-ring matches null min/max  |
 * | 3 | 1 corruption point                               | IMPLEMENTED | data/cards.json TW-266 attributes.corruption |
 *
 * The Lesser Ring's entire printed effect is "+2 to direct influence" (see the
 * authoritative text in data/cards.json TW-266). It has NO corruption-check
 * ability — an earlier draft of this test carried a phantom "tap to cancel a
 * corruption check" row/todo that does not correspond to the card. The card is
 * fully implemented and certified (2026-05-24).
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
import { recomputeDerived } from '../../engine/recompute-derived.js';

const LESSER_RING = 'tw-266' as CardDefinitionId;
const PRECIOUS_GOLD_RING = 'tw-306' as CardDefinitionId;

describe('Lesser Ring (tw-266)', () => {
  beforeEach(() => resetMint());

  test('bearer gains +2 effective direct influence while ring is held', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const baseDI = base.players[RESOURCE_PLAYER].characters[aragornId].effectiveStats.directInfluence;

    const withRing = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, LESSER_RING));
    const ringDI = withRing.players[RESOURCE_PLAYER].characters[aragornId].effectiveStats.directInfluence;

    expect(ringDI).toBe(baseDI + 2);
  });

  test('bearer gains 1 corruption point while ring is held', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const baseCp = base.players[RESOURCE_PLAYER].characters[aragornId].effectiveStats.corruptionPoints;

    const withRing = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, LESSER_RING));
    const ringCp = withRing.players[RESOURCE_PLAYER].characters[aragornId].effectiveStats.corruptionPoints;

    expect(ringCp).toBe(baseCp + 1);
  });

  test('lesser-ring is eligible for any gold-ring test result — offered after any roll total', () => {
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
    const ringId = withRing.players[RESOURCE_PLAYER].characters[aragornId].items[0].instanceId;
    const withHand = addCardToHand(withRing, RESOURCE_PLAYER, LESSER_RING);

    // Test with a high roll that would exclude magic-ring (1-5) and dwarven-ring (8+) ranges:
    // tw-306: lesser-ring any, magic-ring 1-5, dwarven-ring 8+, the-one-ring 10+
    // Roll 7: only lesser-ring eligible
    const withPending = enqueueGoldRingTest(withHand, PLAYER_1, ringId, aragornId);
    const afterRoll = dispatch(
      { ...withPending, cheatRollTotal: 7 },
      viableActions(withPending, PLAYER_1, 'gold-ring-test-roll')[0].action,
    );

    const playActions = viableActions(afterRoll, PLAYER_1, 'play-ring-after-test');
    expect(playActions).toHaveLength(1);
    expect((playActions[0].action as { ringInstanceId: string }).ringInstanceId).toBeDefined();
  });

  test('lesser-ring played: moves from hand onto the character after the test', () => {
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
    const ringId = withRing.players[RESOURCE_PLAYER].characters[aragornId].items[0].instanceId;
    const withHand = addCardToHand(withRing, RESOURCE_PLAYER, LESSER_RING);

    const withPending = enqueueGoldRingTest(withHand, PLAYER_1, ringId, aragornId);
    const afterRoll = dispatch(
      { ...withPending, cheatRollTotal: 9 },
      viableActions(withPending, PLAYER_1, 'gold-ring-test-roll')[0].action,
    );

    const playAction = viableActions(afterRoll, PLAYER_1, 'play-ring-after-test')[0].action;
    const afterPlay = dispatch(afterRoll, playAction);

    expect(afterPlay.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === LESSER_RING)).toBeUndefined();
    expect(
      afterPlay.players[RESOURCE_PLAYER].characters[aragornId].items.find(i => i.definitionId === LESSER_RING),
    ).toBeDefined();
  });
});
