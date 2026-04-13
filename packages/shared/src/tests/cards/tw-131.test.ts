/**
 * @module tw-131.test
 *
 * Card test: Bilbo (tw-131)
 * Type: hero-character
 * Effects: 3
 *
 * "Unique. Unless he is one of the starting characters, he may only be
 * brought into play at his home site. All of his corruption checks are
 * modified by +4. -2 marshalling points if eliminated."
 *
 * This tests all three effects:
 * 1. check-modifier: +4 to corruption checks (via corruptionModifier base stat)
 * 2. play-restriction: home-site-only (cannot play at havens, only at Bag End)
 * 3. mp-modifier: -2 marshalling points when in eliminated pile
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  pool, PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, BILBO, GIMLI,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  GLAMDRING,
  Phase,
  buildTestState, resetMint,
  findCharInstanceId, viablePlayCharacterActions,
  enqueueTransferCorruptionCheck,
  getCharacter,
} from '../test-helpers.js';
import {
  computeLegalActions, reduce,
  BAG_END,
} from '../../index.js';
import type {
  CharacterCard, CorruptionCheckAction,
  CardInstanceId,
} from '../../index.js';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Bilbo (tw-131)', () => {
  beforeEach(() => resetMint());

  // --- Effect 1: corruption check modifier +4 ---

  test('corruptionModifier base stat is +4', () => {
    const bilboDef = pool[BILBO as string] as CharacterCard;
    expect(bilboDef.corruptionModifier).toBe(4);
  });

  test('+4 corruption modifier decreases need on pending corruption check', () => {
    // Build org phase state with Bilbo holding Glamdring and a pending
    // corruption check (as if Bilbo just transferred an item).
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BAG_END, characters: [{ defId: BILBO, items: [GLAMDRING] }, ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const bilboId = findCharInstanceId(state, 0, BILBO);
    const glamdringInstId = getCharacter(state, 0, BILBO).items[0].instanceId;

    const stateWithCheck = enqueueTransferCorruptionCheck(state, PLAYER_1, bilboId, glamdringInstId);

    const actions = computeLegalActions(stateWithCheck, PLAYER_1);
    const ccActions = actions
      .filter(a => a.viable && a.action.type === 'corruption-check')
      .map(a => a.action as CorruptionCheckAction);

    expect(ccActions.length).toBe(1);
    expect(ccActions[0].characterId).toBe(bilboId);
    // corruptionModifier is +4 (Bilbo's bonus)
    expect(ccActions[0].corruptionModifier).toBe(4);
    // need = CP + 1 - modifier. With modifier +4, need = CP - 3.
    // This makes it much easier for Bilbo to pass corruption checks.
    expect(ccActions[0].need).toBe(ccActions[0].corruptionPoints + 1 - 4);
  });

  // --- Effect 2: play-restriction home-site-only ---

  test('cannot be played at a haven (home-site-only restriction)', () => {
    // Bilbo in hand, company at Rivendell (a haven). Bilbo should NOT be
    // playable there due to home-site-only restriction.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [BILBO],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const playActions = viablePlayCharacterActions(state, PLAYER_1);
    const bilboActions = playActions.filter(
      a => state.players[0].hand.some(
        h => h.instanceId === a.characterInstanceId && h.definitionId === BILBO,
      ),
    );

    // Bilbo should NOT be viable at Rivendell haven
    expect(bilboActions.length).toBe(0);
  });

  test('can be played at home site Bag End (from site deck)', () => {
    // Bilbo in hand, Bag End in site deck. Bilbo should be playable there.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [BILBO],
          siteDeck: [BAG_END, MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const playActions = viablePlayCharacterActions(state, PLAYER_1);
    const bilboActions = playActions.filter(
      a => state.players[0].hand.some(
        h => h.instanceId === a.characterInstanceId && h.definitionId === BILBO,
      ),
    );

    // Bilbo should be viable at Bag End
    expect(bilboActions.length).toBeGreaterThanOrEqual(1);

    // All viable Bilbo actions should target Bag End (from site deck)
    for (const action of bilboActions) {
      const siteInst = state.players[0].siteDeck.find(s => s.instanceId === action.atSite);
      expect(siteInst).toBeDefined();
      expect(siteInst!.definitionId).toBe(BAG_END);
    }
  });

  test('can be played at Bag End when company is already there', () => {
    // A company already at Bag End; Bilbo in hand should be playable.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BAG_END, characters: [ARAGORN] }],
          hand: [BILBO],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const playActions = viablePlayCharacterActions(state, PLAYER_1);
    const bilboActions = playActions.filter(
      a => state.players[0].hand.some(
        h => h.instanceId === a.characterInstanceId && h.definitionId === BILBO,
      ),
    );

    expect(bilboActions.length).toBeGreaterThanOrEqual(1);
  });

  test('other characters without restriction CAN be played at havens', () => {
    // Gimli in hand (no home-site-only restriction) should be playable at Rivendell.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [GIMLI],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const playActions = viablePlayCharacterActions(state, PLAYER_1);
    const gimliActions = playActions.filter(
      a => state.players[0].hand.some(
        h => h.instanceId === a.characterInstanceId && h.definitionId === GIMLI,
      ),
    );

    // Gimli should be viable at Rivendell haven
    expect(gimliActions.length).toBeGreaterThanOrEqual(1);
  });

  // --- Effect 3: mp-modifier -2 on elimination ---

  test('-2 marshalling points when in eliminated pile', () => {
    // Put Bilbo in the eliminated pile and trigger recomputation
    // by dispatching a pass action (the reducer recomputes on every action).
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Manually add Bilbo to eliminated pile
    const bilboInst = { instanceId: 'inst-bilbo-elim' as CardInstanceId, definitionId: BILBO };
    const modifiedPlayer = { ...state.players[0], eliminatedPile: [bilboInst] };
    const modifiedState = {
      ...state,
      players: [modifiedPlayer, state.players[1]] as unknown as typeof state.players,
    };

    // Dispatch a pass action to trigger recomputation of marshalling points
    const result = reduce(modifiedState, { type: 'pass', player: PLAYER_1 });

    // After recomputation:
    // Aragorn in play: 3 character MP
    // Bilbo eliminated: -2 character MP (from mp-modifier effect)
    // Total character MP = 3 + (-2) = 1
    expect(result.state.players[0].marshallingPoints.character).toBe(1);
  });
});
