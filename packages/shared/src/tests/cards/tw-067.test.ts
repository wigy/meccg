/**
 * @module tw-067.test
 *
 * Card test: Muster Disperses (tw-067)
 * Type: hazard-event (short)
 * Effects: 1
 *
 * "Playable on a faction. The faction's player makes a roll. The faction
 *  is discarded if the result plus his unused general influence is less
 *  than 11."
 *
 * Tests verify:
 * 1. Card definition and effects
 * 2. Playable during M/H when a faction is in play
 * 3. Not playable when no factions are in play
 * 4. One action per in-play faction
 * 5. Faction discarded when roll + unused GI < 11
 * 6. Faction stays when roll + unused GI >= 11
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, GIMLI, LEGOLAS,
  RANGERS_OF_THE_NORTH, RIDERS_OF_ROHAN,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeWildernessMHState,
  resolveChain,
  handCardId, companyIdAt, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, reduce, Phase, CardStatus, GENERAL_INFLUENCE } from '../../index.js';
import type { CardInPlay, CardInstanceId, CardDefinitionId, PlayHazardAction, MusterRollAction } from '../../index.js';

const MUSTER_DISPERSES = 'tw-67' as CardDefinitionId;

const factionInPlay: CardInPlay = {
  instanceId: 'faction-rangers' as CardInstanceId,
  definitionId: RANGERS_OF_THE_NORTH,
  status: CardStatus.Untapped,
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Muster Disperses (tw-067)', () => {
  beforeEach(() => resetMint());


  test('playable during M/H when opponent has a faction in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
          cardsInPlay: [factionInPlay],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [MUSTER_DISPERSES],
          siteDeck: [RIVENDELL],
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
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [MUSTER_DISPERSES],
          siteDeck: [RIVENDELL],
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
      instanceId: 'faction-riders' as CardInstanceId,
      definitionId: RIDERS_OF_ROHAN,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
          cardsInPlay: [factionInPlay, secondFaction],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [MUSTER_DISPERSES],
          siteDeck: [RIVENDELL],
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

  test('faction discarded when roll + unused GI < 11', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
          cardsInPlay: [factionInPlay],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [MUSTER_DISPERSES],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const mhState = makeWildernessMHState();
    const gameState = { ...state, phaseState: mhState };

    // Aragorn mind 9 → GI used = 9, unused GI = 11.
    // Roll 2 + 11 = 13 >= 11, faction always survives with just Aragorn.
    const p1 = gameState.players[0];
    expect(GENERAL_INFLUENCE - p1.generalInfluenceUsed).toBe(11);

    // Play the hazard targeting the faction
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

    // Resolve chain — both pass, then the muster-roll pending resolution fires
    const afterChain = resolveChain(result.state);

    // Should now have a muster-roll pending resolution
    const musterActions = computeLegalActions(afterChain, PLAYER_1);
    const rollAction = musterActions.find(
      a => a.viable && a.action.type === 'muster-roll',
    );
    expect(rollAction).toBeDefined();
    const muster = rollAction!.action as MusterRollAction;
    expect(muster.factionInstanceId).toBe(factionInPlay.instanceId);
    // need = 11 - 11 = 0 (easy — any roll succeeds)
    expect(muster.need).toBe(0);

    // Cheat the roll to 2 (minimum): 2 + 11 = 13 >= 11, faction survives
    const afterRoll = reduce(
      { ...afterChain, cheatRollTotal: 2 },
      muster,
    );
    expect(afterRoll.error).toBeUndefined();
    // Faction should still be in play
    expect(afterRoll.state.players[0].cardsInPlay.some(
      c => c.instanceId === factionInPlay.instanceId,
    )).toBe(true);
  });

  test('faction discarded when roll + unused GI < 11 (low GI scenario)', () => {
    // Aragorn (mind 9) + Gimli (mind 6) = 15 GI used
    // Unused GI = 20 - 15 = 5
    // Need roll + 5 >= 11, so need roll >= 6.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN, GIMLI] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
          cardsInPlay: [factionInPlay],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [MUSTER_DISPERSES],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const mhState = makeWildernessMHState();
    const gameState = { ...state, phaseState: mhState };

    const p1 = gameState.players[0];
    expect(GENERAL_INFLUENCE - p1.generalInfluenceUsed).toBe(5);

    // Play the hazard
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
      a => a.viable && a.action.type === 'muster-roll',
    );
    expect(rollAction).toBeDefined();
    const muster = rollAction!.action as MusterRollAction;
    expect(muster.need).toBe(6);

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

  test('faction survives when roll + unused GI >= 11', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN, GIMLI] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
          cardsInPlay: [factionInPlay],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [MUSTER_DISPERSES],
          siteDeck: [RIVENDELL],
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
      a => a.viable && a.action.type === 'muster-roll',
    );
    expect(rollAction).toBeDefined();
    const muster = rollAction!.action as MusterRollAction;

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
