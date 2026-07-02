/**
 * @module le-126.test
 *
 * Card test: Muster Disperses (le-126)
 * Type: hazard-event (short)
 * Effects: 1
 *
 * "Playable on a faction. The faction's player makes a roll. The faction
 *  is discarded if the result plus his unused general influence is less
 *  than 11."
 *
 * Identical reprint of Muster Disperses (tw-67), already certified.
 *
 * Fixture alignment: minion-resource-faction target, so tests use minion
 * characters (LE) and minion sites (LE) throughout.
 *
 * Tests verify:
 * 1. Playable during M/H when a faction is in play
 * 2. Not playable when no factions are in play
 * 3. One action per in-play faction
 * 4. Faction discarded when roll + unused GI < 11
 * 5. Faction stays when roll + unused GI >= 11
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  buildTestState, resetMint, makeWildernessMHState,
  resolveChain,
  handCardId, companyIdAt, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, reduce, Phase, CardStatus, GENERAL_INFLUENCE } from '../../index.js';
import type { CardInPlay, CardInstanceId, CardDefinitionId, PlayHazardAction, ResolveDiceCheckAction } from '../../index.js';

const MUSTER_DISPERSES = 'le-126' as CardDefinitionId;

// Minion sites
const MORIA_MINION = 'le-392' as CardDefinitionId;   // shadow-hold
const MINAS_MORGUL = 'le-390' as CardDefinitionId;   // minion haven

// Minion characters
const LIEUTENANT_OF_DOL_GULDUR = 'le-21' as CardDefinitionId; // mind 9
const GORBAG = 'le-11' as CardDefinitionId;                    // mind 6
const TROS_HESNEF = 'le-46' as CardDefinitionId;               // mind 2 (opponent placeholder)

// Minion factions
const GOBLINS_OF_GOBLIN_GATE = 'le-265' as CardDefinitionId;
const ORCS_OF_MORIA = 'le-278' as CardDefinitionId;

const factionInPlay: CardInPlay = {
  instanceId: 'faction-goblins' as CardInstanceId,
  definitionId: GOBLINS_OF_GOBLIN_GATE,
  status: CardStatus.Untapped,
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Muster Disperses (le-126)', () => {
  beforeEach(() => resetMint());

  test('playable during M/H when opponent has a faction in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA_MINION, characters: [LIEUTENANT_OF_DOL_GULDUR] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
          cardsInPlay: [factionInPlay],
        },
        {
          id: PLAYER_2,
          companies: [{ site: MINAS_MORGUL, characters: [TROS_HESNEF] }],
          hand: [MUSTER_DISPERSES],
          siteDeck: [MORIA_MINION],
        },
      ],
    });

    const mhState = makeWildernessMHState();
    const gameState = { ...state, phaseState: mhState };

    const actions = computeLegalActions(gameState, PLAYER_2);
    const playActions = actions.filter(
      a => a.viable && a.action.type === 'play-hazard'
        && (a.action).targetFactionInstanceId != null,
    );
    expect(playActions).toHaveLength(1);
    const action = playActions[0].action as PlayHazardAction;
    expect(action.targetFactionInstanceId).toBe(factionInPlay.instanceId);
  });

  test('not playable when no factions are in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA_MINION, characters: [LIEUTENANT_OF_DOL_GULDUR] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: MINAS_MORGUL, characters: [TROS_HESNEF] }],
          hand: [MUSTER_DISPERSES],
          siteDeck: [MORIA_MINION],
        },
      ],
    });

    const mhState = makeWildernessMHState();
    const gameState = { ...state, phaseState: mhState };

    const actions = computeLegalActions(gameState, PLAYER_2);
    const playActions = actions.filter(
      a => a.action.type === 'play-hazard'
        && (a.action).targetFactionInstanceId != null,
    );
    expect(playActions).toHaveLength(0);
  });

  test('generates one action per in-play faction', () => {
    const secondFaction: CardInPlay = {
      instanceId: 'faction-moria-orcs' as CardInstanceId,
      definitionId: ORCS_OF_MORIA,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA_MINION, characters: [LIEUTENANT_OF_DOL_GULDUR] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
          cardsInPlay: [factionInPlay, secondFaction],
        },
        {
          id: PLAYER_2,
          companies: [{ site: MINAS_MORGUL, characters: [TROS_HESNEF] }],
          hand: [MUSTER_DISPERSES],
          siteDeck: [MORIA_MINION],
        },
      ],
    });

    const mhState = makeWildernessMHState();
    const gameState = { ...state, phaseState: mhState };

    const actions = computeLegalActions(gameState, PLAYER_2);
    const playActions = actions.filter(
      a => a.viable && a.action.type === 'play-hazard'
        && (a.action).targetFactionInstanceId != null,
    );
    expect(playActions).toHaveLength(2);

    const targetIds = playActions.map(a => (a.action as PlayHazardAction).targetFactionInstanceId);
    expect(targetIds).toContain(factionInPlay.instanceId);
    expect(targetIds).toContain(secondFaction.instanceId);
  });

  test('faction survives when roll + unused GI >= 11 (high GI scenario)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA_MINION, characters: [LIEUTENANT_OF_DOL_GULDUR] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
          cardsInPlay: [factionInPlay],
        },
        {
          id: PLAYER_2,
          companies: [{ site: MINAS_MORGUL, characters: [TROS_HESNEF] }],
          hand: [MUSTER_DISPERSES],
          siteDeck: [MORIA_MINION],
        },
      ],
    });

    const mhState = makeWildernessMHState();
    const gameState = { ...state, phaseState: mhState };

    // Lieutenant of Dol Guldur mind 9 → GI used = 9, unused GI = 11.
    // Roll 2 (minimum) + 11 = 13 >= 11, faction always survives alone.
    const p1 = gameState.players[0];
    expect(GENERAL_INFLUENCE - p1.generalInfluenceUsed).toBe(11);

    const hazardId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const result = reduce(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: hazardId,
      targetCompanyId: companyId,
      targetFactionInstanceId: factionInPlay.instanceId,
    });
    expect(result.error).toBeUndefined();

    const afterChain = resolveChain(result.state);

    const musterActions = computeLegalActions(afterChain, PLAYER_1);
    const rollAction = musterActions.find(
      a => a.viable && a.action.type === 'resolve-dice-check',
    );
    expect(rollAction).toBeDefined();
    const muster = rollAction!.action as ResolveDiceCheckAction;
    const dc = afterChain.pendingResolutions.find(r => r.kind.type === 'dice-check');
    expect(dc?.kind.type).toBe('dice-check');
    if (dc?.kind.type === 'dice-check') {
      expect(dc.kind.targetInstanceId).toBe(factionInPlay.instanceId);
      expect(dc.kind.threshold).toBe(11);
    }

    // Cheat the roll to 2 (minimum): 2 + 11 = 13 >= 11, faction survives
    const afterRoll = reduce(
      { ...afterChain, cheatRollTotal: 2 },
      muster,
    );
    expect(afterRoll.error).toBeUndefined();
    expect(afterRoll.state.players[0].cardsInPlay.some(
      c => c.instanceId === factionInPlay.instanceId,
    )).toBe(true);
  });

  test('faction discarded when roll + unused GI < 11 (low GI scenario)', () => {
    // Lieutenant of Dol Guldur (mind 9) + Gorbag (mind 6) = 15 GI used
    // Unused GI = 20 - 15 = 5
    // Need roll + 5 >= 11, so need roll >= 6.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA_MINION, characters: [LIEUTENANT_OF_DOL_GULDUR, GORBAG] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
          cardsInPlay: [factionInPlay],
        },
        {
          id: PLAYER_2,
          companies: [{ site: MINAS_MORGUL, characters: [TROS_HESNEF] }],
          hand: [MUSTER_DISPERSES],
          siteDeck: [MORIA_MINION],
        },
      ],
    });

    const mhState = makeWildernessMHState();
    const gameState = { ...state, phaseState: mhState };

    const p1 = gameState.players[0];
    expect(GENERAL_INFLUENCE - p1.generalInfluenceUsed).toBe(5);

    const hazardId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const result = reduce(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: hazardId,
      targetCompanyId: companyId,
      targetFactionInstanceId: factionInPlay.instanceId,
    });
    expect(result.error).toBeUndefined();

    const afterChain = resolveChain(result.state);

    const musterActions = computeLegalActions(afterChain, PLAYER_1);
    const rollAction = musterActions.find(
      a => a.viable && a.action.type === 'resolve-dice-check',
    );
    expect(rollAction).toBeDefined();
    const muster = rollAction!.action as ResolveDiceCheckAction;

    // Cheat the roll to 5 (fail): 5 + 5 = 10 < 11 → faction discarded
    const afterFail = reduce(
      { ...afterChain, cheatRollTotal: 5 },
      muster,
    );
    expect(afterFail.error).toBeUndefined();
    expect(afterFail.state.players[0].cardsInPlay.some(
      c => c.instanceId === factionInPlay.instanceId,
    )).toBe(false);
    expect(afterFail.state.players[0].discardPile.some(
      c => c.instanceId === factionInPlay.instanceId,
    )).toBe(true);
  });

  test('faction survives when roll + unused GI >= 11 (low GI scenario, high roll)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA_MINION, characters: [LIEUTENANT_OF_DOL_GULDUR, GORBAG] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
          cardsInPlay: [factionInPlay],
        },
        {
          id: PLAYER_2,
          companies: [{ site: MINAS_MORGUL, characters: [TROS_HESNEF] }],
          hand: [MUSTER_DISPERSES],
          siteDeck: [MORIA_MINION],
        },
      ],
    });

    const mhState = makeWildernessMHState();
    const gameState = { ...state, phaseState: mhState };

    const hazardId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const result = reduce(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: hazardId,
      targetCompanyId: companyId,
      targetFactionInstanceId: factionInPlay.instanceId,
    });
    expect(result.error).toBeUndefined();

    const afterChain = resolveChain(result.state);

    const musterActions = computeLegalActions(afterChain, PLAYER_1);
    const rollAction = musterActions.find(
      a => a.viable && a.action.type === 'resolve-dice-check',
    );
    expect(rollAction).toBeDefined();
    const muster = rollAction!.action as ResolveDiceCheckAction;

    // Cheat the roll to 6 (pass): 6 + 5 = 11 >= 11 → faction survives
    const afterPass = reduce(
      { ...afterChain, cheatRollTotal: 6 },
      muster,
    );
    expect(afterPass.error).toBeUndefined();
    expect(afterPass.state.players[0].cardsInPlay.some(
      c => c.instanceId === factionInPlay.instanceId,
    )).toBe(true);
  });
});
