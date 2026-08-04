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
  buildTestState, resetMint, viablePlayCharacterActions, findCharInstanceId, dispatch, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, ADRAZAR, KILI, LEGOLAS, ELROND, GLORFINDEL_II,
  RIVENDELL, LORIEN, MINAS_TIRITH,
  RESOURCE_PLAYER,
} from '../../test-helpers.js';
import type { GameState } from '../../../index.js';
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

  test('DI follower joins the controller\'s own company when two companies share a site', () => {
    // Kíli's company and Aragorn's company both stand at Rivendell (as happens
    // after a split-company). Adrazar is played under Aragorn's DI. Regression
    // test: the reducer used to pick "the first company at this site" without
    // checking which company the controller was actually in — with Kíli's
    // company listed first, it planted the follower there instead of in
    // Aragorn's company, leaving it looking like a member of both.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: RIVENDELL, characters: [KILI] },
            { site: RIVENDELL, characters: [ARAGORN] },
          ],
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

    // Force both companies onto the same site instance.
    const sharedSite = state.players[0].companies[0].currentSite!;
    const sharedState: GameState = {
      ...state,
      players: [
        {
          ...state.players[0],
          companies: state.players[0].companies.map(c => ({ ...c, currentSite: sharedSite })),
        },
        state.players[1],
      ],
    };

    const aragornId = findCharInstanceId(sharedState, RESOURCE_PLAYER, ARAGORN);
    const kiliId = findCharInstanceId(sharedState, RESOURCE_PLAYER, KILI);
    const adrInstId = sharedState.players[RESOURCE_PLAYER].hand.find(
      c => c.definitionId === ADRAZAR,
    )!.instanceId;

    const after = dispatch(sharedState, {
      type: 'play-character',
      player: PLAYER_1,
      characterInstanceId: adrInstId,
      atSite: sharedSite.instanceId,
      controlledBy: aragornId,
    });

    const aragornCompany = after.players[0].companies.find(c => c.characters.includes(aragornId))!;
    const kiliCompany = after.players[0].companies.find(c => c.characters.includes(kiliId))!;

    expect(aragornCompany.characters).toContain(adrInstId);
    expect(kiliCompany.characters).not.toContain(adrInstId);
  });

  test('a character may be played under GI even when it would exceed remaining general influence', () => {
    // Aragorn (9) + Elrond (10) already use 19 of the 20-point pool, leaving
    // only 1 remaining GI. Glorfindel II (mind 8) in hand exceeds both that
    // remainder and every in-play character's unused DI (Aragorn 3, Elrond 4).
    // Regression test: the engine used to withhold the GI play entirely in
    // this situation ("mind exceeds remaining general influence ... no
    // character has sufficient direct influence"), but rule 2.II.2.2.1 makes
    // GI play legal "regardless of whether doing so would exceed [the]
    // maximum general influence" — the overflow is only settled at the end
    // of the organization phase (CoE 3.47).
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN, ELROND] }],
          hand: [GLORFINDEL_II],
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

    expect(state.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(19);

    const glorfindelHandId = state.players[RESOURCE_PLAYER].hand.find(
      c => c.definitionId === GLORFINDEL_II,
    )!.instanceId;
    const plays = viablePlayCharacterActions(state, PLAYER_1);
    const glorfindelPlays = plays.filter(a => a.characterInstanceId === glorfindelHandId);

    expect(glorfindelPlays.some(a => a.controlledBy === 'general')).toBe(true);

    const giPlay = glorfindelPlays.find(a => a.controlledBy === 'general')!;
    const after = dispatch(state, giPlay);
    expect(after.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(27);
  });
});
