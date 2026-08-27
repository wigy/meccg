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
 *   - May not be played against a company containing a character with Beorn's House as home site
 */

import { describe, test, expect } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MINAS_TIRITH,
  buildTestState, makeMHState,
  companyIdAt, handCardId, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, Phase, SiteType, CardDefinitionId } from '../../index.js';

const BEORNING_TOLL = 'le-62' as CardDefinitionId;
const BEORN = 'tw-126' as CardDefinitionId;

// ─── Region-name keying context for Wold & Foothills ─────────────────────────

const MH_WOLD_AND_FOOTHILLS = {
  resolvedSitePathNames: ['Wold & Foothills'],
  destinationSiteType: SiteType.RuinsAndLairs,
  destinationSiteName: 'Glittering Caves',
};

describe('Beorning Toll (le-62)', () => {
  test('playable when moving company passes through Wold & Foothills', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [ARAGORN, LEGOLAS] }],
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
    const gameState = { ...state, phaseState: makeMHState(MH_WOLD_AND_FOOTHILLS) };

    const hazardActions = computeLegalActions(gameState, PLAYER_2);
    const beorningTollPlay = hazardActions.filter(
      a => a.action.type === 'play-hazard'
        && 'cardInstanceId' in a.action
        && a.action.cardInstanceId === handCardId(gameState, HAZARD_PLAYER)
        && a.viable,
    );

    expect(beorningTollPlay.length).toBeGreaterThan(0);
  });

  test('not playable against company containing character with Beorn\'s House as home site', () => {
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
    const gameState = { ...state, phaseState: makeMHState(MH_WOLD_AND_FOOTHILLS) };

    const hazardActions = computeLegalActions(gameState, PLAYER_2);
    const beorningTollPlay = hazardActions.filter(
      a => a.action.type === 'play-hazard'
        && 'cardInstanceId' in a.action
        && a.action.cardInstanceId === handCardId(gameState, HAZARD_PLAYER)
        && companyIdAt(gameState, RESOURCE_PLAYER) === a.action.targetCompanyId,
    );

    expect(beorningTollPlay.length).toBeGreaterThan(0);
    expect(beorningTollPlay.every(a => !a.viable)).toBe(true);
  });

  test('not playable when region path does not include a keyed region', () => {
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
    // Fangorn and Rohan are not among Beorning Toll's keyed regions
    const gameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePathNames: ['Fangorn', 'Rohan'],
        destinationSiteType: SiteType.FreeHold,
        destinationSiteName: 'Edoras',
      }),
    };

    const hazardActions = computeLegalActions(gameState, PLAYER_2);
    const beorningTollPlay = hazardActions.filter(
      a => a.action.type === 'play-hazard'
        && 'cardInstanceId' in a.action
        && a.action.cardInstanceId === handCardId(gameState, HAZARD_PLAYER),
    );

    expect(beorningTollPlay.every(a => !a.viable)).toBe(true);
  });
});
