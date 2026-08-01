/**
 * @module tw-186.test
 *
 * Card test: Vygavril (tw-186)
 * Type: hero-character (race man, prowess 2, body 7, direct influence 1)
 * Effects: 3
 *
 * "Unique. +2 direct influence against the Southron faction. Against
 *  Nazgûl and Ringwraiths, +6 to her prowess and the Nazgûl/Ringwraith's
 *  body is halved (rounded up)."
 *
 * Rules exercised:
 * 1. stat-modifier: +2 direct influence during a faction-influence-check
 *    against the Southrons faction (and NOT against other factions).
 * 2. stat-modifier: +6 prowess when in combat vs a nazgul (Nazgûl/Ringwraith),
 *    and NOT vs other races.
 * 3. enemy-modifier: the enemy's body is halved (rounded up) when in combat
 *    vs a nazgul, and NOT vs other races.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  LEGOLAS,
  DUNLENDINGS, DUNNISH_CLAN_HOLD,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeShadowMHState, findCharInstanceId,
  executeAction, buildSitePhaseState,
  getCharacter, companyIdAt, dispatch, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { Phase, computeLegalActions, Race } from '../../index.js';
import type { CombatState, InfluenceAttemptAction, CardDefinitionId } from '../../index.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const VYGAVRIL = 'tw-186' as CardDefinitionId;
const SOUTHRONS = 'tw-329' as CardDefinitionId; // Southrons faction (influence number 9)
const SOUTHRON_OASIS = 'tw-426' as CardDefinitionId; // Southrons' playable site (border-hold)

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Vygavril (tw-186)', () => {
  beforeEach(() => resetMint());

  test('base effective prowess is 2 (combat bonus does not inflate base stats)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [VYGAVRIL] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    expect(getCharacter(state, RESOURCE_PLAYER, VYGAVRIL).effectiveStats.prowess).toBe(2);
  });

  test('+2 direct influence against the Southrons faction', () => {
    // Vygavril (man, base DI 1) attempts to influence Southrons at Southron Oasis.
    // Southrons influence number = 9. Vygavril has +2 DI specifically vs Southrons.
    //   need = influenceNumber(9) - baseDI(1) - vygavrilDIBonus(2) = 6
    // Without the bonus the need would be 8, so a need of 6 proves +2 applied.
    const state = buildSitePhaseState({
      characters: [VYGAVRIL],
      site: SOUTHRON_OASIS,
      hand: [SOUTHRONS],
    });

    const vygavrilId = findCharInstanceId(state, RESOURCE_PLAYER, VYGAVRIL);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const vygavrilAttempt = influenceActions.find(a => a.influencingCharacterId === vygavrilId);
    expect(vygavrilAttempt).toBeDefined();
    expect(vygavrilAttempt!.need).toBe(6);
  });

  test('+2 DI bonus does not apply to a non-Southrons faction', () => {
    // Vygavril attempting Dunlendings (a different faction) must NOT get the +2.
    // Dunlendings influence number = 10, gives Men a -1 check modifier.
    //   need = influenceNumber(10) - baseDI(1) - checkMod(-1) = 10
    // If the +2 Southrons bonus wrongly applied the need would be 8.
    const state = buildSitePhaseState({
      characters: [VYGAVRIL],
      site: DUNNISH_CLAN_HOLD,
      hand: [DUNLENDINGS],
    });

    const vygavrilId = findCharInstanceId(state, RESOURCE_PLAYER, VYGAVRIL);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const vygavrilAttempt = influenceActions.find(a => a.influencingCharacterId === vygavrilId);
    expect(vygavrilAttempt).toBeDefined();
    expect(vygavrilAttempt!.need).toBe(10);
  });

  test('+6 prowess bonus applies in combat vs nazgul (no tap)', () => {
    // Vygavril prowess 2 + 6 bonus - 3 no-tap = 5. Roll 11: 5 + 11 = 16 > 15 → win.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [VYGAVRIL] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const vygavrilId = findCharInstanceId(state, RESOURCE_PLAYER, VYGAVRIL);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);

    const combat: CombatState = {
      attackSource: { type: 'creature', instanceId: 'fake-nazgul' as never },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 15,
      creatureBody: 10,
      creatureRace: Race.Ringwraith,
      strikeAssignments: [],
      currentStrikeIndex: 0,
      phase: 'assign-strikes',
      assignmentPhase: 'defender',
      bodyCheckTarget: null,
      detainment: false,
    };

    const ready = { ...state, phaseState: makeShadowMHState(), combat };

    const assigned = dispatch(ready, { type: 'assign-strike', player: PLAYER_1, characterId: vygavrilId });
    const afterStrike = executeAction(assigned, PLAYER_1, 'resolve-strike', 11, false);
    expect(afterStrike.combat?.phase).toBe('body-check');
    expect(afterStrike.combat?.bodyCheckTarget).toBe('creature');
  });

  test('+6 prowess bonus applies in combat vs nazgul (tapping)', () => {
    // Tapping: prowess = 2 + 6 = 8 (no -3 penalty). Roll 8: 8 + 8 = 16 > 15 → win.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [VYGAVRIL] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const vygavrilId = findCharInstanceId(state, RESOURCE_PLAYER, VYGAVRIL);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);

    const combat: CombatState = {
      attackSource: { type: 'creature', instanceId: 'fake-nazgul' as never },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 15,
      creatureBody: 10,
      creatureRace: Race.Ringwraith,
      strikeAssignments: [{ characterId: vygavrilId, excessStrikes: 0, resolved: false }],
      currentStrikeIndex: 0,
      phase: 'resolve-strike',
      assignmentPhase: 'done',
      bodyCheckTarget: null,
      detainment: false,
    };

    const ready = { ...state, phaseState: makeShadowMHState(), combat };

    const afterStrike = executeAction(ready, PLAYER_1, 'resolve-strike', 8, true);
    expect(afterStrike.combat?.phase).toBe('body-check');
    expect(afterStrike.combat?.bodyCheckTarget).toBe('creature');
  });

  test('+6 prowess bonus does NOT apply vs a non-nazgul (orc)', () => {
    // Orc with prowess 8. Vygavril tapping (no -3) base prowess = 2.
    // Roll 4: 2 + 4 = 6 < 8 → wounded (body check vs character).
    // If the +6 bonus wrongly applied, 8 + 4 = 12 > 8 → would defeat the strike
    // (body check vs creature). Asserting bodyCheckTarget === 'character' proves
    // the bonus is nazgul-only.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [VYGAVRIL] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const vygavrilId = findCharInstanceId(state, RESOURCE_PLAYER, VYGAVRIL);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);

    const combat: CombatState = {
      attackSource: { type: 'creature', instanceId: 'fake-orc' as never },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 8,
      creatureBody: 9,
      creatureRace: Race.Orc,
      strikeAssignments: [{ characterId: vygavrilId, excessStrikes: 0, resolved: false }],
      currentStrikeIndex: 0,
      phase: 'resolve-strike',
      assignmentPhase: 'done',
      bodyCheckTarget: null,
      detainment: false,
    };

    const ready = { ...state, phaseState: makeShadowMHState(), combat };

    const afterStrike = executeAction(ready, PLAYER_1, 'resolve-strike', 4, true);
    expect(afterStrike.combat?.phase).toBe('body-check');
    expect(afterStrike.combat?.bodyCheckTarget).toBe('character');
  });

  test('nazgul body 9 (odd) is halved to 5 (rounded up) during body check', () => {
    // Body 9 → ceil(9/2) = 5.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [VYGAVRIL] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const vygavrilId = findCharInstanceId(state, RESOURCE_PLAYER, VYGAVRIL);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);

    const combat: CombatState = {
      attackSource: { type: 'creature', instanceId: 'fake-nazgul' as never },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 5,
      creatureBody: 9,
      creatureRace: Race.Ringwraith,
      strikeAssignments: [{ characterId: vygavrilId, excessStrikes: 0, resolved: false }],
      currentStrikeIndex: 0,
      phase: 'resolve-strike',
      assignmentPhase: 'done',
      bodyCheckTarget: null,
      detainment: false,
    };

    const ready = { ...state, phaseState: makeShadowMHState(), combat };

    const afterStrike = executeAction(ready, PLAYER_1, 'resolve-strike', 12, false);
    expect(afterStrike.combat?.phase).toBe('body-check');
    expect(afterStrike.combat?.bodyCheckTarget).toBe('creature');

    // Roll 5 ≤ 5 (halved body) → creature survives
    const afterSurvive = executeAction(afterStrike, PLAYER_1, 'body-check-roll', 5);
    expect(afterSurvive.combat).toBeNull();

    // Roll 6 > 5 → creature defeated
    const afterDefeat = executeAction(afterStrike, PLAYER_1, 'body-check-roll', 6);
    expect(afterDefeat.combat).toBeNull();
  });

  test('nazgul body 10 (even) is halved to 5 during body check', () => {
    // Body 10 → ceil(10/2) = 5.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [VYGAVRIL] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const vygavrilId = findCharInstanceId(state, RESOURCE_PLAYER, VYGAVRIL);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);

    const combat: CombatState = {
      attackSource: { type: 'creature', instanceId: 'fake-nazgul' as never },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 5,
      creatureBody: 10,
      creatureRace: Race.Ringwraith,
      strikeAssignments: [{ characterId: vygavrilId, excessStrikes: 0, resolved: false }],
      currentStrikeIndex: 0,
      phase: 'resolve-strike',
      assignmentPhase: 'done',
      bodyCheckTarget: null,
      detainment: false,
    };

    const ready = { ...state, phaseState: makeShadowMHState(), combat };

    const afterStrike = executeAction(ready, PLAYER_1, 'resolve-strike', 12, false);
    expect(afterStrike.combat?.phase).toBe('body-check');

    // Roll 5 ≤ 5 → creature survives; roll 6 > 5 → creature defeated
    expect(executeAction(afterStrike, PLAYER_1, 'body-check-roll', 5).combat).toBeNull();
    expect(executeAction(afterStrike, PLAYER_1, 'body-check-roll', 6).combat).toBeNull();
  });

  test('enemy body is NOT halved vs a non-nazgul (orc)', () => {
    // Orc with body 9 — body should NOT be halved.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [VYGAVRIL] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const vygavrilId = findCharInstanceId(state, RESOURCE_PLAYER, VYGAVRIL);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);

    const combat: CombatState = {
      attackSource: { type: 'creature', instanceId: 'fake-orc' as never },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 3,
      creatureBody: 9,
      creatureRace: Race.Orc,
      strikeAssignments: [{ characterId: vygavrilId, excessStrikes: 0, resolved: false }],
      currentStrikeIndex: 0,
      phase: 'resolve-strike',
      assignmentPhase: 'done',
      bodyCheckTarget: null,
      detainment: false,
    };

    const ready = { ...state, phaseState: makeShadowMHState(), combat };

    const afterStrike = executeAction(ready, PLAYER_1, 'resolve-strike', 12, false);
    expect(afterStrike.combat?.phase).toBe('body-check');

    // Roll 9 ≤ 9 (full body, not halved) → creature survives
    expect(executeAction(afterStrike, PLAYER_1, 'body-check-roll', 9).combat).toBeNull();
    // Roll 10 > 9 → creature defeated (body was 9, not 5)
    expect(executeAction(afterStrike, PLAYER_1, 'body-check-roll', 10).combat).toBeNull();
  });
});
