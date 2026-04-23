/**
 * @module td-37.test
 *
 * Card test: Itangast Ahunt (td-37)
 * Type: hazard-event (long, unique)
 * Effects: 2 (duplication-limit scope:game max:1, ahunt-attack)
 *
 * "Unique. Any company moving in Withered Heath, Northern Rhovanion, Iron
 *  Hills, and/or Grey Mountain Narrows faces one Dragon attack (considered a
 *  hazard creature attack) — 4 strikes at 16/7.
 *  If Doors of Night is in play, this attack also affects: Southern
 *  Rhovanion, Dorwinion, Heart of Mirkwood, and Woodland Realm."
 *
 * Engine Support:
 * | # | Feature                           | Status      | Notes                              |
 * |---|-----------------------------------|-------------|------------------------------------|
 * | 1 | Unique (duplication-limit game:1)  | IMPLEMENTED | duplication-limit effect           |
 * | 2 | Ahunt attack on matching regions   | IMPLEMENTED | ahunt-attack in order-effects step |
 * | 3 | Doors of Night extends regions     | IMPLEMENTED | extended clause with condition      |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  resetMint, buildAhuntOrderEffectsState,
  PLAYER_1, PLAYER_2,
  DOORS_OF_NIGHT,
  viableActions, dispatch,
} from '../test-helpers.js';
import { RegionType, reduce } from '../../index.js';
import type { CardDefinitionId, CombatState } from '../../index.js';

const ITANGAST_AHUNT = 'td-37' as CardDefinitionId;

// Region path fixtures for the ahunt's trigger conditions.
const PATH_WITHERED_HEATH = {
  pathNames: ['Withered Heath'],
  pathTypes: [RegionType.Wilderness],
} as const;
const PATH_NORTHERN_RHOVANION = {
  pathNames: ['Northern Rhovanion'],
  pathTypes: [RegionType.Wilderness],
} as const;
const PATH_IRON_HILLS = {
  pathNames: ['Iron Hills'],
  pathTypes: [RegionType.Wilderness],
} as const;
const PATH_GREY_MOUNTAIN_NARROWS = {
  pathNames: ['Grey Mountain Narrows'],
  pathTypes: [RegionType.Wilderness],
} as const;
const PATH_NON_MATCHING = {
  pathNames: ['Rhudaur', 'Cardolan'],
  pathTypes: [RegionType.Wilderness, RegionType.Wilderness],
} as const;
const PATH_EMPTY = { pathNames: [], pathTypes: [] as RegionType[] } as const;
const PATH_SOUTHERN_RHOVANION = {
  pathNames: ['Southern Rhovanion'],
  pathTypes: [RegionType.Wilderness],
} as const;
const PATH_DORWINION = {
  pathNames: ['Dorwinion'],
  pathTypes: [RegionType.Border],
} as const;
const PATH_HEART_OF_MIRKWOOD = {
  pathNames: ['Heart of Mirkwood'],
  pathTypes: [RegionType.Shadow],
} as const;
const PATH_WOODLAND_REALM = {
  pathNames: ['Woodland Realm'],
  pathTypes: [RegionType.Free],
} as const;

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Itangast Ahunt (td-37)', () => {
  beforeEach(() => resetMint());

  test('company moving through Withered Heath triggers ahunt combat with 4 strikes at 16/7', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: ITANGAST_AHUNT, ...PATH_WITHERED_HEATH });

    const passActions = viableActions(state, PLAYER_1, 'pass');
    expect(passActions.length).toBeGreaterThanOrEqual(1);

    const next = dispatch(state, passActions[0].action);

    expect(next.combat).not.toBeNull();
    const combat = next.combat as CombatState;
    expect(combat.attackSource.type).toBe('ahunt');
    expect(combat.strikesTotal).toBe(4);
    expect(combat.strikeProwess).toBe(16);
    expect(combat.creatureBody).toBe(7);
    expect(combat.creatureRace).toBe('dragon');
    // No "attacker-chooses-defenders" on this card — defender assigns.
    expect(combat.assignmentPhase).toBe('defender');
  });

  test('company moving through Northern Rhovanion triggers ahunt combat', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: ITANGAST_AHUNT, ...PATH_NORTHERN_RHOVANION });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
    expect(next.combat!.attackSource.type).toBe('ahunt');
  });

  test('company moving through Iron Hills triggers ahunt combat', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: ITANGAST_AHUNT, ...PATH_IRON_HILLS });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
  });

  test('company moving through Grey Mountain Narrows triggers ahunt combat', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: ITANGAST_AHUNT, ...PATH_GREY_MOUNTAIN_NARROWS });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
  });

  test('company moving through non-matching region does not trigger ahunt', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: ITANGAST_AHUNT, ...PATH_NON_MATCHING });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).toBeNull();
  });

  test('non-moving company (empty path) does not trigger ahunt', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: ITANGAST_AHUNT, ...PATH_EMPTY });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).toBeNull();
  });

  // ─── Extended regions require Doors of Night ───────────────────────────

  test('Southern Rhovanion does NOT trigger without Doors of Night', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: ITANGAST_AHUNT, ...PATH_SOUTHERN_RHOVANION });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).toBeNull();
  });

  test('Southern Rhovanion triggers with Doors of Night in play', () => {
    const state = buildAhuntOrderEffectsState({
      ahuntDefId: ITANGAST_AHUNT,
      ...PATH_SOUTHERN_RHOVANION,
      extraCardsInPlay: [DOORS_OF_NIGHT],
    });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
    expect(next.combat!.attackSource.type).toBe('ahunt');
  });

  test('Dorwinion triggers with Doors of Night in play', () => {
    const state = buildAhuntOrderEffectsState({
      ahuntDefId: ITANGAST_AHUNT,
      ...PATH_DORWINION,
      extraCardsInPlay: [DOORS_OF_NIGHT],
    });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
  });

  test('Heart of Mirkwood triggers with Doors of Night in play', () => {
    const state = buildAhuntOrderEffectsState({
      ahuntDefId: ITANGAST_AHUNT,
      ...PATH_HEART_OF_MIRKWOOD,
      extraCardsInPlay: [DOORS_OF_NIGHT],
    });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
  });

  test('Woodland Realm triggers with Doors of Night in play', () => {
    const state = buildAhuntOrderEffectsState({
      ahuntDefId: ITANGAST_AHUNT,
      ...PATH_WOODLAND_REALM,
      extraCardsInPlay: [DOORS_OF_NIGHT],
    });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
  });

  test('Woodland Realm does NOT trigger without Doors of Night', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: ITANGAST_AHUNT, ...PATH_WOODLAND_REALM });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).toBeNull();
  });

  // ─── Long-event persistence ────────────────────────────────────────────

  test('ahunt long-event stays in cardsInPlay after combat (not moved to kill/discard)', () => {
    const state = buildAhuntOrderEffectsState({
      ahuntDefId: ITANGAST_AHUNT,
      ...PATH_WITHERED_HEATH,
    });

    let current = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(current.combat).not.toBeNull();

    // Run through combat: drive strike assignments + passes until combat ends.
    for (let i = 0; i < 50 && current.combat !== null; i++) {
      let actions = viableActions(current, PLAYER_1, 'assign-strike');
      if (actions.length > 0) {
        current = dispatch(current, actions[0].action);
        continue;
      }
      for (const pid of [PLAYER_1, PLAYER_2]) {
        actions = viableActions(current, pid, 'pass');
        if (actions.length > 0) {
          const result = reduce(current, actions[0].action);
          if (!result.error) {
            current = result.state;
            break;
          }
        }
      }
    }

    // After combat, ahunt long-event should still be in cardsInPlay.
    const ahuntInPlay = current.players[1].cardsInPlay.some(
      c => c.definitionId === ITANGAST_AHUNT,
    );
    expect(ahuntInPlay).toBe(true);

    expect(current.players[0].killPile.some(c => c.definitionId === ITANGAST_AHUNT)).toBe(false);
    expect(current.players[1].discardPile.some(c => c.definitionId === ITANGAST_AHUNT)).toBe(false);
  });
});
