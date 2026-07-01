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
 * Identical rules text to Muster Disperses (tw-67); see tw-067.test.ts for
 * the hero-fixture version. This test exercises the same engine mechanism
 * (`play-target: faction` legal-action emitter + the "dice-check (muster)"
 * pending resolution in `chain-reducer.ts`) with minion fixtures.
 *
 * Tests verify:
 * 1. Playable during M/H when a faction is in play
 * 2. Not playable when no factions are in play
 * 3. One action per in-play faction
 * 4. Faction survives when roll + unused GI >= 11 (high unused GI)
 * 5. Faction discarded when roll + unused GI < 11 (low unused GI)
 * 6. Faction survives when roll + unused GI >= 11 (low unused GI, passing roll)
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

// Minion characters — clean fixtures with no effects of their own.
const ASTERNAK = 'le-1' as CardDefinitionId;             // man, mind 5
const CARAMBOR = 'le-5' as CardDefinitionId;              // man, mind 6, no effects
const LIEUTENANT_OF_ANGMAR = 'le-20' as CardDefinitionId; // man, mind 9, no effects

// Minion sites
const DOL_GULDUR = 'le-367' as CardDefinitionId;   // minion haven
const MINAS_MORGUL = 'le-390' as CardDefinitionId; // minion haven

// Minion factions — used only as inert cardsInPlay targets.
const BALCHOTH = 'le-260' as CardDefinitionId;
const BLACK_TROLLS = 'le-262' as CardDefinitionId;

const factionInPlay: CardInPlay = {
  instanceId: 'faction-balchoth' as CardInstanceId,
  definitionId: BALCHOTH,
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
          companies: [{ site: DOL_GULDUR, characters: [ASTERNAK] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
          cardsInPlay: [factionInPlay],
        },
        {
          id: PLAYER_2,
          companies: [{ site: MINAS_MORGUL, characters: [CARAMBOR] }],
          hand: [MUSTER_DISPERSES],
          siteDeck: [DOL_GULDUR],
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
          companies: [{ site: DOL_GULDUR, characters: [ASTERNAK] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: MINAS_MORGUL, characters: [CARAMBOR] }],
          hand: [MUSTER_DISPERSES],
          siteDeck: [DOL_GULDUR],
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
      instanceId: 'faction-black-trolls' as CardInstanceId,
      definitionId: BLACK_TROLLS,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: DOL_GULDUR, characters: [ASTERNAK] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
          cardsInPlay: [factionInPlay, secondFaction],
        },
        {
          id: PLAYER_2,
          companies: [{ site: MINAS_MORGUL, characters: [CARAMBOR] }],
          hand: [MUSTER_DISPERSES],
          siteDeck: [DOL_GULDUR],
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

  test('faction survives when roll + unused GI >= 11 (high unused GI)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: DOL_GULDUR, characters: [ASTERNAK] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
          cardsInPlay: [factionInPlay],
        },
        {
          id: PLAYER_2,
          companies: [{ site: MINAS_MORGUL, characters: [CARAMBOR] }],
          hand: [MUSTER_DISPERSES],
          siteDeck: [DOL_GULDUR],
        },
      ],
    });

    const mhState = makeWildernessMHState();
    const gameState = { ...state, phaseState: mhState };

    // Asternak mind 5 → GI used = 5, unused GI = 15.
    // Even the minimum roll (2) gives 2 + 15 = 17 >= 11, faction always survives.
    const p1 = gameState.players[0];
    expect(GENERAL_INFLUENCE - p1.generalInfluenceUsed).toBe(15);

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

    // Cheat the roll to 2 (minimum): 2 + 15 = 17 >= 11, faction survives.
    const afterRoll = reduce(
      { ...afterChain, cheatRollTotal: 2 },
      muster,
    );
    expect(afterRoll.error).toBeUndefined();
    expect(afterRoll.state.players[0].cardsInPlay.some(
      c => c.instanceId === factionInPlay.instanceId,
    )).toBe(true);
  });

  test('faction discarded when roll + unused GI < 11 (low unused GI)', () => {
    // Carambor (mind 6) + Lieutenant of Angmar (mind 9) = 15 GI used.
    // Unused GI = 20 - 15 = 5. Need roll + 5 >= 11, so need roll >= 6.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: DOL_GULDUR, characters: [CARAMBOR, LIEUTENANT_OF_ANGMAR] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
          cardsInPlay: [factionInPlay],
        },
        {
          id: PLAYER_2,
          companies: [{ site: MINAS_MORGUL, characters: [ASTERNAK] }],
          hand: [MUSTER_DISPERSES],
          siteDeck: [DOL_GULDUR],
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

    // Cheat the roll to 5 (fail): 5 + 5 = 10 < 11 → faction discarded.
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

  test('faction survives when roll + unused GI >= 11 (low unused GI, passing roll)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: DOL_GULDUR, characters: [CARAMBOR, LIEUTENANT_OF_ANGMAR] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
          cardsInPlay: [factionInPlay],
        },
        {
          id: PLAYER_2,
          companies: [{ site: MINAS_MORGUL, characters: [ASTERNAK] }],
          hand: [MUSTER_DISPERSES],
          siteDeck: [DOL_GULDUR],
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

    // Cheat the roll to 6 (pass): 6 + 5 = 11 >= 11 → faction survives.
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
