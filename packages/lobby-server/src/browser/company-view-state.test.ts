import { describe, it, expect } from 'vitest';
import { shouldOverrideToAllCompanies } from './company-view-state.js';

/**
 * Regression tests for the turn-change focus decision.
 *
 * Bug report (game mqtbg9mu-u4g9gt, seq 33): when the opponent has the first
 * turn of the game, the local player was dropped into the all-companies overview
 * instead of focusing the opponent's single starting company. The game-start
 * case must keep the override off so the downstream auto-focus lands on the
 * opponent's company in single-company view.
 */
describe('shouldOverrideToAllCompanies', () => {
  const SELF = 'p1';
  const OPPONENT = 'p2';

  it('does NOT force the overview when the opponent has the first turn (game start)', () => {
    // lastActivePlayer === null marks the very start of the game.
    expect(shouldOverrideToAllCompanies(OPPONENT, null, SELF)).toBe(false);
  });

  it('does NOT force the overview when the local player has the first turn', () => {
    expect(shouldOverrideToAllCompanies(SELF, null, SELF)).toBe(false);
  });

  it('forces the overview when it becomes the opponent\'s turn mid-game', () => {
    expect(shouldOverrideToAllCompanies(OPPONENT, SELF, SELF)).toBe(true);
  });

  it('does NOT force the overview when it becomes the local player\'s turn mid-game', () => {
    expect(shouldOverrideToAllCompanies(SELF, OPPONENT, SELF)).toBe(false);
  });

  it('does NOT force the overview when there is no active player', () => {
    expect(shouldOverrideToAllCompanies(null, OPPONENT, SELF)).toBe(false);
  });
});
