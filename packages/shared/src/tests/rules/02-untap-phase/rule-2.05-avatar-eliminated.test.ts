/**
 * @module rule-2.05-avatar-eliminated
 *
 * CoE Rules — Section 2: Untap Phase
 * Rule 2.05: Avatar Eliminated
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * If a player's avatar is eliminated during the game (e.g. by failing a body check or corruption check), it is placed in its player's removed-from-play pile and provides -5 miscellaneous marshalling points to that player. A player whose avatar has been eliminated cannot reveal another avatar.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  GANDALF, BILBO, LEGOLAS, SARUMAN,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, findCharInstanceId,
  makeShadowMHState, makeBodyCheckCombat,
  dispatch, companyIdAt, viablePlayCharacterActions,
  phaseStateAs,
  Phase, RESOURCE_PLAYER,
} from '../../test-helpers.js';
import type { CardInstanceId, FreeCouncilPhaseState, GameOverPhaseState } from '../../../index.js';

describe('Rule 2.05 — Avatar Eliminated', () => {
  beforeEach(() => resetMint());

  test('Eliminated avatar is placed in removed-from-play pile', () => {
    // Gandalf (the wizard avatar) fails a body check → must be placed in
    // the outOfPlayPile (the "removed-from-play pile"), not the discard pile.
    // Bilbo is also in the company so it doesn't become empty when Gandalf leaves.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [GANDALF, BILBO] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);

    // Gandalf body = 9. Roll 12 > 9 → eliminated.
    const readyState = {
      ...state,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: gandalfId }),
      cheatRollTotal: 12,
    };
    const nextState = dispatch(readyState, {
      type: 'body-check-roll', player: PLAYER_2, need: 10, explanation: 'test',
    });

    // Gandalf should no longer be in play and must be in the removed-from-play
    // pile (outOfPlayPile), not the discard pile.
    expect(nextState.players[0].characters[gandalfId as string]).toBeUndefined();
    expect(nextState.players[0].outOfPlayPile.some(c => c.instanceId === gandalfId)).toBe(true);
    expect(nextState.players[0].discardPile.some(c => c.instanceId === gandalfId)).toBe(false);
  });

  test('Eliminated avatar provides -5 miscellaneous marshalling points', () => {
    // Compare two otherwise-identical Free Council end states: one where P1's
    // avatar (Gandalf) has been eliminated, one where it hasn't. The final
    // scores should differ by exactly 5 for P1.
    function buildFreeCouncilEnd(avatarEliminated: boolean) {
      const st = buildTestState({
        phase: Phase.FreeCouncil,
        activePlayer: PLAYER_1,
        players: [
          {
            id: PLAYER_1,
            companies: [{ site: RIVENDELL, characters: [BILBO] }],
            hand: [],
            siteDeck: [MINAS_TIRITH],
          },
          {
            id: PLAYER_2,
            companies: [{ site: LORIEN, characters: [LEGOLAS] }],
            hand: [],
            siteDeck: [RIVENDELL],
          },
        ],
      });

      // firstPlayerDone=true so a single pass from the current player
      // triggers final scoring (handleFreeCouncil → computeFinalScoresAndEnd).
      const fcPhase: FreeCouncilPhaseState = {
        phase: Phase.FreeCouncil,
        tiebreaker: false,
        step: 'corruption-checks',
        currentPlayer: PLAYER_1,
        checkedCharacters: [],
        firstPlayerDone: true,
        pendingCheck: null,
      };

      const p0 = {
        ...st.players[0],
        outOfPlayPile: avatarEliminated
          ? [{ instanceId: 'elim-gandalf' as CardInstanceId, definitionId: GANDALF }]
          : [],
      };
      return { ...st, phaseState: fcPhase, players: [p0, st.players[1]] as unknown as typeof st.players };
    }

    const endedWith = dispatch(buildFreeCouncilEnd(true), { type: 'pass', player: PLAYER_1 });
    const endedWithout = dispatch(buildFreeCouncilEnd(false), { type: 'pass', player: PLAYER_1 });

    expect(endedWith.phaseState.phase).toBe(Phase.GameOver);
    expect(endedWithout.phaseState.phase).toBe(Phase.GameOver);

    const scoreWith = phaseStateAs<GameOverPhaseState>(endedWith).finalScores[PLAYER_1 as string];
    const scoreWithout = phaseStateAs<GameOverPhaseState>(endedWithout).finalScores[PLAYER_1 as string];
    expect(scoreWithout - scoreWith).toBe(5);
  });

  test('Player whose avatar was eliminated cannot play another avatar', () => {
    // P1 has had their avatar Gandalf eliminated (in outOfPlayPile). A
    // second wizard card (Saruman) is in hand during the next organization
    // phase. Playing Saruman would amount to revealing a new avatar — the
    // rule forbids this. The engine must not offer a viable play-character
    // action for Saruman.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          // No avatar in play — Gandalf was eliminated (see below).
          companies: [{ site: RIVENDELL, characters: [BILBO] }],
          hand: [SARUMAN],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MORIA],
        },
      ],
      recompute: true,
    });

    // Place eliminated Gandalf into P1's outOfPlayPile so the state
    // reflects "this player's avatar was eliminated".
    const eliminated = {
      ...state,
      players: [
        {
          ...state.players[0],
          outOfPlayPile: [{ instanceId: 'elim-gandalf' as CardInstanceId, definitionId: GANDALF }],
        },
        state.players[1],
      ] as unknown as typeof state.players,
    };

    // Saruman must not be offered as a viable play-character action.
    const viable = viablePlayCharacterActions(eliminated, PLAYER_1);
    const sarumanViable = viable.filter(a => {
      const inst = eliminated.players[0].hand.find(c => c.instanceId === a.characterInstanceId);
      return inst?.definitionId === SARUMAN;
    });
    expect(sarumanViable).toHaveLength(0);
  });
});
