/**
 * @module le-12.test
 *
 * Card test: Grishnákh (le-12)
 * Type: minion-character (Ringwraith alignment)
 *
 * "Unique. Uruk-hai. Discard on a body check result of 8."
 *
 * Card shape (documented here, NOT asserted — see CLAUDE.md no-tautology rule):
 *   race: orc, keywords: ["uruk-hai"], unique, body 8, prowess 4, mind 3,
 *   skills warrior/scout, discardBodyCheck [8]. Homesite "Any site in Imlad
 *   Morgul".
 *
 * Engine Support:
 * | # | Rule (card text)                       | Status | Notes                                          |
 * |---|----------------------------------------|--------|------------------------------------------------|
 * | 1 | "Unique."                              | OK     | unique: true — duplication-limit (deck/play)   |
 * | 2 | "Uruk-hai."                            | DATA   | classification keyword; no engine gate of its  |
 * |   |                                        |        | own (tag for other cards' matchers)            |
 * | 3 | "Discard on a body check result of 8." | OK     | discardBodyCheck [8] — body-check resolution   |
 *
 * Playable: YES
 *
 * Rules exercised:
 * 1. discardBodyCheck [8]: Grishnákh (orc, body 8) is discarded to the resource
 *    player's discard pile (not eliminated) when a mass body check fails. Veils
 *    Flung Away applies a -1 roll modifier (CoE 3.I.1); a roll of 9 (total 8,
 *    matching the printed value) triggers the discard.
 * 2. Grishnákh stays in play when the body check passes (roll <= 7).
 * 3. "Unique.": only a single copy of Grishnákh may be organised into play —
 *    the engine refuses to play a second copy from hand while one is already
 *    in a company (duplication limit on the unique character).
 *
 * Fixtures:
 *   GRISHNAKH (le-12)         — minion orc warrior/scout, body 8, discardBodyCheck [8], unique
 *   VEILS_FLUNG_AWAY (le-146) — hazard short event; body check modifier -1
 *   LAGDUF (le-18)            — minion orc (opponent filler)
 *   DOL_GULDUR (le-367)       — minion haven (company site)
 *   MINAS_MORGUL (le-390)     — minion haven (opponent site)
 *   EDORAS_LE (le-372)        — free-hold; site path has Wilderness
 *   MORIA_LE (le-392)         — shadow-hold (siteDeck filler)
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
import { Phase, RegionType, Alignment } from '../../index.js';
import type { GameState, MovementHazardPhaseState, CardDefinitionId, ResolveDiceCheckAction } from '../../index.js';

const GRISHNAKH = 'le-12' as CardDefinitionId;
const VEILS_FLUNG_AWAY = 'le-146' as CardDefinitionId;
const LAGDUF = 'le-18' as CardDefinitionId;

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

describe('Grishnákh (le-12)', () => {
  beforeEach(() => resetMint());

  // ── discardBodyCheck [8]: fail → discard to discard pile ──────────────────

  test('Grishnákh is discarded to discard pile when mass body check fails', () => {
    // discardBodyCheck [8]; Veils' -1 rides the roll (CoE 3.I.1) — a total of 8 discards.
    // Roll 9 (total 8, matching the value) → Grishnákh discarded to resource player's discard pile.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [GRISHNAKH] }], hand: [], siteDeck: [EDORAS_LE] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [VEILS_FLUNG_AWAY], siteDeck: [MORIA_LE] },
      ],
    });
    let s: GameState = { ...state, phaseState: makeWildernessMH() };
    const grishnakhId = findCharInstanceId(s, RESOURCE_PLAYER, GRISHNAKH);
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

    // discardBodyCheck [8] → threshold = body 8, -1 roll modifier, target Grishnákh.
    const dc = s.pendingResolutions.find(r => r.kind.type === 'dice-check' && r.kind.targetCharacterId === grishnakhId);
    expect(dc).toBeDefined();
    if (dc?.kind.type === 'dice-check') {
      expect(dc.kind.targetCharacterId).toBe(grishnakhId);
      expect(dc.kind.threshold).toBe(8);
    }

    // Force roll of 9 → total 8 matches the discard value
    s = { ...s, cheatRollTotal: 9 };
    const rollActions = computeLegalActions(s, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'resolve-dice-check');
    expect(rollActions).toHaveLength(1);

    const rollAction = rollActions[0].action as ResolveDiceCheckAction;
    s = dispatch(s, rollAction);

    // Grishnákh must be removed from play and sent to discard pile
    expectCharNotInPlay(s, RESOURCE_PLAYER, grishnakhId);
    const discardDefIds = s.players[RESOURCE_PLAYER].discardPile.map(c => c.definitionId);
    expect(discardDefIds).toContain(GRISHNAKH);
    // Must NOT be in the out-of-play pile (that would be elimination, not discard)
    const oopDefIds = s.players[RESOURCE_PLAYER].outOfPlayPile.map(c => c.definitionId);
    expect(oopDefIds).not.toContain(GRISHNAKH);
  });

  // ── discardBodyCheck [8]: pass → no effect ────────────────────────────────

  test('Grishnákh stays in play when mass body check passes', () => {
    // discardBodyCheck [8]; Veils' -1 rides the roll (CoE 3.I.1) — a total of 8 discards.
    // Roll 7 (not > threshold) → pass → Grishnákh remains in play.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [GRISHNAKH] }], hand: [], siteDeck: [EDORAS_LE] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [VEILS_FLUNG_AWAY], siteDeck: [MORIA_LE] },
      ],
    });
    let s: GameState = { ...state, phaseState: makeWildernessMH() };
    const grishnakhId = findCharInstanceId(s, RESOURCE_PLAYER, GRISHNAKH);
    const veilId = handCardId(s, HAZARD_PLAYER);

    s = dispatch(s, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: veilId, targetCompanyId: P1_COMPANY });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_1 });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_2 });

    // Force roll of 7 → total 6: no match, ≤ body → pass
    s = { ...s, cheatRollTotal: 7 };
    const rollActions = computeLegalActions(s, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'resolve-dice-check');
    s = dispatch(s, rollActions[0].action);

    // Grishnákh must still be in play
    expectCharInPlay(s, RESOURCE_PLAYER, grishnakhId);
  });

  // ── "Unique.": only one copy of Grishnákh may be in play ──────────────────

  test('a second copy of Grishnákh cannot be organised into play while one is already in play', () => {
    // Player 1 already has Grishnákh in a company and holds a second copy in
    // hand. The unique duplication limit must forbid playing the second copy.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [GRISHNAKH] }], hand: [GRISHNAKH], siteDeck: [EDORAS_LE] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [MORIA_LE] },
      ],
    });

    const dupId = handCardId(state, RESOURCE_PLAYER);
    const playActions = computeLegalActions(state, PLAYER_1)
      .filter(a => a.action.type === 'play-character'
        && a.action.characterInstanceId === dupId);

    // The second copy is offered but blocked — and specifically because the
    // unique Grishnákh is already in play (not for some unrelated reason).
    expect(playActions.length).toBeGreaterThanOrEqual(1);
    expect(playActions.every(a => !a.viable)).toBe(true);
    expect(playActions.some(a => /unique/i.test(a.reason ?? ''))).toBe(true);
  });
});
