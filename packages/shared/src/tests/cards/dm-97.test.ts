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
  handCardId, companyIdAt, resolveChain, phaseStateAs,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  findHandCardId, viableActionsForHandCard,
} from '../test-helpers.js';
import type { PlayerSetup } from '../test-helpers.js';
import { computeLegalActions, Phase, RegionType, Race, SiteType } from '../../index.js';
import type { GameState, MovementHazardPhaseState } from '../../index.js';

// Standard setup for every playability test: resource at Rivendell, hazard
// at Lorien, Tribes alone in the hazard hand.
const TRIBES_ONLY_PLAYERS: [PlayerSetup, PlayerSetup] = [
  { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
  { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [TWO_OR_THREE_TRIBES_PRESENT], siteDeck: [MINAS_TIRITH] },
];

type PathFixture = {
  path: RegionType[];
  destination: SiteType;
};

describe('Two or Three Tribes Present (dm-97)', () => {
  beforeEach(() => resetMint());

  test.each<[string, PathFixture]>([
    ['two wildernesses', { path: [RegionType.Wilderness, RegionType.Wilderness], destination: SiteType.RuinsAndLairs }],
    ['one shadow-land',  { path: [RegionType.Shadow],                             destination: SiteType.ShadowHold   }],
    ['one dark-domain',  { path: [RegionType.Dark],                               destination: SiteType.DarkHold     }],
  ])('playable when the site path has %s', (_label, { path, destination }) => {
    const base = buildTestState({ activePlayer: PLAYER_1, phase: Phase.MovementHazard, players: TRIBES_ONLY_PLAYERS });
    const gameState: GameState = {
      ...base,
      phaseState: makeMHState({ resolvedSitePath: path, destinationSiteType: destination }),
    };

    const tribesActions = viableActionsForHandCard(
      gameState, PLAYER_2, 'play-hazard', HAZARD_PLAYER, TWO_OR_THREE_TRIBES_PRESENT,
    );
    expect(tribesActions.length).toBeGreaterThan(0);
    expect(tribesActions.every(a => 'chosenCreatureRace' in a.action)).toBe(true);
  });

  test.each<[string, PathFixture]>([
    ['only one wilderness',      { path: [RegionType.Wilderness],               destination: SiteType.RuinsAndLairs }],
    ['only free/border regions', { path: [RegionType.Free, RegionType.Border],  destination: SiteType.FreeHold      }],
  ])('not playable when the site path has %s', (_label, { path, destination }) => {
    const base = buildTestState({ activePlayer: PLAYER_1, phase: Phase.MovementHazard, players: TRIBES_ONLY_PLAYERS });
    const gameState: GameState = {
      ...base,
      phaseState: makeMHState({ resolvedSitePath: path, destinationSiteType: destination }),
    };

    const tribesActions = viableActionsForHandCard(
      gameState, PLAYER_2, 'play-hazard', HAZARD_PLAYER, TWO_OR_THREE_TRIBES_PRESENT,
    );
    expect(tribesActions).toHaveLength(0);
  });

  test('excluded races (nazgul, undead, dragon) are not available as choices', () => {
    const base = buildTestState({ activePlayer: PLAYER_1, phase: Phase.MovementHazard, players: TRIBES_ONLY_PLAYERS });
    const gameState: GameState = {
      ...base,
      phaseState: makeMHState({ resolvedSitePath: [RegionType.Shadow], destinationSiteType: SiteType.ShadowHold }),
    };

    const tribesActions = viableActionsForHandCard(
      gameState, PLAYER_2, 'play-hazard', HAZARD_PLAYER, TWO_OR_THREE_TRIBES_PRESENT,
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
    const base = buildTestState({ activePlayer: PLAYER_1, phase: Phase.MovementHazard, players: TRIBES_ONLY_PLAYERS });
    const gameState: GameState = {
      ...base,
      phaseState: makeMHState({ resolvedSitePath: [RegionType.Shadow], destinationSiteType: SiteType.ShadowHold }),
    };

    const cardId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const result = reduce(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cardId,
      targetCompanyId: companyId,
      chosenCreatureRace: Race.Orc,
    });
    expect(result.error).toBeUndefined();

    const afterChain = resolveChain(result.state);
    expect(afterChain.activeConstraints).toHaveLength(1);
    const [constraint] = afterChain.activeConstraints;
    expect(constraint.kind.type).toBe('creature-type-no-hazard-limit');
    if (constraint.kind.type === 'creature-type-no-hazard-limit') {
      expect(constraint.kind.exemptRace).toBe(Race.Orc);
    }
    expect(constraint.target).toEqual({ kind: 'company', companyId });
  });

  test('creatures of the chosen race bypass the hazard limit', () => {
    // Hazard limit 1, 0 played — tribes card takes the last slot. Orc-guard
    // (orc) should remain viable because orcs are exempt.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [TWO_OR_THREE_TRIBES_PRESENT, ORC_GUARD], siteDeck: [RIVENDELL] },
      ],
    });
    const gameState: GameState = {
      ...base,
      phaseState: makeMHState({
        hazardsPlayedThisCompany: 0,
        hazardLimitAtReveal: 1,
        resolvedSitePath: [RegionType.Shadow],
        destinationSiteType: SiteType.ShadowHold,
      }),
    };

    const tribesId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const result = reduce(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: tribesId,
      targetCompanyId: companyId,
      chosenCreatureRace: Race.Orc,
    });
    expect(result.error).toBeUndefined();
    const afterTribes = resolveChain(result.state);

    const orcGuardId = findHandCardId(afterTribes, HAZARD_PLAYER, ORC_GUARD);
    const actions = computeLegalActions(afterTribes, PLAYER_2);
    const orcAction = actions.find(
      a => a.action.type === 'play-hazard' && a.action.cardInstanceId === orcGuardId,
    );
    expect(orcAction).toBeDefined();
    expect(orcAction!.viable).toBe(true);
  });

  test('creatures of a different race still count against the hazard limit', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [TWO_OR_THREE_TRIBES_PRESENT, CAVE_DRAKE], siteDeck: [RIVENDELL] },
      ],
    });
    const gameState: GameState = {
      ...base,
      phaseState: makeMHState({
        hazardsPlayedThisCompany: 0,
        hazardLimitAtReveal: 1,
        resolvedSitePath: [RegionType.Shadow, RegionType.Wilderness],
        destinationSiteType: SiteType.RuinsAndLairs,
      }),
    };

    const tribesId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const result = reduce(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: tribesId,
      targetCompanyId: companyId,
      chosenCreatureRace: Race.Orc,
    });
    expect(result.error).toBeUndefined();
    const afterTribes = resolveChain(result.state);

    // Cave-drake (dragon race) should be blocked — only orcs are exempt.
    const drakeId = findHandCardId(afterTribes, HAZARD_PLAYER, CAVE_DRAKE);
    const actions = computeLegalActions(afterTribes, PLAYER_2);
    const drakeAction = actions.find(
      a => a.action.type === 'play-hazard' && a.action.cardInstanceId === drakeId,
    );
    expect(drakeAction).toBeDefined();
    expect(drakeAction!.viable).toBe(false);
  });

  test('exempt creature does not increment hazard count in reducer', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [TWO_OR_THREE_TRIBES_PRESENT, ORC_GUARD], siteDeck: [RIVENDELL] },
      ],
    });
    const gameState: GameState = {
      ...base,
      phaseState: makeMHState({
        hazardsPlayedThisCompany: 0,
        hazardLimitAtReveal: 2,
        resolvedSitePath: [RegionType.Shadow],
        destinationSiteType: SiteType.ShadowHold,
      }),
    };

    const tribesId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const r1 = reduce(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: tribesId,
      targetCompanyId: companyId,
      chosenCreatureRace: Race.Orc,
    });
    expect(r1.error).toBeUndefined();
    const afterTribes = resolveChain(r1.state);

    // Tribes card itself counted: hazardsPlayedThisCompany should be 1.
    const ps1 = phaseStateAs<MovementHazardPhaseState>(afterTribes);
    expect(ps1.hazardsPlayedThisCompany).toBe(1);

    // Orc-guard (orc, exempt) must NOT increment the count.
    const orcGuardId = findHandCardId(afterTribes, HAZARD_PLAYER, ORC_GUARD);
    const r2 = reduce(afterTribes, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: orcGuardId,
      targetCompanyId: companyId,
      keyedBy: { method: 'region-type', value: RegionType.Shadow },
    });
    expect(r2.error).toBeUndefined();
    const ps2 = phaseStateAs<MovementHazardPhaseState>(r2.state);
    expect(ps2.hazardsPlayedThisCompany).toBe(1);
  });
});
