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
  PLAYER_1, PLAYER_2,
  EOWYN, LEGOLAS,
  BARROW_WIGHT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeShadowMHState, findCharInstanceId,
  executeAction, playCreatureHazardAndResolve, runCreatureCombat,
  dispatch, getCharacter, expectCharStatus, RESOURCE_PLAYER,
  makeSingleCharCombatState, companyIdAt, handCardId, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase, CardStatus } from '../../index.js';

const SHADOW_KEYING = { method: 'region-type' as const, value: 'shadow' };
const EOWYN_BASE_PROWESS = 2;

describe('Éowyn (tw-147)', () => {
  beforeEach(() => resetMint());


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

    expect(getCharacter(state, RESOURCE_PLAYER, EOWYN).effectiveStats.prowess).toBe(EOWYN_BASE_PROWESS);
  });

  test('+6 prowess bonus applies in combat vs nazgul (no tap)', () => {
    // Éowyn base prowess 2 + 6 bonus - 3 no-tap = 5.
    // Roll 11: 5 + 11 = 16 > 15 → character defeats strike.
    const ready = makeSingleCharCombatState({ heroDefId: EOWYN, creatureRace: 'nazgul', creatureProwess: 15, creatureBody: 10 });
    const eowynId = findCharInstanceId(ready, RESOURCE_PLAYER, EOWYN);

    // Assign strike
    const afterAssign = dispatch(ready, { type: 'assign-strike', player: PLAYER_1, characterId: eowynId });

    // Resolve without tapping — use executeAction to get properly formed action
    const afterStrike = executeAction(afterAssign, PLAYER_1, 'resolve-strike', 11, false);
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

    const ready = { ...state, phaseState: makeShadowMHState() };

    const bwId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, bwId, companyId, SHADOW_KEYING);

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.creatureRace).toBe('undead');

    // Éowyn prowess 2 - 3(no tap) = -1 + roll 12 = 11 < 12 → wounded
    // Body check roll 2 ≤ 7 → survives
    const afterCombat = runCreatureCombat(afterChain, EOWYN, 12, 2);
    expect(afterCombat.combat).toBeNull();

    expectCharStatus(afterCombat, RESOURCE_PLAYER, EOWYN, CardStatus.Inverted);
  });

  test('tapping to fight with +6 bonus gives correct prowess vs nazgul', () => {
    // Tapping: prowess = 2 + 6 = 8 (no -3 penalty).
    // Roll 8: 8 + 8 = 16 > 15 → character wins.
    const ready = makeSingleCharCombatState({ heroDefId: EOWYN, creatureRace: 'nazgul', creatureProwess: 15, creatureBody: 10 });
    const eowynId = findCharInstanceId(ready, RESOURCE_PLAYER, EOWYN);

    const afterAssign = dispatch(ready, { type: 'assign-strike', player: PLAYER_1, characterId: eowynId });

    const afterStrike = executeAction(afterAssign, PLAYER_1, 'resolve-strike', 8, true);
    expect(afterStrike.combat?.phase).toBe('body-check');
    expect(afterStrike.combat?.bodyCheckTarget).toBe('creature');
  });

  test('nazgul body 9 (odd) is halved to 5 (rounded up) during body check', () => {
    // Body 9 → ceil(9/2) = 5.
    const ready = makeSingleCharCombatState({
      heroDefId: EOWYN, creatureRace: 'nazgul', creatureProwess: 5, creatureBody: 9, preAssigned: true,
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
    const ready = makeSingleCharCombatState({
      heroDefId: EOWYN, creatureRace: 'nazgul', creatureProwess: 5, creatureBody: 10, preAssigned: true,
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
    const ready = makeSingleCharCombatState({
      heroDefId: EOWYN, creatureRace: 'orc', creatureProwess: 3, creatureBody: 9, preAssigned: true,
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
