/**
 * @module td-95.test
 *
 * Card test: A Short Rest (td-95)
 * Type: hero-resource-event (wizard), non-unique, Long-event, 0 MP
 *
 * "Each moving company may draw an extra card for each region less than four
 *  in its site path."
 *
 * CRF 22 ruling: the extra draw is only allowed for moving companies that
 * actually have a site path — it cannot be used with Under-deeps movement or
 * special movement cards (e.g. Belegaer).
 *
 * Mechanics: a resource long-event sits in the moving player's `cardsInPlay`
 * and contributes a `draw-modifier` (draw: resource, value
 * `"4 - sitePath.regionCount"`, min 0) to the movement/hazard draw step. The
 * `when` gate requires an actual region site path (movementType region/starter,
 * regionCount in 1..3), so under-deeps/special movement (empty path) and full
 * 4+-region paths grant no bonus, and the bonus is never negative.
 *
 * The destination in every scenario is Moria (tw-125): resourceDraws 2,
 * hazardDraws 3. Aragorn (mind 9) makes the resource player draw-eligible.
 *
 * Engine Support:
 * | # | Feature                                          | Status      | Notes                                               |
 * |---|--------------------------------------------------|-------------|-----------------------------------------------------|
 * | 1 | +(4 - regions) resource draws for a moving co.   | IMPLEMENTED | draw-modifier collected from active player's        |
 * |   |                                                  |             | cardsInPlay (long-event), sitePath.regionCount      |
 * | 2 | Only companies with a real region site path      | IMPLEMENTED | when: movementType in region/starter                |
 * | 3 | Excludes under-deeps / special movement          | IMPLEMENTED | empty path + movementType gate                      |
 * | 4 | Never reduces draws for long (4+ region) paths   | IMPLEMENTED | when: regionCount in 1..3                            |
 * | 5 | Opponent's copy never helps the moving player    | IMPLEMENTED | collected from the ACTIVE player's cardsInPlay only |
 *
 * Playable: YES
 * Certified: 2026-07-08
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildMHOrderEffectsDrawState, addCardInPlay, dispatch, resetMint,
  PLAYER_1, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, MORIA,
} from '../test-helpers.js';
import { RegionType } from '../../index.js';
import type { CardDefinitionId, MovementHazardPhaseState, GameState } from '../../index.js';
import { MovementType } from '../../types/common.js';

const A_SHORT_REST = 'td-95' as CardDefinitionId;

// Moria's printed draw boxes (baseline before any modifier).
const BASE_RESOURCE_DRAWS = 2;
const BASE_HAZARD_DRAWS = 3;

describe('A Short Rest (td-95)', () => {
  beforeEach(() => resetMint());

  test.each([
    [1, 3],
    [2, 2],
    [3, 1],
    [4, 0],
    [5, 0],
  ])(
    'region path of %i region(s) grants %i extra resource draw(s)',
    (regionCount, bonus) => {
      const path = Array.from({ length: regionCount }, () => RegionType.Wilderness);
      let state: GameState = buildMHOrderEffectsDrawState({
        heroChars: [ARAGORN],
        destinationSite: MORIA,
        pathTypes: path,
        movementType: MovementType.Region,
      });
      state = addCardInPlay(state, RESOURCE_PLAYER, A_SHORT_REST);
      const after = dispatch(state, { type: 'pass', player: PLAYER_1 });
      const mh = after.phaseState as MovementHazardPhaseState;

      expect(mh.step).toBe('draw-cards');
      expect(mh.resourceDrawMax).toBe(BASE_RESOURCE_DRAWS + bonus);
      // Only the resource draw pool is affected — hazard draws are untouched.
      expect(mh.hazardDrawMax).toBe(BASE_HAZARD_DRAWS);
    },
  );

  test('starter movement with a short site path also grants the bonus', () => {
    let state: GameState = buildMHOrderEffectsDrawState({
      heroChars: [ARAGORN],
      destinationSite: MORIA,
      pathTypes: [RegionType.Wilderness],
      movementType: MovementType.Starter,
    });
    state = addCardInPlay(state, RESOURCE_PLAYER, A_SHORT_REST);
    const after = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect((after.phaseState as MovementHazardPhaseState).resourceDrawMax).toBe(BASE_RESOURCE_DRAWS + 3);
  });

  test('no bonus without A Short Rest in play (the card is the source)', () => {
    const state: GameState = buildMHOrderEffectsDrawState({
      heroChars: [ARAGORN],
      destinationSite: MORIA,
      pathTypes: [RegionType.Wilderness],
      movementType: MovementType.Region,
    });
    const after = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect((after.phaseState as MovementHazardPhaseState).resourceDrawMax).toBe(BASE_RESOURCE_DRAWS);
  });

  test('under-deeps movement (no site path) grants no bonus', () => {
    let state: GameState = buildMHOrderEffectsDrawState({
      heroChars: [ARAGORN],
      destinationSite: MORIA,
      pathTypes: [],
      movementType: MovementType.UnderDeeps,
    });
    state = addCardInPlay(state, RESOURCE_PLAYER, A_SHORT_REST);
    const after = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect((after.phaseState as MovementHazardPhaseState).resourceDrawMax).toBe(BASE_RESOURCE_DRAWS);
  });

  test('special movement is excluded even with a non-empty path (CRF ruling)', () => {
    // Defensive: special movement resolves to an empty path in play, but the
    // movementType gate excludes it independent of path length.
    let state: GameState = buildMHOrderEffectsDrawState({
      heroChars: [ARAGORN],
      destinationSite: MORIA,
      pathTypes: [RegionType.Wilderness],
      movementType: MovementType.Special,
    });
    state = addCardInPlay(state, RESOURCE_PLAYER, A_SHORT_REST);
    const after = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect((after.phaseState as MovementHazardPhaseState).resourceDrawMax).toBe(BASE_RESOURCE_DRAWS);
  });

  test("an opponent's A Short Rest never helps the moving player", () => {
    // P1 is moving; the card sits in the opponent's (P2) cardsInPlay. The draw
    // step collects draw-modifiers from the ACTIVE player's cardsInPlay only.
    let state: GameState = buildMHOrderEffectsDrawState({
      heroChars: [ARAGORN],
      destinationSite: MORIA,
      pathTypes: [RegionType.Wilderness],
      movementType: MovementType.Region,
    });
    state = addCardInPlay(state, HAZARD_PLAYER, A_SHORT_REST);
    const after = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect((after.phaseState as MovementHazardPhaseState).resourceDrawMax).toBe(BASE_RESOURCE_DRAWS);
  });

  test('end-to-end: the moving player can actually draw the extra cards', () => {
    let state: GameState = buildMHOrderEffectsDrawState({
      heroChars: [ARAGORN],
      destinationSite: MORIA,
      pathTypes: [RegionType.Wilderness], // 1 region → +3 → max 5
      movementType: MovementType.Region,
    });
    state = addCardInPlay(state, RESOURCE_PLAYER, A_SHORT_REST);
    let after = dispatch(state, { type: 'pass', player: PLAYER_1 });

    expect((after.phaseState as MovementHazardPhaseState).resourceDrawMax).toBe(5);

    const handBefore = after.players[RESOURCE_PLAYER].hand.length;
    for (let i = 0; i < 5; i++) {
      after = dispatch(after, { type: 'draw-cards', player: PLAYER_1, count: 1 });
    }
    const post = after.phaseState as MovementHazardPhaseState;
    expect(post.resourceDrawCount).toBe(5);
    expect(after.players[RESOURCE_PLAYER].hand.length).toBe(handBefore + 5);
  });
});
