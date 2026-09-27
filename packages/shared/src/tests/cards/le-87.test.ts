/**
 * @module le-87.test
 *
 * Card test: Orc-watch (le-87)
 * Type: hazard-creature (orcs)
 *
 * Text: "Orcs. Three strikes."
 *
 * Base stats: strikes 3, prowess 9, body — (no body check), kill MP 1.
 *
 * keyedTo:
 * | # | Entry                                                               | When   | Notes                            |
 * |---|---------------------------------------------------------------------|--------|----------------------------------|
 * | 1 | regionTypes: [shadow, dark], siteTypes: [shadow-hold, dark-hold]    | always | {s}{d}{S}{D} — any one suffices |
 *
 * Distinct region types and site types within a single `keyedTo` entry are
 * alternatives (OR'd): Orc-watch keys when the resolved site path contains
 * a shadow-land OR a dark-domain, OR the destination is a shadow-hold or
 * dark-hold.
 *
 * Effects: none — "Orcs" and "Three strikes" are carried by base card fields
 * (`race`, `strikes`) handled structurally by the engine.
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

const ORC_WATCH = 'le-87' as CardDefinitionId;

const SHADOW_KEYING = { method: 'region-type' as const, value: RegionType.Shadow };
const DARK_KEYING = { method: 'region-type' as const, value: RegionType.Dark };
const SHADOW_HOLD_KEYING = { method: 'site-type' as const, value: SiteType.ShadowHold };
const DARK_HOLD_KEYING = { method: 'site-type' as const, value: SiteType.DarkHold };

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
        hand: [ORC_WATCH],
        siteDeck: [RIVENDELL],
      },
    ],
  });
}

/** MH state with a pure dark-domain path to a free-hold destination. */
function makeDarkRegionMHState() {
  return makeMHState({
    resolvedSitePath: [RegionType.Dark],
    resolvedSitePathNames: ['Gorgoroth'],
    destinationSiteType: SiteType.FreeHold,
    destinationSiteName: 'Minas Tirith',
  });
}

/** MH state with a border-land path to a shadow-hold destination. */
function makeBorderShadowHoldMHState() {
  return makeMHState({
    resolvedSitePath: [RegionType.Border],
    resolvedSitePathNames: ['Rhovanion'],
    destinationSiteType: SiteType.ShadowHold,
    destinationSiteName: 'Dol Guldur',
  });
}

/** MH state with a border-land path to a dark-hold destination. */
function makeBorderDarkHoldMHState() {
  return makeMHState({
    resolvedSitePath: [RegionType.Border],
    resolvedSitePathNames: ['Rhovanion'],
    destinationSiteType: SiteType.DarkHold,
    destinationSiteName: 'Barad-dûr',
  });
}

function keyingsOffered(state: GameState): Set<string | undefined> {
  const plays = viableActions(state, PLAYER_2, 'play-hazard');
  return new Set(plays.map(p => {
    const a = p.action as { keyedBy?: { method: string; value: string } };
    return a.keyedBy?.value;
  }));
}

describe('Orc-watch (le-87)', () => {
  beforeEach(() => resetMint());

  // ─── Base stats: three strikes at prowess 9, orcs ────────────────────────

  test('attack uses 3 strikes at prowess 9, orc race, no body via shadow keying', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeShadowMHState() };
    const orcId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const after = playCreatureHazardAndResolve(
      ready, PLAYER_2, orcId, companyId, SHADOW_KEYING,
    );

    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(3);
    expect(after.combat!.strikeProwess).toBe(9);
    expect(after.combat!.creatureRace).toBe('orc');
    expect(after.combat!.creatureBody).toBeNull();
  });

  // ─── Keying: each of {s}{d}{S}{D} is offered ─────────────────────────────

  test('shadow path to shadow-hold offers shadow and shadow-hold keyings', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeShadowMHState() };

    const keyings = keyingsOffered(ready);
    expect(keyings.has(RegionType.Shadow)).toBe(true);
    expect(keyings.has(SiteType.ShadowHold)).toBe(true);
  });

  test('playable on a dark-domain path via dark keying', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeDarkRegionMHState() };

    const keyings = keyingsOffered(ready);
    expect(keyings.has(RegionType.Dark)).toBe(true);
  });

  test('playable at a shadow-hold destination via site-type keying', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeBorderShadowHoldMHState() };

    const keyings = keyingsOffered(ready);
    expect(keyings.has(SiteType.ShadowHold)).toBe(true);
    expect(keyings.has(RegionType.Border)).toBe(false);
  });

  test('playable at a dark-hold destination via site-type keying', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeBorderDarkHoldMHState() };

    const keyings = keyingsOffered(ready);
    expect(keyings.has(SiteType.DarkHold)).toBe(true);
  });

  // ─── Keying: not playable without shadow/dark region or hold ─────────────

  test('NOT playable on a wilderness path to ruins-and-lairs', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeWildernessMHState() };

    expect(viableActions(ready, PLAYER_2, 'play-hazard')).toHaveLength(0);

    const all = computeLegalActions(ready, PLAYER_2).filter(ea => ea.action.type === 'play-hazard');
    expect(all.length).toBeGreaterThan(0);
    expect(all.every(ea => !ea.viable)).toBe(true);
    expect(all[0].reason).toMatch(/Not keyable/);
  });

  test('NOT playable on a free-domain path to free-hold', () => {
    const state = baseStateWithHazardInHand();
    const freeMH = makeMHState({
      resolvedSitePath: [RegionType.Free],
      resolvedSitePathNames: ['Anórien'],
      destinationSiteType: SiteType.FreeHold,
      destinationSiteName: 'Minas Tirith',
    });
    const ready: GameState = { ...state, phaseState: freeMH };

    expect(viableActions(ready, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  // ─── Attack via each alternative keying ──────────────────────────────────

  test('attack uses 3 strikes at prowess 9 via dark keying', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeDarkRegionMHState() };
    const after = playCreatureHazardAndResolve(
      ready, PLAYER_2, handCardId(ready, HAZARD_PLAYER), companyIdAt(ready, RESOURCE_PLAYER), DARK_KEYING,
    );

    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(3);
    expect(after.combat!.strikeProwess).toBe(9);
  });

  test('attack uses 3 strikes at prowess 9 via shadow-hold keying', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeBorderShadowHoldMHState() };
    const after = playCreatureHazardAndResolve(
      ready, PLAYER_2, handCardId(ready, HAZARD_PLAYER), companyIdAt(ready, RESOURCE_PLAYER), SHADOW_HOLD_KEYING,
    );

    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(3);
    expect(after.combat!.strikeProwess).toBe(9);
  });

  test('attack uses 3 strikes at prowess 9 via dark-hold keying', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeBorderDarkHoldMHState() };
    const after = playCreatureHazardAndResolve(
      ready, PLAYER_2, handCardId(ready, HAZARD_PLAYER), companyIdAt(ready, RESOURCE_PLAYER), DARK_HOLD_KEYING,
    );

    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(3);
    expect(after.combat!.strikeProwess).toBe(9);
  });
});
