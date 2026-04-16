/**
 * @module dm-97.test
 *
 * Card test: Two or Three Tribes Present (dm-97)
 * Type: hazard-event (short)
 * Effects: 2 (play-condition: site-path, creature-race-choice)
 *
 * "Playable on a company moving with at least two Wildernesses, one
 *  Shadow-land, or one Dark-domain in their site path. When played,
 *  announce a creature type except Nazgûl, Undead, or Dragons (like
 *  Orcs, Men, Slayers, Drakes, etc.). For this turn, any hazard
 *  creatures of this type played against target company do not count
 *  against the hazard limit."
 *
 * Certified: 2026-04-14
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  reduce,
  ARAGORN, LEGOLAS,
  CAVE_DRAKE, ORC_GUARD,
  TWO_OR_THREE_TRIBES_PRESENT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState,
  handCardId, viableActions, resolveChain, phaseStateAs,
} from '../test-helpers.js';
import { computeLegalActions, Phase, RegionType, Race, SiteType } from '../../index.js';
import type { GameState, MovementHazardPhaseState } from '../../index.js';

describe('Two or Three Tribes Present (dm-97)', () => {
  beforeEach(() => resetMint());

  test('playable with two wildernesses in site path', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [TWO_OR_THREE_TRIBES_PRESENT], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
      destinationSiteType: SiteType.RuinsAndLairs,
    });
    const gameState: GameState = { ...state, phaseState: mhState };

    const actions = viableActions(gameState, PLAYER_2, 'play-hazard');
    const tribesActions = actions.filter(a =>
      a.action.type === 'play-hazard' && a.action.cardInstanceId === gameState.players[1].hand[0].instanceId,
    );
    expect(tribesActions.length).toBeGreaterThan(0);
    expect(tribesActions.every(a => 'chosenCreatureRace' in a.action)).toBe(true);
  });

  test('playable with one shadow-land in site path', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [TWO_OR_THREE_TRIBES_PRESENT], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Shadow],
      destinationSiteType: SiteType.ShadowHold,
    });
    const gameState: GameState = { ...state, phaseState: mhState };

    const actions = viableActions(gameState, PLAYER_2, 'play-hazard');
    const tribesActions = actions.filter(a =>
      a.action.type === 'play-hazard' && a.action.cardInstanceId === gameState.players[1].hand[0].instanceId,
    );
    expect(tribesActions.length).toBeGreaterThan(0);
  });

  test('playable with one dark-domain in site path', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [TWO_OR_THREE_TRIBES_PRESENT], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Dark],
      destinationSiteType: SiteType.DarkHold,
    });
    const gameState: GameState = { ...state, phaseState: mhState };

    const actions = viableActions(gameState, PLAYER_2, 'play-hazard');
    const tribesActions = actions.filter(a =>
      a.action.type === 'play-hazard' && a.action.cardInstanceId === gameState.players[1].hand[0].instanceId,
    );
    expect(tribesActions.length).toBeGreaterThan(0);
  });

  test('not playable with only one wilderness in site path', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [TWO_OR_THREE_TRIBES_PRESENT], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      destinationSiteType: SiteType.RuinsAndLairs,
    });
    const gameState: GameState = { ...state, phaseState: mhState };

    const actions = viableActions(gameState, PLAYER_2, 'play-hazard');
    const tribesActions = actions.filter(a =>
      a.action.type === 'play-hazard' && a.action.cardInstanceId === gameState.players[1].hand[0].instanceId,
    );
    expect(tribesActions).toHaveLength(0);
  });

  test('not playable with only free and border regions', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [TWO_OR_THREE_TRIBES_PRESENT], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Free, RegionType.Border],
      destinationSiteType: SiteType.FreeHold,
    });
    const gameState: GameState = { ...state, phaseState: mhState };

    const actions = viableActions(gameState, PLAYER_2, 'play-hazard');
    const tribesActions = actions.filter(a =>
      a.action.type === 'play-hazard' && a.action.cardInstanceId === gameState.players[1].hand[0].instanceId,
    );
    expect(tribesActions).toHaveLength(0);
  });

  test('excluded races (nazgul, undead, dragon) are not available as choices', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [TWO_OR_THREE_TRIBES_PRESENT], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Shadow],
      destinationSiteType: SiteType.ShadowHold,
    });
    const gameState: GameState = { ...state, phaseState: mhState };

    const allActions = computeLegalActions(gameState, PLAYER_2);
    const tribesActions = allActions.filter(a =>
      a.viable && a.action.type === 'play-hazard'
      && a.action.cardInstanceId === gameState.players[1].hand[0].instanceId,
    );
    const chosenRaces = tribesActions.map(a =>
      a.action.type === 'play-hazard' ? a.action.chosenCreatureRace : undefined,
    );
    expect(chosenRaces).not.toContain(Race.Dragon);
    expect(chosenRaces).not.toContain(Race.Undead);
    expect(chosenRaces).not.toContain(Race.Ringwraith);
    expect(chosenRaces).toContain(Race.Orc);
    expect(chosenRaces).toContain(Race.Troll);
    expect(chosenRaces).toContain(Race.Man);
  });

  test('playing the card adds creature-type-no-hazard-limit constraint', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [TWO_OR_THREE_TRIBES_PRESENT], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Shadow],
      destinationSiteType: SiteType.ShadowHold,
    });
    const gameState: GameState = { ...state, phaseState: mhState };

    const cardId = handCardId(gameState, 1);
    const companyId = gameState.players[0].companies[0].id;
    const result = reduce(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cardId,
      targetCompanyId: companyId,
      chosenCreatureRace: Race.Orc,
    });
    expect(result.error).toBeUndefined();

    const afterChain = resolveChain(result.state);
    expect(afterChain.activeConstraints.length).toBe(1);
    const constraint = afterChain.activeConstraints[0];
    expect(constraint.kind.type).toBe('creature-type-no-hazard-limit');
    if (constraint.kind.type === 'creature-type-no-hazard-limit') {
      expect(constraint.kind.exemptRace).toBe(Race.Orc);
    }
    expect(constraint.target).toEqual({ kind: 'company', companyId });
  });

  test('creatures of the chosen race bypass the hazard limit', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [TWO_OR_THREE_TRIBES_PRESENT, ORC_GUARD], siteDeck: [RIVENDELL] },
      ],
    });
    // Hazard limit 1, 0 played so far — tribes card uses the last slot
    const mhState = makeMHState({
      hazardsPlayedThisCompany: 0,
      hazardLimit: 1,
      resolvedSitePath: [RegionType.Shadow],
      destinationSiteType: SiteType.ShadowHold,
    });
    const gameState: GameState = { ...state, phaseState: mhState };

    // Play the tribes card choosing Orc — this uses the 1 hazard slot
    const tribesId = handCardId(gameState, 1, 0);
    const companyId = gameState.players[0].companies[0].id;
    const result = reduce(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: tribesId,
      targetCompanyId: companyId,
      chosenCreatureRace: Race.Orc,
    });
    expect(result.error).toBeUndefined();
    const afterTribes = resolveChain(result.state);

    // Hazard limit reached (1/1) but Orc-guard (orc creature) should still
    // be viable because orcs are exempt from the hazard limit.
    const orcGuardId = afterTribes.players[1].hand.find(
      c => c.definitionId === ORC_GUARD,
    )!.instanceId;
    const actions = computeLegalActions(afterTribes, PLAYER_2);
    const orcAction = actions.find(
      a => a.action.type === 'play-hazard' && a.action.cardInstanceId === orcGuardId,
    );
    expect(orcAction).toBeDefined();
    expect(orcAction!.viable).toBe(true);
  });

  test('creatures of a different race still count against the hazard limit', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [TWO_OR_THREE_TRIBES_PRESENT, CAVE_DRAKE], siteDeck: [RIVENDELL] },
      ],
    });
    // Hazard limit 1, 0 played — tribes card will use the slot
    const mhState = makeMHState({
      hazardsPlayedThisCompany: 0,
      hazardLimit: 1,
      resolvedSitePath: [RegionType.Shadow, RegionType.Wilderness],
      destinationSiteType: SiteType.RuinsAndLairs,
    });
    const gameState: GameState = { ...state, phaseState: mhState };

    // Play tribes card choosing Orc (not drake)
    const tribesId = handCardId(gameState, 1, 0);
    const companyId = gameState.players[0].companies[0].id;
    const result = reduce(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: tribesId,
      targetCompanyId: companyId,
      chosenCreatureRace: Race.Orc,
    });
    expect(result.error).toBeUndefined();
    const afterTribes = resolveChain(result.state);

    // Cave-drake (dragon race) should be blocked by hazard limit since only orcs are exempt
    const drakeId = afterTribes.players[1].hand.find(
      c => c.definitionId === CAVE_DRAKE,
    )!.instanceId;
    const actions = computeLegalActions(afterTribes, PLAYER_2);
    const drakeAction = actions.find(
      a => a.action.type === 'play-hazard' && a.action.cardInstanceId === drakeId,
    );
    expect(drakeAction).toBeDefined();
    expect(drakeAction!.viable).toBe(false);
  });

  test('exempt creature does not increment hazard count in reducer', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [TWO_OR_THREE_TRIBES_PRESENT, ORC_GUARD], siteDeck: [RIVENDELL] },
      ],
    });
    const mhState = makeMHState({
      hazardsPlayedThisCompany: 0,
      hazardLimit: 2,
      resolvedSitePath: [RegionType.Shadow],
      destinationSiteType: SiteType.ShadowHold,
    });
    const gameState: GameState = { ...state, phaseState: mhState };

    // Play tribes card choosing Orc
    const tribesId = handCardId(gameState, 1, 0);
    const companyId = gameState.players[0].companies[0].id;
    const r1 = reduce(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: tribesId,
      targetCompanyId: companyId,
      chosenCreatureRace: Race.Orc,
    });
    expect(r1.error).toBeUndefined();
    const afterTribes = resolveChain(r1.state);

    // Tribes card itself counted: hazardsPlayedThisCompany should be 1
    const ps1 = phaseStateAs<MovementHazardPhaseState>(afterTribes);
    expect(ps1.hazardsPlayedThisCompany).toBe(1);

    // Now play Orc-guard (orc creature, race exempt)
    const orcGuardId = afterTribes.players[1].hand.find(
      c => c.definitionId === ORC_GUARD,
    )!.instanceId;
    const r2 = reduce(afterTribes, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: orcGuardId,
      targetCompanyId: companyId,
      keyedBy: { method: 'region-type', value: RegionType.Shadow },
    });
    expect(r2.error).toBeUndefined();

    // Orc-guard should NOT have incremented hazard count (still 1)
    const ps2 = phaseStateAs<MovementHazardPhaseState>(r2.state);
    expect(ps2.hazardsPlayedThisCompany).toBe(1);
  });
});
