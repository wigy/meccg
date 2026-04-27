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

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MINAS_TIRITH,
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

    const aragornId = base.players[RESOURCE_PLAYER].companies[0].characters[0];

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
    expect(afterSuccess.players[RESOURCE_PLAYER].characters[aragornId as string]).toBeDefined();
    expect(afterSuccess.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === aragornId)).toBe(false);

    // Case 2: roll == CP (5 == 5) → hero fails: character discarded (not eliminated)
    const afterDiscard = dispatch(buildFcState(5), { type: 'pass', player: PLAYER_1 });
    expect(afterDiscard.players[RESOURCE_PLAYER].characters[aragornId as string]).toBeUndefined();
    expect(afterDiscard.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === aragornId)).toBe(true);
    expect(afterDiscard.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === aragornId)).toBe(false);

    // Case 3: roll == CP-1 (4 == 5-1) → hero fails: character discarded
    const afterDiscard2 = dispatch(buildFcState(4), { type: 'pass', player: PLAYER_1 });
    expect(afterDiscard2.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === aragornId)).toBe(true);
    expect(afterDiscard2.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === aragornId)).toBe(false);

    // Case 4: roll <= CP-2 (3 <= 5-2=3) → eliminated: character in outOfPlayPile
    const afterElim = dispatch(buildFcState(3), { type: 'pass', player: PLAYER_1 });
    expect(afterElim.players[RESOURCE_PLAYER].characters[aragornId as string]).toBeUndefined();
    expect(afterElim.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === aragornId)).toBe(true);
    expect(afterElim.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === aragornId)).toBe(false);
  });
});
