/**
 * MEWH §1 — Stage points.
 *
 * Source: The White Hand Insert, "Using MEWH / Stage Points".
 *
 * "Certain cards give your Fallen-wizard 'stage points'. ... You must keep
 * track of your accumulated stage points."
 *
 * Stage points are derived by `recomputeDerived` from the `stage-points` effect
 * carried by the Fallen-wizard's in-play stage permanent-events. These tests
 * exercise that derivation through the real recompute path (not by asserting
 * card JSON against itself): synthetic stage permanent-events are registered in
 * the shared pool, placed in play, and the resulting `PlayerState.stagePoints`
 * is asserted.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Phase, Alignment, CardStatus } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, CardInPlay } from '../../index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import {
  buildTestState, resetMint, pool,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  RIVENDELL, MINAS_TIRITH, ARAGORN,
} from '../test-helpers.js';

const STAGE_3 = 'test-stage-3' as CardDefinitionId;
const STAGE_2 = 'test-stage-2' as CardDefinitionId;
const STAGE_MINUS_1 = 'test-stage-minus-1' as CardDefinitionId;

/** A minimal stage permanent-event definition carrying a `stage-points` value. */
function stageDef(id: CardDefinitionId, name: string, value: number): unknown {
  return {
    cardType: 'minion-resource-event',
    alignment: 'stage',
    id,
    name,
    unique: false,
    eventType: 'permanent',
    marshallingPoints: 0,
    marshallingCategory: 'misc',
    effects: [{ type: 'stage-points', value }],
    text: `Gives ${value} stage points.`,
  };
}

/** Build an Organization-phase state for a Fallen-wizard with `cards` in play. */
function fwWith(cards: CardInPlay[], alignment: Alignment = Alignment.FallenWizard) {
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

describe('MEWH §1 — Stage points', () => {
  beforeAll(() => {
    (pool as Record<string, unknown>)[STAGE_3 as string] = stageDef(STAGE_3, 'Test Stage Three', 3);
    (pool as Record<string, unknown>)[STAGE_2 as string] = stageDef(STAGE_2, 'Test Stage Two', 2);
    (pool as Record<string, unknown>)[STAGE_MINUS_1 as string] = stageDef(STAGE_MINUS_1, 'Test Stage Minus One', -1);
  });
  afterAll(() => {
    delete (pool as Record<string, unknown>)[STAGE_3 as string];
    delete (pool as Record<string, unknown>)[STAGE_2 as string];
    delete (pool as Record<string, unknown>)[STAGE_MINUS_1 as string];
  });
  beforeEach(() => resetMint());

  test('a Fallen-wizard with no stage cards has 0 stage points', () => {
    const state = fwWith([]);
    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(0);
  });

  test('a single stage card contributes its printed stage points', () => {
    const state = fwWith([inPlay(STAGE_3, 'p1-1000')]);
    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(3);
  });

  test('multiple stage cards sum their stage points', () => {
    const state = fwWith([inPlay(STAGE_3, 'p1-1000'), inPlay(STAGE_2, 'p1-1001')]);
    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(5);
  });

  test('a negative stage-points effect reduces the running total', () => {
    const state = fwWith([inPlay(STAGE_3, 'p1-1000'), inPlay(STAGE_MINUS_1, 'p1-1001')]);
    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(2);
  });

  test('a non-Fallen-wizard never accrues stage points even with a stage card in play', () => {
    const state = fwWith([inPlay(STAGE_3, 'p1-1000')], Alignment.Wizard);
    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(0);
  });
});
