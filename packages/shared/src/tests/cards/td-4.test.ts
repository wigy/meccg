/**
 * @module td-4.test
 *
 * Card test: Bairanax Ahunt (td-4)
 * Type: hazard-event (long, unique)
 * Effects: 2 (duplication-limit scope:game max:1, ahunt-attack)
 *
 * "Unique. Any company moving in Withered Heath, Gundabad, Anduin Vales,
 *  and/or Grey Mountain Narrows faces one Dragon attack (considered a hazard
 *  creature attack) — 3 strikes at 12/6 (attacker chooses defending characters).
 *  If Doors of Night is in play, this attack also affects: Northern Rhovanion,
 *  Iron Hills, Southern Rhovanion, and Angmar."
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
  resetMint, buildAhuntOrderEffectsState, buildTestState, makeMHState,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  DOORS_OF_NIGHT,
  viableActions, dispatch, handCardId, companyIdAt, playHazardAndResolve,
} from '../test-helpers.js';
import { Phase, RegionType, ARAGORN, LEGOLAS, EDHELLOND, LORIEN, MINAS_TIRITH } from '../../index.js';
import type { CardDefinitionId, CombatState, GameState } from '../../index.js';

const BAIRANAX_AHUNT = 'td-4' as CardDefinitionId;

const PATH_WITHERED_HEATH = {
  pathNames: ['Withered Heath'],
  pathTypes: [RegionType.Wilderness],
} as const;
const PATH_GUNDABAD = {
  pathNames: ['Gundabad'],
  pathTypes: [RegionType.Shadow],
} as const;
const PATH_ANDUIN_VALES = {
  pathNames: ['Anduin Vales'],
  pathTypes: [RegionType.Wilderness],
} as const;
const PATH_GREY_MOUNTAIN_NARROWS = {
  pathNames: ['Grey Mountain Narrows'],
  pathTypes: [RegionType.Wilderness],
} as const;
const PATH_NON_MATCHING = {
  pathNames: ['Belfalas', 'Lamedon'],
  pathTypes: [RegionType.Wilderness, RegionType.Wilderness],
} as const;
const PATH_EMPTY = { pathNames: [], pathTypes: [] as RegionType[] } as const;
const PATH_NORTHERN_RHOVANION = {
  pathNames: ['Northern Rhovanion'],
  pathTypes: [RegionType.Wilderness],
} as const;
const PATH_IRON_HILLS = {
  pathNames: ['Iron Hills'],
  pathTypes: [RegionType.Wilderness],
} as const;
const PATH_SOUTHERN_RHOVANION = {
  pathNames: ['Southern Rhovanion'],
  pathTypes: [RegionType.Wilderness],
} as const;
const PATH_ANGMAR = {
  pathNames: ['Angmar'],
  pathTypes: [RegionType.Shadow],
} as const;

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Bairanax Ahunt (td-4)', () => {
  beforeEach(() => resetMint());

  test('company moving through Withered Heath triggers ahunt combat at order-effects', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: BAIRANAX_AHUNT, ...PATH_WITHERED_HEATH });

    const passActions = viableActions(state, PLAYER_1, 'pass');
    expect(passActions.length).toBeGreaterThanOrEqual(1);

    const next = dispatch(state, passActions[0].action);

    expect(next.combat).not.toBeNull();
    const combat = next.combat as CombatState;
    expect(combat.attackSource.type).toBe('ahunt');
    expect(combat.strikesTotal).toBe(3);
    expect(combat.strikeProwess).toBe(12);
    expect(combat.creatureBody).toBe(6);
    expect(combat.creatureRace).toBe('dragon');
    expect(combat.assignmentPhase).toBe('cancel-window');
  });

  test('company moving through Gundabad triggers ahunt combat', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: BAIRANAX_AHUNT, ...PATH_GUNDABAD });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
    expect(next.combat!.attackSource.type).toBe('ahunt');
  });

  test('company moving through Anduin Vales triggers ahunt combat', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: BAIRANAX_AHUNT, ...PATH_ANDUIN_VALES });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
    expect(next.combat!.attackSource.type).toBe('ahunt');
  });

  test('company moving through Grey Mountain Narrows triggers ahunt combat', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: BAIRANAX_AHUNT, ...PATH_GREY_MOUNTAIN_NARROWS });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
    expect(next.combat!.attackSource.type).toBe('ahunt');
  });

  test('company moving through non-matching region does not trigger ahunt', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: BAIRANAX_AHUNT, ...PATH_NON_MATCHING });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).toBeNull();
  });

  test('non-moving company (empty path) does not trigger ahunt', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: BAIRANAX_AHUNT, ...PATH_EMPTY });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).toBeNull();
  });

  test('Northern Rhovanion does NOT trigger without Doors of Night', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: BAIRANAX_AHUNT, ...PATH_NORTHERN_RHOVANION });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).toBeNull();
  });

  test('Iron Hills does NOT trigger without Doors of Night', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: BAIRANAX_AHUNT, ...PATH_IRON_HILLS });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).toBeNull();
  });

  test('Southern Rhovanion does NOT trigger without Doors of Night', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: BAIRANAX_AHUNT, ...PATH_SOUTHERN_RHOVANION });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).toBeNull();
  });

  test('Angmar does NOT trigger without Doors of Night', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: BAIRANAX_AHUNT, ...PATH_ANGMAR });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).toBeNull();
  });

  test('Northern Rhovanion triggers with Doors of Night in play', () => {
    const state = buildAhuntOrderEffectsState({
      ahuntDefId: BAIRANAX_AHUNT,
      ...PATH_NORTHERN_RHOVANION,
      extraCardsInPlay: [DOORS_OF_NIGHT],
    });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
    expect(next.combat!.attackSource.type).toBe('ahunt');
  });

  test('Iron Hills triggers with Doors of Night in play', () => {
    const state = buildAhuntOrderEffectsState({
      ahuntDefId: BAIRANAX_AHUNT,
      ...PATH_IRON_HILLS,
      extraCardsInPlay: [DOORS_OF_NIGHT],
    });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
    expect(next.combat!.attackSource.type).toBe('ahunt');
  });

  test('Southern Rhovanion triggers with Doors of Night in play', () => {
    const state = buildAhuntOrderEffectsState({
      ahuntDefId: BAIRANAX_AHUNT,
      ...PATH_SOUTHERN_RHOVANION,
      extraCardsInPlay: [DOORS_OF_NIGHT],
    });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
    expect(next.combat!.attackSource.type).toBe('ahunt');
  });

  test('Angmar triggers with Doors of Night in play', () => {
    const state = buildAhuntOrderEffectsState({
      ahuntDefId: BAIRANAX_AHUNT,
      ...PATH_ANGMAR,
      extraCardsInPlay: [DOORS_OF_NIGHT],
    });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
    expect(next.combat!.attackSource.type).toBe('ahunt');
  });

  test('attacker chooses defenders (cancel-window phase before assignment)', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: BAIRANAX_AHUNT, ...PATH_WITHERED_HEATH });

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
    expect(next.combat!.assignmentPhase).toBe('cancel-window');
  });

  test('ahunt long-event stays in cardsInPlay after combat', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: BAIRANAX_AHUNT, ...PATH_WITHERED_HEATH });

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

    expect(current.players[1].cardsInPlay.some(c => c.definitionId === BAIRANAX_AHUNT)).toBe(true);
    expect(current.players[0].killPile.some(c => c.definitionId === BAIRANAX_AHUNT)).toBe(false);
    expect(current.players[1].discardPile.some(c => c.definitionId === BAIRANAX_AHUNT)).toBe(false);
  });

  test('playing Bairanax Ahunt during the moving company\'s own movement triggers an attack immediately', () => {
    // Bug report (game msd2n90b-jidxrb, seq 305): the hazard player played
    // Bairanax Ahunt targeting the company while it was moving through Grey
    // Mountain Narrows, but no attack was ever faced — order-effects (CoE
    // step 4) had already run for this company *before* the hazard player's
    // step 7, so the freshly-played long-event sat in cardsInPlay unresolved
    // until some future company's movement. Per the long-event rule
    // ("effects are immediately implemented when it is played"), the very
    // act of playing it against the currently-moving company should trigger
    // the attack right away.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: EDHELLOND, characters: [ARAGORN] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [BAIRANAX_AHUNT], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state: GameState = {
      ...base,
      phaseState: makeMHState({
        resolvedSitePathNames: [...PATH_GREY_MOUNTAIN_NARROWS.pathNames],
        resolvedSitePath: [...PATH_GREY_MOUNTAIN_NARROWS.pathTypes],
      }),
    };

    const ahuntId = handCardId(state, HAZARD_PLAYER);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);

    const after = playHazardAndResolve(state, PLAYER_2, ahuntId, companyId);

    expect(after.combat).not.toBeNull();
    const combat = after.combat as CombatState;
    expect(combat.attackSource.type).toBe('ahunt');
    expect(combat.strikesTotal).toBe(3);
    expect(combat.strikeProwess).toBe(12);
    expect(after.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === BAIRANAX_AHUNT)).toBe(true);
  });
});
