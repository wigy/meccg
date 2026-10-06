/**
 * @module le-80.test
 *
 * Card test: Land-drake (le-80)
 * Type: hazard-creature (Drake)
 *
 * Text:
 *   "Drake. One strike. Attacker chooses defending characters."
 *
 * Base stats: strikes 1, prowess 8, body —, kill MP 1, race drake.
 *
 * Canonical cost (`attributes.playable`): {w}{R} — a wilderness region in
 * the site path, or arriving at a Ruins-and-Lairs site. Encoded as a single
 * `keyedTo` entry whose fields are alternatives (OR'd):
 * `regionTypes: [wilderness]` OR `siteTypes: [ruins-and-lairs]`.
 *
 * Effects:
 * | # | Effect Type                       | Status | Notes                            |
 * |---|-----------------------------------|--------|----------------------------------|
 * | 1 | combat-attacker-chooses-defenders | OK     | Cancel-window, then attacker     |
 * |   |                                   |        | (hazard player) assigns strikes  |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  makeMHState, makeWildernessMHState,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt, dispatch,
  viableActions, viableFor,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase, Alignment, RegionType, SiteType } from '../../index.js';
import type { CardDefinitionId, GameState } from '../../index.js';

const LAND_DRAKE = 'le-80' as CardDefinitionId;

const WILDERNESS_KEYING = { method: 'region-type' as const, value: RegionType.Wilderness };

function baseStateWithHazardInHand(): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Wizard,
        companies: [{ site: MORIA, characters: [ARAGORN, LEGOLAS] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [GIMLI] }],
        hand: [LAND_DRAKE],
        siteDeck: [RIVENDELL],
      },
    ],
  });
}

function playedDrake(): GameState {
  const state = baseStateWithHazardInHand();
  const ready: GameState = { ...state, phaseState: makeWildernessMHState() };
  const drakeId = handCardId(ready, HAZARD_PLAYER);
  const companyId = companyIdAt(ready, RESOURCE_PLAYER);
  return playCreatureHazardAndResolve(ready, PLAYER_2, drakeId, companyId, WILDERNESS_KEYING);
}

function keyings(state: GameState): { method: string; value: string }[] {
  return viableActions(state, PLAYER_2, 'play-hazard')
    .map(p => (p.action as { keyedBy?: { method: string; value: string } }).keyedBy)
    .filter((k): k is { method: string; value: string } => k !== undefined);
}

describe('Land-drake (le-80)', () => {
  beforeEach(() => resetMint());

  // ─── Base stats: one strike at prowess 8, race drake, body — ──────────────

  test('attack uses 1 strike at prowess 8, race drake, body —', () => {
    const after = playedDrake();

    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(1);
    expect(after.combat!.strikeProwess).toBe(8);
    expect(after.combat!.creatureRace).toBe('drake');
    expect(after.combat!.creatureBody).toBeNull();
  });

  // ─── combat-attacker-chooses-defenders ────────────────────────────────────

  test('combat opens with a cancel-window (attacker-chooses assignment)', () => {
    const after = playedDrake();

    expect(after.combat!.phase).toBe('assign-strikes');
    expect(after.combat!.assignmentPhase).toBe('cancel-window');
  });

  test('attacker (hazard player) assigns the strike; defender only passes the window', () => {
    const after = playedDrake();

    expect(viableActions(after, PLAYER_1, 'assign-strike')).toHaveLength(0);
    expect(viableActions(after, PLAYER_1, 'pass')).toHaveLength(1);
    expect(viableFor(after, PLAYER_2)).toHaveLength(0);

    const afterPass = dispatch(after, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.combat!.assignmentPhase).toBe('attacker');
    // The attacker may pick either defending character (Aragorn or Legolas).
    expect(viableActions(afterPass, PLAYER_2, 'assign-strike')).toHaveLength(2);
    expect(viableActions(afterPass, PLAYER_1, 'assign-strike')).toHaveLength(0);
  });

  // ─── Keying: {w}{R} ───────────────────────────────────────────────────────

  test('keyable by a single wilderness region in the site path', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Wilderness],
        resolvedSitePathNames: ['Rhudaur'],
        destinationSiteType: SiteType.BorderHold,
        destinationSiteName: 'Bree',
      }),
    };

    expect(keyings(ready)).toContainEqual(WILDERNESS_KEYING);
  });

  test('keyable by a Ruins-and-Lairs destination without wilderness in path', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Border],
        resolvedSitePathNames: ['Andrast'],
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'Moria',
      }),
    };

    const ks = keyings(ready);
    expect(ks).toContainEqual({ method: 'site-type', value: SiteType.RuinsAndLairs });
    expect(ks.some(k => k.method === 'region-type')).toBe(false);
  });

  test('NOT keyable on a pure-shadow path arriving at a Shadow-hold', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Shadow],
        resolvedSitePathNames: ['Imlad Morgul'],
        destinationSiteType: SiteType.ShadowHold,
        destinationSiteName: 'Minas Morgul',
      }),
    };

    expect(viableActions(ready, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });
});
