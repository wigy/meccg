/**
 * @module td-64.test
 *
 * Card test: Scorba Ahunt (td-64)
 * Type: hazard-event (long, unique)
 * Effects: 2 (duplication-limit scope:game max:1, ahunt-attack)
 *
 * "Unique. Any company moving in Forochel, Angmar, and/or Gundabad faces one
 *  Dragon attack (considered a hazard creature attack) — 4 strikes at 10/7
 *  (attacker chooses defending characters).
 *  If Doors of Night is in play, this attack also affects: Númeriador,
 *  Arthedain, and Rhudaur."
 *
 * Engine Support:
 * | # | Feature                           | Status      | Notes                              |
 * |---|-----------------------------------|-------------|------------------------------------|
 * | 1 | Unique (duplication-limit game:1)  | IMPLEMENTED | duplication-limit effect           |
 * | 2 | Ahunt attack on matching regions   | IMPLEMENTED | ahunt-attack in order-effects step |
 * | 3 | Attacker chooses defenders         | IMPLEMENTED | combatRules on ahunt-attack        |
 * | 4 | Doors of Night extends regions     | IMPLEMENTED | extended clause with condition     |
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

const SCORBA_AHUNT = 'td-64' as CardDefinitionId;

const PATH_FOROCHEL = {
  pathNames: ['Forochel'],
  pathTypes: [RegionType.Wilderness],
} as const;
const PATH_ANGMAR = {
  pathNames: ['Angmar'],
  pathTypes: [RegionType.Shadow],
} as const;
const PATH_GUNDABAD = {
  pathNames: ['Gundabad'],
  pathTypes: [RegionType.Shadow],
} as const;
const PATH_NON_MATCHING = {
  pathNames: ['Belfalas', 'Lamedon'],
  pathTypes: [RegionType.Wilderness, RegionType.Wilderness],
} as const;
const PATH_EMPTY = { pathNames: [], pathTypes: [] as RegionType[] } as const;
const PATH_NUMERIADOR = {
  pathNames: ['Númeriador'],
  pathTypes: [RegionType.Wilderness],
} as const;
const PATH_ARTHEDAIN = {
  pathNames: ['Arthedain'],
  pathTypes: [RegionType.Wilderness],
} as const;
const PATH_RHUDAUR = {
  pathNames: ['Rhudaur'],
  pathTypes: [RegionType.Wilderness],
} as const;

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Scorba Ahunt (td-64)', () => {
  beforeEach(() => resetMint());

  test('company moving through Forochel triggers ahunt combat at order-effects', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: SCORBA_AHUNT, ...PATH_FOROCHEL });

    const passActions = viableActions(state, PLAYER_1, 'pass');
    expect(passActions.length).toBeGreaterThanOrEqual(1);

    const next = dispatch(state, passActions[0].action);

    expect(next.combat).not.toBeNull();
    const combat = next.combat as CombatState;
    expect(combat.attackSource.type).toBe('ahunt');
    expect(combat.strikesTotal).toBe(4);
    expect(combat.strikeProwess).toBe(10);
    expect(combat.creatureBody).toBe(7);
    expect(combat.creatureRace).toBe('dragon');
    expect(combat.assignmentPhase).toBe('cancel-window');
  });

  test('company moving through Angmar triggers ahunt combat', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: SCORBA_AHUNT, ...PATH_ANGMAR });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
    expect(next.combat!.attackSource.type).toBe('ahunt');
  });

  test('company moving through Gundabad triggers ahunt combat', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: SCORBA_AHUNT, ...PATH_GUNDABAD });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
    expect(next.combat!.attackSource.type).toBe('ahunt');
  });

  test('company moving through non-matching region does not trigger ahunt', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: SCORBA_AHUNT, ...PATH_NON_MATCHING });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).toBeNull();
  });

  test('non-moving company (empty path) does not trigger ahunt', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: SCORBA_AHUNT, ...PATH_EMPTY });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).toBeNull();
  });

  test('Númeriador does NOT trigger without Doors of Night', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: SCORBA_AHUNT, ...PATH_NUMERIADOR });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).toBeNull();
  });

  test('Arthedain does NOT trigger without Doors of Night', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: SCORBA_AHUNT, ...PATH_ARTHEDAIN });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).toBeNull();
  });

  test('Rhudaur does NOT trigger without Doors of Night', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: SCORBA_AHUNT, ...PATH_RHUDAUR });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).toBeNull();
  });

  test('Númeriador triggers with Doors of Night in play', () => {
    const state = buildAhuntOrderEffectsState({
      ahuntDefId: SCORBA_AHUNT,
      ...PATH_NUMERIADOR,
      extraCardsInPlay: [DOORS_OF_NIGHT],
    });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
    expect(next.combat!.attackSource.type).toBe('ahunt');
  });

  test('Arthedain triggers with Doors of Night in play', () => {
    const state = buildAhuntOrderEffectsState({
      ahuntDefId: SCORBA_AHUNT,
      ...PATH_ARTHEDAIN,
      extraCardsInPlay: [DOORS_OF_NIGHT],
    });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
    expect(next.combat!.attackSource.type).toBe('ahunt');
  });

  test('Rhudaur triggers with Doors of Night in play', () => {
    const state = buildAhuntOrderEffectsState({
      ahuntDefId: SCORBA_AHUNT,
      ...PATH_RHUDAUR,
      extraCardsInPlay: [DOORS_OF_NIGHT],
    });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
    expect(next.combat!.attackSource.type).toBe('ahunt');
  });

  test('attacker chooses defenders (cancel-window phase before assignment)', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: SCORBA_AHUNT, ...PATH_FOROCHEL });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
    expect(next.combat!.assignmentPhase).toBe('cancel-window');
  });

  test('ahunt long-event stays in cardsInPlay after combat', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: SCORBA_AHUNT, ...PATH_FOROCHEL });

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

    expect(current.players[1].cardsInPlay.some(c => c.definitionId === SCORBA_AHUNT)).toBe(true);
    expect(current.players[0].killPile.some(c => c.definitionId === SCORBA_AHUNT)).toBe(false);
    expect(current.players[1].discardPile.some(c => c.definitionId === SCORBA_AHUNT)).toBe(false);
  });
});
