/**
 * @module td-43.test
 *
 * Card test: Leucaruth Ahunt (td-43)
 * Type: hazard-event (long, unique)
 * Effects: 2 (duplication-limit scope:game max:1, ahunt-attack)
 *
 * "Unique. Any company moving in Withered Heath, Northern Rhovanion, Iron
 *  Hills, and/or Grey Mountain Narrows faces one Dragon attack (considered a
 *  hazard creature attack) — 3 strikes at 14/7. If Doors of Night is in play,
 *  this attack also affects: Southern Rhovanion, Dorwinion, Heart of Mirkwood,
 *  and Woodland Realm."
 *
 * Like Scatha Ahunt (td-61) the printed text has NO "(attacker chooses
 * defending characters)" clause, so the ahunt effect carries no
 * `combatRules` and the combat opens in the normal `defender` phase.
 * Its `manifestId` (tw-48) ties it to Leucaruth's other manifestations
 * (Leucaruth at Home td-44 suppresses its Irerock augment while this is in play).
 *
 * Engine Support:
 * | # | Feature                            | Status      | Notes                              |
 * |---|------------------------------------|-------------|------------------------------------|
 * | 1 | Unique (duplication-limit game:1)  | IMPLEMENTED | duplication-limit effect           |
 * | 2 | Ahunt attack on matching regions   | IMPLEMENTED | ahunt-attack in order-effects step |
 * | 3 | Doors of Night extends regions     | IMPLEMENTED | extended clause with condition     |
 * | 4 | Defender assigns (no attacker-pick)| IMPLEMENTED | no combatRules → defender phase    |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  resetMint, buildAhuntOrderEffectsState,
  PLAYER_1, PLAYER_2,
  DOORS_OF_NIGHT,
  viableActions, dispatch, continueAutoAttackCombat,
} from '../test-helpers.js';
import { RegionType } from '../../index.js';
import type { CardDefinitionId, CombatState } from '../../index.js';

const LEUCARUTH_AHUNT = 'td-43' as CardDefinitionId;

const BASE_REGIONS: readonly [string, RegionType][] = [
  ['Withered Heath', RegionType.Wilderness],
  ['Northern Rhovanion', RegionType.Wilderness],
  ['Iron Hills', RegionType.Wilderness],
  ['Grey Mountain Narrows', RegionType.Shadow],
];
const DOORS_REGIONS: readonly [string, RegionType][] = [
  ['Southern Rhovanion', RegionType.Wilderness],
  ['Dorwinion', RegionType.Border],
  ['Heart of Mirkwood', RegionType.Wilderness],
  ['Woodland Realm', RegionType.Border],
];
const PATH_NON_MATCHING = {
  pathNames: ['Belfalas', 'Lamedon'],
  pathTypes: [RegionType.Wilderness, RegionType.Wilderness],
} as const;
const PATH_EMPTY = { pathNames: [], pathTypes: [] as RegionType[] } as const;

function passOnce(state: ReturnType<typeof buildAhuntOrderEffectsState>) {
  return dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Leucaruth Ahunt (td-43)', () => {
  beforeEach(() => resetMint());

  test('company moving through Withered Heath faces a 3-strike 14/7 Dragon attack', () => {
    const state = buildAhuntOrderEffectsState({
      ahuntDefId: LEUCARUTH_AHUNT,
      pathNames: ['Withered Heath'],
      pathTypes: [RegionType.Wilderness],
    });

    const passActions = viableActions(state, PLAYER_1, 'pass');
    expect(passActions.length).toBeGreaterThanOrEqual(1);
    const next = dispatch(state, passActions[0].action);

    expect(next.combat).not.toBeNull();
    const combat = next.combat as CombatState;
    expect(combat.attackSource.type).toBe('ahunt');
    expect(combat.strikesTotal).toBe(3);
    expect(combat.strikeProwess).toBe(14);
    expect(combat.creatureBody).toBe(7);
    expect(combat.creatureRace).toBe('dragon');
  });

  for (const [name, type] of BASE_REGIONS) {
    test(`company moving through ${name} triggers ahunt combat`, () => {
      const state = buildAhuntOrderEffectsState({
        ahuntDefId: LEUCARUTH_AHUNT, pathNames: [name], pathTypes: [type],
      });
      const next = passOnce(state);
      expect(next.combat).not.toBeNull();
      expect(next.combat!.attackSource.type).toBe('ahunt');
    });
  }

  test('defender assigns strikes (no attacker-chooses cancel-window)', () => {
    const state = buildAhuntOrderEffectsState({
      ahuntDefId: LEUCARUTH_AHUNT,
      pathNames: ['Iron Hills'],
      pathTypes: [RegionType.Wilderness],
    });
    const next = passOnce(state);
    expect(next.combat).not.toBeNull();
    expect(next.combat!.assignmentPhase).toBe('defender');
  });

  test('a path crossing several matching regions faces only one attack', () => {
    const state = buildAhuntOrderEffectsState({
      ahuntDefId: LEUCARUTH_AHUNT,
      pathNames: ['Northern Rhovanion', 'Withered Heath', 'Iron Hills'],
      pathTypes: [RegionType.Wilderness, RegionType.Wilderness, RegionType.Wilderness],
    });

    let current = passOnce(state);
    expect(current.combat).not.toBeNull();

    current = continueAutoAttackCombat(current, []).state;
    expect(current.combat).toBeNull();

    // Back in order-effects: no second ahunt attack starts for the other regions.
    const after = viableActions(current, PLAYER_1, 'pass');
    expect(after.length).toBeGreaterThanOrEqual(1);
    const next = dispatch(current, after[0].action);
    expect(next.combat).toBeNull();
  });

  test('company moving through non-matching regions does not trigger ahunt', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: LEUCARUTH_AHUNT, ...PATH_NON_MATCHING });
    expect(passOnce(state).combat).toBeNull();
  });

  test('non-moving company (empty path) does not trigger ahunt', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: LEUCARUTH_AHUNT, ...PATH_EMPTY });
    expect(passOnce(state).combat).toBeNull();
  });

  for (const [name, type] of DOORS_REGIONS) {
    test(`${name} does NOT trigger without Doors of Night`, () => {
      const state = buildAhuntOrderEffectsState({
        ahuntDefId: LEUCARUTH_AHUNT, pathNames: [name], pathTypes: [type],
      });
      expect(passOnce(state).combat).toBeNull();
    });

    test(`${name} triggers with Doors of Night in play`, () => {
      const state = buildAhuntOrderEffectsState({
        ahuntDefId: LEUCARUTH_AHUNT,
        pathNames: [name],
        pathTypes: [type],
        extraCardsInPlay: [DOORS_OF_NIGHT],
      });
      const next = passOnce(state);
      expect(next.combat).not.toBeNull();
      expect(next.combat!.attackSource.type).toBe('ahunt');
      expect(next.combat!.strikesTotal).toBe(3);
      expect(next.combat!.strikeProwess).toBe(14);
    });
  }

  test('ahunt long-event stays in cardsInPlay after combat', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: LEUCARUTH_AHUNT, pathNames: ['Withered Heath'], pathTypes: [RegionType.Wilderness] });

    let current = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(current.combat).not.toBeNull();

    for (let i = 0; i < 50 && current.combat !== null; i++) {
      let actions = viableActions(current, PLAYER_2, 'assign-strike');
      if (actions.length > 0) { current = dispatch(current, actions[0].action); continue; }
      actions = viableActions(current, PLAYER_1, 'assign-strike');
      if (actions.length > 0) { current = dispatch(current, actions[0].action); continue; }
      for (const pid of [PLAYER_1, PLAYER_2]) {
        actions = viableActions(current, pid, 'pass');
        if (actions.length > 0) { current = dispatch(current, actions[0].action); break; }
      }
    }

    expect(current.players[1].cardsInPlay.some(c => c.definitionId === LEUCARUTH_AHUNT)).toBe(true);
    expect(current.players[0].killPile.some(c => c.definitionId === LEUCARUTH_AHUNT)).toBe(false);
    expect(current.players[1].discardPile.some(c => c.definitionId === LEUCARUTH_AHUNT)).toBe(false);
  });
});
