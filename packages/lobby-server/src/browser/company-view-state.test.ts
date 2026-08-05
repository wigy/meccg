import { describe, it, expect } from 'vitest';
import {
  shouldOverrideToAllCompanies,
  shouldFocusOwnCompanyAfterSelectCompany,
  shouldClearOverrideForNewCombat,
} from './company-view-state.js';

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

/**
 * Regression tests for bug report a0b96ce4a3e16820 (game msd9dixh-m9voxl, seq
 * 721): "l'agent a disparu je ne le vois plus sur la surface de jeu" — after
 * playing Pôn-ora-Pôn (dm-22) as an agent hazard during the opponent's
 * movement/hazard phase, the agent never appeared anywhere on the board.
 *
 * Root cause: the select-company → next-step auto-focus fired regardless of
 * whose turn it was, kicking the hazard player out of the all-companies
 * overview (forced on for the whole opponent turn by
 * shouldOverrideToAllCompanies) and into single-company view focused on the
 * opponent's active company — the only view that never renders self.agents.
 */
describe('shouldFocusOwnCompanyAfterSelectCompany', () => {
  const SELF = 'p1';
  const OPPONENT = 'p2';

  it('does NOT focus a company on the opponent\'s turn (stays in the all-companies overview)', () => {
    expect(shouldFocusOwnCompanyAfterSelectCompany('select-company', 'play-hazards', OPPONENT, SELF)).toBe(false);
  });

  it('focuses the active company on our own turn', () => {
    expect(shouldFocusOwnCompanyAfterSelectCompany('select-company', 'draw-cards', SELF, SELF)).toBe(true);
  });

  it('does NOT focus when the previous step was not select-company', () => {
    expect(shouldFocusOwnCompanyAfterSelectCompany('draw-cards', 'play-hazards', SELF, SELF)).toBe(false);
  });

  it('does NOT focus when still in the select-company step', () => {
    expect(shouldFocusOwnCompanyAfterSelectCompany('select-company', 'select-company', SELF, SELF)).toBe(false);
  });

  it('does NOT focus when there is no active player', () => {
    expect(shouldFocusOwnCompanyAfterSelectCompany('select-company', 'draw-cards', null, SELF)).toBe(false);
  });
});

/**
 * Regression tests for bug report 7ff9464e440e22ed (game msenkvsc-3y5o11, seq
 * 581): "When opponnent moves it is staying in the overview screen, not
 * showing the party and my cards". The opponent's movement/hazard phase
 * forces the all-companies overview on for the whole turn (so self-agents
 * stay visible), but a hazard-triggered strike/body-check needs the combat
 * view instead — and the overview's CSS hides the local player's hand. The
 * override must be cleared the moment a new combat starts.
 */
describe('shouldClearOverrideForNewCombat', () => {
  it('clears the override when a new combat starts', () => {
    expect(shouldClearOverrideForNewCombat(true, false)).toBe(true);
  });

  it('does NOT clear the override on a re-render while combat is still ongoing', () => {
    expect(shouldClearOverrideForNewCombat(true, true)).toBe(false);
  });

  it('does NOT clear the override when there is no combat', () => {
    expect(shouldClearOverrideForNewCombat(false, false)).toBe(false);
  });

  it('does NOT clear the override when combat just ended', () => {
    expect(shouldClearOverrideForNewCombat(false, true)).toBe(false);
  });
});
