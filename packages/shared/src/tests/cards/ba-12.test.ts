/**
 * @module ba-12.test
 *
 * Card test: Olog Warlords (ba-12)
 * Type: hazard-creature (Trolls)
 * Effects: 1 (play-condition — only against hero companies)
 *
 * Text:
 *   "Trolls. Three strikes (playable only against hero companies)."
 *
 * Base stats: strikes 3, prowess 10, body 4, kill MP 2.
 *
 * Keying (from playable = {s}{d}{S}{D}):
 * | # | Entry        | When   | Notes                     |
 * |---|--------------|--------|---------------------------|
 * | 1 | shadow-land  | always | region type {s}           |
 * | 1 | dark-domain  | always | region type {d}           |
 * | 1 | shadow-hold  | always | site type {S}             |
 * | 1 | dark-hold    | always | site type {D}             |
 * (all four alternatives share one keyedTo entry)
 *
 * Effects:
 * | # | Effect Type    | Status | Notes                                          |
 * |---|----------------|--------|------------------------------------------------|
 * | 1 | play-condition | OK     | company.alignment = "hero" — hero companies only |
 *
 * This is the exact inverse of Sons of Kings (le-91), which is "playable only
 * against minion companies" (company.alignment ≠ "hero"). The engine maps a
 * Wizard player's companies to the "hero" alignment label
 * (defenderAlignmentLabel); all other alignments carry their own label, so
 * Olog Warlords is offered only against Wizard companies.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  MORIA, MINAS_TIRITH, PELARGIR,
  RIVENDELL, LORIEN,
  buildTestState, resetMint,
  makeMHState, makeShadowMHState,
  viableActions,
} from '../test-helpers.js';
import {
  Phase, Alignment, RegionType, SiteType,
} from '../../index.js';
import type { CardDefinitionId, GameState } from '../../index.js';

const OLOG_WARLORDS = 'ba-12' as CardDefinitionId;
const MIONID = 'as-3' as CardDefinitionId;

const SHADOW_KEYING = { method: 'region-type' as const, value: RegionType.Shadow };
const DARK_KEYING = { method: 'region-type' as const, value: RegionType.Dark };
const SHADOW_HOLD_KEYING = { method: 'site-type' as const, value: SiteType.ShadowHold };
const DARK_HOLD_KEYING = { method: 'site-type' as const, value: SiteType.DarkHold };

describe('Olog Warlords (ba-12)', () => {
  beforeEach(() => resetMint());

  // ─── Play restriction: hero companies only ───────────────────────────────

  test('NOT playable against a Ringwraith (minion) company even when keyed', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MORIA, characters: [MIONID] }],
          hand: [],
          siteDeck: [PELARGIR],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [OLOG_WARLORDS],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    // Shadow-hold destination satisfies keying, so the block is purely the
    // hero-only play-condition, not a keying failure.
    const ready: GameState = { ...state, phaseState: makeShadowMHState() };
    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);
  });

  test('playable against a hero (Wizard) company via shadow-land region', () => {
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
          hand: [OLOG_WARLORDS],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    // Path through a shadow-land region to a non-keyed (R&L) site isolates the
    // region-type keying.
    const shadowMH = makeMHState({
      resolvedSitePath: [RegionType.Shadow],
      resolvedSitePathNames: ['Imlad Morgul'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const ready: GameState = { ...state, phaseState: shadowMH };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === SHADOW_KEYING.method && a.keyedBy?.value === SHADOW_KEYING.value;
    })).toBe(true);
  });

  test('playable against a hero (Wizard) company via dark-domain region', () => {
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
          hand: [OLOG_WARLORDS],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const darkMH = makeMHState({
      resolvedSitePath: [RegionType.Dark],
      resolvedSitePathNames: ['Gorgoroth'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const ready: GameState = { ...state, phaseState: darkMH };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === DARK_KEYING.method && a.keyedBy?.value === DARK_KEYING.value;
    })).toBe(true);
  });

  test('playable against a hero (Wizard) company via shadow-hold site type', () => {
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
          hand: [OLOG_WARLORDS],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    // No region match; shadow-hold destination triggers site-type keying.
    const shadowHoldMH = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const ready: GameState = { ...state, phaseState: shadowHoldMH };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === SHADOW_HOLD_KEYING.method && a.keyedBy?.value === SHADOW_HOLD_KEYING.value;
    })).toBe(true);
  });

  test('playable against a hero (Wizard) company via dark-hold site type', () => {
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
          hand: [OLOG_WARLORDS],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const darkHoldMH = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.DarkHold,
      destinationSiteName: 'Barad-dûr',
    });
    const ready: GameState = { ...state, phaseState: darkHoldMH };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === DARK_HOLD_KEYING.method && a.keyedBy?.value === DARK_HOLD_KEYING.value;
    })).toBe(true);
  });
});
