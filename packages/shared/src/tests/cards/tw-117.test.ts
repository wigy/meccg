/**
 * @module tw-117.test
 *
 * Card test: Alatar (tw-117)
 * Type: hero-character (wizard)
 * Effects: 1 (draw-modifier)
 *
 * "Unique. The number of cards your opponent draws based on Alatar's company's
 *  movement is reduced by one (to minimum of 0). If at a Haven when a hazard
 *  creature attacks one of your companies, he may immediately join that company
 *  (discard allies he controls). Alatar must face a strike from that creature
 *  (in all cases). Following the attack, Alatar must tap (if untapped) and make
 *  a corruption check."
 *
 * Engine Support:
 * | # | Feature                                | Status          | Notes                              |
 * |---|----------------------------------------|-----------------|------------------------------------|
 * | 1 | Reduce opponent hazard draws by 1       | IMPLEMENTED     | draw-modifier effect               |
 * | 2 | Haven-jump to defend another company    | NOT IMPLEMENTED | requires major new engine mechanics |
 * | 3 | Must face a strike from creature        | NOT IMPLEMENTED | requires haven-jump infrastructure  |
 * | 4 | Post-combat tap + corruption check      | NOT IMPLEMENTED | requires haven-jump infrastructure  |
 *
 * Playable: PARTIALLY (draw reduction works; haven-jump ability does not)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  GANDALF, ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, EDORAS,
  Phase, CardStatus,
  buildTestState, resetMint, makeMHState, mint,
  dispatch, makePlayDeck,
} from '../test-helpers.js';
import type { CardDefinitionId, MovementHazardPhaseState, PlayerState } from '../../index.js';

const ALATAR = 'tw-117' as CardDefinitionId;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Alatar (tw-117)', () => {
  beforeEach(() => resetMint());

  /**
   * Helper: build a state in M/H order-effects step with a company moving
   * to a destination site. Dispatching 'pass' triggers transitionToDrawCards.
   */
  function buildMHDrawState(wizard: CardDefinitionId, destinationSite: CardDefinitionId) {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [wizard, LEGOLAS] }],
          hand: [],
          siteDeck: [MORIA],
          playDeck: makePlayDeck(),
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
          playDeck: makePlayDeck(),
        },
      ],
    });

    const destInstId = mint();
    const company = {
      ...state.players[0].companies[0],
      destinationSite: { instanceId: destInstId, definitionId: destinationSite, status: CardStatus.Untapped },
    };
    const players: readonly [PlayerState, PlayerState] = [
      { ...state.players[0], companies: [company] },
      state.players[1],
    ];

    const mhState = makeMHState({ step: 'order-effects' as MovementHazardPhaseState['step'] });
    return { ...state, players, phaseState: mhState };
  }

  // ── Effect 1: draw-modifier — reduce opponent hazard draws by 1 ──

  test('hazard draws reduced by 1 when Alatar is in the moving company', () => {
    const testState = buildMHDrawState(ALATAR, MORIA);

    const result = dispatch(testState, { type: 'pass', player: PLAYER_1 });
    const resultMH = result.phaseState as MovementHazardPhaseState;

    expect(resultMH.step).toBe('draw-cards');
    // Moria normally gives 3 hazard draws; Alatar reduces to 2
    expect(resultMH.hazardDrawMax).toBe(2);
    // Resource draws unaffected (Moria gives 2)
    expect(resultMH.resourceDrawMax).toBe(2);
  });

  test('hazard draws not reduced below the minimum of 0', () => {
    // Edoras has hazardDraws: 1 — after Alatar's -1, should be 0 (not negative)
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ALATAR] }],
          hand: [],
          siteDeck: [],
          playDeck: makePlayDeck(),
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
          playDeck: makePlayDeck(),
        },
      ],
    });

    const destInstId = mint();
    const company = {
      ...state.players[0].companies[0],
      destinationSite: { instanceId: destInstId, definitionId: EDORAS, status: CardStatus.Untapped },
    };
    const players: readonly [PlayerState, PlayerState] = [
      { ...state.players[0], companies: [company] },
      state.players[1],
    ];

    const mhState = makeMHState({ step: 'order-effects' as MovementHazardPhaseState['step'] });
    const testState = { ...state, players, phaseState: mhState };

    const result = dispatch(testState, { type: 'pass', player: PLAYER_1 });
    const resultMH = result.phaseState as MovementHazardPhaseState;

    expect(resultMH.step).toBe('draw-cards');
    expect(resultMH.hazardDrawMax).toBe(0);
  });

  test('without Alatar, hazard draws equal the site value', () => {
    const testState = buildMHDrawState(GANDALF, MORIA);

    const result = dispatch(testState, { type: 'pass', player: PLAYER_1 });
    const resultMH = result.phaseState as MovementHazardPhaseState;

    expect(resultMH.step).toBe('draw-cards');
    // Without Alatar, Moria gives full 3 hazard draws
    expect(resultMH.hazardDrawMax).toBe(3);
    expect(resultMH.resourceDrawMax).toBe(2);
  });
});
