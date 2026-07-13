/**
 * @module le-29.test
 *
 * Card test: Old Troll (le-29)
 * Type: minion-character (ringwraith alignment), non-unique
 * Race: troll | Skills: warrior
 * Stats: prowess 5, body 9, mind 4, direct influence 0, MP 1
 * Homesite: Any Dark-hold
 *
 * Card text:
 *   "Discard on a body check result of 8. +1 direct influence against Trolls,
 *    Orcs, Troll factions, and Orc factions. -1 to all corruption checks."
 *
 * Engine Support (all mechanics pre-existing — no engine change for this card):
 * | # | Feature                                   | Status      | Notes                                              |
 * |---|-------------------------------------------|-------------|----------------------------------------------------|
 * | 1 | discardBodyCheck [8] (structural)         | IMPLEMENTED | rule 8.31 combat reducer discards on a result of 8 |
 * | 2 | +1 DI vs Orc/Troll characters             | IMPLEMENTED | stat-modifier, reason influence-check, target.race |
 * | 3 | +1 DI vs Orc/Troll factions               | IMPLEMENTED | stat-modifier, reason faction-influence-check      |
 * | 4 | -1 to all corruption checks               | IMPLEMENTED | check-modifier corruption, value -1                |
 *
 * Playable: YES
 *
 * Rules exercised:
 *   1. +1 DI vs Orcs lets Old Troll (base DI 0) control an Orc follower of mind 1
 *      (Orc Brawler le-30) it otherwise could not (influence-check, target.race orc).
 *   2. The +1 DI is race-gated: a Man of the same mind 1 (Dunlending Spy le-9) is
 *      NOT controllable — the bonus does not apply to a non-Orc/non-Troll target.
 *   3. +1 DI vs Troll factions reduces the need for Black Trolls (le-262, #11 → 10).
 *   4. +1 DI vs Orc factions reduces the need for Goblins of Goblin-gate (le-265, #9 → 8).
 *   5. -1 to all corruption checks: pending corruption check reports modifier -1
 *      and need = CP + 1 - (-1) = CP + 2.
 *   6. discardBodyCheck [8]: a body check result of exactly 8 discards Old Troll
 *      (not eliminated); a result of 9 (= body, not the special value) leaves it in
 *      play; a result of 10 (> body 9) eliminates it to the out-of-play pile.
 *
 * Fixture alignment: minion-character (ringwraith), so tests use minion sites (LE)
 * and minion candidate characters (LE).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, Alignment,
  buildTestState, buildSitePhaseState, resetMint,
  findCharInstanceId, viablePlayCharacterActions, firstFactionInfluenceAttempt,
  viableActions, dispatch, companyIdAt, makeShadowMHState, makeBodyCheckCombat,
  setCharStatus, CardStatus, getCharacter, RESOURCE_PLAYER,
  enqueueTransferCorruptionCheck,
} from '../test-helpers.js';
import { computeLegalActions, Phase } from '../../index.js';
import type { CardDefinitionId, CorruptionCheckAction, GameState } from '../../index.js';

const OLD_TROLL = 'le-29' as CardDefinitionId;              // troll warrior, DI 0, body 9, discardBodyCheck [8]

// Minion candidate followers for influence-check tests.
const ORC_BRAWLER = 'le-30' as CardDefinitionId;           // orc, mind 1
const DUNLENDING_SPY = 'le-9' as CardDefinitionId;         // man, mind 1 (race-gate control)
const RED_BOOK = 'le-339' as CardDefinitionId;             // minion item, corruption points (triggers check)

// Minion sites.
const MINAS_MORGUL = 'le-390' as CardDefinitionId;         // haven
const DOL_GULDUR = 'le-367' as CardDefinitionId;           // haven
const BARAD_DUR = 'le-352' as CardDefinitionId;            // dark-hold (Old Troll homesite type; Black Trolls playable here)
const GOBLIN_GATE = 'le-378' as CardDefinitionId;          // shadow-hold (Goblins of Goblin-gate's site)
const CARN_DUM = 'le-359' as CardDefinitionId;             // dark-hold (body-check fixture site)
const MORIA_MINION = 'le-392' as CardDefinitionId;         // shadow-hold (site-deck filler)

// Minion factions.
const BLACK_TROLLS = 'le-262' as CardDefinitionId;         // troll faction, influence# 11
const GOBLINS_OF_GOBLIN_GATE = 'le-265' as CardDefinitionId; // orc faction, influence# 9

describe('Old Troll (le-29)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: +1 DI vs Orcs (influence-check follower control) ─────────────────

  test('+1 DI vs Orcs lets Old Troll control an Orc of mind 1 (Orc Brawler)', () => {
    // Old Troll base DI 0 < mind 1 → cannot control. With +1 DI vs Orcs: 1 >= 1 → can.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [OLD_TROLL] }], hand: [ORC_BRAWLER], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [DUNLENDING_SPY] }], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });

    const trollId = findCharInstanceId(state, RESOURCE_PLAYER, OLD_TROLL);
    const underTroll = viablePlayCharacterActions(state, PLAYER_1).filter(a => a.controlledBy === trollId);
    expect(underTroll.length).toBeGreaterThanOrEqual(1);
  });

  // ─── Rule 2: bonus is race-gated ─────────────────────────────────────────────

  test('+1 DI does NOT apply to a Man of the same mind 1 (Dunlending Spy)', () => {
    // Dunlending Spy is race "man" with mind 1. The bonus is race-gated to Orc/Troll,
    // so DI stays at 0 < 1 → no control.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [OLD_TROLL] }], hand: [DUNLENDING_SPY], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [ORC_BRAWLER] }], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });

    const trollId = findCharInstanceId(state, RESOURCE_PLAYER, OLD_TROLL);
    const underTroll = viablePlayCharacterActions(state, PLAYER_1).filter(a => a.controlledBy === trollId);
    expect(underTroll).toHaveLength(0);
  });

  // ─── Rule 3: +1 DI during faction-influence-check vs a Troll faction ──────────

  test('+1 DI vs Troll factions reduces the influence need for Black Trolls', () => {
    // Black Trolls (troll faction, influence# 11) at Barad-dûr.
    // need = influence#(11) - baseDI(0) - diBonusVsTrollFaction(1) = 10.
    const state = buildSitePhaseState({
      characters: [OLD_TROLL],
      site: BARAD_DUR,
      hand: [BLACK_TROLLS],
    });

    const trollId = findCharInstanceId(state, RESOURCE_PLAYER, OLD_TROLL);
    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);

    expect(attempt).toBeDefined();
    expect(attempt!.influencingCharacterId).toBe(trollId);
    expect(attempt!.need).toBe(10);
  });

  // ─── Rule 4: +1 DI during faction-influence-check vs an Orc faction ───────────

  test('+1 DI vs Orc factions reduces the influence need for Goblins of Goblin-gate', () => {
    // Goblins of Goblin-gate (orc faction, influence# 9) at Goblin-gate.
    // need = influence#(9) - baseDI(0) - diBonusVsOrcFaction(1) = 8.
    const state = buildSitePhaseState({
      characters: [OLD_TROLL],
      site: GOBLIN_GATE,
      hand: [GOBLINS_OF_GOBLIN_GATE],
    });

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);

    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(8);
  });

  // ─── Rule 5: -1 to all corruption checks ─────────────────────────────────────

  test('-1 corruption modifier increases need on a pending corruption check', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [{ defId: OLD_TROLL, items: [RED_BOOK] }] }],
          hand: [],
          siteDeck: [MORIA_MINION],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [ORC_BRAWLER] }],
          hand: [],
          siteDeck: [BARAD_DUR],
        },
      ],
    });

    const trollId = findCharInstanceId(state, RESOURCE_PLAYER, OLD_TROLL);
    const itemInstId = getCharacter(state, RESOURCE_PLAYER, OLD_TROLL).items[0].instanceId;

    const stateWithCheck = enqueueTransferCorruptionCheck(state, PLAYER_1, trollId, itemInstId);

    const ccActions = computeLegalActions(stateWithCheck, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'corruption-check')
      .map(a => a.action as CorruptionCheckAction);

    expect(ccActions).toHaveLength(1);
    expect(ccActions[0].characterId).toBe(trollId);
    expect(ccActions[0].corruptionModifier).toBe(-1);
    // need = CP + 1 - modifier. With modifier -1, need = CP + 2.
    expect(ccActions[0].need).toBe(ccActions[0].corruptionPoints + 1 - (-1));
  });

  // ─── Rule 6: Discard on a body check result of 8 ─────────────────────────────

  test('a body check result of exactly 8 discards Old Troll (not eliminated)', () => {
    // discardBodyCheck [8]: result 8 → discard pile, not out-of-play pile.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [OLD_TROLL] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [ORC_BRAWLER] }], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });

    const trollId = findCharInstanceId(state, RESOURCE_PLAYER, OLD_TROLL);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const wounded = setCharStatus(state, RESOURCE_PLAYER, OLD_TROLL, CardStatus.Inverted);
    const readyState: GameState = {
      ...wounded,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: trollId }),
      cheatRollTotal: 8,
    };

    const [bodyCheckAction] = viableActions(readyState, PLAYER_2, 'body-check-roll');
    const after = dispatch(readyState, bodyCheckAction.action);

    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === trollId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === trollId)).toBe(false);
  });

  test('a body check result of 9 (= body, not the special value) leaves Old Troll in play', () => {
    // Body 9, discardBodyCheck [8]: result 9 is neither > body nor the special 8,
    // so the character survives in play.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [OLD_TROLL] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [ORC_BRAWLER] }], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });

    const trollId = findCharInstanceId(state, RESOURCE_PLAYER, OLD_TROLL);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const wounded = setCharStatus(state, RESOURCE_PLAYER, OLD_TROLL, CardStatus.Inverted);
    const readyState: GameState = {
      ...wounded,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: trollId }),
      cheatRollTotal: 9,
    };

    const [bodyCheckAction] = viableActions(readyState, PLAYER_2, 'body-check-roll');
    const after = dispatch(readyState, bodyCheckAction.action);

    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === trollId)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === trollId)).toBe(false);
  });

  test('a body check result above body (10 > 9) eliminates Old Troll to the out-of-play pile', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [OLD_TROLL] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [ORC_BRAWLER] }], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });

    const trollId = findCharInstanceId(state, RESOURCE_PLAYER, OLD_TROLL);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const wounded = setCharStatus(state, RESOURCE_PLAYER, OLD_TROLL, CardStatus.Inverted);
    const readyState: GameState = {
      ...wounded,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: trollId }),
      cheatRollTotal: 10,
    };

    const [bodyCheckAction] = viableActions(readyState, PLAYER_2, 'body-check-roll');
    const after = dispatch(readyState, bodyCheckAction.action);

    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === trollId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === trollId)).toBe(false);
  });
});
