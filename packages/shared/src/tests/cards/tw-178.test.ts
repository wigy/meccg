/**
 * @module tw-178.test
 *
 * Card test: Radagast (tw-178)
 * Type: hero-character (wizard)
 * Effects: 2
 *
 * "Unique. When Radagast's new site is revealed, he may draw one additional
 *  card for each Wilderness in his company's site path. +1 to all of his
 *  corruption checks."
 *
 * Engine Support:
 * | # | Feature                                          | Status      | Notes                                              |
 * |---|--------------------------------------------------|-------------|----------------------------------------------------|
 * | 1 | +1 resource draw per Wilderness in site path     | IMPLEMENTED | draw-modifier with sitePath.wildernessCount expr   |
 * | 2 | +1 to all of his corruption checks               | IMPLEMENTED | corruptionModifier=1 + check-modifier effect       |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI,
  MORIA, EDORAS, RIVENDELL, LORIEN, MINAS_TIRITH,
  Phase,
  buildTestState, resetMint,
  findCharInstanceId, RESOURCE_PLAYER,
  enqueueTransferCorruptionCheck,
  getCharacter,
  dispatch, phaseStateAs,
  buildMHOrderEffectsDrawState,
  PRECIOUS_GOLD_RING,
} from '../test-helpers.js';
import { computeLegalActions, RegionType } from '../../index.js';
import type { CardDefinitionId, MovementHazardPhaseState, CorruptionCheckAction } from '../../index.js';

const RADAGAST = 'tw-178' as CardDefinitionId;

describe('Radagast (tw-178)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: draw-modifier — +1 resource draw per Wilderness in path ──

  test('no extra resource draws when site path has no Wildernesses', () => {
    const testState = buildMHOrderEffectsDrawState({
      heroChars: [RADAGAST, LEGOLAS],
      destinationSite: EDORAS,
      heroSiteDeck: [],
      pathTypes: [RegionType.Free, RegionType.Border],
      pathNames: ['Anorien', 'Gap of Isen'],
    });

    const result = dispatch(testState, { type: 'pass', player: PLAYER_1 });
    const resultMH = phaseStateAs<MovementHazardPhaseState>(result);

    expect(resultMH.step).toBe('draw-cards');
    // Edoras has resourceDraws: 1, hazardDraws: 1. No wildernesses → no bonus
    expect(resultMH.resourceDrawMax).toBe(1);
    expect(resultMH.hazardDrawMax).toBe(1);
  });

  test('+1 resource draw when site path has 1 Wilderness', () => {
    const testState = buildMHOrderEffectsDrawState({
      heroChars: [RADAGAST, LEGOLAS],
      destinationSite: MORIA,
      pathTypes: [RegionType.Wilderness],
      pathNames: ['Rhudaur'],
    });

    const result = dispatch(testState, { type: 'pass', player: PLAYER_1 });
    const resultMH = phaseStateAs<MovementHazardPhaseState>(result);

    expect(resultMH.step).toBe('draw-cards');
    // Moria: resourceDraws=2, hazardDraws=3. +1 per wilderness → resource=3
    expect(resultMH.resourceDrawMax).toBe(3);
    expect(resultMH.hazardDrawMax).toBe(3);
  });

  test('+2 resource draws when site path has 2 Wildernesses', () => {
    const testState = buildMHOrderEffectsDrawState({
      heroChars: [RADAGAST, LEGOLAS],
      destinationSite: MORIA,
      pathTypes: [RegionType.Wilderness, RegionType.Wilderness],
      pathNames: ['Hollin', 'Enedhwaith'],
    });

    const result = dispatch(testState, { type: 'pass', player: PLAYER_1 });
    const resultMH = phaseStateAs<MovementHazardPhaseState>(result);

    expect(resultMH.step).toBe('draw-cards');
    // Moria base resource=2, +2 wildernesses → 4
    expect(resultMH.resourceDrawMax).toBe(4);
    expect(resultMH.hazardDrawMax).toBe(3);
  });

  test('only Wildernesses count — mixed path with Shadow and Dark regions does not boost', () => {
    const testState = buildMHOrderEffectsDrawState({
      heroChars: [RADAGAST, LEGOLAS],
      destinationSite: MORIA,
      pathTypes: [RegionType.Wilderness, RegionType.Shadow, RegionType.Dark],
      pathNames: ['Cardolan', 'Imlad Morgul', 'Gorgoroth'],
    });

    const result = dispatch(testState, { type: 'pass', player: PLAYER_1 });
    const resultMH = phaseStateAs<MovementHazardPhaseState>(result);

    expect(resultMH.step).toBe('draw-cards');
    // One wilderness only — Shadow/Dark don't count
    expect(resultMH.resourceDrawMax).toBe(3);
    expect(resultMH.hazardDrawMax).toBe(3);
  });

  test('hazard draws are not modified by Radagast regardless of Wildernesses', () => {
    const testState = buildMHOrderEffectsDrawState({
      heroChars: [RADAGAST, LEGOLAS],
      destinationSite: MORIA,
      pathTypes: [RegionType.Wilderness, RegionType.Wilderness, RegionType.Wilderness],
      pathNames: ['A', 'B', 'C'],
    });

    const result = dispatch(testState, { type: 'pass', player: PLAYER_1 });
    const resultMH = phaseStateAs<MovementHazardPhaseState>(result);

    expect(resultMH.step).toBe('draw-cards');
    // Moria hazardDraws=3; Radagast's effect only targets resource pool
    expect(resultMH.hazardDrawMax).toBe(3);
    expect(resultMH.resourceDrawMax).toBe(5);
  });

  test('without Radagast in the moving company, wildernesses do not boost resource draws', () => {
    const testState = buildMHOrderEffectsDrawState({
      heroChars: [LEGOLAS, GIMLI],
      destinationSite: MORIA,
      pathTypes: [RegionType.Wilderness, RegionType.Wilderness],
      pathNames: ['Hollin', 'Enedhwaith'],
    });

    const result = dispatch(testState, { type: 'pass', player: PLAYER_1 });
    const resultMH = phaseStateAs<MovementHazardPhaseState>(result);

    expect(resultMH.step).toBe('draw-cards');
    // Without Radagast, Moria's base resourceDraws=2 applies
    expect(resultMH.resourceDrawMax).toBe(2);
    expect(resultMH.hazardDrawMax).toBe(3);
  });

  // ── Effect 2: +1 to all of Radagast's corruption checks ──

  test('+1 corruption modifier decreases need on pending corruption check', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: RADAGAST, items: [PRECIOUS_GOLD_RING] }, LEGOLAS] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const radagastId = findCharInstanceId(state, RESOURCE_PLAYER, RADAGAST);
    const ringInstId = getCharacter(state, RESOURCE_PLAYER, RADAGAST).items[0].instanceId;

    const stateWithCheck = enqueueTransferCorruptionCheck(state, PLAYER_1, radagastId, ringInstId);

    const actions = computeLegalActions(stateWithCheck, PLAYER_1);
    const ccActions = actions
      .filter(a => a.viable && a.action.type === 'corruption-check')
      .map(a => a.action as CorruptionCheckAction);

    expect(ccActions.length).toBe(1);
    expect(ccActions[0].characterId).toBe(radagastId);
    // corruptionModifier is +1 (from the corruptionModifier field, which is
    // the canonical source; the DSL check-modifier effect on Radagast's own
    // card is skipped to avoid double-counting).
    expect(ccActions[0].corruptionModifier).toBe(1);
    // need = CP + 1 - modifier. With modifier +1, need = CP.
    expect(ccActions[0].need).toBe(ccActions[0].corruptionPoints + 1 - 1);
  });
});
