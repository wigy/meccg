/**
 * @module le-83.test
 *
 * Card test: Lesser Spiders (le-83)
 * Type: hazard-creature (Spiders)
 *
 * Text:
 *   "Spiders. Four strikes."
 *
 * Base stats: strikes 4, prowess 7, body —, race Spiders, kill MP 1.
 *
 * keyedTo (canonical playable cost {w}{s}{R}):
 * | # | Entry                                                          | When   | Notes                    |
 * |---|----------------------------------------------------------------|--------|--------------------------|
 * | 1 | regionTypes: [wilderness, shadow], siteTypes: [ruins-and-lairs] | always | base cost {w}{s}{R}      |
 *
 * The tokens inside a single `keyedTo` entry are alternatives (OR'd): Lesser
 * Spiders key when the resolved site path contains at least one wilderness OR
 * at least one shadow-land, OR the destination site is a Ruins & Lairs {R}.
 *
 * Effects: none — the "Spiders" race and four-strike count are structural
 * base-card fields handled by the engine; there is no special text to model.
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
import type { CardDefinitionId, CardInstanceId, GameState } from '../../index.js';

const LESSER_SPIDERS = 'le-83' as CardDefinitionId;

const SHADOW_KEYING = { method: 'region-type' as const, value: RegionType.Shadow };
const RUINS_SITE_KEYING = { method: 'site-type' as const, value: SiteType.RuinsAndLairs };

/** A free-domain path arriving at a Ruins & Lairs site: keys ONLY via {R}. */
function makeFreePathToRuinsMHState() {
  return makeMHState({
    resolvedSitePath: [RegionType.Free],
    resolvedSitePathNames: ['Anórien'],
    destinationSiteType: SiteType.RuinsAndLairs,
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
        hand: [LESSER_SPIDERS],
        siteDeck: [RIVENDELL],
      },
    ],
  });
}

describe('Lesser Spiders (le-83)', () => {
  beforeEach(() => resetMint());

  // ─── Base stats: four strikes at prowess 7, race Spiders, body — ─────────

  test('attack uses 4 strikes at prowess 7 via shadow keying', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeShadowMHState() };
    const cardId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const after = playCreatureHazardAndResolve(
      ready, PLAYER_2, cardId, companyId, SHADOW_KEYING,
    );

    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(4);
    expect(after.combat!.strikeProwess).toBe(7);
    expect(after.combat!.creatureRace).toBe('spider');
    expect(after.combat!.creatureBody).toBeNull();
  });

  // ─── Base stats apply identically when keyed to the Ruins & Lairs site ───

  test('attack uses 4 strikes at prowess 7 via ruins-and-lairs site keying', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeFreePathToRuinsMHState() };
    const cardId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const after = playCreatureHazardAndResolve(
      ready, PLAYER_2, cardId, companyId, RUINS_SITE_KEYING,
    );

    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(4);
    expect(after.combat!.strikeProwess).toBe(7);
    expect(after.combat!.creatureRace).toBe('spider');
  });

  // ─── Keying: playable via each individual alternative ────────────────────

  test('playable on a pure-wilderness path via wilderness keying', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeWildernessMHState() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-type' && a.keyedBy?.value === RegionType.Wilderness;
    })).toBe(true);
  });

  test('playable on a pure-shadow path via shadow keying', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeShadowMHState() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-type' && a.keyedBy?.value === RegionType.Shadow;
    })).toBe(true);
  });

  test('playable via ruins-and-lairs site keying even when path lacks wilderness and shadow', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeFreePathToRuinsMHState() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    const offered = new Set(plays.map(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return `${a.keyedBy?.method}:${a.keyedBy?.value}`;
    }));
    // The {R} site-type option is available…
    expect(offered.has(`site-type:${SiteType.RuinsAndLairs}`)).toBe(true);
    // …while the region-type options are not (the free path has neither).
    expect(offered.has(`region-type:${RegionType.Wilderness}`)).toBe(false);
    expect(offered.has(`region-type:${RegionType.Shadow}`)).toBe(false);
  });

  // ─── Keying: alternatives are OR'd — a wilderness→R&L path offers both ────

  test('wilderness path to a Ruins & Lairs site offers both region and site keying', () => {
    const state = baseStateWithHazardInHand();
    // makeWildernessMHState arrives at Moria (Ruins & Lairs) via a wilderness.
    const ready: GameState = { ...state, phaseState: makeWildernessMHState() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    const offered = new Set(plays.map(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return `${a.keyedBy?.method}:${a.keyedBy?.value}`;
    }));
    expect(offered.has(`region-type:${RegionType.Wilderness}`)).toBe(true);
    expect(offered.has(`site-type:${SiteType.RuinsAndLairs}`)).toBe(true);
  });

  // ─── Keying: NOT playable when no alternative is satisfied ───────────────

  test('NOT playable on a pure-free path arriving at a Free-hold', () => {
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

    const all = computeLegalActions(ready, PLAYER_2).filter(ea => ea.action.type === 'play-hazard');
    expect(all.length).toBeGreaterThan(0);
    expect(all.every(ea => !ea.viable)).toBe(true);
    expect(all[0].reason).toMatch(/Not keyable/);
  });

  test('NOT playable on a pure-dark-domain path arriving at a Dark-hold', () => {
    const state = baseStateWithHazardInHand();
    const darkMH = makeMHState({
      resolvedSitePath: [RegionType.Dark],
      resolvedSitePathNames: ['Gorgoroth'],
      destinationSiteType: SiteType.DarkHold,
      destinationSiteName: 'Moria',
    });
    const ready: GameState = { ...state, phaseState: darkMH };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);
  });

  test('non-unique: two copies key independently', () => {
    // Both copies in hand; a wilderness→R&L path keys each one.
    const state = buildTestState({
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
          hand: [LESSER_SPIDERS, LESSER_SPIDERS],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = { ...state, phaseState: makeWildernessMHState() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    const instances = new Set(plays.map(p => (p.action as { cardInstanceId: CardInstanceId }).cardInstanceId));
    expect(instances.size).toBe(2);
  });
});
