/**
 * @module td-2.test
 *
 * Card test: Agburanar at Home (td-2)
 * Type: hazard-event (permanent), keyword `dragon-manifestation`, manifestId tw-3
 *
 * Text:
 *   "Unique. Unless Agburanar Ahunt is in play, Caves of Ûlund has an
 *    additional automatic-attack: Dragon — 2 strikes at 16/9. In addition,
 *    one unique Dragon manifestation played against each company does not
 *    count against the hazard limit."
 *
 * Effects:
 * | # | Effect Type             | Status | Notes                                                        |
 * |---|-------------------------|--------|--------------------------------------------------------------|
 * | 1 | dragon-at-home          | OK     | +Dragon (2 strikes, 16 prow, 9 body) on Caves of Ûlund; suppressed by Agburanar Ahunt |
 * | 2 | hazard-limit-race-grant | OK     | race dragon, `uniqueOnly` — one unique Dragon per company exempt from the hazard limit |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, CAVE_DRAKE,
  MORIA, LORIEN, RIVENDELL, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState,
  companyIdAt, phaseStateAs, findHandCardId,
  viableActionsForHandCard,
  dispatch,
  addCardInPlay,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { getActiveAutoAttacks } from '../../engine/manifestations.js';
import { Phase, Race, RegionType, SiteType } from '../../index.js';
import type { CardDefinitionId, GameState, MovementHazardPhaseState, SiteCard } from '../../index.js';

const AGBURANAR_AT_HOME = 'td-2' as CardDefinitionId;
const AGBURANAR_AHUNT = 'td-1' as CardDefinitionId;
const CAVES_OF_ULUND = 'tw-381' as CardDefinitionId; // Agburanar's lair (lairOf tw-3)
const DANCING_SPIRE = 'tw-383' as CardDefinitionId; // Daelomin's lair — a different Dragon
const DAELOMIN = 'tw-26' as CardDefinitionId; // unique Dragon manifestation, keyed to Dancing Spire

/**
 * An M/H state with P1's company moving to Dancing Spire (path {w}{b}{s}{w}),
 * P2 (hazard) holding `hand` and the given cards in play, and the hazard limit
 * already reached (1 of 1).
 */
function buildMHState(
  inPlay: CardDefinitionId[],
  hand: CardDefinitionId[],
  mhOverrides?: Partial<MovementHazardPhaseState>,
): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand, siteDeck: [RIVENDELL] },
    ],
  });
  let state = base;
  for (const def of inPlay) state = addCardInPlay(state, HAZARD_PLAYER, def);
  return {
    ...state,
    phaseState: makeMHState({
      hazardLimitAtReveal: 1,
      hazardsPlayedThisCompany: 1,
      resolvedSitePath: [RegionType.Wilderness, RegionType.Border, RegionType.Shadow, RegionType.Wilderness],
      resolvedSitePathNames: ['Withered Heath'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Dancing Spire',
      ...mhOverrides,
    }),
  };
}

