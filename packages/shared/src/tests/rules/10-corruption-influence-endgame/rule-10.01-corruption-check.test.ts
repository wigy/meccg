/**
 * @module rule-10.01-corruption-check
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.01: Corruption Check
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * To resolve a corruption check on a character, the character's player makes a roll and applies any modifications. The result of the modified roll is compared to the character's "corruption point total," meaning the sum of corruption points on the cards that the character controls:
 * • If the modified roll is greater than the character's corruption point total, the corruption check succeeds and there is no other effect.
 * • If the modified roll is equal to or one less than the character's corruption point total, the effect depends on the character's alignment. A hero character fails the check and is immediately discarded along with all of its non-follower cards; a Wizard avatar fails the check and is immediately eliminated along with all of its non-follower cards; and a minion character or Fallen-wizard avatar taps and the corruption check is considered successful.
 * • If the modified roll is less than two or lower than the character's corruption point total, the character fails the corruption check, it is immediately eliminated, and all of its non-follower cards are immediately discarded.
 */

import { describe, test, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, LEGOLAS, GANDALF, BILBO,
  RIVENDELL, LORIEN, MINAS_TIRITH,
  charIdAt, findCharInstanceId, expectCharInPlay, expectCharNotInPlay, expectInPile, expectNotInPile,
  expectInDiscardPile, expectNotInDiscardPile,
  enqueueCorruptionCheck,
} from '../../test-helpers.js';
import type { FreeCouncilPhaseState } from '../../../index.js';
import type { CardInstanceId } from '../../../index.js';

describe('Rule 10.01 — Corruption Check', () => {
  beforeEach(() => resetMint());

  test('Roll vs corruption point total: greater = success; equal or -1 = depends on alignment; less than by 2+ = eliminated', () => {
    // Aragorn is a hero character. Corruption points (CP) = 5, modifier = 0.
    // Roll 6: total = 6 > 5 → success (character remains in play).
    // Roll 5: total = 5 = CP → discard (hero fails at equal).
    // Roll 4: total = 4 = CP-1 → discard (hero fails at CP-1).
    // Roll 3: total = 3 = CP-2 → eliminate (less than CP by 2).

    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.FreeCouncil,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const aragornId = charIdAt(base, RESOURCE_PLAYER);

    const pendingCheck = {
      characterId: aragornId,
      corruptionPoints: 5,
      corruptionModifier: 0,
      possessions: [] as CardInstanceId[],
      need: 6,
      explanation: 'CP 5, modifier 0',
      supportCount: 0,
    };

    const fcState: FreeCouncilPhaseState = {
      phase: Phase.FreeCouncil,
      tiebreaker: false,
      step: 'corruption-checks',
      currentPlayer: PLAYER_1,
      checkedCharacters: [],
      firstPlayerDone: false,
      pendingCheck,
    };

    const buildFcState = (roll: number) => ({
      ...base,
      cheatRollTotal: roll,
      phaseState: fcState,
    });

    // Case 1: roll > CP (6 > 5) → success: character still in characters
    const afterSuccess = dispatch(buildFcState(6), { type: 'pass', player: PLAYER_1 });
    expectCharInPlay(afterSuccess, RESOURCE_PLAYER, aragornId);
    expectNotInDiscardPile(afterSuccess, RESOURCE_PLAYER, aragornId);

    // Case 2: roll == CP (5 == 5) → hero fails: character discarded (not eliminated)
    const afterDiscard = dispatch(buildFcState(5), { type: 'pass', player: PLAYER_1 });
    expectCharNotInPlay(afterDiscard, RESOURCE_PLAYER, aragornId);
    expectInDiscardPile(afterDiscard, RESOURCE_PLAYER, aragornId);
    expectNotInPile(afterDiscard, RESOURCE_PLAYER, 'outOfPlayPile', aragornId);

    // Case 3: roll == CP-1 (4 == 5-1) → hero fails: character discarded
    const afterDiscard2 = dispatch(buildFcState(4), { type: 'pass', player: PLAYER_1 });
    expectInDiscardPile(afterDiscard2, RESOURCE_PLAYER, aragornId);
    expectNotInPile(afterDiscard2, RESOURCE_PLAYER, 'outOfPlayPile', aragornId);

    // Case 4: roll <= CP-2 (3 <= 5-2=3) → eliminated: character in outOfPlayPile
    const afterElim = dispatch(buildFcState(3), { type: 'pass', player: PLAYER_1 });
    expectCharNotInPlay(afterElim, RESOURCE_PLAYER, aragornId);
    expectInPile(afterElim, RESOURCE_PLAYER, 'outOfPlayPile', aragornId);
    expectNotInDiscardPile(afterElim, RESOURCE_PLAYER, aragornId);
  });

  test('Wizard avatar failing with roll == CP is eliminated (outOfPlayPile), not discarded — Free Council path', () => {
    // Gandalf is a wizard avatar (mind === null). CP = 5, roll = 5 → total == CP
    // → within 1 of CP → wizard must be eliminated (outOfPlayPile), not discarded.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.FreeCouncil,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF, BILBO] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const gandalfId = findCharInstanceId(base, RESOURCE_PLAYER, GANDALF);

    const pendingCheck = {
      characterId: gandalfId,
      corruptionPoints: 5,
      corruptionModifier: 0,
      possessions: [] as CardInstanceId[],
      need: 6,
      explanation: 'CP 5, modifier 0',
      supportCount: 0,
    };

    const fcState: FreeCouncilPhaseState = {
      phase: Phase.FreeCouncil,
      tiebreaker: false,
      step: 'corruption-checks',
      currentPlayer: PLAYER_1,
      checkedCharacters: [],
      firstPlayerDone: false,
      pendingCheck,
    };

    // Roll 5 → total 5 == CP 5 → within 1 → wizard eliminated, not discarded
    const after = dispatch({ ...base, cheatRollTotal: 5, phaseState: fcState }, { type: 'pass', player: PLAYER_1 });
    expectCharNotInPlay(after, RESOURCE_PLAYER, gandalfId);
    expectInPile(after, RESOURCE_PLAYER, 'outOfPlayPile', gandalfId);
    expectNotInDiscardPile(after, RESOURCE_PLAYER, gandalfId);
  });

  test('Wizard avatar failing with roll == CP is eliminated (outOfPlayPile), not discarded — pending resolution path', () => {
    // Same rule but exercised through the pending-resolution queue (the path
    // used during movement/hazard and other non-Free-Council phases).
    // Gandalf CP = 5, roll = 5 → total == CP → eliminated.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF, BILBO] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const gandalfId = findCharInstanceId(base, RESOURCE_PLAYER, GANDALF);

    const withCheck = enqueueCorruptionCheck(base, PLAYER_1, gandalfId);

    // Roll 5, CP = 5, modifier 0 → total 5 == CP → wizard eliminated
    const after = dispatch({ ...withCheck, cheatRollTotal: 5 }, {
      type: 'corruption-check',
      player: PLAYER_1,
      characterId: gandalfId,
      corruptionPoints: 5,
      corruptionModifier: 0,
      possessions: [],
      need: 6,
      explanation: 'Test',
    });

    expectCharNotInPlay(after, RESOURCE_PLAYER, gandalfId);
    expectInPile(after, RESOURCE_PLAYER, 'outOfPlayPile', gandalfId);
    expectNotInDiscardPile(after, RESOURCE_PLAYER, gandalfId);
  });
});
