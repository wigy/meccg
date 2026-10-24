/**
 * @module td-5.test
 *
 * Card test: Bairanax at Home (td-5)
 * Type: hazard-event (permanent), keyword `dragon-manifestation`, manifestId td-3
 *
 * Text:
 *   "Unique. Unless Bairanax Ahunt is in play, Ovir Hollow has an additional
 *    automatic-attack: Dragon — 2 strikes at 15/7. In addition, the hazard
 *    limit against any company facing one or more animal hazard creature
 *    attacks is increased by one."
 *
 * Effects:
 * | # | Effect Type                | Status | Notes                                                        |
 * |---|----------------------------|--------|--------------------------------------------------------------|
 * | 1 | dragon-at-home             | OK     | +Dragon (2 strikes, 15 prow, 7 body) on Ovir Hollow; suppressed by Bairanax Ahunt |
 * | 2 | hazard-limit-facing-attack | OK     | race animal, +1 — live from the animal attack's combat through the company's M/H sub-phase |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, CAVE_DRAKE,
  MORIA, LORIEN, RIVENDELL, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState,
  companyIdAt, findHandCardId,
  viableActionsForHandCard,
  dispatch, resolveChain,
  addCardInPlay,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { getActiveAutoAttacks } from '../../engine/manifestations.js';
import { currentHazardLimit } from '../../engine/hazard-limit.js';
import { Phase, Race, RegionType, SiteType } from '../../index.js';
import type { CardDefinitionId, GameState, MovementHazardPhaseState, SiteCard } from '../../index.js';

const BAIRANAX_AT_HOME = 'td-5' as CardDefinitionId;
const BAIRANAX_AHUNT = 'td-4' as CardDefinitionId;
const OVIR_HOLLOW = 'td-179' as CardDefinitionId; // Bairanax's lair (lairOf td-3)
const DANCING_SPIRE = 'tw-383' as CardDefinitionId; // Daelomin's lair — a different Dragon
const CREBAIN = 'tw-25' as CardDefinitionId; // animal hazard creature, keyed to {w}

/**
 * An M/H state with P1's company moving to Dancing Spire (path {w}{b}{s}{w}),
 * P2 (hazard) holding `hand` and the given cards in play.
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
      hazardLimitAtReveal: 2,
      hazardsPlayedThisCompany: 0,
      resolvedSitePath: [RegionType.Wilderness, RegionType.Border, RegionType.Shadow, RegionType.Wilderness],
      resolvedSitePathNames: ['Withered Heath'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Dancing Spire',
      ...mhOverrides,
    }),
  };
}

function limitOf(state: GameState): number {
  return currentHazardLimit(state, state.phaseState as MovementHazardPhaseState, companyIdAt(state, RESOURCE_PLAYER));
}

function playCrebain(state: GameState): GameState {
  return dispatch(state, {
    type: 'play-hazard',
    player: PLAYER_2,
    cardInstanceId: findHandCardId(state, HAZARD_PLAYER, CREBAIN),
    targetCompanyId: companyIdAt(state, RESOURCE_PLAYER),
    keyedBy: { method: 'region-type', value: RegionType.Wilderness },
  });
}

describe('Bairanax at Home (td-5)', () => {
  beforeEach(() => resetMint());

  // ─── dragon-at-home augmentation ──────────────────────────────────────────

  test('Ovir Hollow has only its printed attacks when the At-Home is not in play', () => {
    const state = buildMHState([], []);
    const printed = (state.cardPool[OVIR_HOLLOW] as SiteCard).automaticAttacks.length;
    expect(getActiveAutoAttacks(state, state.cardPool[OVIR_HOLLOW] as SiteCard)).toHaveLength(printed);
  });

  test('At-Home in play adds Dragon — 2 strikes at 15/7 to Ovir Hollow', () => {
    const state = buildMHState([BAIRANAX_AT_HOME], []);
    const printed = (state.cardPool[OVIR_HOLLOW] as SiteCard).automaticAttacks.length;
    const attacks = getActiveAutoAttacks(state, state.cardPool[OVIR_HOLLOW] as SiteCard);
    expect(attacks).toHaveLength(printed + 1);
    expect(attacks[printed]).toMatchObject({ creatureType: 'Dragon', strikes: 2, prowess: 15, body: 7 });
  });

  test('Bairanax Ahunt in play suppresses the additional automatic-attack', () => {
    const state = buildMHState([BAIRANAX_AT_HOME, BAIRANAX_AHUNT], []);
    const printed = (state.cardPool[OVIR_HOLLOW] as SiteCard).automaticAttacks.length;
    expect(getActiveAutoAttacks(state, state.cardPool[OVIR_HOLLOW] as SiteCard)).toHaveLength(printed);
  });

  test('only Bairanax\'s lair is augmented, not another Dragon\'s lair', () => {
    const state = buildMHState([BAIRANAX_AT_HOME], []);
    expect(getActiveAutoAttacks(state, state.cardPool[DANCING_SPIRE] as SiteCard)).toHaveLength(1);
  });

  // ─── hazard limit +1 against a company facing an animal attack ────────────

  test('the hazard limit rises by one once the animal hazard creature attack is faced', () => {
    const state = buildMHState([BAIRANAX_AT_HOME], [CREBAIN]);
    expect(limitOf(state)).toBe(2);

    const played = playCrebain(state);
    expect((played.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany).toBe(1);
    // Declared but not yet resolved — the company is not facing the attack yet.
    expect(played.chain).not.toBeNull();
    expect(limitOf(played)).toBe(2);

    const resolved = resolveChain(played);
    expect(resolved.combat).not.toBeNull();
    expect(resolved.combat!.creatureRace).toBe(Race.Animal);
    expect(limitOf(resolved)).toBe(3);
  });

  test('without the At-Home, facing the animal attack leaves the limit unchanged', () => {
    const state = buildMHState([], [CREBAIN]);
    const resolved = resolveChain(playCrebain(state));
    expect(resolved.combat).not.toBeNull();
    expect(limitOf(resolved)).toBe(2);
  });

  test('after the animal attack resolves, an extra hazard is playable past the base limit', () => {
    const state = buildMHState([BAIRANAX_AT_HOME], [CAVE_DRAKE], {
      hazardLimitAtReveal: 1,
      hazardsPlayedThisCompany: 1,
      hazardsEncountered: ['Crebain'],
    });
    expect(limitOf(state)).toBe(2);
    expect(viableActionsForHandCard(state, PLAYER_2, 'play-hazard', HAZARD_PLAYER, CAVE_DRAKE).length).toBeGreaterThan(0);
  });

  test('without the At-Home, the same hazard is blocked at the limit', () => {
    const state = buildMHState([], [CAVE_DRAKE], {
      hazardLimitAtReveal: 1,
      hazardsPlayedThisCompany: 1,
      hazardsEncountered: ['Crebain'],
    });
    expect(viableActionsForHandCard(state, PLAYER_2, 'play-hazard', HAZARD_PLAYER, CAVE_DRAKE)).toHaveLength(0);
  });

  test('a non-animal attack (Cave-drake) does not raise the limit', () => {
    const state = buildMHState([BAIRANAX_AT_HOME], [CAVE_DRAKE], {
      hazardLimitAtReveal: 1,
      hazardsPlayedThisCompany: 1,
      hazardsEncountered: ['Cave-drake'],
    });
    expect(limitOf(state)).toBe(1);
    expect(viableActionsForHandCard(state, PLAYER_2, 'play-hazard', HAZARD_PLAYER, CAVE_DRAKE)).toHaveLength(0);
  });

  test('facing several animal attacks still raises the limit by only one', () => {
    const state = buildMHState([BAIRANAX_AT_HOME], [], { hazardsEncountered: ['Crebain', 'Crebain'] });
    expect(limitOf(state)).toBe(3);
  });

  test('a company that has faced no attack keeps its normal limit', () => {
    const state = buildMHState([BAIRANAX_AT_HOME], []);
    expect(limitOf(state)).toBe(2);
  });
});
