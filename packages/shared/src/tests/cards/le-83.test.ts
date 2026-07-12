/**
 * @module le-83.test
 *
 * Card test: Lesser Spiders (le-83)
 * Type: hazard-creature (spiders)
 *
 * Text: "Spiders. Four strikes."
 *
 * Base stats: strikes 4, prowess 7, body — (no body check), kill MP 1.
 *
 * keyedTo:
 * | # | Entry                                                           | When   | Notes                        |
 * |---|-----------------------------------------------------------------|--------|------------------------------|
 * | 1 | regionTypes: [wilderness, shadow], siteTypes: [ruins-and-lairs] | always | {w}{s}{R} — any one suffices |
 *
 * Distinct region types and site types within a single `keyedTo` entry are
 * alternatives (OR'd): Lesser Spiders keys when the resolved site path
 * contains at least one wilderness OR at least one shadow-land, OR the
 * destination is a ruins-and-lairs site.
 *
 * Effects: none — "Spiders" and "Four strikes" are carried by base card
 * fields (`race`, `strikes`) handled structurally by the engine. le-83 is the
 * LE-set printing of Lesser Spiders (identical to td-42).
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
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

const LESSER_SPIDERS = 'le-83' as CardDefinitionId;

const WILDERNESS_KEYING = { method: 'region-type' as const, value: RegionType.Wilderness };
const SHADOW_KEYING = { method: 'region-type' as const, value: RegionType.Shadow };
const RL_KEYING = { method: 'site-type' as const, value: SiteType.RuinsAndLairs };

function baseStateWithHazardInHand() {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Wizard,
        companies: [{ site: MORIA, characters: [ARAGORN] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [LESSER_SPIDERS],
        siteDeck: [RIVENDELL],
      },
    ],
  });
}

/** MH state with a border-land region path and ruins-and-lairs destination. */
function makeBorderRLMHState() {
  return makeMHState({
    resolvedSitePath: [RegionType.Border],
    resolvedSitePathNames: ['Rhovanion'],
    destinationSiteType: SiteType.RuinsAndLairs,
    destinationSiteName: 'Mount Doom',
  });
}

describe('Lesser Spiders (le-83)', () => {
  beforeEach(() => resetMint());

  // ─── Base stats: four strikes at prowess 7 ───────────────────────────────

  test('attack uses 4 strikes at prowess 7, spiders race, no body via wilderness keying', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeWildernessMHState() };
    const spidersId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const after = playCreatureHazardAndResolve(
      ready, PLAYER_2, spidersId, companyId, WILDERNESS_KEYING,
    );

    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(4);
    expect(after.combat!.strikeProwess).toBe(7);
    expect(after.combat!.creatureRace).toBe('spider');
    expect(after.combat!.creatureBody).toBeNull();
  });

  // ─── Keying: playable via wilderness region ──────────────────────────────

  test('playable on a wilderness path via wilderness keying', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeWildernessMHState() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-type' && a.keyedBy?.value === RegionType.Wilderness;
    })).toBe(true);
  });

  // ─── Keying: playable via shadow region ──────────────────────────────────

  test('playable on a shadow path via shadow keying', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeShadowMHState() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-type' && a.keyedBy?.value === RegionType.Shadow;
    })).toBe(true);
  });

  // ─── Keying: playable via ruins-and-lairs site type ─────────────────────

  test('playable at a ruins-and-lairs destination via site-type keying', () => {
    const state = baseStateWithHazardInHand();
    // Border-land region path — neither wilderness nor shadow — but R&L destination.
    const ready: GameState = { ...state, phaseState: makeBorderRLMHState() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'site-type' && a.keyedBy?.value === SiteType.RuinsAndLairs;
    })).toBe(true);
  });

  // ─── Keying: wilderness+shadow path offers both keying options ───────────

  test('wilderness+shadow path offers both wilderness and shadow keyings', () => {
    const state = baseStateWithHazardInHand();
    const mixedMH = makeMHState({
      resolvedSitePath: [RegionType.Wilderness, RegionType.Shadow],
      resolvedSitePathNames: ['Rhudaur', 'Imlad Morgul'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Minas Morgul',
    });
    const ready: GameState = { ...state, phaseState: mixedMH };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    const keyings = new Set(plays.map(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.value;
    }));
    expect(keyings.has(RegionType.Wilderness)).toBe(true);
    expect(keyings.has(RegionType.Shadow)).toBe(true);
  });

  // ─── Keying: NOT playable on a pure-dark-domain path to dark-hold ────────

  test('NOT playable on a pure-dark-domain path to dark-hold', () => {
    const state = baseStateWithHazardInHand();
    const darkMH = makeMHState({
      resolvedSitePath: [RegionType.Dark],
      resolvedSitePathNames: ['Gorgoroth'],
      destinationSiteType: SiteType.DarkHold,
      destinationSiteName: 'Barad-dûr',
    });
    const ready: GameState = { ...state, phaseState: darkMH };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);

    const all = computeLegalActions(ready, PLAYER_2).filter(ea => ea.action.type === 'play-hazard');
    expect(all.length).toBeGreaterThan(0);
    expect(all.every(ea => !ea.viable)).toBe(true);
    expect(all[0].reason).toMatch(/Not keyable/);
  });

  // ─── Keying: NOT playable on a free-domain path to free-hold ─────────────

  test('NOT playable on a free-domain path to free-hold', () => {
    const state = baseStateWithHazardInHand();
    const freeMH = makeMHState({
      resolvedSitePath: [RegionType.Free],
      resolvedSitePathNames: ['Anórien'],
      destinationSiteType: SiteType.FreeHold,
      destinationSiteName: 'Minas Tirith',
    });
    const ready: GameState = { ...state, phaseState: freeMH };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);
  });

  // ─── Keying: shadow path to shadow-hold works via shadow keying ──────────

  test('attack uses 4 strikes at prowess 7 via shadow keying', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeShadowMHState() };
    const spidersId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const after = playCreatureHazardAndResolve(
      ready, PLAYER_2, spidersId, companyId, SHADOW_KEYING,
    );

    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(4);
    expect(after.combat!.strikeProwess).toBe(7);
  });

  // ─── Keying: border+R&L path uses site-type keying ───────────────────────

  test('attack uses 4 strikes at prowess 7 via ruins-and-lairs keying', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeBorderRLMHState() };
    const spidersId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const after = playCreatureHazardAndResolve(
      ready, PLAYER_2, spidersId, companyId, RL_KEYING,
    );

    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(4);
    expect(after.combat!.strikeProwess).toBe(7);
  });
});
