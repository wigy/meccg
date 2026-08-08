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
 *
 * Also covers bug report ab2c6ebe99021a4b (game mskidoss-noauyv, seq 696):
 * `company-view.ts`'s `inSelectCompany` (which forces the all-companies
 * overview and, with it, hides the single-company support-tap controls) used
 * to key off the raw `phaseState.step === 'select-company'` string directly.
 * A Lure of Nature end-of-company-mh corruption check fires while `step` is
 * still `'select-company'` (the phase handler enqueues the check before
 * advancing past that step), so the pending resolution short-circuited legal
 * actions to the roll/support-tap set while the stale step string kept
 * forcing the overview — stranding the player unable to reach the
 * single-company view where the support taps render. `inSelectCompany` now
 * reuses {@link selectCompanyPrompt}'s viable-action check, so it agrees with
 * the banner and stays off whenever a pending resolution has taken over legal
 * actions.
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

const pendingCorruptionCheck: EvaluatedAction = {
  action: {
    type: 'corruption-check',
    player: 'p1',
    characterId: 'p1-107',
    corruptionPoints: 2,
    corruptionModifier: 0,
    possessions: [],
    need: 3,
    explanation: 'Lure of Nature (region 1/1): need roll > 2 (CP 2)',
  },
  viable: true,
} as unknown as EvaluatedAction;

const supportCorruptionCheck: EvaluatedAction = {
  action: {
    type: 'support-corruption-check',
    player: 'p1',
    supportingCharacterId: 'p1-111',
    targetCharacterId: 'p1-107',
  },
  viable: true,
} as unknown as EvaluatedAction;

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

  test('returns null while a corruption check has short-circuited legal actions (step still select-company)', () => {
    // phaseState.step would still read 'select-company' at this point in the
    // real game (see module doc), but selectCompanyPrompt only looks at
    // legalActions, so it must not mistake the stale step for a real choice.
    const prompt = selectCompanyPrompt(
      viewWith(Phase.MovementHazard, [pendingCorruptionCheck, supportCorruptionCheck]),
    );
    expect(prompt).toBeNull();
  });
});
