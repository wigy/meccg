/**
 * @module select-company-prompt.test
 *
 * Regression test for bug report 59ae79e6d50ccf82 (game mr9jvlnw-2ldyce, seq
 * 246): during the Movement/Hazard select-company step the client forces the
 * all-companies overview, but that overview hides the phase meter (and its
 * targeting hint), leaving the active player with no on-screen text describing
 * what the game is waiting for. {@link selectCompanyPrompt} now returns a prompt
 * whenever the viewer holds a viable `select-company` action, which
 * `renderSelectCompanyBanner` draws as a banner at the top of the board.
 */

import './test-dom-bootstrap.js';
import { describe, test, expect } from 'vitest';
import { Phase } from '@meccg/shared';
import type { PlayerView, EvaluatedAction } from '@meccg/shared';
import { selectCompanyPrompt } from './company-view.js';

const selectCompany: EvaluatedAction = {
  action: { type: 'select-company', player: 'p1', companyId: 'company-p1-0' },
  viable: true,
} as EvaluatedAction;

const passOnly: EvaluatedAction = {
  action: { type: 'pass', player: 'p1' },
  viable: true,
} as EvaluatedAction;

const nonViableSelect: EvaluatedAction = {
  action: { type: 'select-company', player: 'p1', companyId: 'company-p1-0' },
  viable: false,
  reason: 'not this player',
} as EvaluatedAction;

const viewWith = (phase: Phase, legalActions: EvaluatedAction[]): PlayerView =>
  ({ phaseState: { phase }, legalActions } as unknown as PlayerView);

describe('selectCompanyPrompt', () => {
  test('prompts during the Movement/Hazard select-company step', () => {
    const prompt = selectCompanyPrompt(viewWith(Phase.MovementHazard, [selectCompany]));
    expect(prompt).not.toBeNull();
    expect(prompt?.title).toBe('Select a Company');
    expect(prompt?.detail).toContain('movement/hazard');
  });

  test('uses site-phase wording during the Site select-company step', () => {
    const prompt = selectCompanyPrompt(viewWith(Phase.Site, [selectCompany]));
    expect(prompt?.detail).toContain('site');
  });

  test('returns null when there is no select-company action (viewer is waiting)', () => {
    expect(selectCompanyPrompt(viewWith(Phase.MovementHazard, [passOnly]))).toBeNull();
  });

  test('returns null when the only select-company action is not viable', () => {
    expect(selectCompanyPrompt(viewWith(Phase.MovementHazard, [nonViableSelect]))).toBeNull();
  });
});
