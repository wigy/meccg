/**
 * @module wh-6.test
 *
 * Card test: Lugdush (wh-6)
 * Type: minion-character
 *
 * "Unique. Uruk-hai. Discard on a body check result of 8."
 *
 * Lugdush is a unique Uruk-hai Orc Warrior/Scout (prowess 5, body 8, mind 4).
 * The three printed clauses are all structural:
 *   - "Unique."   → `unique: true`; the duplication engine prevents a second
 *                   copy of a unique card from coming into play.
 *   - "uruk-hai." → `keywords: ["uruk-hai"]`; a descriptive classification
 *                   label consumed by condition filters on other cards. It
 *                   carries no standalone gate of its own.
 *   - "Discard on a body check result of 8." → `discardBodyCheck: [8]`; in the
 *                   mass body check resolution a roll that meets/beats the
 *                   body passes; a total matching [8] discards Lugdush
 *                   to the discard pile (not eliminated to out-of-play).
 *
 * Veils Flung Away applies a −1 modifier to the mass body check in a wilderness,
 * so a roll of 9 gives a total of 8, matching the printed discard value, and
 * discards Lugdush; a roll of 7 (= 7) passes and he stays in play.
 *
 * Characters used:
 *   - wh-6   Lugdush (orc, body 8, discardBodyCheck [8]) — subject under test
 *   - le-12  Grishnakh (minion orc) — hazard-player company placeholder
 * Sites used:
 *   - le-367 Dol Guldur (minion haven)
 *   - le-390 Minas Morgul (minion haven)
 *   - le-372 Edoras (free-hold, sitePath contains wilderness)
 *   - le-392 Moria (shadow-hold, siteDeck filler)
 * Hazard used:
 *   - le-146 Veils Flung Away (short-event, −1 mass body check in wilderness)
 *
 * Engine Support:
 * | # | Feature                                              | Status | Notes                                 |
 * |---|------------------------------------------------------|--------|---------------------------------------|
 * | 1 | unique: true                                         | OK     | duplication-limit prevents 2nd copy   |
 * | 2 | keywords: ["uruk-hai"]                               | DATA   | classification label, no current gate |
 * | 3 | discardBodyCheck [8]: pass threshold = 8             | OK     | dice-check (body-check) resolution    |
 * | 4 | failed mass body check → discarded to discard pile   | OK     | not eliminated to out-of-play         |
 * | 5 | passed mass body check → stays in play               | OK     |                                       |
 *
 * Playable: YES
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

const LUGDUSH = 'wh-6' as CardDefinitionId;
const GRISHNAKH = 'le-12' as CardDefinitionId;   // minion orc — hazard player placeholder

const DOL_GULDUR = 'le-367' as CardDefinitionId;   // minion haven (Lugdush company)
const MINAS_MORGUL = 'le-390' as CardDefinitionId; // minion haven (hazard player)
const EDORAS = 'le-372' as CardDefinitionId;        // free-hold, path has wilderness
const MORIA = 'le-392' as CardDefinitionId;         // shadow-hold (siteDeck filler)

const VEILS_FLUNG_AWAY = 'le-146' as CardDefinitionId;

/** Build an MH state with a Wilderness in the site path (Veils Flung Away condition). */
function makeWildernessMH(overrides?: Partial<MovementHazardPhaseState>): MovementHazardPhaseState {
  return makeMHState({
    resolvedSitePath: [RegionType.Wilderness],
    resolvedSitePathNames: ['Rohan'],
    ...overrides,
  });
}

describe('Lugdush (wh-6)', () => {
  beforeEach(() => resetMint());

  // ── discardBodyCheck [8]: fail → discard to discard pile ──────────────────

  test('discarded to discard pile when mass body check fails', () => {
    // Veils Flung Away applies a -1 roll modifier (CoE 3.I.1). Threshold = body 8; discard band [8].
    // Roll 9 (total 8, matching the value) → Lugdush discarded to the resource player's discard pile.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [LUGDUSH] }], hand: [], siteDeck: [EDORAS] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [GRISHNAKH] }], hand: [VEILS_FLUNG_AWAY], siteDeck: [MORIA] },
      ],
    });
    let s: GameState = { ...state, phaseState: makeWildernessMH() };
    const lugdushId = findCharInstanceId(s, RESOURCE_PLAYER, LUGDUSH);
    const veilId = handCardId(s, HAZARD_PLAYER);

    s = dispatch(s, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: veilId, targetCompanyId: P1_COMPANY });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_1 });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_2 });

    expect(s.pendingResolutions).toHaveLength(1);
    expect(s.pendingResolutions[0].kind.type).toBe('dice-check');
    expect(s.pendingResolutions[0].actor).toBe(PLAYER_1);

    // discardBodyCheck [8] → threshold = body 8, -1 roll modifier, target Lugdush.
    const dc = s.pendingResolutions.find(r => r.kind.type === 'dice-check' && r.kind.targetCharacterId === lugdushId);
    expect(dc).toBeDefined();
    if (dc?.kind.type === 'dice-check') {
      expect(dc.kind.targetCharacterId).toBe(lugdushId);
      expect(dc.kind.threshold).toBe(8);
    }

    s = { ...s, cheatRollTotal: 9 };
    const rollActions = computeLegalActions(s, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'resolve-dice-check');
    expect(rollActions).toHaveLength(1);

    const rollAction = rollActions[0].action as ResolveDiceCheckAction;
    s = dispatch(s, rollAction);

    expectCharNotInPlay(s, RESOURCE_PLAYER, lugdushId);
    const discardDefIds = s.players[RESOURCE_PLAYER].discardPile.map(c => c.definitionId);
    expect(discardDefIds).toContain(LUGDUSH);
    // Must NOT be in the out-of-play pile (that would be elimination, not discard)
    const oopDefIds = s.players[RESOURCE_PLAYER].outOfPlayPile.map(c => c.definitionId);
    expect(oopDefIds).not.toContain(LUGDUSH);
  });

  // ── discardBodyCheck [8]: pass → stays in play ────────────────────────────

  test('stays in play when mass body check passes', () => {
    // discardBodyCheck [8], -1 roll modifier. Roll 7 → total 6: no match, ≤ body → pass.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [LUGDUSH] }], hand: [], siteDeck: [EDORAS] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [GRISHNAKH] }], hand: [VEILS_FLUNG_AWAY], siteDeck: [MORIA] },
      ],
    });
    let s: GameState = { ...state, phaseState: makeWildernessMH() };
    const lugdushId = findCharInstanceId(s, RESOURCE_PLAYER, LUGDUSH);
    const veilId = handCardId(s, HAZARD_PLAYER);

    s = dispatch(s, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: veilId, targetCompanyId: P1_COMPANY });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_1 });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_2 });

    s = { ...s, cheatRollTotal: 7 };
    const rollActions = computeLegalActions(s, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'resolve-dice-check');
    s = dispatch(s, rollActions[0].action);

    expectCharInPlay(s, RESOURCE_PLAYER, lugdushId);
  });
});
