/**
 * @module tw-185.test
 *
 * Card test: Vôteli (tw-185)
 * Type: hero-character (race man, prowess 3, body 6, direct influence 1)
 * Effects: 3
 *
 * "Unique. +2 direct influence against the Lossoth faction. Against
 *  Nazgûl and Ringwraiths, +5 to her prowess and the Nazgûl/Ringwraith's
 *  body is halved (rounded up)."
 *
 * Rules exercised:
 * 1. stat-modifier: +2 direct influence during a faction-influence-check
 *    against the Lossoth faction (and NOT against other factions).
 * 2. stat-modifier: +5 prowess when in combat vs a nazgul (Nazgûl/Ringwraith),
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

const VOTELI = 'tw-185' as CardDefinitionId;
const LOSSOTH = 'tw-268' as CardDefinitionId; // Lossoth faction (influence number 9)
const LOSSADAN_CAMP = 'tw-410' as CardDefinitionId; // Lossoth's playable site (border-hold)

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Vôteli (tw-185)', () => {
  beforeEach(() => resetMint());

  test('base effective prowess is 3 (combat bonus does not inflate base stats)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [VOTELI] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    expect(getCharacter(state, RESOURCE_PLAYER, VOTELI).effectiveStats.prowess).toBe(3);
  });

  test('+2 direct influence against the Lossoth faction', () => {
    // Vôteli (man, base DI 1) attempts to influence Lossoth at Lossadan Camp.
    // Lossoth influence number = 9. Vôteli has +2 DI specifically vs Lossoth.
    //   need = influenceNumber(9) - baseDI(1) - voteliDIBonus(2) = 6
    // Without the bonus the need would be 8, so a need of 6 proves +2 applied.
    const state = buildSitePhaseState({
      characters: [VOTELI],
      site: LOSSADAN_CAMP,
      hand: [LOSSOTH],
    });

    const voteliId = findCharInstanceId(state, RESOURCE_PLAYER, VOTELI);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const voteliAttempt = influenceActions.find(a => a.influencingCharacterId === voteliId);
    expect(voteliAttempt).toBeDefined();
    expect(voteliAttempt!.need).toBe(6);
  });

  test('+2 DI bonus does not apply to a non-Lossoth faction', () => {
    // Vôteli attempting Dunlendings (a different faction) must NOT get the +2.
    // Dunlendings influence number = 10, gives Men a -1 check modifier.
    //   need = influenceNumber(10) - baseDI(1) - checkMod(-1) = 10
    // If the +2 Lossoth bonus wrongly applied the need would be 8.
    const state = buildSitePhaseState({
      characters: [VOTELI],
      site: DUNNISH_CLAN_HOLD,
      hand: [DUNLENDINGS],
    });

    const voteliId = findCharInstanceId(state, RESOURCE_PLAYER, VOTELI);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const voteliAttempt = influenceActions.find(a => a.influencingCharacterId === voteliId);
    expect(voteliAttempt).toBeDefined();
    expect(voteliAttempt!.need).toBe(10);
  });

  test('+5 prowess bonus applies in combat vs nazgul (no tap)', () => {
    // Vôteli prowess 3 + 5 bonus - 3 no-tap = 5. Roll 11: 5 + 11 = 16 > 15 → win.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [VOTELI] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const voteliId = findCharInstanceId(state, RESOURCE_PLAYER, VOTELI);
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

    const assigned = dispatch(ready, { type: 'assign-strike', player: PLAYER_1, characterId: voteliId });
    const afterStrike = executeAction(assigned, PLAYER_1, 'resolve-strike', 11, false);
    expect(afterStrike.combat?.phase).toBe('body-check');
    expect(afterStrike.combat?.bodyCheckTarget).toBe('creature');
  });

  test('+5 prowess bonus applies in combat vs nazgul (tapping)', () => {
    // Tapping: prowess = 3 + 5 = 8 (no -3 penalty). Roll 8: 8 + 8 = 16 > 15 → win.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [VOTELI] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const voteliId = findCharInstanceId(state, RESOURCE_PLAYER, VOTELI);
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
      strikeAssignments: [{ characterId: voteliId, excessStrikes: 0, resolved: false }],
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

  test('+5 prowess bonus does NOT apply vs a non-nazgul (orc)', () => {
    // Orc with prowess 8. Vôteli tapping (no -3) base prowess = 3.
    // Roll 4: 3 + 4 = 7 < 8 → wounded (body check vs character).
    // If the +5 bonus wrongly applied, 8 + 4 = 12 > 8 → would defeat the strike
    // (body check vs creature). Asserting bodyCheckTarget === 'character' proves
    // the bonus is nazgul-only.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [VOTELI] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const voteliId = findCharInstanceId(state, RESOURCE_PLAYER, VOTELI);
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
      strikeAssignments: [{ characterId: voteliId, excessStrikes: 0, resolved: false }],
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
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [VOTELI] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const voteliId = findCharInstanceId(state, RESOURCE_PLAYER, VOTELI);
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
      strikeAssignments: [{ characterId: voteliId, excessStrikes: 0, resolved: false }],
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
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [VOTELI] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const voteliId = findCharInstanceId(state, RESOURCE_PLAYER, VOTELI);
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
      strikeAssignments: [{ characterId: voteliId, excessStrikes: 0, resolved: false }],
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
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [VOTELI] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const voteliId = findCharInstanceId(state, RESOURCE_PLAYER, VOTELI);
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
      strikeAssignments: [{ characterId: voteliId, excessStrikes: 0, resolved: false }],
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
