/**
 * @module le-91.test
 *
 * Card test: Sons of Kings (le-91)
 * Type: hazard-creature (Dúnedain)
 * Effects: 1 (play-condition — only against minion/non-hero companies)
 *
 * Text:
 *   "Dúnedain. Three strikes (playable only against minion companies)."
 *
 * Base stats: strikes 3, prowess 10, body — (no body check), kill MP 2.
 *
 * Keying (from playable = {f}{b}{B}{F}):
 * | # | Entry          | When   | Notes              |
 * |---|----------------|--------|--------------------|
 * | 1 | free-domain    | always | region type {f}    |
 * | 2 | border-land    | always | region type {b}    |
 * | 3 | border-hold    | always | site type {B}      |
 * | 4 | free-hold      | always | site type {F}      |
 *
 * Effects:
 * | # | Effect Type    | Status | Notes                                           |
 * |---|----------------|--------|-------------------------------------------------|
 * | 1 | play-condition | OK     | company.alignment ≠ "hero" — minion companies only |
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
  makeMHState, makeBorderMHState,
  viableActions,
} from '../test-helpers.js';
import {
  Phase, Alignment, RegionType, SiteType,
} from '../../index.js';
import type { CardDefinitionId, GameState } from '../../index.js';

const SONS_OF_KINGS = 'le-91' as CardDefinitionId;
const MIONID = 'as-3' as CardDefinitionId;

const BORDER_KEYING = { method: 'region-type' as const, value: RegionType.Border };
const FREE_KEYING = { method: 'region-type' as const, value: RegionType.Free };
const BORDER_HOLD_KEYING = { method: 'site-type' as const, value: SiteType.BorderHold };
const FREE_HOLD_KEYING = { method: 'site-type' as const, value: SiteType.FreeHold };

describe('Sons of Kings (le-91)', () => {
  beforeEach(() => resetMint());

  // ─── Play restriction: minion companies only ─────────────────────────────

  test('NOT playable against a hero (Wizard) company', () => {
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
          hand: [SONS_OF_KINGS],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const ready: GameState = { ...state, phaseState: makeBorderMHState() };
    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);
  });

  test('playable against a Ringwraith (minion) company via border-land', () => {
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
          hand: [SONS_OF_KINGS],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const ready: GameState = { ...state, phaseState: makeBorderMHState() };
    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === BORDER_KEYING.method && a.keyedBy?.value === BORDER_KEYING.value;
    })).toBe(true);
  });

  test('playable against a Ringwraith company via free-domain', () => {
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
          hand: [SONS_OF_KINGS],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const freeMH = makeMHState({
      resolvedSitePath: [RegionType.Free],
      resolvedSitePathNames: ['Anórien'],
      destinationSiteType: SiteType.FreeHold,
      destinationSiteName: 'Pelargir',
    });
    const ready: GameState = { ...state, phaseState: freeMH };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === FREE_KEYING.method && a.keyedBy?.value === FREE_KEYING.value;
    })).toBe(true);
  });

  test('playable against a Ringwraith company via border-hold site type', () => {
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
          hand: [SONS_OF_KINGS],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    // Path with no region match but border-hold destination triggers site-type keying
    const borderHoldMH = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.BorderHold,
      destinationSiteName: 'Pelargir',
    });
    const ready: GameState = { ...state, phaseState: borderHoldMH };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === BORDER_HOLD_KEYING.method && a.keyedBy?.value === BORDER_HOLD_KEYING.value;
    })).toBe(true);
  });

  test('playable against a Ringwraith company via free-hold site type', () => {
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
          hand: [SONS_OF_KINGS],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const freeHoldMH = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.FreeHold,
      destinationSiteName: 'Pelargir',
    });
    const ready: GameState = { ...state, phaseState: freeHoldMH };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === FREE_HOLD_KEYING.method && a.keyedBy?.value === FREE_HOLD_KEYING.value;
    })).toBe(true);
  });
});
