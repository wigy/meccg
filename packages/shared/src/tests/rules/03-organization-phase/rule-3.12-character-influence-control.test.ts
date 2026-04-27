/**
 * @module rule-3.12-character-influence-control
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.12: Character Influence Control
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Whenever a non-avatar character is played, it must be played under general influence or direct influence according to the following restrictions:
 * • To be played under general influence, the character must be played either into a preexisting company or its own new company (but regardless of whether doing so would exceed its player's maximum general influence).
 * • To be played under direct influence, the character must be played into a preexisting company as a follower of a character that is currently being controlled with general influence, and the played character's mind cannot exceed the available direct influence of the other character.
 * The cumulative mind of a player's non-avatar, non-follower characters is subtracted from that player's general influence, while the cumulative mind of a character's followers is subtracted from the direct influence of the controlling character.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, viablePlayCharacterActions, findCharInstanceId, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, ADRAZAR, KILI, LEGOLAS,
  RIVENDELL, LORIEN, MINAS_TIRITH,
  RESOURCE_PLAYER,
} from '../../test-helpers.js';
describe('Rule 3.12 — Character Influence Control', () => {
  beforeEach(() => resetMint());

  test('Character may be played under GI or under DI of a character with sufficient available DI', () => {
    // Aragorn (DI 3) is in play at Rivendell. Adrazar (mind 3) is in hand.
    // The engine must offer both a GI play and a DI play (under Aragorn)
    // because Adrazar's mind (3) ≤ Aragorn's available DI (3).
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [ADRAZAR],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
      recompute: true,
    });

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const adrInstId = state.players[RESOURCE_PLAYER].hand.find(
      c => c.definitionId === ADRAZAR,
    )!.instanceId;
    const plays = viablePlayCharacterActions(state, PLAYER_1);
    const adrPlays = plays.filter(a => a.characterInstanceId === adrInstId);

    // Both GI and DI options must be offered
    expect(adrPlays.some(a => a.controlledBy === 'general')).toBe(true);
    expect(adrPlays.some(a => a.controlledBy === aragornId)).toBe(true);
  });

  test('Follower mind is subtracted from the controlling character\'s available DI', () => {
    // Aragorn (DI 3) already has Adrazar (mind 3) as a follower, leaving
    // available DI = 0. Kíli (mind 3) in hand cannot be placed under
    // Aragorn's DI (0 < 3), so the DI play must not be offered.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN, { defId: ADRAZAR, followerOf: 0 }] }],
          hand: [KILI],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
      recompute: true,
    });

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const kiliInstId = state.players[RESOURCE_PLAYER].hand.find(
      c => c.definitionId === KILI,
    )!.instanceId;
    const plays = viablePlayCharacterActions(state, PLAYER_1);
    const kiliPlays = plays.filter(a => a.characterInstanceId === kiliInstId);

    // DI play under Aragorn must not be offered (DI fully used by Adrazar)
    expect(kiliPlays.some(a => a.controlledBy === aragornId)).toBe(false);
    // GI play is still an option (mind 3 fits within remaining GI)
    expect(kiliPlays.some(a => a.controlledBy === 'general')).toBe(true);
  });
});
