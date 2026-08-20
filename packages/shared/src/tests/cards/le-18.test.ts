/**
 * @module le-18.test
 *
 * Card test: Lagduf (le-18)
 * Type: minion-character
 *
 * "Unique. Uruk-hai. Discard on a body check result of 8."
 *
 * Engine Support:
 * | # | Feature                             | Status | Notes                                    |
 * |---|-------------------------------------|--------|------------------------------------------|
 * | 1 | keywords: ["uruk-hai"]              | DATA   | classification label, no current gate    |
 * | 2 | discardBodyCheck [8] — mass check   | OK     | dice-check (body-check) resolution       |
 *
 * Playable: YES
 *
 * Rules exercised:
 * 1. Lagduf (orc, body 8, discardBodyCheck [8]) is discarded to the resource
 *    player's discard pile (not eliminated) when a mass body check fails.
 *    Veils Flung Away applies modifier -1, so effectiveThreshold = 7;
 *    a roll of 8 (> 7) triggers the discard (CoE 3.I.1: fail = roll higher than threshold).
 * 2. Lagduf stays in play when the body check passes (roll <= 7).
 *
 * Fixtures:
 *   LAGDUF (le-18)            — minion orc warrior, body 8, discardBodyCheck [8]
 *   VEILS_FLUNG_AWAY (le-146) — hazard short event; body check modifier -1
 *   DOL_GULDUR (le-367)       — minion haven (company site)
 *   MINAS_MORGUL (le-390)     — minion haven (opponent site)
 *   EDORAS_LE (le-372)        — free-hold; site path has Wilderness
 *   MORIA_LE (le-392)         — shadow-hold (siteDeck filler)
 *   GRISHNAKH (le-12)         — minion orc (opponent filler)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  buildTestState, resetMint,
  makeMHState,
  P1_COMPANY,
  handCardId, findCharInstanceId, dispatch,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  expectCharInPlay, expectCharNotInPlay,
} from '../test-helpers.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { Phase, RegionType } from '../../index.js';
import type { GameState, MovementHazardPhaseState, CardDefinitionId, ResolveDiceCheckAction } from '../../index.js';

const LAGDUF = 'le-18' as CardDefinitionId;
const VEILS_FLUNG_AWAY = 'le-146' as CardDefinitionId;
const GRISHNAKH = 'le-12' as CardDefinitionId;

const DOL_GULDUR = 'le-367' as CardDefinitionId;    // minion haven
const MINAS_MORGUL = 'le-390' as CardDefinitionId;  // minion haven
const EDORAS_LE = 'le-372' as CardDefinitionId;     // free-hold; path has Wilderness
const MORIA_LE = 'le-392' as CardDefinitionId;      // shadow-hold (siteDeck filler)

/** Build an MH state with a Wilderness in the site path (Veils Flung Away condition). */
function makeWildernessMH(overrides?: Partial<MovementHazardPhaseState>): MovementHazardPhaseState {
  return makeMHState({
    resolvedSitePath: [RegionType.Wilderness],
    resolvedSitePathNames: ['Rohan'],
    ...overrides,
  });
}

describe('Lagduf (le-18)', () => {
  beforeEach(() => resetMint());

  // ── discardBodyCheck [8]: fail → discard to discard pile ──────────────────

  test('Lagduf is discarded to discard pile when mass body check fails', () => {
    // discardBodyCheck [8], Veils modifier -1 → effectiveThreshold = 7.
    // Roll 8 (> 7) → fail → Lagduf discarded to resource player's discard pile.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [LAGDUF] }], hand: [], siteDeck: [EDORAS_LE] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [GRISHNAKH] }], hand: [VEILS_FLUNG_AWAY], siteDeck: [MORIA_LE] },
      ],
    });
    let s: GameState = { ...state, phaseState: makeWildernessMH() };
    const lagdufId = findCharInstanceId(s, RESOURCE_PLAYER, LAGDUF);
    const veilId = handCardId(s, HAZARD_PLAYER);

    // Hazard player plays Veils Flung Away targeting Player 1's company
    s = dispatch(s, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: veilId, targetCompanyId: P1_COMPANY });

    // Both players pass chain priority
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_1 });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_2 });

    // Body check pending resolution queued for resource player
    expect(s.pendingResolutions).toHaveLength(1);
    expect(s.pendingResolutions[0].kind.type).toBe('dice-check');
    expect(s.pendingResolutions[0].actor).toBe(PLAYER_1);

    // discardBodyCheck [8] + modifier −1 → pre-resolved threshold 7, target Lagduf.
    const dc = s.pendingResolutions.find(r => r.kind.type === 'dice-check' && r.kind.targetCharacterId === lagdufId);
    expect(dc).toBeDefined();
    if (dc?.kind.type === 'dice-check') {
      expect(dc.kind.targetCharacterId).toBe(lagdufId);
      expect(dc.kind.threshold).toBe(7);
    }

    // Force roll of 8 (> effectiveThreshold 7) → fail
    s = { ...s, cheatRollTotal: 8 };
    const rollActions = computeLegalActions(s, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'resolve-dice-check');
    expect(rollActions).toHaveLength(1);

    const rollAction = rollActions[0].action as ResolveDiceCheckAction;
    s = dispatch(s, rollAction);

    // Lagduf must be removed from play and sent to discard pile
    expectCharNotInPlay(s, RESOURCE_PLAYER, lagdufId);
    const discardDefIds = s.players[RESOURCE_PLAYER].discardPile.map(c => c.definitionId);
    expect(discardDefIds).toContain(LAGDUF);
    // Must NOT be in the out-of-play pile (that would be elimination, not discard)
    const oopDefIds = s.players[RESOURCE_PLAYER].outOfPlayPile.map(c => c.definitionId);
    expect(oopDefIds).not.toContain(LAGDUF);
  });

  // ── discardBodyCheck [8]: pass → no effect ────────────────────────────────

  test('Lagduf stays in play when mass body check passes', () => {
    // discardBodyCheck [8], Veils modifier -1 → effectiveThreshold = 7.
    // Roll 7 (not > threshold) → pass → Lagduf remains in play.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [LAGDUF] }], hand: [], siteDeck: [EDORAS_LE] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [GRISHNAKH] }], hand: [VEILS_FLUNG_AWAY], siteDeck: [MORIA_LE] },
      ],
    });
    let s: GameState = { ...state, phaseState: makeWildernessMH() };
    const lagdufId = findCharInstanceId(s, RESOURCE_PLAYER, LAGDUF);
    const veilId = handCardId(s, HAZARD_PLAYER);

    s = dispatch(s, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: veilId, targetCompanyId: P1_COMPANY });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_1 });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_2 });

    // Force roll of 7 (not > effectiveThreshold 7) → pass
    s = { ...s, cheatRollTotal: 7 };
    const rollActions = computeLegalActions(s, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'resolve-dice-check');
    s = dispatch(s, rollActions[0].action);

    // Lagduf must still be in play
    expectCharInPlay(s, RESOURCE_PLAYER, lagdufId);
  });
});
