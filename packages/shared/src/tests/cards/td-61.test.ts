/**
 * @module td-61.test
 *
 * Card test: Scatha Ahunt (td-61)
 * Type: hazard-event (long, unique)
 * Effects: 2 (duplication-limit scope:game max:1, ahunt-attack)
 *
 * "Unique. Any company moving in Withered Heath, Woodland Realm, Northern
 *  Rhovanion, and/or Grey Mountain Narrows faces one Dragon attack (considered
 *  a hazard creature attack) — 4 strikes at 13/8.
 *  If Doors of Night is in play, this attack also affects: Anduin Vales,
 *  Western Mirkwood, Heart of Mirkwood, and Gundabad."
 *
 * Unlike its siblings (td-4 Bairanax Ahunt, td-64 Scorba Ahunt) the printed
 * text has NO "(attacker chooses defending characters)" clause, so the ahunt
 * effect carries no `combatRules` and the combat opens in the normal
 * `defender`-assignment phase rather than a `cancel-window`.
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
  viableActions, dispatch,
} from '../test-helpers.js';
import { RegionType } from '../../index.js';
import type { CardDefinitionId, CombatState } from '../../index.js';

const SCATHA_AHUNT = 'td-61' as CardDefinitionId;

const PATH_WITHERED_HEATH = {
  pathNames: ['Withered Heath'],
  pathTypes: [RegionType.Wilderness],
} as const;
const PATH_WOODLAND_REALM = {
  pathNames: ['Woodland Realm'],
  pathTypes: [RegionType.Border],
} as const;
const PATH_NORTHERN_RHOVANION = {
  pathNames: ['Northern Rhovanion'],
  pathTypes: [RegionType.Wilderness],
} as const;
const PATH_GREY_MOUNTAIN_NARROWS = {
  pathNames: ['Grey Mountain Narrows'],
  pathTypes: [RegionType.Shadow],
} as const;
const PATH_NON_MATCHING = {
  pathNames: ['Belfalas', 'Lamedon'],
  pathTypes: [RegionType.Wilderness, RegionType.Wilderness],
} as const;
const PATH_EMPTY = { pathNames: [], pathTypes: [] as RegionType[] } as const;
const PATH_ANDUIN_VALES = {
  pathNames: ['Anduin Vales'],
  pathTypes: [RegionType.Border],
} as const;
const PATH_WESTERN_MIRKWOOD = {
  pathNames: ['Western Mirkwood'],
  pathTypes: [RegionType.Wilderness],
} as const;
const PATH_HEART_OF_MIRKWOOD = {
  pathNames: ['Heart of Mirkwood'],
  pathTypes: [RegionType.Wilderness],
} as const;
const PATH_GUNDABAD = {
  pathNames: ['Gundabad'],
  pathTypes: [RegionType.Dark],
} as const;

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Scatha Ahunt (td-61)', () => {
  beforeEach(() => resetMint());

  test('company moving through Withered Heath triggers ahunt combat at order-effects', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: SCATHA_AHUNT, ...PATH_WITHERED_HEATH });

    const passActions = viableActions(state, PLAYER_1, 'pass');
    expect(passActions.length).toBeGreaterThanOrEqual(1);

    const next = dispatch(state, passActions[0].action);

    expect(next.combat).not.toBeNull();
    const combat = next.combat as CombatState;
    expect(combat.attackSource.type).toBe('ahunt');
    expect(combat.strikesTotal).toBe(4);
    expect(combat.strikeProwess).toBe(13);
    expect(combat.creatureBody).toBe(8);
    expect(combat.creatureRace).toBe('dragon');
  });

  test('company moving through Woodland Realm triggers ahunt combat', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: SCATHA_AHUNT, ...PATH_WOODLAND_REALM });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
    expect(next.combat!.attackSource.type).toBe('ahunt');
  });

  test('company moving through Northern Rhovanion triggers ahunt combat', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: SCATHA_AHUNT, ...PATH_NORTHERN_RHOVANION });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
    expect(next.combat!.attackSource.type).toBe('ahunt');
  });

  test('company moving through Grey Mountain Narrows triggers ahunt combat', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: SCATHA_AHUNT, ...PATH_GREY_MOUNTAIN_NARROWS });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
    expect(next.combat!.attackSource.type).toBe('ahunt');
  });

  test('defender assigns strikes (no attacker-chooses cancel-window)', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: SCATHA_AHUNT, ...PATH_WITHERED_HEATH });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
    expect(next.combat!.assignmentPhase).toBe('defender');
  });

  test('company moving through non-matching region does not trigger ahunt', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: SCATHA_AHUNT, ...PATH_NON_MATCHING });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).toBeNull();
  });

  test('non-moving company (empty path) does not trigger ahunt', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: SCATHA_AHUNT, ...PATH_EMPTY });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).toBeNull();
  });

  test('Anduin Vales does NOT trigger without Doors of Night', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: SCATHA_AHUNT, ...PATH_ANDUIN_VALES });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).toBeNull();
  });

  test('Western Mirkwood does NOT trigger without Doors of Night', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: SCATHA_AHUNT, ...PATH_WESTERN_MIRKWOOD });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).toBeNull();
  });

  test('Heart of Mirkwood does NOT trigger without Doors of Night', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: SCATHA_AHUNT, ...PATH_HEART_OF_MIRKWOOD });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).toBeNull();
  });

  test('Gundabad does NOT trigger without Doors of Night', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: SCATHA_AHUNT, ...PATH_GUNDABAD });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).toBeNull();
  });

  test('Anduin Vales triggers with Doors of Night in play', () => {
    const state = buildAhuntOrderEffectsState({
      ahuntDefId: SCATHA_AHUNT,
      ...PATH_ANDUIN_VALES,
      extraCardsInPlay: [DOORS_OF_NIGHT],
    });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
    expect(next.combat!.attackSource.type).toBe('ahunt');
  });

  test('Western Mirkwood triggers with Doors of Night in play', () => {
    const state = buildAhuntOrderEffectsState({
      ahuntDefId: SCATHA_AHUNT,
      ...PATH_WESTERN_MIRKWOOD,
      extraCardsInPlay: [DOORS_OF_NIGHT],
    });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
    expect(next.combat!.attackSource.type).toBe('ahunt');
  });

  test('Heart of Mirkwood triggers with Doors of Night in play', () => {
    const state = buildAhuntOrderEffectsState({
      ahuntDefId: SCATHA_AHUNT,
      ...PATH_HEART_OF_MIRKWOOD,
      extraCardsInPlay: [DOORS_OF_NIGHT],
    });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
    expect(next.combat!.attackSource.type).toBe('ahunt');
  });

  test('Gundabad triggers with Doors of Night in play', () => {
    const state = buildAhuntOrderEffectsState({
      ahuntDefId: SCATHA_AHUNT,
      ...PATH_GUNDABAD,
      extraCardsInPlay: [DOORS_OF_NIGHT],
    });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
    expect(next.combat!.attackSource.type).toBe('ahunt');
  });

  test('ahunt long-event stays in cardsInPlay after combat', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: SCATHA_AHUNT, ...PATH_WITHERED_HEATH });

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

    expect(current.players[1].cardsInPlay.some(c => c.definitionId === SCATHA_AHUNT)).toBe(true);
    expect(current.players[0].killPile.some(c => c.definitionId === SCATHA_AHUNT)).toBe(false);
    expect(current.players[1].discardPile.some(c => c.definitionId === SCATHA_AHUNT)).toBe(false);
  });
});
