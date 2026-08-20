/**
 * @module le-25.test
 *
 * Card test: Muzgash (le-25)
 * Type: minion-character
 *
 * "Unique. Uruk-hai. Discard on a body check result of 8."
 *
 * Muzgash is a unique Uruk-hai Orc Warrior (prowess 4, body 8, mind 2).
 * His `discardBodyCheck: [8]` encodes the standard Orc mass-body-check
 * discard rule: pass threshold is 8. With Veils Flung Away's −1 modifier
 * the effective threshold drops to 7 — rolls of 7+ pass (Muzgash survives),
 * rolls of 6 or lower fail (Muzgash is discarded to the discard pile, not
 * eliminated to the out-of-play pile).
 *
 * Characters used:
 *   - le-25  Muzgash (orc, body 8, discardBodyCheck [8]) — subject under test
 *   - le-1   Asternak (man, body 7) — hazard-player company placeholder
 * Sites used:
 *   - le-390 Minas Morgul (minion haven)
 *   - le-367 Dol Guldur (minion haven)
 *   - le-372 Edoras (free-hold, sitePath contains wilderness)
 *   - le-392 Moria (shadow-hold)
 * Hazard used:
 *   - le-146 Veils Flung Away (short-event, −1 mass body check in wilderness)
 *
 * Engine Support:
 * | # | Feature                                              | Status |
 * |---|------------------------------------------------------|--------|
 * | 1 | Uruk-hai keyword marker on card definition           | OK     |
 * | 2 | discardBodyCheck [8]: pass threshold = 8             | OK     |
 * | 3 | Failed mass body check: discarded to discard pile    | OK     |
 * | 4 | Passed mass body check: stays in play                | OK     |
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

const MUZGASH = 'le-25' as CardDefinitionId;
const ASTERNAK = 'le-1' as CardDefinitionId;   // man, body 7 — hazard player placeholder

const MINAS_MORGUL = 'le-390' as CardDefinitionId; // minion haven (Muzgash home)
const DOL_GULDUR = 'le-367' as CardDefinitionId;   // minion haven (hazard player)
const EDORAS = 'le-372' as CardDefinitionId;        // free-hold, path has wilderness
const MORIA = 'le-392' as CardDefinitionId;         // shadow-hold

const VEILS_FLUNG_AWAY = 'le-146' as CardDefinitionId;

function makeWildernessMH(overrides?: Partial<MovementHazardPhaseState>): MovementHazardPhaseState {
  return makeMHState({
    resolvedSitePath: [RegionType.Wilderness],
    resolvedSitePathNames: ['Rohan'],
    ...overrides,
  });
}

describe('Muzgash (le-25)', () => {
  beforeEach(() => resetMint());

  // ── Mass body check: discardBodyCheck [8] ─────────────────────────────────

  test('discarded to discard pile when mass body check fails', () => {
    // Veils Flung Away applies modifier −1. discardBodyCheck [8] → threshold 7.
    // Roll 8 (> 7) → fail → Muzgash discarded to discard pile.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [MUZGASH] }], hand: [], siteDeck: [EDORAS] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [ASTERNAK] }], hand: [VEILS_FLUNG_AWAY], siteDeck: [MORIA] },
      ],
    });
    let s: GameState = { ...state, phaseState: makeWildernessMH() };
    const muzgashId = findCharInstanceId(s, RESOURCE_PLAYER, MUZGASH);
    const veilId = handCardId(s, HAZARD_PLAYER);

    s = dispatch(s, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: veilId, targetCompanyId: P1_COMPANY });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_1 });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_2 });

    expect(s.pendingResolutions).toHaveLength(1);
    expect(s.pendingResolutions[0].kind.type).toBe('dice-check');
    expect(s.pendingResolutions[0].actor).toBe(PLAYER_1);

    // discardBodyCheck [8] + modifier −1 → pre-resolved threshold 7, target Muzgash.
    const dc = s.pendingResolutions.find(r => r.kind.type === 'dice-check' && r.kind.targetCharacterId === muzgashId);
    expect(dc).toBeDefined();
    if (dc?.kind.type === 'dice-check') {
      expect(dc.kind.targetCharacterId).toBe(muzgashId);
      expect(dc.kind.threshold).toBe(7);
    }

    s = { ...s, cheatRollTotal: 8 };
    const rollActions = computeLegalActions(s, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'resolve-dice-check');
    expect(rollActions).toHaveLength(1);

    const rollAction = rollActions[0].action as ResolveDiceCheckAction;
    s = dispatch(s, rollAction);

    expectCharNotInPlay(s, RESOURCE_PLAYER, muzgashId);
    const discardDefIds = s.players[0].discardPile.map(c => c.definitionId);
    expect(discardDefIds).toContain(MUZGASH);
    expect(s.players[0].outOfPlayPile.map(c => c.definitionId)).not.toContain(MUZGASH);
  });

  test('stays in play when mass body check passes', () => {
    // discardBodyCheck [8], modifier −1 → threshold 7. Roll 7 (not > 7) → pass.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [MUZGASH] }], hand: [], siteDeck: [EDORAS] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [ASTERNAK] }], hand: [VEILS_FLUNG_AWAY], siteDeck: [MORIA] },
      ],
    });
    let s: GameState = { ...state, phaseState: makeWildernessMH() };
    const muzgashId = findCharInstanceId(s, RESOURCE_PLAYER, MUZGASH);
    const veilId = handCardId(s, HAZARD_PLAYER);

    s = dispatch(s, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: veilId, targetCompanyId: P1_COMPANY });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_1 });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_2 });

    s = { ...s, cheatRollTotal: 7 };
    const rollActions = computeLegalActions(s, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'resolve-dice-check');
    s = dispatch(s, rollActions[0].action);

    expectCharInPlay(s, RESOURCE_PLAYER, muzgashId);
  });
});
