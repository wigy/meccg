/**
 * @module tw-180.test
 *
 * Card test: Sam Gamgee (tw-180)
 * Type: hero-character
 * Effects: 2
 *
 * "Unique. Unless he is one of the starting characters, he may only be
 * brought into play at his home site. All of his corruption checks are
 * modified by +3."
 *
 * Tests:
 * 1. check-modifier: +3 to corruption checks (base corruptionModifier)
 * 2. play-restriction: home-site-only (can only be played at Bag End, not havens)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, SAM_GAMGEE, HALDIR,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  GLAMDRING,
  Phase,
  buildTestState, resetMint,
  findCharInstanceId, viablePlayCharacterActions,
  enqueueTransferCorruptionCheck,
  getCharacter, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, BAG_END } from '../../index.js';
import type { CorruptionCheckAction } from '../../index.js';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Sam Gamgee (tw-180)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: check-modifier (corruption +3) ────────────────────────────


  test('+3 corruption modifier lowers need on pending corruption check', () => {
    // Sam holding Glamdring (4 CP) with a pending corruption check.
    // need = CP + 1 - modifier = 4 + 1 - 3 = 2
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BAG_END, characters: [{ defId: SAM_GAMGEE, items: [GLAMDRING] }, LEGOLAS] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const samId = findCharInstanceId(state, RESOURCE_PLAYER, SAM_GAMGEE);
    const glamdringInstId = getCharacter(state, RESOURCE_PLAYER, SAM_GAMGEE).items[0].instanceId;

    const stateWithCheck = enqueueTransferCorruptionCheck(state, PLAYER_1, samId, glamdringInstId);

    const actions = computeLegalActions(stateWithCheck, PLAYER_1);
    const ccActions = actions
      .filter(a => a.viable && a.action.type === 'corruption-check')
      .map(a => a.action as CorruptionCheckAction);

    expect(ccActions.length).toBe(1);
    expect(ccActions[0].characterId).toBe(samId);
    expect(ccActions[0].corruptionModifier).toBe(3);
    // need = CP + 1 - modifier. With modifier +3, need is much lower.
    expect(ccActions[0].need).toBe(ccActions[0].corruptionPoints + 1 - 3);
  });

  // ── Effect 2: play-restriction (home-site-only) ─────────────────────────

  test('can be played at homesite Bag End', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [SAM_GAMGEE],
          siteDeck: [BAG_END, MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viablePlayCharacterActions(state, PLAYER_1);
    // Sam should be playable at Bag End (from site deck)
    const samActions = actions.filter(a => {
      const siteDef = state.cardPool[
        state.players[0].siteDeck.find(c => c.instanceId === a.atSite)?.definitionId as string
      ];
      return siteDef && 'name' in siteDef && siteDef.name === 'Bag End';
    });
    expect(samActions.length).toBeGreaterThanOrEqual(1);
  });

  test('cannot be played at a haven (home-site-only restriction)', () => {
    // Sam is in hand, but only havens are available (no Bag End in site deck)
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [SAM_GAMGEE],
          siteDeck: [RIVENDELL, MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viablePlayCharacterActions(state, PLAYER_1);
    // Sam should NOT be playable — no Bag End available, and havens are blocked
    expect(actions.length).toBe(0);
  });

  test('cannot join a company at a haven', () => {
    // Sam is in hand, a company exists at Lorien (haven), but Sam can't join it
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [HALDIR] }],
          hand: [SAM_GAMGEE],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viablePlayCharacterActions(state, PLAYER_1);
    // Sam should NOT be playable at Lorien (haven)
    expect(actions.length).toBe(0);
  });

  test('can join a company already at Bag End', () => {
    // A company exists at Bag End — Sam should be able to join it
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BAG_END, characters: [HALDIR] }],
          hand: [SAM_GAMGEE],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viablePlayCharacterActions(state, PLAYER_1);
    expect(actions.length).toBeGreaterThanOrEqual(1);
  });
});
