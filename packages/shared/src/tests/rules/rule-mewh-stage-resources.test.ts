/**
 * MEWH §2 — Stage resources (discard during organization).
 *
 * Source: The White Hand Insert, "The Player Turn": "You may discard one of
 * your stage resource cards already in play during your organization phase. You
 * may not discard such a card if it would reduce your stage points below 3."
 *
 * Stage permanent-events are already gated to the organization phase (they are
 * offered by the organization-phase permanent-event action computer). These
 * tests cover the new discard action: it is offered for an in-play stage
 * permanent-event only when the resulting stage-point total stays at 3 or more,
 * and the reducer moves the card to the discard pile.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Alignment, CardStatus } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, CardInPlay, GameState } from '../../index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import {
  buildTestState, resetMint, dispatch, reduce, viableActions, pool, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  RIVENDELL, MINAS_TIRITH, ARAGORN,
} from '../test-helpers.js';

const STAGE_3 = 'test-stage-res-3' as CardDefinitionId;
const STAGE_2 = 'test-stage-res-2' as CardDefinitionId;

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

function inPlay(defId: CardDefinitionId, instanceId: string): CardInPlay {
  return { instanceId: instanceId as CardInstanceId, definitionId: defId, status: CardStatus.Untapped };
}

/** Organization-phase state for a Fallen-wizard with `cards` in play. */
function fwOrg(cards: CardInPlay[]): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.FallenWizard,
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

describe('MEWH §2 — Stage resources discard', () => {
  beforeAll(() => {
    (pool as Record<string, unknown>)[STAGE_3 as string] = stageDef(STAGE_3, 'Test Stage Three', 3);
    (pool as Record<string, unknown>)[STAGE_2 as string] = stageDef(STAGE_2, 'Test Stage Two', 2);
  });
  afterAll(() => {
    delete (pool as Record<string, unknown>)[STAGE_3 as string];
    delete (pool as Record<string, unknown>)[STAGE_2 as string];
  });
  beforeEach(() => resetMint());

  test('discard is offered when the total stays at 3 or more', () => {
    // 3 + 2 = 5 stage points; discarding the 2-point card leaves 3 (allowed).
    const state = fwOrg([inPlay(STAGE_3, 'p1-1000'), inPlay(STAGE_2, 'p1-1001')]);
    const actions = viableActions(state, PLAYER_1, 'discard-stage-resource');
    const targets = actions.map(a => (a.action as { cardInstanceId: string }).cardInstanceId);
    expect(targets).toContain('p1-1001'); // the 2-point card → 5-2=3, allowed
    expect(targets).not.toContain('p1-1000'); // the 3-point card → 5-3=2, not allowed
  });

  test('discard is not offered when it would drop the total below 3', () => {
    // Only a single 3-point card: discarding it would leave 0 (< 3).
    const state = fwOrg([inPlay(STAGE_3, 'p1-1000')]);
    const actions = viableActions(state, PLAYER_1, 'discard-stage-resource');
    expect(actions).toHaveLength(0);
  });

  test('discarding moves the card to the discard pile and lowers the stage total', () => {
    const state = fwOrg([inPlay(STAGE_3, 'p1-1000'), inPlay(STAGE_2, 'p1-1001')]);
    const after = dispatch(state, { type: 'discard-stage-resource', player: PLAYER_1, cardInstanceId: 'p1-1001' as CardInstanceId });

    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === 'p1-1001')).toBe(false);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === 'p1-1001')).toBe(true);
    expect(after.players[RESOURCE_PLAYER].stagePoints).toBe(3);
  });

  test('the reducer rejects a discard that would drop below 3', () => {
    const state = fwOrg([inPlay(STAGE_3, 'p1-1000')]);
    const result = reduce(state, { type: 'discard-stage-resource', player: PLAYER_1, cardInstanceId: 'p1-1000' as CardInstanceId });
    // Rejected with an error → card still in play.
    expect(result.error).toBeDefined();
    expect(result.state.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === 'p1-1000')).toBe(true);
  });

  test('a non-Fallen-wizard is never offered the discard action', () => {
    const state = recomputeDerived(buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [inPlay(STAGE_3, 'p1-1000'), inPlay(STAGE_2, 'p1-1001')] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    }));
    expect(viableActions(state, PLAYER_1, 'discard-stage-resource')).toHaveLength(0);
  });
});
