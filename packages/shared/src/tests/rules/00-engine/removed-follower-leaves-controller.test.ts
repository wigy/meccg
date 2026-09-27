/**
 * @module removed-follower-leaves-controller.test
 *
 * Regression from random self-play (sim seeds 100011 q vs r, 100001 m vs p,
 * 101008 r vs t): a follower removed from play — by a failed corruption
 * check, eliminated by A Malady Without Healing's body check, or returned to
 * hand by Call of Home — stayed listed in its controller's `followers`. The dangling id kept charging the follower's mind
 * against the controller's direct influence. Every removal path must prune
 * the controller's list, as combat elimination (`pruneLeaderFollowers`) and
 * prisoner-taking already do.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, BILBO, LEGOLAS,
  RIVENDELL, LORIEN,
  findCharInstanceId, enqueueCorruptionCheck,
} from '../../test-helpers.js';
import { eliminateCharacter, returnCharacterToHand } from '../../../engine/pending-reducers.js';
import type { GameState } from '../../../index.js';

/** Aragorn and Bilbo in one company, Bilbo under Aragorn's direct influence. */
function stateWithFollower(): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, BILBO] }], hand: [], siteDeck: [] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
    ],
  });
  const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
  const bilboId = findCharInstanceId(base, RESOURCE_PLAYER, BILBO);
  const p1 = base.players[RESOURCE_PLAYER];
  return {
    ...base,
    players: [
      {
        ...p1,
        characters: {
          ...p1.characters,
          [aragornId]: { ...p1.characters[aragornId], followers: [bilboId] },
          [bilboId]: { ...p1.characters[bilboId], controlledBy: aragornId },
        },
      },
      base.players[1],
    ],
  };
}

describe('a follower removed from play leaves its controller\'s followers list', () => {
  beforeEach(() => resetMint());

  test('failed corruption check', () => {
    const state = stateWithFollower();
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const bilboId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);

    const ready = enqueueCorruptionCheck(state, PLAYER_1, bilboId);
    // Roll 2 vs CP 10 → hard fail: Bilbo is removed from play.
    const after = dispatch({ ...ready, cheatRollTotal: 2 }, {
      type: 'corruption-check',
      player: PLAYER_1,
      characterId: bilboId,
      corruptionPoints: 10,
      corruptionModifier: 0,
      possessions: [],
      need: 11,
      explanation: 'Test',
    });

    const p1 = after.players[RESOURCE_PLAYER];
    expect(p1.characters[bilboId]).toBeUndefined();
    expect(p1.characters[aragornId].followers).toEqual([]);
  });

  test('eliminated by a dice-check body check (eliminateCharacter)', () => {
    const state = stateWithFollower();
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const bilboId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);

    const after = eliminateCharacter(state, RESOURCE_PLAYER, bilboId, state.players[RESOURCE_PLAYER].characters[bilboId]);

    const p1 = after.players[RESOURCE_PLAYER];
    expect(p1.characters[bilboId]).toBeUndefined();
    expect(p1.characters[aragornId].followers).toEqual([]);
  });

  test('returned to hand (Call of Home)', () => {
    const state = stateWithFollower();
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const bilboId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);

    const after = returnCharacterToHand(state, RESOURCE_PLAYER, bilboId, state.players[RESOURCE_PLAYER].characters[bilboId]);

    const p1 = after.players[RESOURCE_PLAYER];
    expect(p1.characters[bilboId]).toBeUndefined();
    expect(p1.hand.some(c => c.instanceId === bilboId)).toBe(true);
    expect(p1.characters[aragornId].followers).toEqual([]);
  });
});
