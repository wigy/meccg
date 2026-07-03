/**
 * @module tw-179.test
 *
 * Card test: Robin Smallburrow (tw-179)
 * Type: hero-character
 * Effects: 2
 *
 * "Unique. Unless he is one of the starting characters, he may only be
 * brought into play at his home site. All of his corruption checks are
 * modified by +2."
 *
 * Tests:
 * 1. check-modifier: +2 to corruption checks (check-modifier effect)
 * 2. play-restriction: home-site-only (can only be played at Bag End, not havens)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { CardDefinitionId } from '../../index.js';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, HALDIR,
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

const ROBIN_SMALLBURROW = 'tw-179' as CardDefinitionId;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Robin Smallburrow (tw-179)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: check-modifier (corruption +2) ────────────────────────────

  test('+2 corruption modifier lowers need on pending corruption check', () => {
    // Robin holding Glamdring (4 CP) with a pending corruption check.
    // need = CP + 1 - modifier = 4 + 1 - 2 = 3
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BAG_END, characters: [{ defId: ROBIN_SMALLBURROW, items: [GLAMDRING] }, LEGOLAS] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const robinId = findCharInstanceId(state, RESOURCE_PLAYER, ROBIN_SMALLBURROW);
    const glamdringInstId = getCharacter(state, RESOURCE_PLAYER, ROBIN_SMALLBURROW).items[0].instanceId;

    const stateWithCheck = enqueueTransferCorruptionCheck(state, PLAYER_1, robinId, glamdringInstId);

    const actions = computeLegalActions(stateWithCheck, PLAYER_1);
    const ccActions = actions
      .filter(a => a.viable && a.action.type === 'corruption-check')
      .map(a => a.action as CorruptionCheckAction);

    expect(ccActions.length).toBe(1);
    expect(ccActions[0].characterId).toBe(robinId);
    expect(ccActions[0].corruptionModifier).toBe(2);
    // need = CP + 1 - modifier. With modifier +2, need is lower.
    expect(ccActions[0].need).toBe(ccActions[0].corruptionPoints + 1 - 2);
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
          hand: [ROBIN_SMALLBURROW],
          siteDeck: [BAG_END, MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viablePlayCharacterActions(state, PLAYER_1);
    // Robin should be playable at Bag End (from site deck)
    const robinActions = actions.filter(a => {
      const siteDef = state.cardPool[
        state.players[0].siteDeck.find(c => c.instanceId === a.atSite)?.definitionId as CardDefinitionId
      ];
      return siteDef && 'name' in siteDef && siteDef.name === 'Bag End';
    });
    expect(robinActions.length).toBeGreaterThanOrEqual(1);
  });

  test('cannot be played at a haven (home-site-only restriction)', () => {
    // Robin is in hand, but only havens are available (no Bag End in site deck)
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [ROBIN_SMALLBURROW],
          siteDeck: [RIVENDELL, MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viablePlayCharacterActions(state, PLAYER_1);
    // Robin should NOT be playable — no Bag End available, and havens are blocked
    expect(actions.length).toBe(0);
  });

  test('cannot join a company at a haven', () => {
    // Robin is in hand, a company exists at Lorien (haven), but Robin can't join it
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [HALDIR] }],
          hand: [ROBIN_SMALLBURROW],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viablePlayCharacterActions(state, PLAYER_1);
    // Robin should NOT be playable at Lorien (haven)
    expect(actions.length).toBe(0);
  });

  test('can join a company already at Bag End', () => {
    // A company exists at Bag End — Robin should be able to join it
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BAG_END, characters: [HALDIR] }],
          hand: [ROBIN_SMALLBURROW],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viablePlayCharacterActions(state, PLAYER_1);
    expect(actions.length).toBeGreaterThanOrEqual(1);
  });
});
