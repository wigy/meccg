/**
 * @module rule-5.18-playing-creature
 *
 * CoE Rules — Section 5: Movement/Hazard Phase
 * Rule 5.18: Playing a Creature
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Playing a Creature - As an action during a movement/hazard phase, the hazard player may play a creature targeting the current company. Playing a creature counts as one against the hazard limit, and can only be declared if doing so initiates a new chain of effects (i.e. it cannot be played in response). The creature must be "keyed" as an active condition, meaning that one of the following conditions must be specified by the hazard player when the creature is declared:
 * • The creature is being keyed to a specific region type on the creature's card OR a specific region name where the creature is playable as indicated in the creature's text, which in either case must match a type or name of one of the regions that the company is moving through. If multiple of the same region type appear on the creature card, the company must be moving through at least that many corresponding regions (but which need not be consecutive).
 * • The creature is being keyed to a specific site type on the creature's card OR a specific site name where the creature is playable as indicated in the creature's text, which in either case must match the type or name of the company's new site (i.e. the company's current site if the company is not moving).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch,
  viableActions, nonViableOfType,
  makeWildernessMHState, makeShadowMHState,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  ORC_PATROL, ASSASSIN, EYE_OF_SAURON,
  companyIdAt,
} from '../../test-helpers.js';
import { computeLegalActions, Phase } from '../../../index.js';
import type { MovementHazardPhaseState, PlayHazardAction } from '../../../index.js';

describe('Rule 5.18 — Playing a Creature', () => {
  beforeEach(() => resetMint());

  test('Creature is viable when keying matches the current site path', () => {
    // Orc-patrol (keyed to wilderness/shadow/dark regions and ruins-and-lairs/
    // shadow-hold/dark-hold sites) in a wilderness path to ruins-and-lairs.
    // The engine should offer one viable play-hazard action per matching
    // keying option (region-type:wilderness and site-type:ruins-and-lairs).
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ORC_PATROL], siteDeck: [RIVENDELL] },
      ],
    });

    const gameState = { ...state, phaseState: makeWildernessMHState() };

    const plays = viableActions(gameState, PLAYER_2, 'play-hazard');
    expect(plays.length).toBeGreaterThan(0);

    // Every offered action targets P1's company
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    for (const ea of plays) {
      expect((ea.action as PlayHazardAction).targetCompanyId).toBe(companyId);
    }
  });

  test('Creature is non-viable when no keying matches the current site path', () => {
    // Assassin is keyed only to free-hold and border-hold sites. A company
    // moving through a wilderness region to a ruins-and-lairs destination
    // matches neither — Assassin must be listed as non-viable.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ASSASSIN], siteDeck: [RIVENDELL] },
      ],
    });

    // Wilderness path, ruins-and-lairs destination — Assassin has no match
    const gameState = { ...state, phaseState: makeWildernessMHState() };

    expect(viableActions(gameState, PLAYER_2, 'play-hazard')).toHaveLength(0);

    const allActions = computeLegalActions(gameState, PLAYER_2);
    const nonViable = nonViableOfType(allActions, 'play-hazard');
    expect(nonViable.length).toBeGreaterThan(0);

    const assassinInstId = gameState.players[HAZARD_PLAYER].hand[0].instanceId;
    expect(nonViable.some(ea => (ea.action as PlayHazardAction).cardInstanceId === assassinInstId)).toBe(true);
  });

  test('Playing a creature counts as one against the hazard limit', () => {
    // hazardsPlayedThisCompany starts at 0. After P2 plays Orc-patrol,
    // it must increment to 1.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ORC_PATROL], siteDeck: [RIVENDELL] },
      ],
    });

    const gameState = { ...state, phaseState: makeWildernessMHState({ hazardsPlayedThisCompany: 0, hazardLimitAtReveal: 4 }) };

    expect(gameState.phaseState.hazardsPlayedThisCompany).toBe(0);

    const orcId = gameState.players[HAZARD_PLAYER].hand[0].instanceId;
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const after = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: orcId,
      targetCompanyId: companyId,
      keyedBy: { method: 'region-type', value: 'wilderness' },
    });

    expect((after.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany).toBe(1);
  });

  test('Creature cannot be played in response when a chain of effects is already active', () => {
    // P2 plays Eye of Sauron (a hazard long-event) first, creating an active
    // chain. P1 then passes priority back to P2. While P2 holds priority with
    // the chain still open, no play-hazard actions are offered — the engine
    // switches to chain-only actions (pass-chain-priority, cancel-attack,
    // etc.). Creatures require initiating a new chain and cannot join one.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [EYE_OF_SAURON, ORC_PATROL], siteDeck: [RIVENDELL] },
      ],
    });

    const mhState = makeShadowMHState({ hazardLimitAtReveal: 4, hazardsPlayedThisCompany: 0 });
    const gameState = { ...state, phaseState: mhState };

    // P2 plays Eye of Sauron → chain starts with P1 holding priority
    const eyeId = gameState.players[HAZARD_PLAYER].hand
      .find(c => c.definitionId === EYE_OF_SAURON)!.instanceId;
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const afterEye = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: eyeId,
      targetCompanyId: companyId,
    });
    expect(afterEye.chain).not.toBeNull();

    // P1 passes → P2 now holds priority while chain remains active
    const afterP1Pass = dispatch(afterEye, { type: 'pass-chain-priority', player: PLAYER_1 });
    expect(afterP1Pass.chain).not.toBeNull();
    expect(afterP1Pass.chain!.priority).toBe(PLAYER_2);

    // The engine is now in chain mode: no play-hazard actions surface for P2 —
    // creatures cannot be declared mid-chain
    expect(viableActions(afterP1Pass, PLAYER_2, 'play-hazard')).toHaveLength(0);
    expect(nonViableOfType(computeLegalActions(afterP1Pass, PLAYER_2), 'play-hazard')).toHaveLength(0);
  });
});
