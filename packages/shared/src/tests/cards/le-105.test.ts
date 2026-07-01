/**
 * @module le-105.test
 *
 * Card test: Call of Home (le-105)
 * Type: hazard-event (short)
 *
 * "Playable on a non-Ringwraith, non-Wizard character not bearing The One
 *  Ring. The character's player makes a roll. The character returns to his
 *  player's hand if the result plus his player's unused general influence
 *  is less than 10. Any one item held by the removed character may
 *  automatically be transferred to another character in his company (all
 *  other non-follower cards he controls are discarded)."
 *
 * Identical rules text to Call of Home (tw-18) — a Neutral hazard reprinted
 * in The Lidless Eye set. Same DSL effects (play-target filter +
 * call-of-home-check), exercised here against minion-side fixtures.
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
  buildTestState, resetMint,
  viableActions, makeMHState,
  P1_COMPANY,
  handCardId, charIdAt, findCharInstanceId, dispatch, RESOURCE_PLAYER, HAZARD_PLAYER,
  expectCharInPlay, expectCharNotInPlay,
} from '../test-helpers.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { Phase } from '../../index.js';
import type { GameState, HazardEventCard, CardDefinitionId, PlayHazardAction, ResolveDiceCheckAction } from '../../index.js';

const LE_CALL_OF_HOME = 'le-105' as CardDefinitionId;
const THE_ONE_RING = 'tw-347' as CardDefinitionId;
const GANDALF = 'tw-156' as CardDefinitionId;

// Minion-side fixtures (LE set)
const GORBAG = 'le-11' as CardDefinitionId;         // orc, mind 6
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;    // orc, mind 5
const ASTERNAK = 'le-1' as CardDefinitionId;        // man, mind 5
const CIRYAHER = 'le-6' as CardDefinitionId;        // dunadan, mind 5
const LAGDUF = 'le-18' as CardDefinitionId;         // orc, mind 3
const ADUNAPHEL = 'le-50' as CardDefinitionId;      // ringwraith avatar
const BLACK_MACE = 'le-299' as CardDefinitionId;    // minion greater item (weapon)

// Minion havens / sites
const DOL_GULDUR = 'le-367' as CardDefinitionId;    // haven
const MINAS_MORGUL = 'le-390' as CardDefinitionId;  // haven
const MORIA_LE = 'le-392' as CardDefinitionId;      // shadow-hold (siteDeck filler)
const CARN_DUM = 'le-359' as CardDefinitionId;      // haven (siteDeck filler)

describe('Call of Home (le-105)', () => {
  beforeEach(() => resetMint());

  test('card definition is a short hazard event with play-target and call-of-home-check effects', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [MORIA_LE] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [LE_CALL_OF_HOME], siteDeck: [CARN_DUM] },
      ],
    });

    const def = state.cardPool[LE_CALL_OF_HOME] as HazardEventCard;
    expect(def).toBeDefined();
    expect(def.cardType).toBe('hazard-event');
    expect(def.eventType).toBe('short');
    expect(def.effects).toHaveLength(2);
    expect(def.effects![0].type).toBe('play-target');
    expect(def.effects![1].type).toBe('call-of-home-check');
  });

  test('playable on a non-wizard, non-ringwraith character during M/H play-hazards', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [MORIA_LE] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [LE_CALL_OF_HOME], siteDeck: [CARN_DUM] },
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
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [GANDALF] }], hand: [], siteDeck: [MORIA_LE] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [LE_CALL_OF_HOME], siteDeck: [CARN_DUM] },
      ],
    });

    const mhState: GameState = { ...state, phaseState: makeMHState() };
    const actions = viableActions(mhState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });

  test('NOT playable on a Ringwraith character (Adûnaphel)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [ADUNAPHEL] }], hand: [], siteDeck: [MORIA_LE] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [LE_CALL_OF_HOME], siteDeck: [CARN_DUM] },
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
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [{ defId: GORBAG, items: [THE_ONE_RING] }] }], hand: [], siteDeck: [MORIA_LE] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [LE_CALL_OF_HOME], siteDeck: [CARN_DUM] },
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
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [GORBAG, ORC_CAPTAIN] }], hand: [], siteDeck: [MORIA_LE] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [LE_CALL_OF_HOME], siteDeck: [CARN_DUM] },
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
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [MORIA_LE] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [LE_CALL_OF_HOME], siteDeck: [CARN_DUM] },
      ],
    });

    const gorbagId = charIdAt(state, RESOURCE_PLAYER);
    const mhState: GameState = { ...state, phaseState: makeMHState() };
    const cohId = handCardId(mhState, HAZARD_PLAYER);

    // Play Call of Home targeting Gorbag
    let s = dispatch(mhState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cohId,
      targetCompanyId: P1_COMPANY,
      targetCharacterId: gorbagId,
    });

    // Resolve chain (both pass)
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_1 });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_2 });

    // Now a pending dice-check (call-of-home) should be queued for PLAYER_1
    expect(s.pendingResolutions).toHaveLength(1);
    expect(s.pendingResolutions[0].kind.type).toBe('dice-check');

    // The pending dice-check targets Gorbag with threshold 10.
    const dc = s.pendingResolutions.find(r => r.kind.type === 'dice-check');
    expect(dc?.kind.type).toBe('dice-check');
    if (dc?.kind.type === 'dice-check') {
      expect(dc.kind.targetCharacterId).toBe(gorbagId);
      expect(dc.kind.threshold).toBe(10);
    }

    // Gorbag mind=6, unused GI = 20 - 6 = 14. Need roll >= 10 - 14 = -4.
    // Any roll passes. Force roll = 2 (minimum).
    s = { ...s, cheatRollTotal: 2 };

    const rollActions = computeLegalActions(s, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'resolve-dice-check');
    expect(rollActions).toHaveLength(1);

    const rollAction = rollActions[0].action as ResolveDiceCheckAction;
    s = dispatch(s, rollAction);

    // Character should still be in play
    expectCharInPlay(s, RESOURCE_PLAYER, gorbagId);
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
          companies: [{ site: DOL_GULDUR, characters: [
            GORBAG,
            CIRYAHER,
            { defId: LAGDUF, items: [BLACK_MACE] },
          ] }],
          hand: [],
          siteDeck: [MORIA_LE],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [ORC_CAPTAIN] }], hand: [LE_CALL_OF_HOME], siteDeck: [CARN_DUM] },
      ],
    });

    // Gorbag (mind 6) + Ciryaher (mind 5) + Lagduf (mind 3) = 14 GI used.
    // Unused GI = 20 - 14 = 6. Need roll >= 10 - 6 = 4.
    const lagdufId = findCharInstanceId(state, RESOURCE_PLAYER, LAGDUF);
    const mhState: GameState = { ...state, phaseState: makeMHState() };
    const cohId = handCardId(mhState, HAZARD_PLAYER);

    // Play Call of Home targeting Lagduf
    let s = dispatch(mhState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cohId,
      targetCompanyId: P1_COMPANY,
      targetCharacterId: lagdufId,
    });

    // Resolve chain
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_1 });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_2 });

    expect(s.pendingResolutions).toHaveLength(1);
    expect(s.pendingResolutions[0].kind.type).toBe('dice-check');

    // Force a low roll (3) so 3 + 6 = 9 < 10 → character returns to hand
    s = { ...s, cheatRollTotal: 3 };

    const rollActions = computeLegalActions(s, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'resolve-dice-check');
    expect(rollActions).toHaveLength(1);

    s = dispatch(s, rollActions[0].action);

    // Character should be back in hand
    expectCharNotInPlay(s, RESOURCE_PLAYER, lagdufId);
    const handDefIds = s.players[0].hand.map(c => c.definitionId);
    expect(handDefIds).toContain(LAGDUF);

    // Item (Black Mace) should be discarded
    const discardDefIds = s.players[0].discardPile.map(c => c.definitionId);
    expect(discardDefIds).toContain(BLACK_MACE);
  });

  test('followers fall to GI when controller returns to hand', () => {
    // Orc Captain (mind 5) + Gorbag (mind 6) + Asternak (mind 5) use 16 GI,
    // leaving 4 unused. Target Asternak (the one with the follower).
    // Need roll >= 10 - 4 = 6. Force roll = 2 → fails.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: DOL_GULDUR, characters: [
            ORC_CAPTAIN,
            GORBAG,
            { defId: ASTERNAK, items: [] },
            { defId: LAGDUF, followerOf: 2 },
          ] }],
          hand: [],
          siteDeck: [MORIA_LE],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [CIRYAHER] }], hand: [LE_CALL_OF_HOME], siteDeck: [CARN_DUM] },
      ],
    });

    // GI used: Orc Captain 5 + Gorbag 6 + Asternak 5 = 16. Lagduf is
    // follower (not under GI). Unused GI = 4. Need roll >= 10 - 4 = 6.
    const asternakId = findCharInstanceId(state, RESOURCE_PLAYER, ASTERNAK);
    const lagdufId = findCharInstanceId(state, RESOURCE_PLAYER, LAGDUF);
    const mhState: GameState = { ...state, phaseState: makeMHState() };
    const cohId = handCardId(mhState, HAZARD_PLAYER);

    let s = dispatch(mhState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cohId,
      targetCompanyId: P1_COMPANY,
      targetCharacterId: asternakId,
    });

    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_1 });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_2 });

    expect(s.pendingResolutions).toHaveLength(1);

    // Force low roll: 2 + 4 = 6 < 10 → fails
    s = { ...s, cheatRollTotal: 2 };
    const rollActions = computeLegalActions(s, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'resolve-dice-check');
    expect(rollActions).toHaveLength(1);

    s = dispatch(s, rollActions[0].action);

    // Asternak should be in hand
    expectCharNotInPlay(s, RESOURCE_PLAYER, asternakId);
    const handDefIds = s.players[0].hand.map(c => c.definitionId);
    expect(handDefIds).toContain(ASTERNAK);

    // Lagduf should have fallen to GI (since Asternak was removed, GI used
    // drops to 11 and Lagduf's mind 3 fits within remaining 9 GI).
    const lagduf = s.players[0].characters[lagdufId];
    expect(lagduf).toBeDefined();
    expect(lagduf.controlledBy).toBe('general');
  });
});
