/**
 * @module dm-121.test
 *
 * Card test: Crown of Flowers (dm-121)
 * Type: hero-resource-event (permanent)
 * Keyword: environment
 *
 * "Environment. Crown of Flowers has no effect until you play a resource with
 * it. You can play one resource from your hand with this card. The resource is
 * considered to be played and to be in play as though Gates of Morning were in
 * play and Doors of Night were not. Crown of Flowers does not affect the
 * interpretation of any card except the resource played with it. Discard Crown
 * of Flowers when the resource is discarded. Discard the resource if Crown of
 * Flowers is discarded."
 *
 * | # | Effect Type              | Status          | Notes                                 |
 * |---|--------------------------|-----------------|---------------------------------------|
 * | 1 | [play-resource-with]     | NOT IMPLEMENTED | No DSL type for "play resource with   |
 * |   |                          |                 | this card" mechanic                   |
 * | 2 | [gates-of-morning-scope] | NOT IMPLEMENTED | No per-card scoped environment        |
 * |   |                          |                 | override mechanic in DSL or engine    |
 * | 3 | [linked-discard]         | NOT IMPLEMENTED | Bidirectional card-link discard not   |
 * |   |                          |                 | present in DSL or engine              |
 *
 * Playable: NO — core mechanics require new engine capabilities.
 *
 * NOT CERTIFIED — the following rules are not tested due to missing engine
 * support:
 * - Playing a resource from hand simultaneously with this card
 * - Treating the paired resource as if Gates of Morning were in play
 * - Discarding Crown of Flowers when the paired resource is discarded
 * - Discarding the paired resource when Crown of Flowers is discarded
 *
 * Tested rules (partial coverage only):
 * 1. Card is playable as a permanent event during the site phase.
 * 2. After chain resolution, the card appears in the resource player's
 *    cardsInPlay.
 * 3. The "environment" keyword is present: Doors of Night discards Crown of
 *    Flowers when it enters play (Environment keyword interaction).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  LORIEN, MORIA, MINAS_TIRITH, RIVENDELL,
  DOORS_OF_NIGHT,
  buildTestState, buildSitePhaseState, resetMint, resolveChain,
  viableActions, handCardId, addCardInPlay, dispatch, companyIdAt,
  makeMHState,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

const CROWN_OF_FLOWERS = 'dm-121' as CardDefinitionId;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Crown of Flowers (dm-121)', () => {
  beforeEach(() => resetMint());

  test('playable as a permanent event during site phase', () => {
    const state = buildSitePhaseState({
      site: MORIA,
      hand: [CROWN_OF_FLOWERS],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(playActions).toHaveLength(1);
  });

  test('enters cardsInPlay after chain resolves', () => {
    const state = buildSitePhaseState({
      site: MORIA,
      hand: [CROWN_OF_FLOWERS],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(playActions).toHaveLength(1);

    const afterPlay = dispatch(state, playActions[0].action);
    const resolved = resolveChain(afterPlay);

    const cardId = state.players[0].hand[0].instanceId;
    expect(resolved.players[0].cardsInPlay.some(c => c.instanceId === cardId)).toBe(true);
  });

  test('Environment keyword: Doors of Night discards Crown of Flowers', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [DOORS_OF_NIGHT], siteDeck: [RIVENDELL] },
      ],
    });

    const mhState = makeMHState();
    const stateWithMH = { ...base, phaseState: mhState };
    const stateWithCOF = addCardInPlay(stateWithMH, RESOURCE_PLAYER, CROWN_OF_FLOWERS);

    const cofInstanceId = stateWithCOF.players[RESOURCE_PLAYER].cardsInPlay[0].instanceId;
    const donId = handCardId(stateWithCOF, HAZARD_PLAYER);
    const companyId = companyIdAt(stateWithCOF, RESOURCE_PLAYER);

    const afterPlay = dispatch(stateWithCOF, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: donId,
      targetCompanyId: companyId,
    });

    const resolved = resolveChain(afterPlay);

    expect(resolved.players[RESOURCE_PLAYER].cardsInPlay).toHaveLength(0);
    expect(resolved.players[RESOURCE_PLAYER].discardPile.some(
      c => c.instanceId === cofInstanceId,
    )).toBe(true);
  });
});
