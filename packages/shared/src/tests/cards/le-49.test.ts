/**
 * @module le-49.test
 *
 * Card test: Ulkaur the Tongueless (le-49)
 * Type: minion-character (ringwraith alignment), unique
 * Race: troll | Skills: warrior | Keywords: Leader, Olog-hai
 * Stats: prowess 6, body 9, mind 5, direct influence 0, MP 2
 * Homesite: Barad-dûr
 *
 * Card text:
 *   "Unique. Olog-hai. Leader. Discard on a body check result of 9. +2 direct
 *    influence against Trolls, Orcs, Troll factions, and Orc factions. -1 to all
 *    corruption checks."
 *
 * Engine Support (all mechanics pre-existing — no engine change for this card):
 * | # | Feature                                   | Status      | Notes                                              |
 * |---|-------------------------------------------|-------------|----------------------------------------------------|
 * | 1 | discardBodyCheck [9] (structural)         | IMPLEMENTED | rule 8.31 combat reducer discards on a result of 9 |
 * | 2 | Leader keyword (structural)               | IMPLEMENTED | leader-control variant of a faction influence roll |
 * | 3 | +2 DI vs Orc/Troll characters             | IMPLEMENTED | stat-modifier, reason influence-check, target.race |
 * | 4 | +2 DI vs Orc/Troll factions               | IMPLEMENTED | stat-modifier, reason faction-influence-check      |
 * | 5 | -1 to all corruption checks               | IMPLEMENTED | check-modifier corruption, value -1                |
 *
 * Playable: YES
 *
 * Rules exercised:
 *   1. +2 DI vs Orcs lets Ulkaur (base DI 0) control an Orc follower of mind 1
 *      (Orc Brawler le-30) that his base DI alone could not reach.
 *   2. The +2 DI is race-gated: a Man of the same mind 1 (Dunlending Spy le-9) is
 *      NOT controllable — the bonus does not apply to a non-Orc/non-Troll target.
 *   3. +2 DI vs Trolls: wearing High Helm (le-313, +2 DI) Ulkaur reaches DI 4 and
 *      can control Troll Lout (le-44, troll, mind 3), while the same DI 2 without
 *      the race bonus cannot reach Dorelas (le-8, man, mind 3).
 *   4. +2 DI vs Troll factions reduces the need for Black Trolls (le-262, #11 → 9).
 *   5. +2 DI vs Orc factions reduces the need for Goblins of Goblin-gate (le-265, #9 → 7).
 *   6. Leader keyword: Ulkaur is offered the place-under-leader-control variant of the
 *      Black Trolls influence attempt; a non-Leader troll (Troll Lout) is not.
 *   7. -1 to all corruption checks: a pending corruption check reports modifier -1
 *      and need = CP + 1 - (-1) = CP + 2.
 *   8. discardBodyCheck [9]: a body check result of exactly 9 (= body, but the card's
 *      special value) discards Ulkaur rather than leaving him in play; a result of
 *      8 leaves him in play; a result of 10 (> body 9) eliminates him out of play.
 *
 * "Olog-hai" is a troll-subtype trait with no separate mechanical rule beyond the
 * keyword itself (the engine treats it like Uruk-hai / Half-troll labels), so it
 * carries no dedicated assertion. "Unique" is deck-construction data.
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
import type {
  CardDefinitionId, CardInstanceId, CorruptionCheckAction, GameState, InfluenceAttemptAction,
} from '../../index.js';

const ULKAUR = 'le-49' as CardDefinitionId;                // troll Leader, DI 0, body 9, discardBodyCheck [9]

// Minion candidate followers for influence-check tests.
const ORC_BRAWLER = 'le-30' as CardDefinitionId;           // orc, mind 1
const DUNLENDING_SPY = 'le-9' as CardDefinitionId;         // man, mind 1 (race-gate control)
const TROLL_LOUT = 'le-44' as CardDefinitionId;            // troll, mind 3, NOT a Leader
const DORELAS = 'le-8' as CardDefinitionId;                // man, mind 3 (race-gate control)

// Minion items.
const HIGH_HELM = 'le-313' as CardDefinitionId;            // +2 direct influence (unconditional)
const RED_BOOK = 'le-339' as CardDefinitionId;             // corruption points (triggers a corruption check)

// Minion sites.
const MINAS_MORGUL = 'le-390' as CardDefinitionId;         // haven
const DOL_GULDUR = 'le-367' as CardDefinitionId;           // haven
const BARAD_DUR = 'le-352' as CardDefinitionId;            // dark-hold (Ulkaur's homesite; Black Trolls playable here)
const GOBLIN_GATE = 'le-378' as CardDefinitionId;          // shadow-hold (Goblins of Goblin-gate's site)
const CARN_DUM = 'le-359' as CardDefinitionId;             // dark-hold (body-check fixture site)
const MORIA_MINION = 'le-392' as CardDefinitionId;         // shadow-hold (site-deck filler)

// Minion factions.
const BLACK_TROLLS = 'le-262' as CardDefinitionId;         // troll faction, influence# 11, leader-control
const GOBLINS_OF_GOBLIN_GATE = 'le-265' as CardDefinitionId; // orc faction, influence# 9

/** Place-under-leader-control variants of the faction influence attempt. */
function controlVariants(state: GameState, factionInstanceId: CardInstanceId): InfluenceAttemptAction[] {
  return viableActions(state, PLAYER_1, 'influence-attempt')
    .map(a => a.action as InfluenceAttemptAction)
    .filter(a => a.factionInstanceId === factionInstanceId && a.placeUnderLeaderControl === true);
}

