/**
 * @module td-100.test
 *
 * Card test: Belegaer (td-100)
 * Type: hero-resource-event (short)
 * Effects: 3
 *   - play-window organization
 *   - play-target character (DSL filter: company.siteRegion $in the 13 Belegaer coastal regions)
 *   - on-event self-enters-play → set-company-special-movement "belegaer"
 *
 * "Playable during organization phase on a company moving without region
 *  cards. Company may move from a site of origin in one of the following
 *  regions to a new site in one of the following regions: Lindon, Elven
 *  Shores, Eriadoran Coast, Andrast Coast, Bay of Belfalas, Mouths of the
 *  Anduin, Enedhwaith, Old Pûkel-land, Andrast, Anfalas, Belfalas, Lebennin,
 *  and Harondor. The site path is [{c} {c} {c}] and the hazard limit is
 *  decreased by two to a minimum of two."
 *
 * Certified: 2026-08-22
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, Alignment,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI, FARAMIR, EOWYN, CAVE_DRAKE,
  TOLFALAS, LORIEN,
  makeMHState,
  handCardId, charIdAt, companyIdAt, dispatch,
  viableActions, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, PlanMovementAction, PlayHazardAction, MovementHazardPhaseState, DeclarePathAction } from '../../index.js';
import { RegionType, GREY_HAVENS } from '../../index.js';

const BELEGAER = 'td-100' as CardDefinitionId;
const FELL_TURTLE = 'tw-34' as CardDefinitionId; // keyed only to coastal-sea [{c}]
const HUORN = 'tw-45' as CardDefinitionId; // keyed only to wilderness [{w}]

describe('Belegaer (td-100)', () => {
  beforeEach(() => resetMint());

  test('playable during organization phase on a company at a site in a listed coastal region (Lindon)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: GREY_HAVENS, characters: [ARAGORN] }], hand: [BELEGAER], siteDeck: [TOLFALAS] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const cardInstance = handCardId(base, RESOURCE_PLAYER);
    const aragornInstance = charIdAt(base, RESOURCE_PLAYER);

    const playActions = viableActions(base, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as { cardInstanceId: string; targetScoutInstanceId?: string; targetCharacterId?: string });
    const belegaer = playActions.find(a => a.cardInstanceId === cardInstance);
    expect(belegaer).toBeDefined();
    expect(belegaer?.targetScoutInstanceId ?? belegaer?.targetCharacterId).toBe(aragornInstance);
  });

  test('not playable when the company is at a site outside the listed regions', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [BELEGAER], siteDeck: [TOLFALAS] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const cardInstance = handCardId(base, RESOURCE_PLAYER);

    const playActions = viableActions(base, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as { cardInstanceId: string });
    expect(playActions.some(a => a.cardInstanceId === cardInstance)).toBe(false);
  });

  test('playing the card grants belegaer special movement to the target company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: GREY_HAVENS, characters: [ARAGORN] }], hand: [BELEGAER], siteDeck: [TOLFALAS] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const cardInstance = handCardId(base, RESOURCE_PLAYER);
    const aragornInstance = charIdAt(base, RESOURCE_PLAYER);

    const afterPlay = dispatch(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardInstance,
      targetScoutInstanceId: aragornInstance,
    });

    expect(afterPlay.players[RESOURCE_PLAYER].companies[0].specialMovement).toBe('belegaer');
  });

  test('special movement allows plan-movement directly between two Belegaer-listed sites, bypassing region adjacency', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: GREY_HAVENS, characters: [ARAGORN] }], hand: [BELEGAER], siteDeck: [TOLFALAS, LORIEN] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const cardInstance = handCardId(base, RESOURCE_PLAYER);
    const aragornInstance = charIdAt(base, RESOURCE_PLAYER);

    const afterPlay = dispatch(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardInstance,
      targetScoutInstanceId: aragornInstance,
    });

    const moveActions = viableActions(afterPlay, PLAYER_1, 'plan-movement')
      .map(ea => ea.action as PlanMovementAction);
    const moveDefIds = moveActions
      .map(a => afterPlay.players[RESOURCE_PLAYER].siteDeck.find(c => c.instanceId === a.destinationSite)?.definitionId);

    // Tolfalas (Mouths of the Anduin) is on the Belegaer region list — reachable.
    expect(moveDefIds).toContain(TOLFALAS);
    // Lórien is not on the list — never offered even though it's in the site deck.
    expect(moveDefIds).not.toContain(LORIEN);
  });

  test('declared path is Special with the site path treated as three coastal-sea regions, and the hazard limit drops by 2', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: GREY_HAVENS, characters: [ARAGORN, LEGOLAS, GIMLI, FARAMIR, EOWYN] }],
          hand: [BELEGAER],
          siteDeck: [TOLFALAS],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    const cardInstance = handCardId(base, RESOURCE_PLAYER);
    const aragornInstance = charIdAt(base, RESOURCE_PLAYER);

    const afterPlay = dispatch(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardInstance,
      targetScoutInstanceId: aragornInstance,
    });

    const moveActions = viableActions(afterPlay, PLAYER_1, 'plan-movement')
      .map(ea => ea.action as PlanMovementAction);
    const afterMove = dispatch(afterPlay, moveActions[0]);

    const revealState = {
      ...afterMove,
      phaseState: makeMHState({ step: 'reveal-new-site', activeCompanyIndex: 0 }),
    };
    const declareActions = viableActions(revealState, PLAYER_1, 'declare-path')
      .map(ea => ea.action as DeclarePathAction);
    expect(declareActions).toHaveLength(1);
    expect(declareActions[0].movementType).toBe('special');

    const afterDeclare = dispatch(revealState, declareActions[0]);
    const finalMh = afterDeclare.phaseState as MovementHazardPhaseState;
    expect(finalMh.resolvedSitePath).toEqual([RegionType.Coastal, RegionType.Coastal, RegionType.Coastal]);
    // Company of 5 → base hazard limit 5, minus 2 (Belegaer) = 3.
    expect(finalMh.hazardLimitAtReveal).toBe(3);
  });

  test('the hazard limit reduction never goes below its floor of 2', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: GREY_HAVENS, characters: [ARAGORN, LEGOLAS] }], hand: [BELEGAER], siteDeck: [TOLFALAS] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    const cardInstance = handCardId(base, RESOURCE_PLAYER);
    const aragornInstance = charIdAt(base, RESOURCE_PLAYER);

    const afterPlay = dispatch(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardInstance,
      targetScoutInstanceId: aragornInstance,
    });
    const moveActions = viableActions(afterPlay, PLAYER_1, 'plan-movement')
      .map(ea => ea.action as PlanMovementAction);
    const afterMove = dispatch(afterPlay, moveActions[0]);
    const revealState = {
      ...afterMove,
      phaseState: makeMHState({ step: 'reveal-new-site', activeCompanyIndex: 0 }),
    };
    const declareActions = viableActions(revealState, PLAYER_1, 'declare-path')
      .map(ea => ea.action as DeclarePathAction);

    const afterDeclare = dispatch(revealState, declareActions[0]);
    const finalMh = afterDeclare.phaseState as MovementHazardPhaseState;
    // Company of 2 → base hazard limit 2, minus 2 would be 0, floored to 2.
    expect(finalMh.hazardLimitAtReveal).toBe(2);
  });

  test('with the site path treated as coastal-sea, a coastal-keyed creature is playable and a wilderness-keyed creature is not', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: GREY_HAVENS, characters: [ARAGORN] }], hand: [BELEGAER], siteDeck: [TOLFALAS] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [FELL_TURTLE, HUORN, CAVE_DRAKE], siteDeck: [] },
      ],
    });
    const cardInstance = handCardId(base, RESOURCE_PLAYER);
    const aragornInstance = charIdAt(base, RESOURCE_PLAYER);
    const targetCompanyId = companyIdAt(base, RESOURCE_PLAYER);

    const afterPlay = dispatch(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardInstance,
      targetScoutInstanceId: aragornInstance,
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      movementType: 'special' as MovementHazardPhaseState['movementType'],
      resolvedSitePath: [RegionType.Coastal, RegionType.Coastal, RegionType.Coastal],
      resolvedSitePathNames: [],
      destinationSiteType: undefined,
      destinationSiteName: 'Tolfalas',
    });
    const stateAtPlayHazards = { ...afterPlay, phaseState: mhState };

    const hazardActions = viableActions(stateAtPlayHazards, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.targetCompanyId === targetCompanyId);
    const playedDefIds = hazardActions.map(a => a.cardInstanceId)
      .map(instId => stateAtPlayHazards.players[1].hand.find(c => c.instanceId === instId)?.definitionId);

    expect(playedDefIds).toContain(FELL_TURTLE);
    expect(playedDefIds).not.toContain(HUORN);
  });
});
