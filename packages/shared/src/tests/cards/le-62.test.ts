/**
 * @module le-62.test
 *
 * Card test: Beorning Toll (le-62)
 * Type: hazard-creature
 * Race: Men
 * Prowess: 11  Body: 6  Kill-MP: 2
 *
 * Key rules:
 *   - Each character in the company faces one strike (combat-one-strike-per-character)
 *   - Detainment against covert and hero (Wizard) companies
 *   - Keyed to named regions: Anduin Vales, Wold & Foothills, High Pass, Redhorn Gate
 *   - May also be played at non-Haven sites in these regions (site-in-region,
 *     `destinationSite.siteType` excludes `haven`) — the twin card Horse-lords
 *     (le-78) omits this second keying entry since its own test fixtures never
 *     isolate the site-in-region path; Beorning Toll's identical text is
 *     certified with both keying entries so the printed "non-Haven" qualifier
 *     is actually enforced.
 *   - May not be played against a company containing a character with
 *     Beorn's House as a home site
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, EAGLES_EYRIE,
  buildTestState, resetMint, makeMHState,
  companyIdAt, dispatch, viableActions,
  playCreatureHazardAndResolve,
  handCardId, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, Phase, SiteType } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

const BEORNING_TOLL = 'le-62' as CardDefinitionId;
const BEORN = 'tw-126' as CardDefinitionId;

// ─── Region-name keying context for Anduin Vales ─────────────────────────────

const ANDUIN_VALES_KEYING = { method: 'region-name' as const, value: 'Anduin Vales' };

const MH_ANDUIN_VALES = {
  resolvedSitePathNames: ['Anduin Vales'],
  destinationSiteType: SiteType.BorderHold,
  destinationSiteName: 'Beorn’s House',
};

describe('Beorning Toll (le-62)', () => {
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
          hand: [BEORNING_TOLL],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const gameState = { ...state, phaseState: makeMHState(MH_ANDUIN_VALES) };

    const creatureId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(gameState, PLAYER_2, creatureId, companyId, ANDUIN_VALES_KEYING);

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
          hand: [BEORNING_TOLL],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const gameState = { ...state, phaseState: makeMHState(MH_ANDUIN_VALES) };

    const creatureId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(gameState, PLAYER_2, creatureId, companyId, ANDUIN_VALES_KEYING);

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.detainment).toBe(true);
  });

  test('not playable against company containing character with Beorn’s House as home site', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MINAS_TIRITH, characters: [BEORN, ARAGORN] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [ARAGORN] }],
          hand: [BEORNING_TOLL],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const gameState = { ...state, phaseState: makeMHState(MH_ANDUIN_VALES) };

    const hazardActions = computeLegalActions(gameState, PLAYER_2);
    const tollPlay = hazardActions.filter(
      a => a.action.type === 'play-hazard'
        && 'cardInstanceId' in a.action
        && a.action.cardInstanceId === handCardId(gameState, HAZARD_PLAYER),
    );

    expect(tollPlay.length).toBeGreaterThan(0);
    expect(tollPlay.every(a => !a.viable)).toBe(true);
  });

  test('playable against company with no Beorn’s-House-homesite character', () => {
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
          hand: [BEORNING_TOLL],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const gameState = { ...state, phaseState: makeMHState(MH_ANDUIN_VALES) };

    const hazardActions = computeLegalActions(gameState, PLAYER_2);
    const tollPlay = hazardActions.filter(
      a => a.action.type === 'play-hazard'
        && 'cardInstanceId' in a.action
        && a.action.cardInstanceId === handCardId(gameState, HAZARD_PLAYER)
        && a.viable,
    );

    expect(tollPlay.length).toBeGreaterThan(0);
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
          hand: [BEORNING_TOLL],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const gameState = { ...state, phaseState: makeMHState(MH_ANDUIN_VALES) };

    const creatureId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(gameState, PLAYER_2, creatureId, companyId, ANDUIN_VALES_KEYING);

    expect(afterChain.combat!.detainment).toBe(true);

    // "Each character faces one strike": the strike is assigned to Aragorn
    // automatically when the defender closes the pre-assignment window.
    let current = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });
    expect(current.combat!.strikeAssignments).toHaveLength(1);

    // Resolve with a low roll — strike succeeds (prowess 11 vs roll ~2)
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

  test('not playable when region path does not include any of the four named regions', () => {
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
          hand: [BEORNING_TOLL],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    // Fangorn and Rohan are not among Beorning Toll's keyed regions, and the
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
    const tollPlay = hazardActions.filter(
      a => a.action.type === 'play-hazard'
        && 'cardInstanceId' in a.action
        && a.action.cardInstanceId === handCardId(gameState, HAZARD_PLAYER),
    );

    expect(tollPlay.every(a => !a.viable)).toBe(true);
  });

  // ─── "May also be played at non-Haven sites in these regions" (site-in-region) ───

  test('keyable at a non-Haven site in Anduin Vales even when the movement path never enters Anduin Vales', () => {
    // Eagles' Eyrie is a Free-hold in Anduin Vales, reached here through a
    // path that names no Anduin-Vales-family region — only the
    // site-in-region entry can key this.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MINAS_TIRITH, characters: [ARAGORN], destinationSite: EAGLES_EYRIE }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [ARAGORN] }],
          hand: [BEORNING_TOLL],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const gameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePathNames: ['Rhudaur'],
        destinationSiteType: SiteType.FreeHold,
        destinationSiteName: 'Eagles’ Eyrie',
      }),
    };

    const plays = viableActions(gameState, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'site-in-region' && a.keyedBy?.value === 'Anduin Vales';
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
          companies: [{ site: MINAS_TIRITH, characters: [ARAGORN, LEGOLAS], destinationSite: EAGLES_EYRIE }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [ARAGORN] }],
          hand: [BEORNING_TOLL],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const gameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePathNames: ['Rhudaur'],
        destinationSiteType: SiteType.FreeHold,
        destinationSiteName: 'Eagles’ Eyrie',
      }),
    };

    const creatureId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(
      gameState, PLAYER_2, creatureId, companyId,
      { method: 'site-in-region' as const, value: 'Anduin Vales' },
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(2);
    expect(afterChain.combat!.strikeProwess).toBe(11);
    expect(afterChain.combat!.creatureBody).toBe(6);
  });

  test('NOT keyable at a Haven in Wold & Foothills via site-in-region (non-Haven qualifier)', () => {
    // Lórien is a Haven whose region is Wold & Foothills, reached here
    // through a path that names no Wold-&-Foothills-family region. The
    // site-in-region entry is gated on destinationSite.siteType !== haven,
    // so it must not match — matching the printed "non-Haven sites" wording.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN], destinationSite: LORIEN }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [BEORNING_TOLL],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const gameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePathNames: ['Rhudaur'],
        destinationSiteType: SiteType.Haven,
        destinationSiteName: 'Lórien',
      }),
    };

    const plays = viableActions(gameState, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);
  });

  test('remains keyable via region-name path even when the destination is a Haven inside a named region', () => {
    // The base "keyed to [region]" clause matches on the moving company's
    // resolved site path regardless of the destination's site type — the
    // "non-Haven" qualifier only narrows the separate site-in-region clause,
    // not the printed region-name keying itself.
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
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [BEORNING_TOLL],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const gameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePathNames: ['Wold & Foothills'],
        destinationSiteType: SiteType.Haven,
        destinationSiteName: 'Lórien',
      }),
    };

    const plays = viableActions(gameState, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-name' && a.keyedBy?.value === 'Wold & Foothills';
    })).toBe(true);
  });
});
