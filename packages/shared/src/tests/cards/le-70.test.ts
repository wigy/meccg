/**
 * @module le-70.test
 *
 * Card test: Elves upon Errantry (le-70)
 * Type: hazard-creature (Elf)
 * Effects: 1 (play-condition — only against minion/non-hero companies)
 *
 * Text:
 *   "Elves. Four strikes (playable only against minion companies)."
 *
 * Base stats: strikes 4, prowess 9, body — (no body check), kill MP 1 (starred).
 *
 * keyedTo (canonical playable: {w}{w}{b}{f}):
 * | # | Entry                               | When   |
 * |---|--------------------------------------|--------|
 * | 1 | wilderness×2 / border / free (any)  | always |
 *
 * Effects:
 * | # | Effect Type    | Status | Notes                                              |
 * |---|----------------|--------|-----------------------------------------------------|
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
  makeMHState, makeDoubleWildernessMHState, makeBorderMHState,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt,
  viableActions,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import {
  Phase, Alignment, RegionType, SiteType,
} from '../../index.js';
import type { CardDefinitionId, GameState } from '../../index.js';

const ELVES_UPON_ERRANTRY = 'le-70' as CardDefinitionId;
const MIONID = 'as-3' as CardDefinitionId;

const WILDERNESS_KEYING = { method: 'region-type' as const, value: RegionType.Wilderness };
const BORDER_KEYING = { method: 'region-type' as const, value: RegionType.Border };
const FREE_KEYING = { method: 'region-type' as const, value: RegionType.Free };

describe('Elves upon Errantry (le-70)', () => {
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
          hand: [ELVES_UPON_ERRANTRY],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const ready: GameState = { ...state, phaseState: makeDoubleWildernessMHState() };
    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);
  });

  test('playable against a Ringwraith (minion) company via double-wilderness', () => {
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
          hand: [ELVES_UPON_ERRANTRY],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const ready: GameState = { ...state, phaseState: makeDoubleWildernessMHState() };
    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === WILDERNESS_KEYING.method && a.keyedBy?.value === WILDERNESS_KEYING.value;
    })).toBe(true);
  });

  // ─── Keying: base {w}{w}{b}{f} — any matching region type ────────────────

  test('single wilderness path is NOT enough (base keying requires ≥2)', () => {
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
          hand: [ELVES_UPON_ERRANTRY],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const mhOneWild = makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Rhudaur'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const ready: GameState = { ...state, phaseState: mhOneWild };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-type' && a.keyedBy?.value === RegionType.Wilderness;
    })).toBe(false);
  });

  test('playable against a Ringwraith company via border-land', () => {
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
          hand: [ELVES_UPON_ERRANTRY],
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
          hand: [ELVES_UPON_ERRANTRY],
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

  // ─── Combat end-to-end: 4 strikes, prowess 9 ─────────────────────────────

  test('combat initiates from double-wilderness keying with 4 strikes at prowess 9', () => {
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
          hand: [ELVES_UPON_ERRANTRY],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = { ...state, phaseState: makeDoubleWildernessMHState() };
    const creatureId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, creatureId, companyId, WILDERNESS_KEYING,
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(4);
    expect(afterChain.combat!.strikeProwess).toBe(9);
  });
});
