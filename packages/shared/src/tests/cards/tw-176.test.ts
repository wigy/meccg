/**
 * @module tw-176.test
 *
 * Card test: Peath (tw-176)
 * Type: hero-character
 * Effects: 3
 *
 * "Unique. +4 direct influence against the Dunlendings faction. Against
 *  Nazgûl and Ringwraiths, +5 to her prowess and the Nazgûl/Ringwraith's
 *  body is halved (rounded up)."
 *
 * Tests:
 * 1. stat-modifier: +4 DI during faction-influence-check for Dunlendings
 * 2. stat-modifier: +5 prowess when combat vs nazgul
 * 3. enemy-modifier: halve enemy body (round up) when combat vs nazgul
 * 4. No combat bonus applies vs non-nazgul enemies
 * 5. DI bonus does not apply to non-Dunlendings factions
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  pool, PLAYER_1, PLAYER_2,
  PEATH, LEGOLAS,
  BARROW_WIGHT,
  DUNLENDINGS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, DUNNISH_CLAN_HOLD,
  buildTestState, resetMint, makeMHState, findCharInstanceId,
  reduce, executeAction, playCreatureHazardAndResolve, runCreatureCombat,
  buildSitePhaseState,
} from '../test-helpers.js';
import { Phase, RegionType, SiteType, computeLegalActions } from '../../index.js';
import type { CharacterCard, CombatState, InfluenceAttemptAction } from '../../index.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const SHADOW_KEYING = { method: 'region-type' as const, value: 'shadow' };

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Peath (tw-176)', () => {
  beforeEach(() => resetMint());

  test('card definition has correct stats and effects', () => {
    const def = pool[PEATH as string] as CharacterCard;
    expect(def).toBeDefined();
    expect(def.cardType).toBe('hero-character');
    expect(def.name).toBe('Peath');
    expect(def.race).toBe('man');
    expect(def.prowess).toBe(4);
    expect(def.body).toBe(7);
    expect(def.mind).toBe(4);
    expect(def.directInfluence).toBe(1);
    expect(def.skills).toEqual(['ranger', 'diplomat']);
    expect(def.effects).toHaveLength(3);
    expect(def.effects![0]).toEqual({
      type: 'stat-modifier',
      stat: 'direct-influence',
      value: 4,
      when: { reason: 'faction-influence-check', 'faction.name': 'Dunlendings' },
    });
    expect(def.effects![1]).toEqual({
      type: 'stat-modifier',
      stat: 'prowess',
      value: 5,
      when: { reason: 'combat', 'enemy.race': 'nazgul' },
    });
    expect(def.effects![2]).toEqual({
      type: 'enemy-modifier',
      stat: 'body',
      op: 'halve-round-up',
      when: { reason: 'combat', 'enemy.race': 'nazgul' },
    });
  });

  test('base effective prowess is 4 (combat bonus does not inflate base stats)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [PEATH] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const peathId = findCharInstanceId(state, 0, PEATH);
    expect(state.players[0].characters[peathId as string].effectiveStats.prowess).toBe(4);
  });

  test('+4 direct influence against Dunlendings faction', () => {
    // Peath (man, base DI 1) attempts to influence Dunlendings at Dunnish Clan-hold.
    // Dunlendings influence number = 9.
    // Peath has +4 DI bonus specifically for Dunlendings.
    // Dunlendings gives Men -1 check modifier.
    //   modifier = DI 1 + DI bonus 4 + Men check penalty (-1) = 4
    //   need = 9 - 4 = 5
    const state = buildSitePhaseState({
      characters: [PEATH],
      site: DUNNISH_CLAN_HOLD,
      hand: [DUNLENDINGS],
    });

    const peathId = findCharInstanceId(state, 0, PEATH);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const peathAttempt = influenceActions.find(
      a => a.influencingCharacterId === peathId,
    );
    expect(peathAttempt).toBeDefined();

    // influenceNumber(9) - baseDI(1) - peathDIBonus(4) - menCheckPenalty(-1 → adds 1) = 5
    // Wait: Men check modifier is -1, so it makes the check harder (+1 to need).
    // need = influenceNumber - DI - DIbonus - checkMod = 9 - 1 - 4 - (-1) = 5
    expect(peathAttempt!.need).toBe(5);
  });

  test('+4 DI bonus does not apply to non-Dunlendings factions', () => {
    // Peath attempting a different faction should NOT get the +4 bonus.
    // Use Legolas attempting Dunlendings — Legolas gets no Peath-specific bonus.
    const state = buildSitePhaseState({
      characters: [LEGOLAS],
      site: DUNNISH_CLAN_HOLD,
      hand: [DUNLENDINGS],
    });

    const legolasId = findCharInstanceId(state, 0, LEGOLAS);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const legolasAttempt = influenceActions.find(
      a => a.influencingCharacterId === legolasId,
    );
    expect(legolasAttempt).toBeDefined();

    // Legolas (elf, DI 2): influenceNumber(9) - baseDI(2) - no race penalty = 7
    expect(legolasAttempt!.need).toBe(7);
  });

  test('+5 prowess bonus applies in combat vs nazgul (no tap)', () => {
    // Peath base prowess 4 + 5 bonus - 3 no-tap = 6.
    // Roll 10: 6 + 10 = 16 > 15 → character defeats strike.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [PEATH] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const peathId = findCharInstanceId(state, 0, PEATH);
    const companyId = state.players[0].companies[0].id;

    const combat: CombatState = {
      attackSource: { type: 'creature', instanceId: 'fake-nazgul' as never },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 15,
      creatureBody: 10,
      creatureRace: 'nazgul',
      strikeAssignments: [],
      currentStrikeIndex: 0,
      phase: 'assign-strikes',
      assignmentPhase: 'defender',
      bodyCheckTarget: null,
      detainment: false,
    };

    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Shadow],
      resolvedSitePathNames: ['Imlad Morgul'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });

    const ready = { ...state, phaseState: mhState, combat };

    // Assign strike
    const result1 = reduce(ready, { type: 'assign-strike', player: PLAYER_1, characterId: peathId });
    expect(result1.error).toBeUndefined();

    // Resolve without tapping: prowess = 4 + 5 - 3 = 6. Roll 10: 6 + 10 = 16 > 15.
    const afterStrike = executeAction(result1.state, PLAYER_1, 'resolve-strike', 10, false);
    expect(afterStrike.combat?.phase).toBe('body-check');
    expect(afterStrike.combat?.bodyCheckTarget).toBe('creature');
  });

  test('+5 prowess bonus does not apply vs non-nazgul (Barrow-wight)', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [PEATH] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [BARROW_WIGHT], siteDeck: [RIVENDELL] },
      ],
    });

    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Shadow],
      resolvedSitePathNames: ['Imlad Morgul'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const ready = { ...state, phaseState: mhState };

    const bwId = ready.players[1].hand[0].instanceId;
    const companyId = ready.players[0].companies[0].id;
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, bwId, companyId, SHADOW_KEYING);

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.creatureRace).toBe('undead');

    // Peath prowess 4 - 3(no tap) = 1 + roll 12 = 13 > 12 → character wins
    const afterCombat = runCreatureCombat(afterChain, PEATH, 12, 2);
    expect(afterCombat.combat).toBeNull();
  });

  test('tapping to fight with +5 bonus gives correct prowess vs nazgul', () => {
    // Tapping: prowess = 4 + 5 = 9 (no -3 penalty).
    // Roll 7: 9 + 7 = 16 > 15 → character wins.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [PEATH] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const peathId = findCharInstanceId(state, 0, PEATH);
    const companyId = state.players[0].companies[0].id;

    const combat: CombatState = {
      attackSource: { type: 'creature', instanceId: 'fake-nazgul' as never },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 15,
      creatureBody: 10,
      creatureRace: 'nazgul',
      strikeAssignments: [{ characterId: peathId, excessStrikes: 0, resolved: false }],
      currentStrikeIndex: 0,
      phase: 'resolve-strike',
      assignmentPhase: 'done',
      bodyCheckTarget: null,
      detainment: false,
    };

    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Shadow],
      resolvedSitePathNames: ['Imlad Morgul'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });

    const ready = { ...state, phaseState: mhState, combat };

    // Resolve with tapping: prowess = 4 + 5 = 9. Roll 7: 9 + 7 = 16 > 15.
    const afterStrike = executeAction(ready, PLAYER_1, 'resolve-strike', 7, true);
    expect(afterStrike.combat?.phase).toBe('body-check');
    expect(afterStrike.combat?.bodyCheckTarget).toBe('creature');
  });

  test('nazgul body 9 (odd) is halved to 5 (rounded up) during body check', () => {
    // Body 9 → ceil(9/2) = 5.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [PEATH] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const peathId = findCharInstanceId(state, 0, PEATH);
    const companyId = state.players[0].companies[0].id;

    const combat: CombatState = {
      attackSource: { type: 'creature', instanceId: 'fake-nazgul' as never },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 5,
      creatureBody: 9,
      creatureRace: 'nazgul',
      strikeAssignments: [{ characterId: peathId, excessStrikes: 0, resolved: false }],
      currentStrikeIndex: 0,
      phase: 'resolve-strike',
      assignmentPhase: 'done',
      bodyCheckTarget: null,
      detainment: false,
    };

    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Shadow],
      resolvedSitePathNames: ['Imlad Morgul'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });

    const ready = { ...state, phaseState: mhState, combat };

    // Win the strike with high roll
    const afterStrike = executeAction(ready, PLAYER_1, 'resolve-strike', 12, false);
    expect(afterStrike.combat?.phase).toBe('body-check');
    expect(afterStrike.combat?.bodyCheckTarget).toBe('creature');

    // Roll 5 ≤ 5 (halved body) → creature survives
    const afterSurvive = executeAction(afterStrike, PLAYER_2, 'body-check-roll', 5);
    expect(afterSurvive.combat).toBeNull();

    // Roll 6 > 5 → creature defeated
    const afterDefeat = executeAction(afterStrike, PLAYER_2, 'body-check-roll', 6);
    expect(afterDefeat.combat).toBeNull();
  });

  test('nazgul body 10 (even) is halved to 5 during body check', () => {
    // Body 10 → ceil(10/2) = 5.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [PEATH] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const peathId = findCharInstanceId(state, 0, PEATH);
    const companyId = state.players[0].companies[0].id;

    const combat: CombatState = {
      attackSource: { type: 'creature', instanceId: 'fake-nazgul' as never },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 5,
      creatureBody: 10,
      creatureRace: 'nazgul',
      strikeAssignments: [{ characterId: peathId, excessStrikes: 0, resolved: false }],
      currentStrikeIndex: 0,
      phase: 'resolve-strike',
      assignmentPhase: 'done',
      bodyCheckTarget: null,
      detainment: false,
    };

    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Shadow],
      resolvedSitePathNames: ['Imlad Morgul'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });

    const ready = { ...state, phaseState: mhState, combat };

    const afterStrike = executeAction(ready, PLAYER_1, 'resolve-strike', 12, false);
    expect(afterStrike.combat?.phase).toBe('body-check');

    // Roll 5 ≤ 5 → creature survives
    const afterSurvive = executeAction(afterStrike, PLAYER_2, 'body-check-roll', 5);
    expect(afterSurvive.combat).toBeNull();

    // Roll 6 > 5 → creature defeated
    const afterDefeat = executeAction(afterStrike, PLAYER_2, 'body-check-roll', 6);
    expect(afterDefeat.combat).toBeNull();
  });

  test('enemy body is not halved vs non-nazgul', () => {
    // Orc with body 9 — body should NOT be halved.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [PEATH] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const peathId = findCharInstanceId(state, 0, PEATH);
    const companyId = state.players[0].companies[0].id;

    const combat: CombatState = {
      attackSource: { type: 'creature', instanceId: 'fake-orc' as never },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 3,
      creatureBody: 9,
      creatureRace: 'orc',
      strikeAssignments: [{ characterId: peathId, excessStrikes: 0, resolved: false }],
      currentStrikeIndex: 0,
      phase: 'resolve-strike',
      assignmentPhase: 'done',
      bodyCheckTarget: null,
      detainment: false,
    };

    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Shadow],
      resolvedSitePathNames: ['Imlad Morgul'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });

    const ready = { ...state, phaseState: mhState, combat };

    const afterStrike = executeAction(ready, PLAYER_1, 'resolve-strike', 12, false);
    expect(afterStrike.combat?.phase).toBe('body-check');

    // Roll 9 ≤ 9 (full body, not halved) → creature survives
    const afterSurvive = executeAction(afterStrike, PLAYER_2, 'body-check-roll', 9);
    expect(afterSurvive.combat).toBeNull();

    // Roll 10 > 9 → creature defeated (body was 9, not 5)
    const afterDefeat = executeAction(afterStrike, PLAYER_2, 'body-check-roll', 10);
    expect(afterDefeat.combat).toBeNull();
  });
});