describe('Ulkaur the Tongueless (le-49)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: +2 DI vs Orcs (influence-check follower control) ────────────────

  test('+2 DI vs Orcs lets Ulkaur control an Orc of mind 1 (Orc Brawler)', () => {
    // Ulkaur base DI 0 < mind 1 → cannot control. With +2 DI vs Orcs: 2 >= 1 → can.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [ULKAUR] }], hand: [ORC_BRAWLER], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [DUNLENDING_SPY] }], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });

    const ulkaurId = findCharInstanceId(state, RESOURCE_PLAYER, ULKAUR);
    const underUlkaur = viablePlayCharacterActions(state, PLAYER_1).filter(a => a.controlledBy === ulkaurId);
    expect(underUlkaur.length).toBeGreaterThanOrEqual(1);
  });

  // ─── Rule 2: the bonus is race-gated ────────────────────────────────────────

  test('+2 DI does NOT apply to a Man of the same mind 1 (Dunlending Spy)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [ULKAUR] }], hand: [DUNLENDING_SPY], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [ORC_BRAWLER] }], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });

    const ulkaurId = findCharInstanceId(state, RESOURCE_PLAYER, ULKAUR);
    const underUlkaur = viablePlayCharacterActions(state, PLAYER_1).filter(a => a.controlledBy === ulkaurId);
    expect(underUlkaur).toHaveLength(0);
  });

  // ─── Rule 3: +2 DI vs Trolls (influence-check follower control) ──────────────

  test('+2 DI vs Trolls lets a High-Helmed Ulkaur (DI 2) control Troll Lout (mind 3)', () => {
    // High Helm grants +2 DI unconditionally → base DI 2. The troll bonus adds
    // another +2 against a troll target: 4 >= mind 3 → controllable.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [{ defId: ULKAUR, items: [HIGH_HELM] }] }],
          hand: [TROLL_LOUT],
          siteDeck: [MORIA_MINION],
        },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [ORC_BRAWLER] }], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });

    const ulkaurId = findCharInstanceId(state, RESOURCE_PLAYER, ULKAUR);
    const underUlkaur = viablePlayCharacterActions(state, PLAYER_1).filter(a => a.controlledBy === ulkaurId);
    expect(underUlkaur.length).toBeGreaterThanOrEqual(1);
  });

  test('the same High-Helmed Ulkaur (DI 2) cannot control a Man of mind 3 (Dorelas)', () => {
    // Identical fixture, non-Orc/non-Troll target of the same mind: only the
    // unconditional +2 applies → 2 < 3 → not controllable.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MINAS_MORGUL, characters: [{ defId: ULKAUR, items: [HIGH_HELM] }] }],
          hand: [DORELAS],
          siteDeck: [MORIA_MINION],
        },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [ORC_BRAWLER] }], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });

    const ulkaurId = findCharInstanceId(state, RESOURCE_PLAYER, ULKAUR);
    const underUlkaur = viablePlayCharacterActions(state, PLAYER_1).filter(a => a.controlledBy === ulkaurId);
    expect(underUlkaur).toHaveLength(0);
  });

  // ─── Rule 4: +2 DI during faction-influence-check vs a Troll faction ─────────

  test('+2 DI vs Troll factions reduces the influence need for Black Trolls', () => {
    // Black Trolls (troll faction, influence# 11) at Barad-dûr.
    // need = influence#(11) - baseDI(0) - diBonusVsTrollFaction(2) = 9.
    const state = buildSitePhaseState({
      characters: [ULKAUR],
      site: BARAD_DUR,
      hand: [BLACK_TROLLS],
    });

    const ulkaurId = findCharInstanceId(state, RESOURCE_PLAYER, ULKAUR);
    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);

    expect(attempt).toBeDefined();
    expect(attempt!.influencingCharacterId).toBe(ulkaurId);
    expect(attempt!.need).toBe(9);
  });

  // ─── Rule 5: +2 DI during faction-influence-check vs an Orc faction ──────────

  test('+2 DI vs Orc factions reduces the influence need for Goblins of Goblin-gate', () => {
    // Goblins of Goblin-gate (orc faction, influence# 9) at Goblin-gate.
    // need = influence#(9) - baseDI(0) - diBonusVsOrcFaction(2) = 7.
    const state = buildSitePhaseState({
      characters: [ULKAUR],
      site: GOBLIN_GATE,
      hand: [GOBLINS_OF_GOBLIN_GATE],
    });

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);

    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(7);
  });

  // ─── Rule 6: Leader keyword enables the leader-control variant ───────────────

  test('Leader keyword: Ulkaur is offered the place-under-leader-control variant for Black Trolls', () => {
    const state = buildSitePhaseState({
      characters: [ULKAUR],
      site: BARAD_DUR,
      hand: [BLACK_TROLLS],
    });
    const factionInstanceId = state.players[0].hand[0].instanceId;

    expect(controlVariants(state, factionInstanceId)).toHaveLength(1);
  });

  test('a non-Leader troll (Troll Lout) is NOT offered the leader-control variant', () => {
    const state = buildSitePhaseState({
      characters: [TROLL_LOUT],
      site: BARAD_DUR,
      hand: [BLACK_TROLLS],
    });
    const factionInstanceId = state.players[0].hand[0].instanceId;

    expect(controlVariants(state, factionInstanceId)).toHaveLength(0);
    expect(firstFactionInfluenceAttempt(state, factionInstanceId)).toBeDefined();
  });

  // ─── Rule 7: -1 to all corruption checks ────────────────────────────────────

  test('-1 corruption modifier increases need on a pending corruption check', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [{ defId: ULKAUR, items: [RED_BOOK] }] }],
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

    const ulkaurId = findCharInstanceId(state, RESOURCE_PLAYER, ULKAUR);
    const itemInstId = getCharacter(state, RESOURCE_PLAYER, ULKAUR).items[0].instanceId;

    const stateWithCheck = enqueueTransferCorruptionCheck(state, PLAYER_1, ulkaurId, itemInstId);

    const ccActions = computeLegalActions(stateWithCheck, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'corruption-check')
      .map(a => a.action as CorruptionCheckAction);

    expect(ccActions).toHaveLength(1);
    expect(ccActions[0].characterId).toBe(ulkaurId);
    expect(ccActions[0].corruptionModifier).toBe(-1);
    // need = CP + 1 - modifier. With modifier -1, need = CP + 2.
    expect(ccActions[0].need).toBe(ccActions[0].corruptionPoints + 1 - (-1));
  });

  // ─── Rule 8: Discard on a body check result of 9 ─────────────────────────────

  test('a body check result of exactly 9 discards Ulkaur (not eliminated)', () => {
    // discardBodyCheck [9]: a result equal to body would normally be survivable,
    // but the card's special value sends him to the discard pile instead.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [ULKAUR] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [ORC_BRAWLER] }], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });

    const ulkaurId = findCharInstanceId(state, RESOURCE_PLAYER, ULKAUR);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const wounded = setCharStatus(state, RESOURCE_PLAYER, ULKAUR, CardStatus.Inverted);
    const readyState: GameState = {
      ...wounded,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: ulkaurId }),
      cheatRollTotal: 9,
    };

    const [bodyCheckAction] = viableActions(readyState, PLAYER_2, 'body-check-roll');
    const after = dispatch(readyState, bodyCheckAction.action);

    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === ulkaurId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === ulkaurId)).toBe(false);
  });

  test('a body check result of 8 (< body, not the special value) leaves Ulkaur in play', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [ULKAUR] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [ORC_BRAWLER] }], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });

    const ulkaurId = findCharInstanceId(state, RESOURCE_PLAYER, ULKAUR);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const wounded = setCharStatus(state, RESOURCE_PLAYER, ULKAUR, CardStatus.Inverted);
    const readyState: GameState = {
      ...wounded,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: ulkaurId }),
      cheatRollTotal: 8,
    };

    const [bodyCheckAction] = viableActions(readyState, PLAYER_2, 'body-check-roll');
    const after = dispatch(readyState, bodyCheckAction.action);

    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === ulkaurId)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === ulkaurId)).toBe(false);
  });

  test('a body check result above body (10 > 9) eliminates Ulkaur to the out-of-play pile', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [ULKAUR] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [ORC_BRAWLER] }], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });

    const ulkaurId = findCharInstanceId(state, RESOURCE_PLAYER, ULKAUR);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const wounded = setCharStatus(state, RESOURCE_PLAYER, ULKAUR, CardStatus.Inverted);
    const readyState: GameState = {
      ...wounded,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: ulkaurId }),
      cheatRollTotal: 10,
    };

    const [bodyCheckAction] = viableActions(readyState, PLAYER_2, 'body-check-roll');
    const after = dispatch(readyState, bodyCheckAction.action);

    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === ulkaurId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === ulkaurId)).toBe(false);
  });
});