describe('Agburanar at Home (td-2)', () => {
  beforeEach(() => resetMint());

  // ─── dragon-at-home augmentation ──────────────────────────────────────────

  test('Caves of Ûlund has only its printed Dragon attack when the At-Home is not in play', () => {
    const state = buildMHState([], []);
    const attacks = getActiveAutoAttacks(state, state.cardPool[CAVES_OF_ULUND] as SiteCard);
    expect(attacks).toHaveLength(1);
    expect(attacks[0]).toMatchObject({ creatureType: 'Dragon', strikes: 1, prowess: 13 });
  });

  test('At-Home in play adds Dragon — 2 strikes at 16/9 to Caves of Ûlund', () => {
    const state = buildMHState([AGBURANAR_AT_HOME], []);
    const attacks = getActiveAutoAttacks(state, state.cardPool[CAVES_OF_ULUND] as SiteCard);
    expect(attacks).toHaveLength(2);
    expect(attacks[0]).toMatchObject({ strikes: 1, prowess: 13 });
    expect(attacks[1]).toMatchObject({ creatureType: 'Dragon', strikes: 2, prowess: 16, body: 9 });
  });

  test('Agburanar Ahunt in play suppresses the additional automatic-attack', () => {
    const state = buildMHState([AGBURANAR_AT_HOME, AGBURANAR_AHUNT], []);
    expect(getActiveAutoAttacks(state, state.cardPool[CAVES_OF_ULUND] as SiteCard)).toHaveLength(1);
  });

  test('only Agburanar\'s lair is augmented, not another Dragon\'s lair', () => {
    const state = buildMHState([AGBURANAR_AT_HOME], []);
    expect(getActiveAutoAttacks(state, state.cardPool[DANCING_SPIRE] as SiteCard)).toHaveLength(1);
  });

  // ─── hazard-limit-race-grant (unique Dragons only) ────────────────────────

  test('a unique Dragon manifestation is playable past the hazard limit while the At-Home is in play', () => {
    const state = buildMHState([AGBURANAR_AT_HOME], [DAELOMIN]);
    const actions = viableActionsForHandCard(state, PLAYER_2, 'play-hazard', HAZARD_PLAYER, DAELOMIN);
    expect(actions.length).toBeGreaterThan(0);
  });

  test('without the At-Home, the unique Dragon is blocked at the hazard limit', () => {
    const state = buildMHState([], [DAELOMIN]);
    expect(viableActionsForHandCard(state, PLAYER_2, 'play-hazard', HAZARD_PLAYER, DAELOMIN)).toHaveLength(0);
  });

  test('a non-unique Dragon (Cave-drake) is not exempt', () => {
    const state = buildMHState([AGBURANAR_AT_HOME], [CAVE_DRAKE]);
    expect(viableActionsForHandCard(state, PLAYER_2, 'play-hazard', HAZARD_PLAYER, CAVE_DRAKE)).toHaveLength(0);
  });

  test('the non-unique Cave-drake is otherwise playable under the limit (control)', () => {
    const state = buildMHState([AGBURANAR_AT_HOME], [CAVE_DRAKE], { hazardsPlayedThisCompany: 0 });
    expect(viableActionsForHandCard(state, PLAYER_2, 'play-hazard', HAZARD_PLAYER, CAVE_DRAKE).length).toBeGreaterThan(0);
  });

  test('playing the unique Dragon does not count against the hazard limit and spends the company\'s exemption', () => {
    const state = buildMHState([AGBURANAR_AT_HOME], [DAELOMIN]);
    const result = dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: findHandCardId(state, HAZARD_PLAYER, DAELOMIN),
      targetCompanyId: companyIdAt(state, RESOURCE_PLAYER),
      keyedBy: { method: 'site-name', value: 'Dancing Spire' },
    });
    const ps = phaseStateAs<MovementHazardPhaseState>(result);
    expect(ps.hazardsPlayedThisCompany).toBe(1);
    expect(ps.hazardLimitRaceGrantsUsed).toEqual([Race.Dragon]);
  });

  test('only one unique Dragon per company is exempt — once spent, the limit applies again', () => {
    const state = buildMHState([AGBURANAR_AT_HOME], [DAELOMIN], { hazardLimitRaceGrantsUsed: [Race.Dragon] });
    expect(viableActionsForHandCard(state, PLAYER_2, 'play-hazard', HAZARD_PLAYER, DAELOMIN)).toHaveLength(0);
  });

  test('under the limit, playing the unique Dragon still uses the free slot rather than the limit', () => {
    const state = buildMHState([AGBURANAR_AT_HOME], [DAELOMIN], { hazardsPlayedThisCompany: 0 });
    const result = dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: findHandCardId(state, HAZARD_PLAYER, DAELOMIN),
      targetCompanyId: companyIdAt(state, RESOURCE_PLAYER),
      keyedBy: { method: 'site-name', value: 'Dancing Spire' },
    });
    expect(phaseStateAs<MovementHazardPhaseState>(result).hazardsPlayedThisCompany).toBe(0);
  });
});
