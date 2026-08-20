/**
 * @module le-44.test
 *
 * Card test: Troll Lout (le-44)
 * Type: minion-character (ringwraith alignment)
 * Stats: Troll warrior, prowess 4, body 9, mind 3, DI 0, MP 1
 * Homesite: Any Dark-hold
 *
 * Card text:
 *   "Discard on a body check result of 8. -1 to all corruption checks."
 *
 * Engine Support:
 * | # | Feature                            | Status      | Notes                                           |
 * |---|------------------------------------|-------------|------------------------------------------------|
 * | 1 | discardBodyCheck [8] (structural)  | IMPLEMENTED | troll discarded to discard pile on failed body check |
 * | 2 | -1 corruption check modifier       | IMPLEMENTED | check-modifier effect, value -1                 |
 *
 * Playable: YES
 *
 * Rules exercised:
 * 1. discardBodyCheck [8]: troll is discarded when body check roll < effective threshold (8 base).
 *    Verified via Veils Flung Away (le-146, −1 modifier): effective threshold = 7;
 *    roll=6 → discard, roll=7 → safe.
 * 2. -1 modifier applied to all corruption checks:
 *    corruptionModifier is -1 and need = CP + 1 − (−1) = CP + 2.
 *
 * Fixtures:
 *   TROLL_LOUT (le-44)          - minion troll warrior, body 9, discardBodyCheck [8]
 *   RED_BOOK (le-339)           - minion resource item, 2 corruption points (triggers check)
 *   VEILS_FLUNG_AWAY (le-146)   - minion hazard event, mass body check (modifier −1)
 *   DOL_GULDUR (le-367)         - minion haven (home site)
 *   MINAS_MORGUL (le-390)       - minion haven (opponent site)
 *   ASTERNAK (le-1)             - minion man character (filler for opponent company)
 *   MORIA (le-392)              - shadow-hold (siteDeck filler)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  buildTestState, resetMint,
  makeMHState, handCardId,
  P1_COMPANY, findCharInstanceId, dispatch,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  expectCharInPlay, expectCharNotInPlay,
  enqueueTransferCorruptionCheck,
  getCharacter,
  ARAGORN, RIVENDELL,
} from '../test-helpers.js';
import { computeLegalActions, Phase, RegionType, Alignment } from '../../index.js';
import type { CardDefinitionId, CorruptionCheckAction, GameState } from '../../index.js';

const TROLL_LOUT = 'le-44' as CardDefinitionId;
const RED_BOOK = 'le-339' as CardDefinitionId;
const VEILS_FLUNG_AWAY = 'le-146' as CardDefinitionId;

const DOL_GULDUR = 'le-367' as CardDefinitionId;    // minion haven
const MINAS_MORGUL = 'le-390' as CardDefinitionId;  // minion haven
const ASTERNAK = 'le-1' as CardDefinitionId;          // minion man character (filler)
const MORIA = 'le-392' as CardDefinitionId;           // shadow-hold (siteDeck filler)

describe('Troll Lout (le-44)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: -1 corruption check modifier ──────────────────────────────────

  test('-1 corruption modifier increases need on pending corruption check', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [{ defId: TROLL_LOUT, items: [RED_BOOK] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const loutId = findCharInstanceId(state, RESOURCE_PLAYER, TROLL_LOUT);
    const itemInstId = getCharacter(state, RESOURCE_PLAYER, TROLL_LOUT).items[0].instanceId;

    const stateWithCheck = enqueueTransferCorruptionCheck(state, PLAYER_1, loutId, itemInstId);

    const actions = computeLegalActions(stateWithCheck, PLAYER_1);
    const ccActions = actions
      .filter(a => a.viable && a.action.type === 'corruption-check')
      .map(a => a.action as CorruptionCheckAction);

    expect(ccActions.length).toBe(1);
    expect(ccActions[0].characterId).toBe(loutId);
    expect(ccActions[0].corruptionModifier).toBe(-1);
    // need = CP + 1 - modifier. With modifier -1, need = CP + 2.
    expect(ccActions[0].need).toBe(ccActions[0].corruptionPoints + 1 - (-1));
  });

  // ── Structural: discardBodyCheck [8] ────────────────────────────────────────

  test('Troll Lout is discarded when body check fails (roll < effective threshold)', () => {
    // discardBodyCheck = [8]; Veils Flung Away applies −1 modifier → effective threshold = 7.
    // Roll of 8 (> 7) triggers failure → character discarded to discard pile.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [TROLL_LOUT] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [ASTERNAK] }], hand: [VEILS_FLUNG_AWAY], siteDeck: [MORIA] },
      ],
    });
    let s: GameState = {
      ...state,
      phaseState: makeMHState({ resolvedSitePath: [RegionType.Wilderness], resolvedSitePathNames: ['Rohan'] }),
    };
    const loutId = findCharInstanceId(s, RESOURCE_PLAYER, TROLL_LOUT);
    const veilId = handCardId(s, HAZARD_PLAYER);

    s = dispatch(s, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: veilId, targetCompanyId: P1_COMPANY });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_1 });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_2 });

    expect(s.pendingResolutions).toHaveLength(1);
    expect(s.pendingResolutions[0].kind.type).toBe('dice-check');

    // Force roll of 8 (> 7 effective threshold) → fail → discard
    s = { ...s, cheatRollTotal: 8 };
    const rollActions = computeLegalActions(s, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'resolve-dice-check');
    expect(rollActions).toHaveLength(1);

    s = dispatch(s, rollActions[0].action);

    expectCharNotInPlay(s, RESOURCE_PLAYER, loutId);
    const discardDefIds = s.players[0].discardPile.map(c => c.definitionId);
    expect(discardDefIds).toContain(TROLL_LOUT);
  });

  test('Troll Lout stays in play when body check passes (roll >= effective threshold)', () => {
    // discardBodyCheck = [8]; Veils Flung Away −1 modifier → effective threshold = 7.
    // Roll of 7 (= 7, passes) → character stays in play.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [TROLL_LOUT] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [ASTERNAK] }], hand: [VEILS_FLUNG_AWAY], siteDeck: [MORIA] },
      ],
    });
    let s: GameState = {
      ...state,
      phaseState: makeMHState({ resolvedSitePath: [RegionType.Wilderness], resolvedSitePathNames: ['Rohan'] }),
    };
    const loutId = findCharInstanceId(s, RESOURCE_PLAYER, TROLL_LOUT);
    const veilId = handCardId(s, HAZARD_PLAYER);

    s = dispatch(s, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: veilId, targetCompanyId: P1_COMPANY });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_1 });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_2 });

    // Force roll of 7 (= 7 effective threshold, passes) → safe
    s = { ...s, cheatRollTotal: 7 };
    const rollActions = computeLegalActions(s, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'resolve-dice-check');
    s = dispatch(s, rollActions[0].action);

    expectCharInPlay(s, RESOURCE_PLAYER, loutId);
  });
});
