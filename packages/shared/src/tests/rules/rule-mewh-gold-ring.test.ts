/**
 * MEWH §10 — Fallen-wizard gold ring test modifier.
 *
 * Source: The White Hand Insert, "Playing and Using Resources / Testing Gold
 * Rings": "Whenever a Fallen-wizard player tests a hero gold ring item, the roll
 * is modified by -1."
 *
 * The modifier applies only to a **hero** gold ring (`hero-resource-item`); a
 * minion gold ring is unaffected, and a Wizard testing the same hero ring is
 * unaffected. Asserted on the `ring-play-offer` resolution's `rollTotal`, which
 * records the modified roll total used for the ring-test table.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { Alignment } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, LEGOLAS, RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  Phase,
  buildTestState, resetMint,
  findCharInstanceId, viableActions, dispatch,
  attachItemToChar, enqueueGoldRingTest,
} from '../test-helpers.js';

const PRECIOUS_GOLD_RING = 'tw-306' as CardDefinitionId;   // hero gold ring
const A_LITTLE_GOLD_RING = 'le-297' as CardDefinitionId;   // minion gold ring

/** Roll a gold-ring test for `ring` borne by Aragorn and return the resulting rollTotal. */
function rollTotalFor(alignment: Alignment, ring: CardDefinitionId, cheatRollTotal: number): number {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      { id: PLAYER_1, alignment, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
  const withRing = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, ring);
  const ringId = withRing.players[RESOURCE_PLAYER].characters[aragornId].items[0].instanceId;

  const withPending = enqueueGoldRingTest(withRing, PLAYER_1, ringId, aragornId);
  const afterRoll = dispatch(
    { ...withPending, cheatRollTotal },
    viableActions(withPending, PLAYER_1, 'gold-ring-test-roll')[0].action,
  );

  const offer = afterRoll.pendingResolutions.find(r => r.kind.type === 'ring-play-offer');
  expect(offer).toBeDefined();
  if (offer?.kind.type !== 'ring-play-offer') throw new Error('no ring-play-offer');
  return offer.kind.rollTotal;
}

describe('MEWH §10 — Fallen-wizard gold ring test', () => {
  beforeEach(() => resetMint());

  test('a Fallen-wizard testing a hero gold ring rolls at -1', () => {
    expect(rollTotalFor(Alignment.FallenWizard, PRECIOUS_GOLD_RING, 8)).toBe(7);
  });

  test('a Wizard testing the same hero gold ring is unmodified', () => {
    expect(rollTotalFor(Alignment.Wizard, PRECIOUS_GOLD_RING, 8)).toBe(8);
  });

  test('a Fallen-wizard testing a minion gold ring is unmodified', () => {
    expect(rollTotalFor(Alignment.FallenWizard, A_LITTLE_GOLD_RING, 8)).toBe(8);
  });
});
