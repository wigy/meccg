/**
 * @module td-21.test
 *
 * Card test: Eärcaraxë Ahunt (td-21)
 * Type: hazard-event (long, unique)
 * Effects: 2 (duplication-limit scope:game max:1, ahunt-attack)
 *
 * "Unique. Any company moving in Andrast Coast, Bay of Belfalas, Eriadoran
 *  Coast, and/or Andrast faces one Dragon attack (considered a hazard creature
 *  attack) — 3 strikes at 15/6 (attacker chooses defending characters).
 *  If Doors of Night is in play, this attack also affects: Old Pûkel-land,
 *  Enedhwaith, Anfalas, and any Coastal Sea region (or region type)."
 *
 * Engine Support:
 * | # | Feature                           | Status      | Notes                              |
 * |---|-----------------------------------|-------------|------------------------------------|
 * | 1 | Unique (duplication-limit game:1)  | IMPLEMENTED | duplication-limit effect           |
 * | 2 | Ahunt attack on matching regions   | IMPLEMENTED | ahunt-attack in order-effects step |
 * | 3 | Attacker chooses defenders         | IMPLEMENTED | combatRules on ahunt-attack        |
 * | 4 | Doors of Night extends regions     | IMPLEMENTED | extended clause with condition      |
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

const EARCARAXE_AHUNT = 'td-21' as CardDefinitionId;

// Region path fixtures for the ahunt's trigger conditions.
const PATH_ANDRAST_COAST = {
  pathNames: ['Anfalas', 'Andrast Coast'],
  pathTypes: [RegionType.Wilderness, RegionType.Coastal],
} as const;
const PATH_BAY_OF_BELFALAS = {
  pathNames: ['Bay of Belfalas'],
  pathTypes: [RegionType.Coastal],
} as const;
const PATH_NON_MATCHING = {
  pathNames: ['Belfalas', 'Lamedon'],
  pathTypes: [RegionType.Wilderness, RegionType.Wilderness],
} as const;
const PATH_EMPTY = { pathNames: [], pathTypes: [] as RegionType[] } as const;
const PATH_OLD_PUKEL_LAND = {
  pathNames: ['Old Pûkel-land'],
  pathTypes: [RegionType.Wilderness],
} as const;
const PATH_COASTAL_SEA = {
  pathNames: ['Some Coastal Region'],
  pathTypes: ['coastal-sea' as RegionType],
} as const;
const PATH_ENEDHWAITH = {
  pathNames: ['Enedhwaith'],
  pathTypes: [RegionType.Wilderness],
} as const;
const PATH_ANFALAS = {
  pathNames: ['Anfalas'],
  pathTypes: [RegionType.Wilderness],
} as const;
const PATH_ANDRAST = {
  pathNames: ['Andrast'],
  pathTypes: [RegionType.Wilderness],
} as const;

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Eärcaraxë Ahunt (td-21)', () => {
  beforeEach(() => resetMint());


  test('company moving through Andrast Coast triggers ahunt combat at order-effects', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: EARCARAXE_AHUNT, ...PATH_ANDRAST_COAST });

    const passActions = viableActions(state, PLAYER_1, 'pass');
    expect(passActions.length).toBeGreaterThanOrEqual(1);

    const next = dispatch(state, passActions[0].action);

    expect(next.combat).not.toBeNull();
    const combat = next.combat as CombatState;
    expect(combat.attackSource.type).toBe('ahunt');
    expect(combat.strikesTotal).toBe(3);
    expect(combat.strikeProwess).toBe(15);
    expect(combat.creatureBody).toBe(6);
    expect(combat.creatureRace).toBe('dragon');
    expect(combat.assignmentPhase).toBe('cancel-window');
  });

  test('company moving through Bay of Belfalas triggers ahunt combat', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: EARCARAXE_AHUNT, ...PATH_BAY_OF_BELFALAS });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
    expect(next.combat!.attackSource.type).toBe('ahunt');
  });

  test('company moving through non-matching region does not trigger ahunt', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: EARCARAXE_AHUNT, ...PATH_NON_MATCHING });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).toBeNull();
  });

  test('non-moving company (empty path) does not trigger ahunt', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: EARCARAXE_AHUNT, ...PATH_EMPTY });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).toBeNull();
  });

  test('Old Pûkel-land does NOT trigger without Doors of Night', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: EARCARAXE_AHUNT, ...PATH_OLD_PUKEL_LAND });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).toBeNull();
  });

  test('Old Pûkel-land triggers with Doors of Night in play', () => {
    const state = buildAhuntOrderEffectsState({
      ahuntDefId: EARCARAXE_AHUNT,
      ...PATH_OLD_PUKEL_LAND,
      extraCardsInPlay: [DOORS_OF_NIGHT],
    });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
    expect(next.combat!.attackSource.type).toBe('ahunt');
  });

  test('coastal-sea region type triggers with Doors of Night in play', () => {
    const state = buildAhuntOrderEffectsState({
      ahuntDefId: EARCARAXE_AHUNT,
      ...PATH_COASTAL_SEA,
      extraCardsInPlay: [DOORS_OF_NIGHT],
    });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
    expect(next.combat!.attackSource.type).toBe('ahunt');
  });

  test('Enedhwaith triggers with Doors of Night in play', () => {
    const state = buildAhuntOrderEffectsState({
      ahuntDefId: EARCARAXE_AHUNT,
      ...PATH_ENEDHWAITH,
      extraCardsInPlay: [DOORS_OF_NIGHT],
    });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
  });

  test('Anfalas triggers with Doors of Night in play', () => {
    const state = buildAhuntOrderEffectsState({
      ahuntDefId: EARCARAXE_AHUNT,
      ...PATH_ANFALAS,
      extraCardsInPlay: [DOORS_OF_NIGHT],
    });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
  });

  test('attacker chooses defenders (cancel-window phase)', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: EARCARAXE_AHUNT, ...PATH_ANDRAST });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
    expect(next.combat!.assignmentPhase).toBe('cancel-window');
  });

  test('ahunt long-event stays in cardsInPlay after combat (not moved to kill/discard)', () => {
    const state = buildAhuntOrderEffectsState({
      ahuntDefId: EARCARAXE_AHUNT,
      pathNames: ['Andrast Coast'],
      pathTypes: [RegionType.Coastal],
    });

    // Trigger combat
    let current = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(current.combat).not.toBeNull();

    // Run through combat: both players pass through strike assignment and resolution
    for (let i = 0; i < 50 && current.combat !== null; i++) {
      // Try hazard player actions first (attacker assigns strikes)
      let actions = viableActions(current, PLAYER_2, 'assign-strike');
      if (actions.length > 0) {
        current = dispatch(current, actions[0].action);
        continue;
      }
      // Try defender actions
      actions = viableActions(current, PLAYER_1, 'assign-strike');
      if (actions.length > 0) {
        current = dispatch(current, actions[0].action);
        continue;
      }
      // Try pass actions from either player
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

    // After combat, ahunt card should still be in cardsInPlay
    const ahuntInPlay = current.players[1].cardsInPlay.some(
      c => c.definitionId === EARCARAXE_AHUNT,
    );
    expect(ahuntInPlay).toBe(true);

    // It should NOT be in discard or kill piles
    expect(current.players[0].killPile.some(c => c.definitionId === EARCARAXE_AHUNT)).toBe(false);
    expect(current.players[1].discardPile.some(c => c.definitionId === EARCARAXE_AHUNT)).toBe(false);
  });
});
