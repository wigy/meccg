/**
 * @module le-76.test
 *
 * Card test: Gondorian Rangers (le-76)
 * Type: hazard-creature
 * Race: Dúnedain
 * Prowess: 9  Body: 6  Kill-MP: 2
 *
 * Key rules:
 *   - Each character in the company faces one strike (combat-one-strike-per-character)
 *   - Detainment against covert and hero (Wizard) companies (combat-detainment)
 *   - Keyed to named regions: Ithilien, Dagorlad, Harondor, Mouths of the Anduin,
 *     Brown Lands
 *   - May also be played at sites in these regions (site-in-region). Unlike the
 *     Men-race rangers (Beorning Toll le-62, Horse-lords le-78), the printed
 *     text carries no "non-Haven" qualifier on this clause, so the
 *     `siteInRegionNames` entry has no `when` gate.
 *   - May not be played against a company containing a character with
 *     Henneth Annûn as a home site (Faramir)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI, FARAMIR,
  RIVENDELL, LORIEN, MINAS_TIRITH, TOLFALAS,
  buildTestState, resetMint, makeMHState,
  companyIdAt, dispatch, viableActions,
  playCreatureHazardAndResolve,
  handCardId, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, Phase, SiteType } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

const GONDORIAN_RANGERS = 'le-76' as CardDefinitionId;

// ─── Region-name keying context for Ithilien ─────────────────────────────────

const ITHILIEN_KEYING = { method: 'region-name' as const, value: 'Ithilien' };

const MH_ITHILIEN = {
  resolvedSitePathNames: ['Ithilien'],
  destinationSiteType: SiteType.BorderHold,
  destinationSiteName: 'Henneth Annûn',
};

describe('Gondorian Rangers (le-76)', () => {
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
          hand: [GONDORIAN_RANGERS],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const gameState = { ...state, phaseState: makeMHState(MH_ITHILIEN) };

    const creatureId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(gameState, PLAYER_2, creatureId, companyId, ITHILIEN_KEYING);

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
          hand: [GONDORIAN_RANGERS],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const gameState = { ...state, phaseState: makeMHState(MH_ITHILIEN) };

    const creatureId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(gameState, PLAYER_2, creatureId, companyId, ITHILIEN_KEYING);

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.detainment).toBe(true);
  });

  test('not playable against company containing character with Henneth Annûn as home site', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MINAS_TIRITH, characters: [FARAMIR, ARAGORN] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [ARAGORN] }],
          hand: [GONDORIAN_RANGERS],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const gameState = { ...state, phaseState: makeMHState(MH_ITHILIEN) };

    const hazardActions = computeLegalActions(gameState, PLAYER_2);
    const rangersPlay = hazardActions.filter(
      a => a.action.type === 'play-hazard'
        && 'cardInstanceId' in a.action
        && a.action.cardInstanceId === handCardId(gameState, HAZARD_PLAYER),
    );

    expect(rangersPlay.length).toBeGreaterThan(0);
    expect(rangersPlay.every(a => !a.viable)).toBe(true);
  });

  test('playable against company with no Henneth-Annûn-homesite character', () => {
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
          hand: [GONDORIAN_RANGERS],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const gameState = { ...state, phaseState: makeMHState(MH_ITHILIEN) };

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
          companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [ARAGORN] }],
          hand: [GONDORIAN_RANGERS],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const gameState = { ...state, phaseState: makeMHState(MH_ITHILIEN) };

    const creatureId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(gameState, PLAYER_2, creatureId, companyId, ITHILIEN_KEYING);

    expect(afterChain.combat!.detainment).toBe(true);

    // "Each character faces one strike": the strike is assigned to Aragorn
    // automatically when the defender closes the pre-assignment window.
    let current = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });
    expect(current.combat!.strikeAssignments).toHaveLength(1);

    // Resolve with a low roll — strike succeeds (prowess 9 vs roll ~2)
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

  test('not playable when region path does not include any of the five named regions', () => {
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
          hand: [GONDORIAN_RANGERS],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    // Fangorn and Rohan are not among Gondorian Rangers' keyed regions, and the
    // destination (Edoras) is not itself in one of those regions either, so
    // neither the region-name nor the site-in-region entry can match.
    const gameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePathNames: ['Fangorn', 'Rohan'],
        destinationSiteType: SiteType.FreeHold,
        destinationSiteName: 'Edoras',
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

  // ─── "May also be played at sites in these regions" (site-in-region) ───────

  test('keyable at a site in Mouths of the Anduin even when the movement path never enters the region', () => {
    // Tolfalas is a Ruins-and-lairs site in Mouths of the Anduin, reached here
    // through a path that names no region among Gondorian Rangers' five — only
    // the site-in-region entry can key this.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MINAS_TIRITH, characters: [ARAGORN], destinationSite: TOLFALAS }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [ARAGORN] }],
          hand: [GONDORIAN_RANGERS],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const gameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePathNames: ['Rhudaur'],
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'Tolfalas',
      }),
    };

    const plays = viableActions(gameState, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'site-in-region' && a.keyedBy?.value === 'Mouths of the Anduin';
    })).toBe(true);
  });

  test('resolving via the site-in-region keying still starts combat correctly', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MINAS_TIRITH, characters: [ARAGORN, LEGOLAS], destinationSite: TOLFALAS }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [ARAGORN] }],
          hand: [GONDORIAN_RANGERS],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const gameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePathNames: ['Rhudaur'],
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'Tolfalas',
      }),
    };

    const creatureId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(
      gameState, PLAYER_2, creatureId, companyId,
      { method: 'site-in-region' as const, value: 'Mouths of the Anduin' },
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(2);
    expect(afterChain.combat!.strikeProwess).toBe(9);
    expect(afterChain.combat!.creatureBody).toBe(6);
  });

  test('remains keyable via region-name path even when the destination site is outside the five named regions', () => {
    // The base "keyed to [region]" clause matches on the moving company's
    // resolved site path regardless of the destination site's own region.
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
          hand: [GONDORIAN_RANGERS],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const gameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePathNames: ['Harondor'],
        destinationSiteType: SiteType.FreeHold,
        destinationSiteName: 'Edoras',
      }),
    };

    const plays = viableActions(gameState, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-name' && a.keyedBy?.value === 'Harondor';
    })).toBe(true);
  });
});
