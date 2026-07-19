/**
 * @module le-66.test
 *
 * Card test: Cave-drake (le-66)
 * Type: hazard-creature (Dragon)
 *
 * Text:
 *   "Dragon. Two strikes. Attacker chooses defending characters."
 *
 * Base stats: strikes 2, prowess 10, body —, kill MP 1, race dragon.
 *
 * Canonical cost (`attributes.playable`): {w}{w}{R} — two wilderness
 * regions in the site path, arriving at a Ruins-and-Lairs site. This is
 * encoded as a single `keyedTo` entry whose fields are alternatives (OR'd):
 * `regionTypes: [wilderness, wilderness]` (count-based: needs two) OR
 * `siteTypes: [ruins-and-lairs]` (destination). Same structure as the
 * identical The-Wizards Cave-drake (tw-020), already certified.
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
  makeMHState, makeDoubleWildernessMHState,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt, dispatch,
  viableActions, viableFor,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase, Alignment, RegionType, SiteType } from '../../index.js';
import type { CardDefinitionId, GameState } from '../../index.js';

const CAVE_DRAKE_LE = 'le-66' as CardDefinitionId;

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
        hand: [CAVE_DRAKE_LE],
        siteDeck: [RIVENDELL],
      },
    ],
  });
}

describe('Cave-drake (le-66)', () => {
  beforeEach(() => resetMint());

  // ─── Base stats: two strikes at prowess 10, race dragon, body — ───────────

  test('attack uses 2 strikes at prowess 10, race dragon, body —', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeDoubleWildernessMHState() };
    const drakeId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const after = playCreatureHazardAndResolve(
      ready, PLAYER_2, drakeId, companyId, WILDERNESS_KEYING,
    );

    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(2);
    expect(after.combat!.strikeProwess).toBe(10);
    expect(after.combat!.creatureRace).toBe('dragon');
    expect(after.combat!.creatureBody).toBeNull();
  });

  // ─── combat-attacker-chooses-defenders ────────────────────────────────────

  test('combat opens with a cancel-window (attacker-chooses assignment)', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeDoubleWildernessMHState() };
    const drakeId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const after = playCreatureHazardAndResolve(
      ready, PLAYER_2, drakeId, companyId, WILDERNESS_KEYING,
    );

    expect(after.combat!.phase).toBe('assign-strikes');
    // attacker-chooses routes through a cancel-window before the attacker assigns
    expect(after.combat!.assignmentPhase).toBe('cancel-window');
  });

  test('attacker (hazard player) assigns strikes; defender only passes the window', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeDoubleWildernessMHState() };
    const drakeId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const after = playCreatureHazardAndResolve(
      ready, PLAYER_2, drakeId, companyId, WILDERNESS_KEYING,
    );

    // During cancel-window the defender cannot assign strikes (attacker chooses);
    // with no cancel cards in hand the only defender action is to pass.
    expect(viableActions(after, PLAYER_1, 'assign-strike')).toHaveLength(0);
    expect(viableActions(after, PLAYER_1, 'pass')).toHaveLength(1);
    // The attacker has nothing to do until the window closes.
    expect(viableFor(after, PLAYER_2)).toHaveLength(0);

    // After the defender passes, the attacker assigns both strikes across the
    // two defending characters (Aragorn, Legolas).
    const afterPass = dispatch(after, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.combat!.assignmentPhase).toBe('attacker');
    expect(viableActions(afterPass, PLAYER_2, 'assign-strike').length).toBeGreaterThan(0);
    // Defender does not assign strikes on an attacker-chooses attack.
    expect(viableActions(afterPass, PLAYER_1, 'assign-strike')).toHaveLength(0);
  });

  // ─── Keying: {w}{w}{R} ────────────────────────────────────────────────────

  test('keyable on a double-wilderness path arriving at Ruins-and-Lairs', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeDoubleWildernessMHState() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-type' && a.keyedBy?.value === RegionType.Wilderness;
    })).toBe(true);
  });

  test('NOT keyable on a pure-shadow path arriving at a Shadow-hold', () => {
    const state = baseStateWithHazardInHand();
    const shadowMH = makeMHState({
      resolvedSitePath: [RegionType.Shadow],
      resolvedSitePathNames: ['Imlad Morgul'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Minas Morgul',
    });
    const ready: GameState = { ...state, phaseState: shadowMH };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);
  });
});
