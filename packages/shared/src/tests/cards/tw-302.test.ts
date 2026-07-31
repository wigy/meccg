/**
 * @module tw-302.test
 *
 * Card test: Paths of the Dead (tw-302)
 * Type: hero-resource-event (short)
 * Effects: 4
 *   - play-window organization / end-of-org
 *   - play-target character (DSL filter: target.name "Aragorn II" + company.siteName "Dunharrow")
 *   - on-event self-enters-play → set-company-special-movement "paths-of-the-dead"
 *   - on-event self-enters-play → add-constraint only-race-creatures-on-company (race: undead, scope turn)
 *
 * "Playable only at the end of the organization phase on a company containing
 *  Aragorn II at Dunharrow. The company may move to the Vale of Erech site.
 *  The only hazard creatures that may be played on this company are Undead,
 *  but any Undead may be played on the company." (CoE IE 2018 erratum)
 *
 * Certified: 2026-07-31
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, Alignment,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, CAVE_DRAKE,
  LORIEN,
  makeMHState,
  handCardId, charIdAt, companyIdAt, dispatch,
  viableActions, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, PlanMovementAction, PlayHazardAction } from '../../index.js';
import { RegionType, SiteType } from '../../index.js';

const PATHS_OF_THE_DEAD = 'tw-302' as CardDefinitionId;
const DUNHARROW = 'tw-389' as CardDefinitionId;
const VALE_OF_ERECH = 'tw-434' as CardDefinitionId;
const CORPSE_CANDLE = 'tw-23' as CardDefinitionId; // Undead, keyed to wilderness

describe('Paths of the Dead (tw-302)', () => {
  beforeEach(() => resetMint());

  test('playable at the end of the organization phase on a company containing Aragorn II at Dunharrow', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: DUNHARROW, characters: [ARAGORN] }], hand: [PATHS_OF_THE_DEAD], siteDeck: [VALE_OF_ERECH] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const cardInstance = handCardId(base, RESOURCE_PLAYER);
    const aragornInstance = charIdAt(base, RESOURCE_PLAYER);

    const playActions = viableActions(base, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as { cardInstanceId: string; targetScoutInstanceId?: string });
    const paths = playActions.find(a => a.cardInstanceId === cardInstance);
    expect(paths).toBeDefined();
    expect(paths?.targetScoutInstanceId).toBe(aragornInstance);
  });

  test('not playable when Aragorn II is not in the company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: DUNHARROW, characters: [LEGOLAS] }], hand: [PATHS_OF_THE_DEAD], siteDeck: [VALE_OF_ERECH] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [{ defId: ARAGORN }] }], hand: [], siteDeck: [] },
      ],
    });
    const cardInstance = handCardId(base, RESOURCE_PLAYER);

    const playActions = viableActions(base, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as { cardInstanceId: string });
    expect(playActions.some(a => a.cardInstanceId === cardInstance)).toBe(false);
  });

  test('not playable when the company is not at Dunharrow', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [PATHS_OF_THE_DEAD], siteDeck: [VALE_OF_ERECH] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const cardInstance = handCardId(base, RESOURCE_PLAYER);

    const playActions = viableActions(base, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as { cardInstanceId: string });
    expect(playActions.some(a => a.cardInstanceId === cardInstance)).toBe(false);
  });

  test('playing the card grants paths-of-the-dead special movement and adds only-race-creatures-on-company (undead)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: DUNHARROW, characters: [ARAGORN] }], hand: [PATHS_OF_THE_DEAD], siteDeck: [VALE_OF_ERECH] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const cardInstance = handCardId(base, RESOURCE_PLAYER);
    const aragornInstance = charIdAt(base, RESOURCE_PLAYER);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);

    const afterPlay = dispatch(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardInstance,
      targetScoutInstanceId: aragornInstance,
    });

    expect(afterPlay.players[RESOURCE_PLAYER].companies[0].specialMovement).toBe('paths-of-the-dead');

    expect(afterPlay.activeConstraints).toHaveLength(1);
    const constraint = afterPlay.activeConstraints[0];
    expect(constraint.kind.type).toBe('only-race-creatures-on-company');
    expect((constraint.kind as { race: string }).race).toBe('undead');
    expect(constraint.scope.kind).toBe('turn');
    expect(constraint.target).toEqual({ kind: 'company', companyId });
  });

  test('special movement allows plan-movement directly to Vale of Erech (not region-adjacent to Dunharrow)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: DUNHARROW, characters: [ARAGORN] }], hand: [PATHS_OF_THE_DEAD], siteDeck: [VALE_OF_ERECH] },
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
    expect(moveDefIds).toContain(VALE_OF_ERECH);

    const afterMove = dispatch(afterPlay, moveActions[0]);

    // At the movement/hazard phase's reveal-new-site step, the special
    // movement (not ordinary region movement) is used: the path is declared
    // as MovementType.Special with no traversed regions, regardless of
    // whether Dunharrow and Vale of Erech's regions are actually adjacent.
    const revealState = {
      ...afterMove,
      phaseState: makeMHState({ step: 'reveal-new-site', activeCompanyIndex: 0 }),
    };
    const declareActions = viableActions(revealState, PLAYER_1, 'declare-path')
      .map(ea => ea.action as { movementType: string });
    expect(declareActions).toHaveLength(1);
    expect(declareActions[0].movementType).toBe('special');
  });

  test('only-race-creatures-on-company allows Undead creatures but blocks others', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: DUNHARROW, characters: [ARAGORN] }], hand: [PATHS_OF_THE_DEAD], siteDeck: [VALE_OF_ERECH] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CAVE_DRAKE, CORPSE_CANDLE], siteDeck: [] },
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
      resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.BorderHold,
      destinationSiteName: 'Vale of Erech',
    });
    const stateAtPlayHazards = { ...afterPlay, phaseState: mhState };

    const hazardActions = viableActions(stateAtPlayHazards, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.targetCompanyId === targetCompanyId);
    const playedDefIds = hazardActions.map(a => a.cardInstanceId)
      .map(instId => stateAtPlayHazards.players[1].hand.find(c => c.instanceId === instId)?.definitionId);

    expect(playedDefIds).toContain(CORPSE_CANDLE);
    expect(playedDefIds).not.toContain(CAVE_DRAKE);
  });
});
