/**
 * @module le-60.test
 *
 * Card test: Arthadan Rangers (le-60)
 * Type: hazard-creature
 * Race: Dúnedain
 * Prowess: 10  Body: 6  Kill-MP: 2*
 *
 * Key rules:
 *   - Each character in the company faces one strike (combat-one-strike-per-character)
 *   - Detainment against covert and hero (Wizard) companies (combat-detainment)
 *   - Keyed to named regions: Arthedain, Rhudaur, Cardolan, Hollin, The Shire
 *     (and, since keying is by region name, at any site in those regions)
 *   - May not be played against a company containing a character with Bree as home site
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI, THEODEN,
  RIVENDELL, LORIEN, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState,
  companyIdAt, dispatch, viableActions,
  playCreatureHazardAndResolve,
  handCardId, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, Phase, SiteType } from '../../index.js';

const ARTHADAN_RANGERS = 'le-60' as import('../../index.js').CardDefinitionId;

// ─── Region-name keying context for Cardolan (one of the keyed regions) ──────

const CARDOLAN_KEYING = { method: 'region-name' as const, value: 'Cardolan' };

const MH_CARDOLAN = {
  resolvedSitePathNames: ['Cardolan'],
  destinationSiteType: SiteType.FreeHold,
  destinationSiteName: 'Tharbad',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Arthadan Rangers (le-60)', () => {
  beforeEach(() => resetMint());

  test('each character in company faces one strike', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          // No Bree-homesite character (Legolas/Gimli/Théoden)
          companies: [{ site: MINAS_TIRITH, characters: [LEGOLAS, GIMLI, THEODEN] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [ARTHADAN_RANGERS],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const gameState = { ...state, phaseState: makeMHState(MH_CARDOLAN) };

    const creatureId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(gameState, PLAYER_2, creatureId, companyId, CARDOLAN_KEYING);

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(3);
  });

  test('combat is detainment against hero (Wizard) company', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MINAS_TIRITH, characters: [LEGOLAS, GIMLI] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [ARTHADAN_RANGERS],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const gameState = { ...state, phaseState: makeMHState(MH_CARDOLAN) };

    const creatureId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(gameState, PLAYER_2, creatureId, companyId, CARDOLAN_KEYING);

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.detainment).toBe(true);
  });

  test('not playable against company containing character with Bree as home site', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          // Aragorn II (tw-120) has Bree as home site
          companies: [{ site: MINAS_TIRITH, characters: [ARAGORN, LEGOLAS] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [ARTHADAN_RANGERS],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const gameState = { ...state, phaseState: makeMHState(MH_CARDOLAN) };

    const hazardActions = computeLegalActions(gameState, PLAYER_2);
    const rangersPlay = hazardActions.filter(
      a => a.action.type === 'play-hazard'
        && 'cardInstanceId' in a.action
        && a.action.cardInstanceId === handCardId(gameState, HAZARD_PLAYER),
    );

    expect(rangersPlay.length).toBeGreaterThan(0);
    expect(rangersPlay.every(a => !a.viable)).toBe(true);
  });

  test('playable against company with no Bree-homesite character', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MINAS_TIRITH, characters: [LEGOLAS, GIMLI] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [ARTHADAN_RANGERS],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const gameState = { ...state, phaseState: makeMHState(MH_CARDOLAN) };

    const hazardActions = computeLegalActions(gameState, PLAYER_2);
    const rangersPlay = hazardActions.filter(
      a => a.action.type === 'play-hazard'
        && 'cardInstanceId' in a.action
        && a.action.cardInstanceId === handCardId(gameState, HAZARD_PLAYER)
        && a.viable,
    );

    expect(rangersPlay.length).toBeGreaterThan(0);
  });

  test('detainment: wounded character is tapped not eliminated', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MINAS_TIRITH, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [ARTHADAN_RANGERS],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const gameState = { ...state, phaseState: makeMHState(MH_CARDOLAN) };

    const creatureId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(gameState, PLAYER_2, creatureId, companyId, CARDOLAN_KEYING);

    expect(afterChain.combat!.detainment).toBe(true);

    // Assign the strike to Legolas
    const assignActions = viableActions(afterChain, PLAYER_1, 'assign-strike');
    expect(assignActions.length).toBeGreaterThan(0);
    let current = dispatch(afterChain, assignActions[0].action);

    // Resolve with a low roll — strike succeeds (prowess 10 vs roll ~2)
    const resolveActions = viableActions({ ...current, cheatRollTotal: 2 }, PLAYER_1, 'resolve-strike');
    expect(resolveActions.length).toBeGreaterThan(0);
    current = dispatch({ ...current, cheatRollTotal: 2 }, resolveActions[0].action);

    // In detainment, no body check is required; combat ends immediately
    expect(current.combat).toBeNull();

    // Legolas should be tapped (detainment result), not wounded/eliminated
    const legolasStatus = Object.values(current.players[RESOURCE_PLAYER].characters)
      .find(c => c.definitionId === LEGOLAS)?.status;
    expect(legolasStatus).toBe('tapped');
  });

  test('not playable when region path does not include a keyed region', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MINAS_TIRITH, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [ARTHADAN_RANGERS],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    // Rohan and Fangorn are not among Arthadan Rangers' keyed regions
    const gameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePathNames: ['Rohan', 'Fangorn'],
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'Fangorn',
      }),
    };

    const hazardActions = computeLegalActions(gameState, PLAYER_2);
    const rangersPlay = hazardActions.filter(
      a => a.action.type === 'play-hazard'
        && 'cardInstanceId' in a.action
        && a.action.cardInstanceId === handCardId(gameState, HAZARD_PLAYER),
    );

    expect(rangersPlay.every(a => !a.viable)).toBe(true);
  });
});
