/**
 * @module td-117.test
 *
 * Card test: Forod (td-117)
 * Type: hero-resource-event (short)
 * Effects: 3
 *   - play-window organization
 *   - play-target character (DSL filter: company.siteRegion $in the 7 Northern regions)
 *   - on-event self-enters-play → set-company-special-movement "named-region-crossing"
 *     (crossingRegions the 7 regions, crossingSitePath 3x wilderness,
 *     crossingHazardLimitDelta -2, crossingHazardLimitFloor 2)
 *
 * "Playable during organization phase on a company moving without region
 *  cards. Company may move from a site of origin in one of the following
 *  regions to a new site in one of the following regions: Lindon, Forochel,
 *  Angmar, Gundabad, Grey Mountain Narrows, Withered Heath, and Iron Hills.
 *  The site path is [{w} {w} {w}] and the hazard limit is decreased by two
 *  to a minimum of two."
 *
 * Same mechanic as Belegaer (td-100), generalized: `named-region-crossing`
 * takes its region list, site-path region types, and hazard-limit delta/floor
 * from the granting card's own effect data instead of hardcoded engine
 * constants — see td-100.test.ts for the coastal-sea sibling.
 *
 * Certified: 2026-09-19
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, Alignment,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI, FARAMIR, EOWYN, CAVE_DRAKE,
  makeMHState,
  handCardId, charIdAt, companyIdAt, dispatch,
  viableActions, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, PlanMovementAction, PlayHazardAction, MovementHazardPhaseState, DeclarePathAction } from '../../index.js';
// GREY_HAVENS/LORIEN must come from index.js directly, not test-helpers.js —
// they are only used internally by the test-helpers-* barrel modules, not
// re-exported by name, so importing them from '../test-helpers.js' silently
// resolves to `undefined` (mirrors td-100.test.ts's own GREY_HAVENS import).
import { RegionType, GREY_HAVENS, LORIEN } from '../../index.js';

const FOROD = 'td-117' as CardDefinitionId;
const IRON_HILL_DWARF_HOLD = 'tw-403' as CardDefinitionId; // Iron Hills
const HUORN = 'tw-45' as CardDefinitionId; // keyed only to wilderness [{w}]
const FELL_TURTLE = 'tw-34' as CardDefinitionId; // keyed only to coastal-sea [{c}]

describe('Forod (td-117)', () => {
  beforeEach(() => resetMint());

  test('playable during organization phase on a company at a site in a listed region (Lindon — Grey Havens)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: GREY_HAVENS, characters: [ARAGORN] }], hand: [FOROD], siteDeck: [IRON_HILL_DWARF_HOLD] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const cardInstance = handCardId(base, RESOURCE_PLAYER);
    const aragornInstance = charIdAt(base, RESOURCE_PLAYER);

    const playActions = viableActions(base, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as { cardInstanceId: string; targetScoutInstanceId?: string; targetCharacterId?: string });
    const forod = playActions.find(a => a.cardInstanceId === cardInstance);
    expect(forod).toBeDefined();
    expect(forod?.targetScoutInstanceId ?? forod?.targetCharacterId).toBe(aragornInstance);
  });

  test('not playable when the company is at a site outside the listed regions', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [FOROD], siteDeck: [IRON_HILL_DWARF_HOLD] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const cardInstance = handCardId(base, RESOURCE_PLAYER);

    const playActions = viableActions(base, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as { cardInstanceId: string });
    expect(playActions.some(a => a.cardInstanceId === cardInstance)).toBe(false);
  });

  test('playing the card grants named-region-crossing special movement to the target company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: GREY_HAVENS, characters: [ARAGORN] }], hand: [FOROD], siteDeck: [IRON_HILL_DWARF_HOLD] },
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

    const company = afterPlay.players[RESOURCE_PLAYER].companies[0];
    expect(company.specialMovement).toBe('named-region-crossing');
    expect(company.crossingRegions).toEqual([
      'Lindon', 'Forochel', 'Angmar', 'Gundabad', 'Grey Mountain Narrows', 'Withered Heath', 'Iron Hills',
    ]);
    expect(company.crossingSitePath).toEqual([RegionType.Wilderness, RegionType.Wilderness, RegionType.Wilderness]);
    expect(company.crossingHazardLimitDelta).toBe(-2);
    expect(company.crossingHazardLimitFloor).toBe(2);
  });

  test('special movement allows plan-movement directly between two listed-region sites, bypassing region adjacency', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: GREY_HAVENS, characters: [ARAGORN] }], hand: [FOROD], siteDeck: [IRON_HILL_DWARF_HOLD, LORIEN] },
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

    // Iron Hill Dwarf-hold (Iron Hills) is on Forod's region list — reachable.
    expect(moveDefIds).toContain(IRON_HILL_DWARF_HOLD);
    // Lórien is not on the list — never offered even though it's in the site deck.
    expect(moveDefIds).not.toContain(LORIEN);
  });

  test('declared path is Special with the site path treated as three wilderness regions, and the hazard limit drops by 2', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: GREY_HAVENS, characters: [ARAGORN, LEGOLAS, GIMLI, FARAMIR, EOWYN] }],
          hand: [FOROD],
          siteDeck: [IRON_HILL_DWARF_HOLD],
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
    expect(finalMh.resolvedSitePath).toEqual([RegionType.Wilderness, RegionType.Wilderness, RegionType.Wilderness]);
    // Company of 5 → base hazard limit 5, minus 2 (Forod) = 3.
    expect(finalMh.hazardLimitAtReveal).toBe(3);
  });

  test('the hazard limit reduction never goes below its floor of 2', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: GREY_HAVENS, characters: [ARAGORN, LEGOLAS] }], hand: [FOROD], siteDeck: [IRON_HILL_DWARF_HOLD] },
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

  test('with the site path treated as wilderness, a wilderness-keyed creature is playable and a coastal-keyed creature is not', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: GREY_HAVENS, characters: [ARAGORN] }], hand: [FOROD], siteDeck: [IRON_HILL_DWARF_HOLD] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [HUORN, FELL_TURTLE, CAVE_DRAKE], siteDeck: [] },
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
      resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness, RegionType.Wilderness],
      resolvedSitePathNames: [],
      destinationSiteType: undefined,
      destinationSiteName: 'Iron Hill Dwarf-hold',
    });
    const stateAtPlayHazards = { ...afterPlay, phaseState: mhState };

    const hazardActions = viableActions(stateAtPlayHazards, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.targetCompanyId === targetCompanyId);
    const playedDefIds = hazardActions.map(a => a.cardInstanceId)
      .map(instId => stateAtPlayHazards.players[1].hand.find(c => c.instanceId === instId)?.definitionId);

    expect(playedDefIds).toContain(HUORN);
    expect(playedDefIds).not.toContain(FELL_TURTLE);
  });
});
