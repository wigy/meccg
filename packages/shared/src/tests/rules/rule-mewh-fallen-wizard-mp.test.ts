/**
 * MEWH §4 — Fallen-wizard marshalling points.
 *
 * Source: The White Hand Insert, "Using MEWH / Marshalling Points".
 *
 * - "Marshalling points for stage resource cards are handled normally (i.e. as
 *   printed on the card)."
 * - "However, all other marshalling point cards are only worth 1 marshalling
 *   point each to a Fallen-wizard (regardless of their printed value)."
 *
 * Exercised through the real `recomputeDerived` MP tally: the same card scores
 * its printed value for a Wizard but a flat 1 for a Fallen-wizard, while a stage
 * resource scores its printed value for the Fallen-wizard.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Alignment, CardStatus } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, CardInPlay } from '../../index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import {
  buildTestState, resetMint, pool, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  RIVENDELL, MINAS_TIRITH, ARAGORN, RANGERS_OF_ITHILIEN,
} from '../test-helpers.js';

const STAGE_MP = 'test-stage-mp-2' as CardDefinitionId;
// Misty Mountain Wargs (le-272): a leader-control faction whose group bonus
// ("three or more factions controlled by the same leader give 2 extra
// marshalling points") is the fixture for CoE 10.F3 below.
const MISTY_MOUNTAIN_WARGS = 'le-272' as CardDefinitionId;

/** Build an Organization-phase state with `cards` in play for the given alignment. */
function withCards(alignment: Alignment, cards: CardInPlay[]) {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      {
        id: PLAYER_1,
        alignment,
        companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
        cardsInPlay: cards,
      },
      { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return recomputeDerived(state);
}

function inPlay(defId: CardDefinitionId, instanceId: string): CardInPlay {
  return { instanceId: instanceId as CardInstanceId, definitionId: defId, status: CardStatus.Untapped };
}

describe('MEWH §4 — Fallen-wizard marshalling points', () => {
  beforeAll(() => {
    // A stage resource printed with 2 marshalling points.
    (pool as Record<string, unknown>)[STAGE_MP as string] = {
      cardType: 'minion-resource-event',
      alignment: 'stage',
      id: STAGE_MP,
      name: 'Test Stage With MP',
      unique: false,
      eventType: 'permanent',
      marshallingPoints: 2,
      marshallingCategory: 'misc',
      effects: [],
      text: 'Worth 2 marshalling points.',
    };
  });
  afterAll(() => {
    delete (pool as Record<string, unknown>)[STAGE_MP as string];
  });
  beforeEach(() => resetMint());

  test('a 3-MP faction scores its printed value for a Wizard', () => {
    const state = withCards(Alignment.Wizard, [inPlay(RANGERS_OF_ITHILIEN, 'p1-1000')]);
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(3);
  });

  test('the same 3-MP faction is worth only 1 to a Fallen-wizard', () => {
    const state = withCards(Alignment.FallenWizard, [inPlay(RANGERS_OF_ITHILIEN, 'p1-1000')]);
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(1);
  });

  test('each non-stage card counts as 1 for a Fallen-wizard (two factions → 2)', () => {
    const state = withCards(Alignment.FallenWizard, [
      inPlay(RANGERS_OF_ITHILIEN, 'p1-1000'),
      inPlay(RANGERS_OF_ITHILIEN, 'p1-1001'),
    ]);
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(2);
  });

  test('a stage resource scores its printed marshalling points for a Fallen-wizard', () => {
    const state = withCards(Alignment.FallenWizard, [inPlay(STAGE_MP, 'p1-1000')]);
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(2);
  });

  // CoE 10.F3: "A Fallen-wizard player may receive the extra faction
  // marshalling points for a group of faction cards that may be played on a
  // leader, but they receive only one extra faction point for the group of
  // factions instead of two."
  test('a leader-control group bonus is only +1 (not +2) for a Fallen-wizard', () => {
    const leaderId = 'p1-leader' as CardInstanceId;
    const factions: CardInPlay[] = [0, 1, 2].map(i => ({
      instanceId: `mmw-${i}` as CardInstanceId,
      definitionId: MISTY_MOUNTAIN_WARGS,
      status: CardStatus.Untapped,
      controlledBy: leaderId,
    }));
    const state = withCards(Alignment.FallenWizard, factions);
    // 3 factions clamped to 1 MP each (MEWH §4) + reduced group bonus (1) = 4.
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(4);
  });
});
