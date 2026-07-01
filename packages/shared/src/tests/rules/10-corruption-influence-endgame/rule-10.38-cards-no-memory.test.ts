/**
 * @module rule-10.38-cards-no-memory
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.38: Cards Have No Memory
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Cards do not have "memory" once they leave play; cards in the discard pile don't "remember" how they were played.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Phase } from '../../../index.js';
import type { CardDefinitionId, GameState } from '../../../index.js';
import {
  buildTestState, resetMint, makeMHState,
  viableActions, dispatch, resolveChain,
  handCardId, findCharInstanceId,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, GIMLI, MORIA, LORIEN, MINAS_TIRITH, RIVENDELL,
} from '../../test-helpers.js';

// Weariness of the Heart (le-149): two structurally different play paths
// (option "prowess" targeting Aragorn vs. option "corruption" targeting
// Gimli) — if the resulting discard-pile entries are identical apart from
// their instance ID, the card genuinely "remembers" nothing about how it
// was played.
const WEARINESS_OF_THE_HEART = 'le-149' as CardDefinitionId;

function playWeariness(optionId: 'prowess' | 'corruption', targetDefId: CardDefinitionId): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN, GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [WEARINESS_OF_THE_HEART], siteDeck: [RIVENDELL] },
    ],
  });
  const state = { ...base, phaseState: makeMHState() };
  const targetId = findCharInstanceId(state, RESOURCE_PLAYER, targetDefId);
  const cardId = handCardId(state, HAZARD_PLAYER);
  const companyId = state.players[RESOURCE_PLAYER].companies[0].id;

  const afterPlay = dispatch(state, {
    type: 'play-hazard',
    player: PLAYER_2,
    cardInstanceId: cardId,
    targetCompanyId: companyId,
    targetCharacterId: targetId,
    optionId,
  } as never);
  return resolveChain(afterPlay);
}

describe('Rule 10.38 — Cards Have No Memory', () => {
  beforeEach(() => resetMint());

  test('discarded copies of the same card carry no trace of how each was played', () => {
    const viaProwess = playWeariness('prowess', ARAGORN);
    const viaCorruption = playWeariness('corruption', GIMLI);

    const prowessCard = viaProwess.players[HAZARD_PLAYER].discardPile
      .find(c => c.definitionId === WEARINESS_OF_THE_HEART);
    const corruptionCard = viaCorruption.players[HAZARD_PLAYER].discardPile
      .find(c => c.definitionId === WEARINESS_OF_THE_HEART);
    expect(prowessCard).toBeDefined();
    expect(corruptionCard).toBeDefined();

    // Same shape regardless of which option/target it was played with —
    // only the (irrelevant) instance ID differs.
    expect(Object.keys(prowessCard!).sort()).toEqual(Object.keys(corruptionCard!).sort());
    expect({ ...prowessCard, instanceId: undefined }).toEqual({ ...corruptionCard, instanceId: undefined });
  });

  test('viable actions for a fresh copy of the card never depend on a previous play', () => {
    // A pass-through control: playing the card once and looking at a
    // *different, freshly-dealt* copy afterward offers the exact same two
    // options as if the card had never been played before.
    const state = playWeariness('prowess', ARAGORN);
    const freshHand = {
      ...state,
      players: state.players.map((p, i) => i === HAZARD_PLAYER
        ? { ...p, hand: [...p.hand, { instanceId: 'fresh-copy' as never, definitionId: WEARINESS_OF_THE_HEART }] }
        : p) as unknown as typeof state.players,
    };
    const gimliId = findCharInstanceId(freshHand, RESOURCE_PLAYER, GIMLI);
    const actions = viableActions(freshHand, PLAYER_2, 'play-hazard')
      .map(a => (a.action as { targetCharacterId?: unknown; optionId?: string; cardInstanceId?: unknown }))
      .filter(a => a.cardInstanceId === 'fresh-copy' && a.targetCharacterId === gimliId);
    expect(actions.map(a => a.optionId).sort()).toEqual(['corruption', 'prowess']);
  });
});
