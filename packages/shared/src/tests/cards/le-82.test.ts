/**
 * @module le-82.test
 *
 * Card test: Lawless Men (le-82)
 * Type: hazard-creature (Men)
 *
 * Text:
 *   "Men. Two strikes."
 *
 * Base stats: strikes 2, prowess 9, body —, kill MP 1.
 *
 * keyedTo:
 * | # | Entry                                    | When   | Notes               |
 * |---|------------------------------------------|--------|---------------------|
 * | 1 | regionTypes: [border, wilderness, shadow] | always | base cost {b}{w}{s} |
 *
 * Distinct region types inside a single `keyedTo` entry are alternatives
 * (OR'd): Lawless Men keys when the resolved site path contains at least one
 * border-land OR at least one wilderness OR at least one shadow-land.
 *
 * Effects: none — race and strike count are structural stats.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  makeMHState, makeShadowMHState, makeWildernessMHState,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt,
  viableActions,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import {
  Phase, Alignment, RegionType, SiteType, computeLegalActions,
} from '../../index.js';
import type { CardDefinitionId, GameState } from '../../index.js';

const LAWLESS_MEN = 'le-82' as CardDefinitionId;

describe('Lawless Men (le-82)', () => {
  beforeEach(() => resetMint());

  // ─── Base stats: two strikes at prowess 9, race Men, body — ──────────────

  test('attack uses 2 strikes at prowess 9 via border keying', () => {
    const state = buildTestState({
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
          hand: [LAWLESS_MEN],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Border],
        resolvedSitePathNames: ['Cardolan'],
        destinationSiteType: SiteType.BorderHold,
        destinationSiteName: 'Bree',
      }),
    };
    const cardId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const after = playCreatureHazardAndResolve(
      ready, PLAYER_2, cardId, companyId,
      { method: 'region-type' as const, value: RegionType.Border },
    );

    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(2);
    expect(after.combat!.strikeProwess).toBe(9);
    expect(after.combat!.creatureRace).toBe('men');
    expect(after.combat!.creatureBody).toBeNull();
  });

  // ─── Keying: playable via individual region types ─────────────────────────

  test('playable on a pure-border path via border keying', () => {
    const state = buildTestState({
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
          hand: [LAWLESS_MEN],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Border],
        resolvedSitePathNames: ['Cardolan'],
        destinationSiteType: SiteType.BorderHold,
        destinationSiteName: 'Bree',
      }),
    };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-type' && a.keyedBy?.value === RegionType.Border;
    })).toBe(true);
  });

  test('playable on a pure-wilderness path via wilderness keying', () => {
    const state = buildTestState({
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
          hand: [LAWLESS_MEN],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = { ...state, phaseState: makeWildernessMHState() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-type' && a.keyedBy?.value === RegionType.Wilderness;
    })).toBe(true);
  });

  test('playable on a pure-shadow path via shadow keying', () => {
    const state = buildTestState({
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
          hand: [LAWLESS_MEN],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = { ...state, phaseState: makeShadowMHState() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-type' && a.keyedBy?.value === RegionType.Shadow;
    })).toBe(true);
  });

  // ─── Keying: NOT playable on paths lacking all three region types ──────────

  test('NOT playable on a pure-dark-domain path', () => {
    const state = buildTestState({
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
          hand: [LAWLESS_MEN],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Dark],
        resolvedSitePathNames: ['Gorgoroth'],
        destinationSiteType: SiteType.DarkHold,
        destinationSiteName: 'Moria',
      }),
    };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);

    const all = computeLegalActions(ready, PLAYER_2).filter(ea => ea.action.type === 'play-hazard');
    expect(all.length).toBeGreaterThan(0);
    expect(all.every(ea => !ea.viable)).toBe(true);
    expect(all[0].reason).toMatch(/Not keyable/);
  });

  test('NOT playable on a pure-free-domain path', () => {
    const state = buildTestState({
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
          hand: [LAWLESS_MEN],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Free],
        resolvedSitePathNames: ['Anorien'],
        destinationSiteType: SiteType.FreeHold,
        destinationSiteName: 'Minas Tirith',
      }),
    };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);
  });
});
