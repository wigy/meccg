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
  GANDALF, BILBO, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState, findCharInstanceId,
  dispatch, companyIdAt,
  Phase,
} from '../../test-helpers.js';
import { RegionType, SiteType } from '../../../index.js';
import type { CombatState, CardInstanceId, FreeCouncilPhaseState, GameOverPhaseState } from '../../../index.js';

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

    const gandalfId = findCharInstanceId(state, 0, GANDALF);
    const companyId = companyIdAt(state, 0);

    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Shadow],
      resolvedSitePathNames: ['Imlad Morgul'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });

    const combat: CombatState = {
      attackSource: { type: 'automatic-attack', siteInstanceId: 'fake-site' as CardInstanceId, attackIndex: 0 },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 10,
      creatureBody: null,
      creatureRace: 'orc',
      strikeAssignments: [
        { characterId: gandalfId, excessStrikes: 0, resolved: true, result: 'wounded', wasAlreadyWounded: false },
      ],
      currentStrikeIndex: 0,
      phase: 'body-check',
      assignmentPhase: 'done',
      bodyCheckTarget: 'character',
      detainment: false,
    };

    // Gandalf body = 9. Roll 12 > 9 → eliminated.
    const readyState = { ...state, phaseState: mhState, combat, cheatRollTotal: 12 };
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

    const scoreWith = (endedWith.phaseState as GameOverPhaseState).finalScores[PLAYER_1 as string];
    const scoreWithout = (endedWithout.phaseState as GameOverPhaseState).finalScores[PLAYER_1 as string];
    expect(scoreWithout - scoreWith).toBe(5);
  });

  test.todo('Player whose avatar was eliminated cannot reveal another avatar');
});
