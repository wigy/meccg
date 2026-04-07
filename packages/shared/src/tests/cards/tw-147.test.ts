/**
 * @module tw-147.test
 *
 * Card test: Éowyn (tw-147)
 * Type: hero-character
 * Effects: 2
 *
 * "Unique. Against Nazgûl and Ringwraiths, +6 to her prowess and the
 *  Nazgûl/Ringwraith's body is halved (rounded up)."
 *
 * Tests:
 * 1. stat-modifier: +6 prowess when combat vs nazgul
 * 2. enemy-modifier: halve enemy body (round up) when combat vs nazgul
 * 3. No bonus applies vs non-nazgul enemies
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  pool, PLAYER_1, PLAYER_2,
  EOWYN, LEGOLAS,
  BARROW_WIGHT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState, findCharInstanceId,
  reduce, executeAction, playCreatureHazardAndResolve, runCreatureCombat,
} from '../test-helpers.js';
import { Phase, RegionType, SiteType, CardStatus } from '../../index.js';
import type { CharacterCard, CombatState } from '../../index.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const SHADOW_KEYING = { method: 'region-type' as const, value: 'shadow' };

/**
 * Build a state with Éowyn in combat against a creature with the given race.
 * Returns the state ready for strike assignment or resolution.
 */
function buildCombatState(opts: {
  creatureRace: string;
  creatureProwess: number;
  creatureBody: number | null;
  preAssigned?: boolean;
}) {
  const state = buildTestState({
    phase: Phase.MovementHazard,
    activePlayer: PLAYER_1,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [EOWYN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
    ],
  });

  const eowynId = findCharInstanceId(state, 0, EOWYN);
  const companyId = state.players[0].companies[0].id;

  const combat: CombatState = {
    attackSource: { type: 'creature', instanceId: `fake-${opts.creatureRace}` as never },
    companyId,
    defendingPlayerId: PLAYER_1,
    attackingPlayerId: PLAYER_2,
    strikesTotal: 1,
    strikeProwess: opts.creatureProwess,
    creatureBody: opts.creatureBody,
    creatureRace: opts.creatureRace,
    strikeAssignments: opts.preAssigned
      ? [{ characterId: eowynId, excessStrikes: 0, resolved: false }]
      : [],
    currentStrikeIndex: 0,
    phase: opts.preAssigned ? 'resolve-strike' : 'assign-strikes',
    assignmentPhase: opts.preAssigned ? 'done' : 'defender',
    bodyCheckTarget: null,
    detainment: false,
  };

  const mhState = makeMHState({
    resolvedSitePath: [RegionType.Shadow],
    resolvedSitePathNames: ['Imlad Morgul'],
    destinationSiteType: SiteType.ShadowHold,
    destinationSiteName: 'Moria',
  });

  return { ...state, phaseState: mhState, combat };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Éowyn (tw-147)', () => {
  beforeEach(() => resetMint());

  test('card definition has correct stats and effects', () => {
    const def = pool[EOWYN as string] as CharacterCard;
    expect(def).toBeDefined();
    expect(def.cardType).toBe('hero-character');
    expect(def.name).toBe('Éowyn');
    expect(def.race).toBe('man');
    expect(def.prowess).toBe(2);
    expect(def.body).toBe(7);
    expect(def.mind).toBe(2);
    expect(def.directInfluence).toBe(0);
    expect(def.skills).toEqual(['warrior', 'scout']);
    expect(def.effects).toHaveLength(2);
    expect(def.effects![0]).toEqual({
      type: 'stat-modifier',
      stat: 'prowess',
      value: 6,
      when: { reason: 'combat', 'enemy.race': 'nazgul' },
    });
    expect(def.effects![1]).toEqual({
      type: 'enemy-modifier',
      stat: 'body',
      op: 'halve-round-up',
      when: { reason: 'combat', 'enemy.race': 'nazgul' },
    });
  });

  test('base effective prowess is 2 (combat bonus does not inflate base stats)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [EOWYN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const eowynId = findCharInstanceId(state, 0, EOWYN);
    expect(state.players[0].characters[eowynId as string].effectiveStats.prowess).toBe(2);
  });

  test('+6 prowess bonus applies in combat vs nazgul (no tap)', () => {
    // Éowyn base prowess 2 + 6 bonus - 3 no-tap = 5.
    // Roll 11: 5 + 11 = 16 > 15 → character defeats strike.
    const ready = buildCombatState({ creatureRace: 'nazgul', creatureProwess: 15, creatureBody: 10 });
    const eowynId = findCharInstanceId(ready, 0, EOWYN);

    // Assign strike
    const result1 = reduce(ready, { type: 'assign-strike', player: PLAYER_1, characterId: eowynId });
    expect(result1.error).toBeUndefined();

    // Resolve without tapping — use executeAction to get properly formed action
    const afterStrike = executeAction(result1.state, PLAYER_1, 'resolve-strike', 11, false);
    expect(afterStrike.combat?.phase).toBe('body-check');
    expect(afterStrike.combat?.bodyCheckTarget).toBe('creature');
  });

  test('+6 prowess bonus does not apply vs non-nazgul (Barrow-wight)', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [EOWYN] }], hand: [], siteDeck: [MINAS_TIRITH] },
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

    // Éowyn prowess 2 - 3(no tap) = -1 + roll 12 = 11 < 12 → wounded
    // Body check roll 2 ≤ 7 → survives
    const afterCombat = runCreatureCombat(afterChain, EOWYN, 12, 2);
    expect(afterCombat.combat).toBeNull();

    const eowynId = findCharInstanceId(afterCombat, 0, EOWYN);
    expect(afterCombat.players[0].characters[eowynId as string].status).toBe(CardStatus.Inverted);
  });

  test('tapping to fight with +6 bonus gives correct prowess vs nazgul', () => {
    // Tapping: prowess = 2 + 6 = 8 (no -3 penalty).
    // Roll 8: 8 + 8 = 16 > 15 → character wins.
    const ready = buildCombatState({ creatureRace: 'nazgul', creatureProwess: 15, creatureBody: 10 });
    const eowynId = findCharInstanceId(ready, 0, EOWYN);

    const result1 = reduce(ready, { type: 'assign-strike', player: PLAYER_1, characterId: eowynId });
    expect(result1.error).toBeUndefined();

    const afterStrike = executeAction(result1.state, PLAYER_1, 'resolve-strike', 8, true);
    expect(afterStrike.combat?.phase).toBe('body-check');
    expect(afterStrike.combat?.bodyCheckTarget).toBe('creature');
  });

  test('nazgul body 9 (odd) is halved to 5 (rounded up) during body check', () => {
    // Body 9 → ceil(9/2) = 5.
    const ready = buildCombatState({
      creatureRace: 'nazgul', creatureProwess: 5, creatureBody: 9, preAssigned: true,
    });

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
    const ready = buildCombatState({
      creatureRace: 'nazgul', creatureProwess: 5, creatureBody: 10, preAssigned: true,
    });

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
    const ready = buildCombatState({
      creatureRace: 'orc', creatureProwess: 3, creatureBody: 9, preAssigned: true,
    });

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
