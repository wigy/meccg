/**
 * @module tw-38.test
 *
 * Card test: Ghouls (tw-38)
 * Type: hazard-creature (undead)
 *
 * Text:
 *   "Undead. Five strikes."
 *
 * Base stats: strikes 5, prowess 7, body —, kill MP 1, non-unique.
 *
 * Canonical keying (cards.json `attributes.playable`): {s}{d}{S}{D}
 *
 * keyedTo:
 * | # | Entry                                                          |
 * |---|----------------------------------------------------------------|
 * | 1 | regionTypes: [shadow, dark], siteTypes: [shadow-hold, dark-hold]|
 *
 * Within a single `keyedTo` entry every region type and site type is an
 * alternative (OR'd by the engine): Ghouls keys when the resolved site path
 * contains a Shadow-land OR Dark-domain region, OR the destination site is a
 * Shadow-hold OR Dark-hold. No `effects` — all rules ("Undead" race, five
 * strikes) are carried by base card fields handled structurally by the engine.
 *
 * This is a reprint of le-73 (identical text and keying), certified under the
 * LE set; see le-73.test.ts for the original test this one is adapted from.
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

const GHOULS = 'tw-38' as CardDefinitionId;

const SHADOW_KEYING = { method: 'region-type' as const, value: RegionType.Shadow };
const DARK_KEYING = { method: 'region-type' as const, value: RegionType.Dark };

/** Dark-domain region path arriving at a Dark-hold. */
function makeDarkMHState() {
  return makeMHState({
    resolvedSitePath: [RegionType.Dark],
    resolvedSitePathNames: ['Gorgoroth'],
    destinationSiteType: SiteType.DarkHold,
    destinationSiteName: 'Moria',
  });
}

/** Wilderness path (no shadow/dark region) arriving at a Shadow-hold. */
function makeWildernessToShadowHoldMHState() {
  return makeMHState({
    resolvedSitePath: [RegionType.Wilderness],
    resolvedSitePathNames: ['Rhudaur'],
    destinationSiteType: SiteType.ShadowHold,
    destinationSiteName: 'Moria',
  });
}

/** Wilderness path (no shadow/dark region) arriving at a Dark-hold. */
function makeWildernessToDarkHoldMHState() {
  return makeMHState({
    resolvedSitePath: [RegionType.Wilderness],
    resolvedSitePathNames: ['Rhudaur'],
    destinationSiteType: SiteType.DarkHold,
    destinationSiteName: 'Moria',
  });
}

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
        hand: [GHOULS],
        siteDeck: [RIVENDELL],
      },
    ],
  });
}

describe('Ghouls (tw-38)', () => {
  beforeEach(() => resetMint());

  // ─── Base stats: five strikes at prowess 7, undead, no body ─────────────

  test('attack uses 5 strikes at prowess 7, undead race, no body', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeShadowMHState() };
    const ghoulsId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const after = playCreatureHazardAndResolve(
      ready, PLAYER_2, ghoulsId, companyId, SHADOW_KEYING,
    );

    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(5);
    expect(after.combat!.strikeProwess).toBe(7);
    expect(after.combat!.creatureRace).toBe('undead');
    expect(after.combat!.creatureBody).toBeNull();
  });

  // ─── Keying: playable to Shadow-land region ─────────────────────────────

  test('playable on a shadow-land path via shadow region keying', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeShadowMHState() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-type' && a.keyedBy?.value === RegionType.Shadow;
    })).toBe(true);
  });

  // ─── Keying: playable to Dark-domain region ─────────────────────────────

  test('playable on a dark-domain path via dark region keying', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeDarkMHState() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-type' && a.keyedBy?.value === RegionType.Dark;
    })).toBe(true);

    // The base stats apply on the dark path too.
    const ghoulsId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const after = playCreatureHazardAndResolve(
      ready, PLAYER_2, ghoulsId, companyId, DARK_KEYING,
    );
    expect(after.combat!.strikesTotal).toBe(5);
    expect(after.combat!.strikeProwess).toBe(7);
  });

  // ─── Keying: playable to a Shadow-hold via site-type (no shadow region) ──

  test('playable via shadow-hold site type even on a wilderness path', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeWildernessToShadowHoldMHState() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'site-type' && a.keyedBy?.value === SiteType.ShadowHold;
    })).toBe(true);
    // No region-type option, since the path is pure wilderness.
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-type';
    })).toBe(false);
  });

  // ─── Keying: playable to a Dark-hold via site-type (no dark region) ──────

  test('playable via dark-hold site type even on a wilderness path', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeWildernessToDarkHoldMHState() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    const siteTypePlay = plays.find(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'site-type' && a.keyedBy?.value === SiteType.DarkHold;
    });
    expect(siteTypePlay).toBeDefined();

    // Resolves into a 5-strike attack when played keyed to the dark-hold.
    const ghoulsId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const after = playCreatureHazardAndResolve(
      ready, PLAYER_2, ghoulsId, companyId,
      { method: 'site-type' as const, value: SiteType.DarkHold },
    );
    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(5);
  });

  // ─── Keying: NOT playable when neither region nor site type matches ──────

  test('NOT playable on a pure-wilderness path to ruins-and-lairs', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeWildernessMHState() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);

    const all = computeLegalActions(ready, PLAYER_2).filter(ea => ea.action.type === 'play-hazard');
    expect(all.length).toBeGreaterThan(0);
    expect(all.every(ea => !ea.viable)).toBe(true);
  });

  test('NOT playable on a border path to a border-hold', () => {
    const state = baseStateWithHazardInHand();
    const borderMH = makeMHState({
      resolvedSitePath: [RegionType.Border],
      resolvedSitePathNames: ['Andrast'],
      destinationSiteType: SiteType.BorderHold,
      destinationSiteName: 'Pelargir',
    });
    const ready: GameState = { ...state, phaseState: borderMH };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);
  });

  test('NOT playable on a free path to a free-hold', () => {
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

  // ─── Keying: both region and site type offered when both match ──────────

  test('shadow path to a shadow-hold offers the region-type option', () => {
    const state = baseStateWithHazardInHand();
    // makeShadowMHState arrives at a Shadow-hold via a Shadow-land region.
    const ready: GameState = { ...state, phaseState: makeShadowMHState() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    // Region keying is offered (shadow path); the engine reports the region
    // match for the shadow-land in the path.
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-type' && a.keyedBy?.value === RegionType.Shadow;
    })).toBe(true);
  });
});
