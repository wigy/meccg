/**
 * @module tw-18.test
 *
 * Card test: Call of Home (tw-18)
 * Type: hazard-event (short)
 *
 * "Playable on a non-Ringwraith, non-Wizard character not bearing The One
 *  Ring. The character's player makes a roll. The character returns to his
 *  player's hand if the result plus his player's unused general influence
 *  is less than 10. Any one item held by the removed character may
 *  automatically be transferred to another character in his company (all
 *  other non-follower cards he controls are discarded)."
 *
 * Engine support:
 * - play-target character filter: non-wizard, non-ringwraith, not bearing
 *   The One Ring
 * - call-of-home-check threshold:10 — roll + unused GI < 10 returns the
 *   character to hand; items/allies/hazards discarded, followers fall to GI
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GANDALF,
  GLAMDRING,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  viableActions, makeMHState,
  P1_COMPANY,
  handCardId, charIdAt, dispatch,
} from '../test-helpers.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { Phase } from '../../index.js';
import type { GameState, HazardEventCard, CardDefinitionId, PlayHazardAction, CallOfHomeRollAction } from '../../index.js';

const CALL_OF_HOME = 'tw-18' as CardDefinitionId;
const THE_ONE_RING = 'tw-347' as CardDefinitionId;

describe('Call of Home (tw-18)', () => {
  beforeEach(() => resetMint());

  test('card definition is a short hazard event with play-target and call-of-home-check effects', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CALL_OF_HOME], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const def = state.cardPool[CALL_OF_HOME as string] as HazardEventCard;
    expect(def).toBeDefined();
    expect(def.cardType).toBe('hazard-event');
    expect(def.eventType).toBe('short');
    expect(def.effects).toHaveLength(2);
    expect(def.effects![0].type).toBe('play-target');
    expect(def.effects![1].type).toBe('call-of-home-check');
  });

  test('playable on a non-wizard character during M/H play-hazards', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CALL_OF_HOME], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhState: GameState = { ...state, phaseState: makeMHState() };
    const actions = viableActions(mhState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(1);

    const playAction = actions[0].action as PlayHazardAction;
    expect(playAction.targetCharacterId).toBeDefined();
  });

  test('NOT playable on a wizard character (Gandalf)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CALL_OF_HOME], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhState: GameState = { ...state, phaseState: makeMHState() };
    const actions = viableActions(mhState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });

  test('NOT playable on a character bearing The One Ring', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [THE_ONE_RING] }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CALL_OF_HOME], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhState: GameState = { ...state, phaseState: makeMHState() };
    const actions = viableActions(mhState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });

  test('generates one action per eligible character in the company', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [CALL_OF_HOME], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhState: GameState = { ...state, phaseState: makeMHState() };
    const actions = viableActions(mhState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(2);
  });

  test('character stays when roll + unused GI >= threshold', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CALL_OF_HOME], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const aragornId = charIdAt(state, 0);
    const mhState: GameState = { ...state, phaseState: makeMHState() };
    const cohId = handCardId(mhState, 1);

    // Play Call of Home targeting Aragorn
    let s = dispatch(mhState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cohId,
      targetCompanyId: P1_COMPANY,
      targetCharacterId: aragornId,
    });

    // Resolve chain (both pass)
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_1 });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_2 });

    // Now a pending call-of-home-roll should be queued for PLAYER_1
    expect(s.pendingResolutions).toHaveLength(1);
    expect(s.pendingResolutions[0].kind.type).toBe('call-of-home-roll');

    // Aragorn mind=6, unused GI = 20 - 6 = 14. Need roll >= 10 - 14 = -4.
    // Any roll passes. Force roll = 2 (minimum).
    s = { ...s, cheatRollTotal: 2 };

    const rollActions = computeLegalActions(s, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'call-of-home-roll');
    expect(rollActions).toHaveLength(1);

    const rollAction = rollActions[0].action as CallOfHomeRollAction;
    expect(rollAction.targetCharacterId).toBe(aragornId);

    s = dispatch(s, rollAction);

    // Character should still be in play
    expect(s.players[0].characters[aragornId as string]).toBeDefined();
    expect(s.players[0].hand.length).toBe(0);
  });

  test('character returns to hand when roll + unused GI < threshold', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [
            ARAGORN,
            LEGOLAS,
            { defId: 'tw-143' as CardDefinitionId, items: [GLAMDRING] },
          ] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CALL_OF_HOME], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // tw-143 = Beretar (mind 2, dunadan)
    // With Aragorn (mind 6) + Legolas (mind 6) + Beretar (mind 2) = 14 GI used.
    // Unused GI = 20 - 14 = 6. Need roll >= 10 - 6 = 4.
    const beretarId = charIdAt(state, 0, 0, 2);
    const mhState: GameState = { ...state, phaseState: makeMHState() };
    const cohId = handCardId(mhState, 1);

    // Play Call of Home targeting Beretar
    let s = dispatch(mhState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cohId,
      targetCompanyId: P1_COMPANY,
      targetCharacterId: beretarId,
    });

    // Resolve chain
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_1 });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_2 });

    expect(s.pendingResolutions).toHaveLength(1);
    expect(s.pendingResolutions[0].kind.type).toBe('call-of-home-roll');

    // Force a low roll (3) so 3 + 6 = 9 < 10 → character returns to hand
    s = { ...s, cheatRollTotal: 3 };

    const rollActions = computeLegalActions(s, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'call-of-home-roll');
    expect(rollActions).toHaveLength(1);

    s = dispatch(s, rollActions[0].action);

    // Character should be back in hand
    expect(s.players[0].characters[beretarId as string]).toBeUndefined();
    const handDefIds = s.players[0].hand.map(c => c.definitionId);
    expect(handDefIds).toContain('tw-143');

    // Item (Glamdring) should be discarded
    const discardDefIds = s.players[0].discardPile.map(c => c.definitionId);
    expect(discardDefIds).toContain(GLAMDRING);
  });

  test('followers fall to GI when controller returns to hand', () => {
    // Use Beorn (tw-131, mind 7) + Gimli (tw-158, mind 6) + Beretar (tw-143, mind 2 follower of Beorn)
    // + Aragorn (tw-120, mind 6) to use 19 GI, leaving 1 unused.
    // Target Beorn (the one with follower). Need roll >= 10 - 1 = 9. Force roll = 2 → fails.
    const BEORN = 'tw-131' as CardDefinitionId;
    const GIMLI = 'tw-158' as CardDefinitionId;
    const BERETAR = 'tw-143' as CardDefinitionId;

    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [
            ARAGORN,
            GIMLI,
            { defId: BEORN, items: [] },
            { defId: BERETAR, followerOf: 2 },
          ] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CALL_OF_HOME], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // GI used: Aragorn 6 + Gimli 6 + Beorn 7 = 19. Beretar is follower (not under GI).
    // Unused GI = 1. Need roll >= 10 - 1 = 9.
    const beornId = charIdAt(state, 0, 0, 2);
    const beretarId = charIdAt(state, 0, 0, 3);
    const mhState: GameState = { ...state, phaseState: makeMHState() };
    const cohId = handCardId(mhState, 1);

    let s = dispatch(mhState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cohId,
      targetCompanyId: P1_COMPANY,
      targetCharacterId: beornId,
    });

    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_1 });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_2 });

    expect(s.pendingResolutions).toHaveLength(1);

    // Force low roll: 2 + 1 = 3 < 10 → fails
    s = { ...s, cheatRollTotal: 2 };
    const rollActions = computeLegalActions(s, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'call-of-home-roll');
    expect(rollActions).toHaveLength(1);

    s = dispatch(s, rollActions[0].action);

    // Beorn should be in hand
    expect(s.players[0].characters[beornId as string]).toBeUndefined();
    const handDefIds = s.players[0].hand.map(c => c.definitionId);
    expect(handDefIds).toContain(BEORN);

    // Beretar should have fallen to GI (since Beorn was removed, GI used
    // drops to 12 and Beretar's mind 2 fits within remaining 8 GI).
    const beretar = s.players[0].characters[beretarId as string];
    expect(beretar).toBeDefined();
    expect(beretar.controlledBy).toBe('general');
  });
});
