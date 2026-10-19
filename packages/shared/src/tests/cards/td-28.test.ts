/**
 * @module td-28.test
 *
 * Card test: Gothmog (td-28)
 * Type: hazard-creature (Troll), unique — 1 strike, 14 prowess, 9 body, 3 kill MP
 *
 * Text:
 *   "Unique. Troll. One strike. May also be played following an Orc or
 *    Troll attack in a Shadow-land [{s}] or Shadow-hold [{S}]."
 *
 * Effects:
 * | # | Rule (card text)                                   | Encoding                                          |
 * |---|-----------------------------------------------------|---------------------------------------------------|
 * | 1 | Base cost `{d}{D}` (canonical `playable`)           | keyedTo[0]: { regionTypes: [dark],                |
 * |   |                                                     |   siteTypes: [dark-hold] }                        |
 * | 2 | "May also be played following an Orc or Troll       | keyedTo[1]: { followsAttackKeyedTo: {             |
 * |   |  attack in a Shadow-land [{s}] or Shadow-hold [{S}]"|   races: [orc, troll], regionTypes: [shadow],     |
 * |   |                                                     |   siteTypes: [shadow-hold] } }                    |
 * | 3 | "Unique. Troll. One strike."                        | structural (unique, race, strikes/prowess/body)   |
 *
 * Rule 2 follows the Carrion Birds (td-7) precedent: "an attack in a
 * Shadow-land or Shadow-hold" is an earlier creature attack against the same
 * company this M/H sub-phase whose own play was keyed to a Shadow-land or a
 * Shadow-hold.
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, GIMLI,
  ORC_LIEUTENANT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState,
  resolveChain, handCardId, companyIdAt, charIdAt, dispatch,
  viableHazardPlays,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, Phase, RegionType, SiteType } from '../../index.js';
import type {
  CardDefinitionId, GameState, MovementHazardPhaseState,
} from '../../index.js';

const GOTHMOG = 'td-28' as CardDefinitionId;

describe('Gothmog (td-28)', () => {
  let state: GameState;

  beforeEach(() => {
    resetMint();
    state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN, GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [ORC_LIEUTENANT, GOTHMOG], siteDeck: [RIVENDELL] },
      ],
    });
  });

  // ─── Rule 1: base keying {d}{D} ───────────────────────────────────────

  test('playable keyed to a Dark-domain in the site path', () => {
    const s = { ...state, phaseState: makeMHState({ resolvedSitePath: [RegionType.Dark] }) };
    const keyings = viableHazardPlays(s, PLAYER_2, handCardId(s, HAZARD_PLAYER, 1)).map(a => a.keyedBy);
    expect(keyings).toContainEqual({ method: 'region-type', value: RegionType.Dark });
  });

  test('playable keyed to a Dark-hold destination', () => {
    const s = {
      ...state,
      phaseState: makeMHState({ destinationSiteType: SiteType.DarkHold, destinationSiteName: 'Some Dark-hold' }),
    };
    const keyings = viableHazardPlays(s, PLAYER_2, handCardId(s, HAZARD_PLAYER, 1)).map(a => a.keyedBy);
    expect(keyings).toContainEqual({ method: 'site-type', value: SiteType.DarkHold });
  });

  test('NOT playable on a Shadow-land / Shadow-hold move with no prior attack', () => {
    const s = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Shadow, RegionType.Wilderness],
        destinationSiteType: SiteType.ShadowHold,
        destinationSiteName: 'Some Shadow-hold',
      }),
    };
    expect(viableHazardPlays(s, PLAYER_2, handCardId(s, HAZARD_PLAYER, 1))).toHaveLength(0);
  });

  // ─── Rule 2: follow-up keying ─────────────────────────────────────────

  test('playable following an Orc attack keyed to a Shadow-land', () => {
    const s = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Shadow],
        hazardsEncountered: ['Orc-guard'],
        hazardsEncounteredKeying: [{ name: 'Orc-guard', regionTypes: [RegionType.Shadow], siteTypes: [] }],
      }),
    };
    expect(viableHazardPlays(s, PLAYER_2, handCardId(s, HAZARD_PLAYER, 1)).map(a => a.keyedBy)).toEqual([
      { method: 'follows-attack-keyed-to', value: 'Orc-guard' },
    ]);
  });

  test('playable following a Troll attack keyed to a Shadow-hold', () => {
    const s = {
      ...state,
      phaseState: makeMHState({
        destinationSiteType: SiteType.ShadowHold,
        destinationSiteName: 'Some Shadow-hold',
        hazardsEncountered: ['Half-trolls of Far Harad'],
        hazardsEncounteredKeying: [
          { name: 'Half-trolls of Far Harad', regionTypes: [], siteTypes: [SiteType.ShadowHold] },
        ],
      }),
    };
    expect(viableHazardPlays(s, PLAYER_2, handCardId(s, HAZARD_PLAYER, 1)).map(a => a.keyedBy)).toEqual([
      { method: 'follows-attack-keyed-to', value: 'Half-trolls of Far Harad' },
    ]);
  });

  test('NOT playable following an Orc attack keyed elsewhere (wilderness / Ruins & Lairs)', () => {
    const s = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Wilderness],
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'Some Lair',
        hazardsEncountered: ['Orc-lieutenant', 'Orc-patrol'],
        hazardsEncounteredKeying: [
          { name: 'Orc-lieutenant', regionTypes: [RegionType.Wilderness], siteTypes: [] },
          { name: 'Orc-patrol', regionTypes: [], siteTypes: [SiteType.RuinsAndLairs] },
        ],
      }),
    };
    expect(viableHazardPlays(s, PLAYER_2, handCardId(s, HAZARD_PLAYER, 1))).toHaveLength(0);
  });

  test('NOT playable following a non-Orc/Troll attack keyed to a Shadow-land', () => {
    const s = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Shadow],
        hazardsEncountered: ['Wolves'],
        hazardsEncounteredKeying: [{ name: 'Wolves', regionTypes: [RegionType.Shadow], siteTypes: [] }],
      }),
    };
    expect(viableHazardPlays(s, PLAYER_2, handCardId(s, HAZARD_PLAYER, 1))).toHaveLength(0);
  });

  test('a real Orc attack keyed to a Shadow-land unlocks Gothmog; it attacks with one 14-prowess Troll strike', () => {
    let s: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Shadow],
        resolvedSitePathNames: ['Imlad Morgul'],
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'Some Lair',
      }),
    };
    const companyId = companyIdAt(s, RESOURCE_PLAYER);

    // Before any attack, the Shadow-land path alone does not key Gothmog.
    expect(viableHazardPlays(s, PLAYER_2, handCardId(s, HAZARD_PLAYER, 1))).toHaveLength(0);

    const ltId = handCardId(s, HAZARD_PLAYER, 0);
    s = resolveChain(dispatch(s, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: ltId,
      targetCompanyId: companyId,
      keyedBy: { method: 'region-type' as const, value: RegionType.Shadow },
    }));
    expect(s.combat).not.toBeNull();
    expect(s.combat!.creatureRace).toBe('orc');

    const aragornId = charIdAt(s, RESOURCE_PLAYER);
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId, tapped: false });
    s = { ...s, cheatRollTotal: 12 };
    const resolveAction = computeLegalActions(s, PLAYER_1).find(a => a.viable && a.action.type === 'resolve-strike');
    expect(resolveAction).toBeDefined();
    s = dispatch(s, resolveAction!.action);
    expect(s.combat).toBeNull();
    expect((s.phaseState as MovementHazardPhaseState).hazardsEncounteredKeying).toEqual([
      { name: 'Orc-lieutenant', regionTypes: [RegionType.Shadow], siteTypes: [] },
    ]);

    const offers = viableHazardPlays(s, PLAYER_2, handCardId(s, HAZARD_PLAYER, 0));
    expect(offers.map(a => a.keyedBy)).toEqual([
      { method: 'follows-attack-keyed-to', value: 'Orc-lieutenant' },
    ]);

    // ─── Rule 3: one strike, 14 prowess, Troll ──────────────────────────
    const after = resolveChain(dispatch(s, offers[0]));
    expect(after.combat).not.toBeNull();
    expect(after.combat!.creatureRace).toBe('troll');
    expect(after.combat!.strikesTotal).toBe(1);
    expect(after.combat!.strikeProwess).toBe(14);
    expect(after.combat!.creatureBody).toBe(9);
    expect(after.combat!.attackSource.type).toBe('creature');
  });
});
