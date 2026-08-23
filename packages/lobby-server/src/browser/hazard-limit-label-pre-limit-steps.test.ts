/**
 * @module hazard-limit-label-pre-limit-steps.test
 *
 * Regression for `getHazardLimitLabel`: the hazard-limit box must stay hidden
 * for every Movement/Hazard sub-step that runs before the limit is computed in
 * the set-hazard-limit handler. The guard listed select-company / reveal-new-site
 * / set-hazard-limit but missed `under-deeps-roll` and `region-shortcut-attack`,
 * which both auto-advance into set-hazard-limit. During those steps
 * `hazardLimitAtReveal` is still 0 (first company) or the previous company's
 * stale value, so the box wrongly rendered "HL 0" — or the prior company's
 * number — instead of nothing.
 */

import './test-dom-bootstrap.js'; // must precede the render-player-names import (load-time window access)
import { describe, test, expect } from 'vitest';
import type { PlayerView } from '@meccg/shared';
import { Phase } from '@meccg/shared';
import { getHazardLimitLabel } from './render-player-names.js';

const viewAtStep = (step: string, hazardLimitAtReveal: number): PlayerView =>
  ({
    activePlayer: 'p2',
    self: { id: 'p1', companies: [] },
    opponent: { id: 'p2', companies: [{ id: 'company-p2-0' }] },
    activeConstraints: [],
    combat: null,
    phaseState: {
      phase: Phase.MovementHazard,
      step,
      activeCompanyIndex: 0,
      hazardLimitAtReveal,
      preRevealHazardLimitConstraintIds: [],
      hazardsPlayedThisCompany: 0,
    },
  }) as unknown as PlayerView;

describe('getHazardLimitLabel hides the box before the limit is set', () => {
  test('under-deeps-roll (before the limit exists) shows nothing, not "HL 0"', () => {
    expect(getHazardLimitLabel(viewAtStep('under-deeps-roll', 0))).toBeNull();
  });

  test('region-shortcut-attack does not leak a previous company\'s stale limit', () => {
    // hazardLimitAtReveal still holds the last company's 5 — the box must not show it.
    expect(getHazardLimitLabel(viewAtStep('region-shortcut-attack', 5))).toBeNull();
  });

  test('a post-limit step (play-hazards) still shows the remaining limit', () => {
    expect(getHazardLimitLabel(viewAtStep('play-hazards', 4))).toBe('4');
  });
});
