/**
 * @module ai/h2/test-support
 *
 * Fixtures shared by the Heuristics-2 tests.
 *
 * The win-probability model is fitted from self-play and ships as a JSON file,
 * which is the right thing for the agent and the wrong thing for a unit test:
 * a test that asserts on risk behaviour must not change its meaning the next
 * time the corpus is regenerated. Tests therefore pin their own coefficients
 * through {@link testWinProbModel}, and only the fit's own tests look at the
 * shipped file.
 */

import type { MarshallingPointTotals, PlayerView } from '@meccg/shared';
import type { WinProbModel } from './core/winprob.js';

/**
 * A win-probability model with hand-chosen coefficients.
 *
 * Defaults put an even game at exactly 50% and give a TSD point a visible but
 * not saturating effect, so a test can move the standing a few points and see
 * the posture respond.
 */
export function testWinProbModel(overrides: Partial<WinProbModel> = {}): WinProbModel {
  return {
    version: 1,
    fittedAt: '2026-01-01T00:00:00.000Z',
    turnScale: 40,
    tsd: 0.08,
    tsdTurn: 0.12,
    corpus: {
      games: 0,
      samples: 0,
      agents: ['test'],
      decks: ['test'],
      seedBase: 0,
      holdoutFraction: 0,
    },
    holdout: { games: 0, samples: 0, brier: 0, logLoss: 0, signAccuracy: 0, reliability: [] },
    ...overrides,
  };
}

/** Marshalling-point totals with every unnamed source at zero. */
export function testMarshallingPoints(values: Partial<MarshallingPointTotals>): MarshallingPointTotals {
  return { character: 0, item: 0, faction: 0, ally: 0, kill: 0, misc: 0, ...values };
}

/**
 * The slice of a {@link PlayerView} the `standing` service reads: both sides'
 * marshalling points and the turn number.
 *
 * Building a whole projected view for a scoring test would mean building a
 * whole game, which is what the scenario corpus is for; standing is a pure
 * function of these three inputs and is tested as one.
 */
export function testStandingView(
  self: Partial<MarshallingPointTotals>,
  opponent: Partial<MarshallingPointTotals>,
  turnNumber: number,
): PlayerView {
  return {
    self: { marshallingPoints: testMarshallingPoints(self), companies: [], characters: {} },
    opponent: { marshallingPoints: testMarshallingPoints(opponent) },
    turnNumber,
    // The Heuristics-1 fallback reads the phase, so a view used to exercise
    // that path needs one; standing itself never looks.
    phaseState: { phase: 'organization' },
  } as unknown as PlayerView;
}
