/**
 * @module td-10.test
 *
 * Card test: Daelomin Ahunt (td-10)
 * Type: hazard-event (long, unique), Dragon manifestation of Daelomin (tw-26)
 * Effects: 2 (duplication-limit scope:game max:1, ahunt-attack)
 *
 * "Unique. Any company moving in Withered Heath, Northern Rhovanion, Iron
 *  Hills, and/or Grey Mountain Narrows faces one Dragon attack (considered a
 *  hazard creature attack) — 4 strikes at 11/7 (attacker chooses defending
 *  characters). If Doors of Night is in play, this attack also affects: Brown
 *  Lands, Southern Rhovanion, Dorwinion, Dagorlad, and Horse Plains."
 *
 * Engine Support (mirrors Eärcaraxë Ahunt td-21):
 * | # | Feature                            | Status      | Notes                              |
 * |---|------------------------------------|-------------|------------------------------------|
 * | 1 | Unique (duplication-limit game:1)  | IMPLEMENTED | duplication-limit effect           |
 * | 2 | Ahunt attack on matching regions   | IMPLEMENTED | ahunt-attack in order-effects step |
 * | 3 | 4 strikes at 11/7, Dragon race     | IMPLEMENTED | ahunt-attack strikes/prowess/body  |
 * | 4 | Attacker chooses defenders         | IMPLEMENTED | combatRules on ahunt-attack        |
 * | 5 | Doors of Night extends regions     | IMPLEMENTED | extended clause with condition     |
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

const DAELOMIN_AHUNT = 'td-10' as CardDefinitionId;

// Base region path fixtures (trigger without Doors of Night).
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
  pathTypes: [RegionType.Shadow],
} as const;

// Non-matching / empty paths.
const PATH_NON_MATCHING = {
  pathNames: ['Gorgoroth', 'Nurn'],
  pathTypes: [RegionType.Dark, RegionType.Dark],
} as const;
const PATH_EMPTY = { pathNames: [], pathTypes: [] as RegionType[] } as const;

// Doors-of-Night-extended regions (only trigger with DoN in play).
const PATH_BROWN_LANDS = {
  pathNames: ['Brown Lands'],
  pathTypes: [RegionType.Shadow],
} as const;
const PATH_SOUTHERN_RHOVANION = {
  pathNames: ['Southern Rhovanion'],
  pathTypes: [RegionType.Wilderness],
} as const;
const PATH_DORWINION = {
  pathNames: ['Dorwinion'],
  pathTypes: [RegionType.Border],
} as const;
const PATH_DAGORLAD = {
  pathNames: ['Dagorlad'],
  pathTypes: [RegionType.Shadow],
} as const;
const PATH_HORSE_PLAINS = {
  pathNames: ['Horse Plains'],
  pathTypes: [RegionType.Shadow],
} as const;

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Daelomin Ahunt (td-10)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: the Dragon attack on the four base regions ────────────────────

  test('company moving through Withered Heath faces the Dragon attack (4 strikes / 11 / 7)', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: DAELOMIN_AHUNT, ...PATH_WITHERED_HEATH });

    const passActions = viableActions(state, PLAYER_1, 'pass');
    expect(passActions.length).toBeGreaterThanOrEqual(1);

    const next = dispatch(state, passActions[0].action);

    expect(next.combat).not.toBeNull();
    const combat = next.combat as CombatState;
    expect(combat.attackSource.type).toBe('ahunt');
    expect(combat.strikesTotal).toBe(4);
    expect(combat.strikeProwess).toBe(11);
    expect(combat.creatureBody).toBe(7);
    expect(combat.creatureRace).toBe('dragon');
  });

  test('each of the other three base regions also triggers the ahunt attack', () => {
    for (const path of [PATH_NORTHERN_RHOVANION, PATH_IRON_HILLS, PATH_GREY_MOUNTAIN_NARROWS]) {
      resetMint();
      const state = buildAhuntOrderEffectsState({ ahuntDefId: DAELOMIN_AHUNT, ...path });
      const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
      expect(next.combat).not.toBeNull();
      expect(next.combat!.attackSource.type).toBe('ahunt');
    }
  });

  test('company moving through a non-matching region does not trigger the attack', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: DAELOMIN_AHUNT, ...PATH_NON_MATCHING });
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).toBeNull();
  });

  test('non-moving company (empty path) does not trigger the attack', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: DAELOMIN_AHUNT, ...PATH_EMPTY });
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).toBeNull();
  });

  // ── Rule: attacker chooses defending characters ───────────────────────────

  test('attacker chooses defending characters (combat opens in cancel-window phase)', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: DAELOMIN_AHUNT, ...PATH_IRON_HILLS });
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
    expect(next.combat!.assignmentPhase).toBe('cancel-window');
  });

  // ── Rule 2: Doors of Night extends the affected regions ───────────────────

  test('extended regions do NOT trigger the attack without Doors of Night', () => {
    for (const path of [PATH_BROWN_LANDS, PATH_SOUTHERN_RHOVANION, PATH_DORWINION, PATH_DAGORLAD, PATH_HORSE_PLAINS]) {
      resetMint();
      const state = buildAhuntOrderEffectsState({ ahuntDefId: DAELOMIN_AHUNT, ...path });
      const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
      expect(next.combat).toBeNull();
    }
  });

  test('each extended region triggers the attack when Doors of Night is in play', () => {
    for (const path of [PATH_BROWN_LANDS, PATH_SOUTHERN_RHOVANION, PATH_DORWINION, PATH_DAGORLAD, PATH_HORSE_PLAINS]) {
      resetMint();
      const state = buildAhuntOrderEffectsState({
        ahuntDefId: DAELOMIN_AHUNT,
        ...path,
        extraCardsInPlay: [DOORS_OF_NIGHT],
      });
      const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
      expect(next.combat).not.toBeNull();
      expect(next.combat!.attackSource.type).toBe('ahunt');
    }
  });

  test('a base region still triggers with Doors of Night in play (base cost never dropped)', () => {
    const state = buildAhuntOrderEffectsState({
      ahuntDefId: DAELOMIN_AHUNT,
      ...PATH_WITHERED_HEATH,
      extraCardsInPlay: [DOORS_OF_NIGHT],
    });
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
    expect(next.combat!.attackSource.type).toBe('ahunt');
  });

  // ── Persistence: the long-event stays in play after the attack resolves ───

  test('the ahunt long-event stays in cardsInPlay after combat (not moved to kill/discard)', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: DAELOMIN_AHUNT, ...PATH_WITHERED_HEATH });

    let current = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(current.combat).not.toBeNull();

    // Drive the combat to completion: attacker assigns strikes, defender resolves,
    // both players pass through the remaining windows.
    for (let i = 0; i < 100 && current.combat !== null; i++) {
      let actions = viableActions(current, PLAYER_2, 'assign-strike');
      if (actions.length > 0) { current = dispatch(current, actions[0].action); continue; }
      actions = viableActions(current, PLAYER_1, 'assign-strike');
      if (actions.length > 0) { current = dispatch(current, actions[0].action); continue; }
      let stepped = false;
      for (const pid of [PLAYER_1, PLAYER_2]) {
        actions = viableActions(current, pid, 'pass');
        if (actions.length > 0) {
          const result = reduce(current, actions[0].action);
          if (!result.error) { current = result.state; stepped = true; break; }
        }
      }
      if (!stepped) break;
    }

    expect(current.players[1].cardsInPlay.some(c => c.definitionId === DAELOMIN_AHUNT)).toBe(true);
    expect(current.players[0].killPile.some(c => c.definitionId === DAELOMIN_AHUNT)).toBe(false);
    expect(current.players[1].discardPile.some(c => c.definitionId === DAELOMIN_AHUNT)).toBe(false);
  });
});
