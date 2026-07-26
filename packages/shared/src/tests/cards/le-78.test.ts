/**
 * @module le-78.test
 *
 * Card test: Horse-lords (le-78)
 * Type: hazard-creature
 * Race: Men
 * Prowess: 10  Body: 6  Kill-MP: 2*
 *
 * Key rules:
 *   - Each character in the company faces one strike (combat-one-strike-per-character)
 *   - Detainment against covert and hero (Wizard) companies
 *   - Keyed to named regions: Rohan, Wold & Foothills, Gap of Isen, Anórien
 *   - May not be played against a company containing a character with Edoras as home site
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

const HORSE_LORDS = 'le-78' as import('../../index.js').CardDefinitionId;

// ─── Region-name keying context for Rohan ────────────────────────────────────

const ROHAN_KEYING = { method: 'region-name' as const, value: 'Rohan' };

const MH_ROHAN = {
  resolvedSitePathNames: ['Rohan'],
  destinationSiteType: SiteType.FreeHold,
  destinationSiteName: 'Edoras',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Horse-lords (le-78)', () => {
  beforeEach(() => resetMint());

  test('each character in company faces one strike', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MINAS_TIRITH, characters: [ARAGORN, LEGOLAS, GIMLI] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [ARAGORN] }],
          hand: [HORSE_LORDS],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const gameState = { ...state, phaseState: makeMHState(MH_ROHAN) };

    const creatureId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(gameState, PLAYER_2, creatureId, companyId, ROHAN_KEYING);

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
          companies: [{ site: MINAS_TIRITH, characters: [ARAGORN, LEGOLAS] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [ARAGORN] }],
          hand: [HORSE_LORDS],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const gameState = { ...state, phaseState: makeMHState(MH_ROHAN) };

    const creatureId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(gameState, PLAYER_2, creatureId, companyId, ROHAN_KEYING);

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.detainment).toBe(true);
  });

  test('not playable against company containing character with Edoras as home site', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MINAS_TIRITH, characters: [THEODEN, ARAGORN] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [ARAGORN] }],
          hand: [HORSE_LORDS],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const gameState = { ...state, phaseState: makeMHState(MH_ROHAN) };

    const hazardActions = computeLegalActions(gameState, PLAYER_2);
    const horseLordsPlay = hazardActions.filter(
      a => a.action.type === 'play-hazard'
        && 'cardInstanceId' in a.action
        && a.action.cardInstanceId === handCardId(gameState, HAZARD_PLAYER),
    );

    expect(horseLordsPlay.length).toBeGreaterThan(0);
    expect(horseLordsPlay.every(a => !a.viable)).toBe(true);
  });

  test('playable against company with no Edoras-homesite character', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MINAS_TIRITH, characters: [ARAGORN, LEGOLAS] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [ARAGORN] }],
          hand: [HORSE_LORDS],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const gameState = { ...state, phaseState: makeMHState(MH_ROHAN) };

    const hazardActions = computeLegalActions(gameState, PLAYER_2);
    const horseLordsPlay = hazardActions.filter(
      a => a.action.type === 'play-hazard'
        && 'cardInstanceId' in a.action
        && a.action.cardInstanceId === handCardId(gameState, HAZARD_PLAYER)
        && a.viable,
    );

    expect(horseLordsPlay.length).toBeGreaterThan(0);
  });

  test('detainment: wounded character is tapped not eliminated', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [ARAGORN] }],
          hand: [HORSE_LORDS],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const gameState = { ...state, phaseState: makeMHState(MH_ROHAN) };

    const creatureId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(gameState, PLAYER_2, creatureId, companyId, ROHAN_KEYING);

    expect(afterChain.combat!.detainment).toBe(true);

    // "Each character faces one strike": the strike is assigned to Aragorn
    // automatically when the defender closes the pre-assignment window.
    let current = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });
    expect(current.combat!.strikeAssignments).toHaveLength(1);

    // Resolve with a low roll — strike succeeds (prowess 10 vs roll ~2)
    const resolveActions = viableActions({ ...current, cheatRollTotal: 2 }, PLAYER_1, 'resolve-strike');
    expect(resolveActions.length).toBeGreaterThan(0);
    current = dispatch({ ...current, cheatRollTotal: 2 }, resolveActions[0].action);

    // In detainment, no body check is required; combat ends immediately
    expect(current.combat).toBeNull();

    // Aragorn should be tapped (detainment result), not wounded/eliminated
    const aragornStatus = Object.values(current.players[RESOURCE_PLAYER].characters)
      .find(c => c.definitionId === ARAGORN)?.status;
    expect(aragornStatus).toBe('tapped');
  });

  test('not playable when region path does not include Rohan or related regions', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [ARAGORN] }],
          hand: [HORSE_LORDS],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    // Fangorn and Redhorn Gate are not in Horse-lords' keyed regions
    const gameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePathNames: ['Fangorn', 'Redhorn Gate'],
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'Moria',
      }),
    };

    const hazardActions = computeLegalActions(gameState, PLAYER_2);
    const horseLordsPlay = hazardActions.filter(
      a => a.action.type === 'play-hazard'
        && 'cardInstanceId' in a.action
        && a.action.cardInstanceId === handCardId(gameState, HAZARD_PLAYER),
    );

    expect(horseLordsPlay.every(a => !a.viable)).toBe(true);
  });
});
