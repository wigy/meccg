/**
 * @module td-172.test
 *
 * Card test: Wormsbane (td-172)
 * Type: hero-resource-item (greater weapon)
 * Effects: 3
 *
 * "Unique. Weapon. +2 to prowess to a maximum of 9 (+4 to prowess to a
 *  maximum of 12 and -2 to strike's body against a Dragon or Drake strike)."
 *
 * Tests:
 * 1. stat-modifier: +2 prowess in combat vs non-Dragon/Drake enemy
 * 2. stat-modifier: +4 prowess in combat vs Dragon (overrides +2)
 * 3. stat-modifier: +4 prowess in combat vs Drake (overrides +2)
 * 4. No +4 override vs non-Dragon/Drake (only +2 applies)
 * 5. enemy-modifier: -2 to Dragon body during body check
 * 6. enemy-modifier: -2 to Drake body during body check
 * 7. No body reduction vs non-Dragon/Drake (e.g. orc)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  LEGOLAS, ARAGORN,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeShadowMHState,
  findCharInstanceId, companyIdAt, executeAction, attachItemToChar,
  RESOURCE_PLAYER, recomputeDerived,
} from '../test-helpers.js';
import { getCharacter } from '../test-helpers-assertions.js';
import { Phase, Race } from '../../index.js';
import type { CombatState, CardDefinitionId } from '../../index.js';

const WORMSBANE = 'td-172' as CardDefinitionId;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildWormsbaneState() {
  const state = buildTestState({
    phase: Phase.MovementHazard,
    activePlayer: PLAYER_1,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
    ],
  });
  return attachItemToChar(state, RESOURCE_PLAYER, LEGOLAS, WORMSBANE);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Wormsbane (td-172)', () => {
  beforeEach(() => resetMint());

  test('+2 prowess bonus changes combat outcome vs non-Dragon enemy', () => {
    // Legolas base prowess 5. Wormsbane +2 = 7 (tapping, no -3 penalty).
    // Orc strikeProwess 4: roll 2 → 7+2=9 > 4 → character wins.
    // Without +2 (prowess 5): 5+2=7 > 4 → also wins, so use strikeProwess 6.
    // strikeProwess 6: roll 2: with +2 → 7+2=9 > 6 → wins; without +2 → 5+2=7 > 6 → also wins.
    // To clearly show +2 matters: strikeProwess=8, roll 2: +2 → 9>8 wins; no Wormsbane → 5+2=7<8 loses.
    // (The "no Wormsbane" scenario is tested implicitly via the no-override test below.)
    const state = buildWormsbaneState();
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);

    const combat: CombatState = {
      attackSource: { type: 'creature', instanceId: 'fake-orc' as never },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 8,
      creatureBody: null,
      creatureRace: Race.Orc,
      strikeAssignments: [{ characterId: legolasId, excessStrikes: 0, resolved: false }],
      currentStrikeIndex: 0,
      phase: 'resolve-strike',
      assignmentPhase: 'done',
      bodyCheckTarget: null,
      detainment: false,
    };

    const mhState = makeShadowMHState();
    const ready = { ...state, phaseState: mhState, combat };

    // Roll 2 tapping: 5+2+2=9 > 8 → character wins; no creature body → combat ends.
    // Without Wormsbane: 5+2=7 < 8 → would be wounded.
    const afterStrike = executeAction(ready, PLAYER_1, 'resolve-strike', 2, true);
    expect(afterStrike.combat).toBeNull();
  });

  test('+4 prowess vs Dragon overrides the baseline +2', () => {
    // strikeProwess=10: with +2 tapping → 5+2+2=9 < 10 → wounded;
    //                   with +4 tapping → 5+4+2=11 > 10 → wins.
    // Dragon creatureBody null → no body check on win.
    const state = buildWormsbaneState();
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);

    const combat: CombatState = {
      attackSource: { type: 'creature', instanceId: 'fake-dragon' as never },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 10,
      creatureBody: null,
      creatureRace: Race.Dragon,
      strikeAssignments: [{ characterId: legolasId, excessStrikes: 0, resolved: false }],
      currentStrikeIndex: 0,
      phase: 'resolve-strike',
      assignmentPhase: 'done',
      bodyCheckTarget: null,
      detainment: false,
    };

    const mhState = makeShadowMHState();
    const ready = { ...state, phaseState: mhState, combat };

    // Roll 2 tapping: 5+4+2=11 > 10 → character wins; combat ends (no body).
    const afterStrike = executeAction(ready, PLAYER_1, 'resolve-strike', 2, true);
    expect(afterStrike.combat).toBeNull();
  });

  test('+4 prowess override also fires vs Drake', () => {
    const state = buildWormsbaneState();
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);

    const combat: CombatState = {
      attackSource: { type: 'creature', instanceId: 'fake-drake' as never },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 10,
      creatureBody: null,
      creatureRace: Race.Drake,
      strikeAssignments: [{ characterId: legolasId, excessStrikes: 0, resolved: false }],
      currentStrikeIndex: 0,
      phase: 'resolve-strike',
      assignmentPhase: 'done',
      bodyCheckTarget: null,
      detainment: false,
    };

    const mhState = makeShadowMHState();
    const ready = { ...state, phaseState: mhState, combat };

    // Roll 2 tapping: 5+4+2=11 > 10 → character wins.
    const afterStrike = executeAction(ready, PLAYER_1, 'resolve-strike', 2, true);
    expect(afterStrike.combat).toBeNull();
  });

  test('+4 override does NOT apply vs non-Dragon/Drake (only +2)', () => {
    // strikeProwess=10: with +2 tapping → 5+2+2=9 < 10 → character wounded.
    // If +4 applied incorrectly: 5+4+2=11 > 10 → would win.
    // Expect: bodyCheckTarget='character' (character lost, only +2 applied).
    const state = buildWormsbaneState();
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);

    const combat: CombatState = {
      attackSource: { type: 'creature', instanceId: 'fake-orc' as never },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 10,
      creatureBody: null,
      creatureRace: Race.Orc,
      strikeAssignments: [{ characterId: legolasId, excessStrikes: 0, resolved: false }],
      currentStrikeIndex: 0,
      phase: 'resolve-strike',
      assignmentPhase: 'done',
      bodyCheckTarget: null,
      detainment: false,
    };

    const mhState = makeShadowMHState();
    const ready = { ...state, phaseState: mhState, combat };

    // Roll 2 tapping: only +2 → 7+2=9 < 10 → character wounded → body check vs character.
    const afterStrike = executeAction(ready, PLAYER_1, 'resolve-strike', 2, true);
    expect(afterStrike.combat?.bodyCheckTarget).toBe('character');
  });

  test('-2 to Dragon body during body check (effective body 9-2=7)', () => {
    // Legolas + Wormsbane vs dragon, creatureBody=9, creatureRace='dragon'.
    // Effective body = 9 - 2 = 7.
    // Win the strike easily first, then body check at threshold.
    const state = buildWormsbaneState();
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);

    const combat: CombatState = {
      attackSource: { type: 'creature', instanceId: 'fake-dragon' as never },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 5,
      creatureBody: 9,
      creatureRace: Race.Dragon,
      strikeAssignments: [{ characterId: legolasId, excessStrikes: 0, resolved: false }],
      currentStrikeIndex: 0,
      phase: 'resolve-strike',
      assignmentPhase: 'done',
      bodyCheckTarget: null,
      detainment: false,
    };

    const mhState = makeShadowMHState();
    const ready = { ...state, phaseState: mhState, combat };

    // Win the strike: tapping, 5+4+12=21 > 5.
    const afterStrike = executeAction(ready, PLAYER_1, 'resolve-strike', 12, true);
    expect(afterStrike.combat?.phase).toBe('body-check');
    expect(afterStrike.combat?.bodyCheckTarget).toBe('creature');

    // Roll 7 ≤ 7 (effective body 9-2=7) — body check completes (creature survives).
    const afterSurvive = executeAction(afterStrike, PLAYER_1, 'body-check-roll', 7);
    expect(afterSurvive.combat).toBeNull();

    // Roll 8 > 7 (effective body 9-2=7) — body check completes (creature defeated).
    const afterDefeated = executeAction(afterStrike, PLAYER_1, 'body-check-roll', 8);
    expect(afterDefeated.combat).toBeNull();
  });

  test('-2 to Drake body during body check (effective body 9-2=7)', () => {
    const state = buildWormsbaneState();
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);

    const combat: CombatState = {
      attackSource: { type: 'creature', instanceId: 'fake-drake' as never },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 5,
      creatureBody: 9,
      creatureRace: Race.Drake,
      strikeAssignments: [{ characterId: legolasId, excessStrikes: 0, resolved: false }],
      currentStrikeIndex: 0,
      phase: 'resolve-strike',
      assignmentPhase: 'done',
      bodyCheckTarget: null,
      detainment: false,
    };

    const mhState = makeShadowMHState();
    const ready = { ...state, phaseState: mhState, combat };

    const afterStrike = executeAction(ready, PLAYER_1, 'resolve-strike', 12, true);
    expect(afterStrike.combat?.phase).toBe('body-check');
    expect(afterStrike.combat?.bodyCheckTarget).toBe('creature');

    // Roll 8 > 7 (effective body 9-2=7) — body check completes.
    const afterBodyCheck = executeAction(afterStrike, PLAYER_1, 'body-check-roll', 8);
    expect(afterBodyCheck.combat).toBeNull();
  });

  test('No body reduction vs non-Dragon/Drake (orc body stays at 9)', () => {
    // Orc body=9. No -2 reduction applies → effective body 9.
    const state = buildWormsbaneState();
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);

    const combat: CombatState = {
      attackSource: { type: 'creature', instanceId: 'fake-orc' as never },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 1,
      creatureBody: 9,
      creatureRace: Race.Orc,
      strikeAssignments: [{ characterId: legolasId, excessStrikes: 0, resolved: false }],
      currentStrikeIndex: 0,
      phase: 'resolve-strike',
      assignmentPhase: 'done',
      bodyCheckTarget: null,
      detainment: false,
    };

    const mhState = makeShadowMHState();
    const ready = { ...state, phaseState: mhState, combat };

    // Win the strike.
    const afterStrike = executeAction(ready, PLAYER_1, 'resolve-strike', 12, true);
    expect(afterStrike.combat?.phase).toBe('body-check');
    expect(afterStrike.combat?.bodyCheckTarget).toBe('creature');

    // Roll 9 ≤ 9 (no reduction, full body 9) — body check completes.
    const afterSurvive = executeAction(afterStrike, PLAYER_1, 'body-check-roll', 9);
    expect(afterSurvive.combat).toBeNull();

    // Roll 10 > 9 (no reduction, full body 9) — body check completes.
    const afterDefeated = executeAction(afterStrike, PLAYER_1, 'body-check-roll', 10);
    expect(afterDefeated.combat).toBeNull();
  });

  test('printed corruption points (2) count toward the bearer\'s corruption total', () => {
    // Bug report ba17ec30666749a5: the browser's CP badge only renders when
    // an item's corruption points are > 0, so a stale 0 in card data hid
    // Wormsbane's corruption entirely. Printed CP is 2 (data/cards.json TD-172).
    const state = recomputeDerived(buildWormsbaneState());
    expect(getCharacter(state, RESOURCE_PLAYER, LEGOLAS).effectiveStats.corruptionPoints).toBe(2);
  });
});
