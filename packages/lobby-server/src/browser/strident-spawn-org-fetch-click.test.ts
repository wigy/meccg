/**
 * @module strident-spawn-org-fetch-click.test
 *
 * Regression test for bug report d9f80cd5e5f57819 (game msnfzusi-73w1gh, seq
 * 668): A Strident Spawn (wh-61) grants "during your organization phase, you
 * may take one Half-orc character from your discard pile to your hand" via
 * the engine's `activate-org-fetch` action, and the engine correctly offered
 * it at the reported sequence. But the cards-in-play row had no click handler
 * for `activate-org-fetch` at all — every other bearer-less in-play activation
 * (`activate-granted-action`, tap-alt, hazard-limit swap, event-maintenance)
 * had one, so the card rendered as a plain, unclickable image and the ability
 * was reachable only from the debug action panel.
 *
 * `findOrgPhaseFetchAction` now resolves the viable `activate-org-fetch`
 * action for a clicked in-play card so the renderer can highlight it and
 * dispatch it directly (the action itself enqueues the shared pick-one-or-pass
 * fetch flow, so no candidate picker is needed here).
 */

import './test-dom-bootstrap.js'; // must precede the company-block import (load-time window access)
import { describe, test, expect } from 'vitest';
import type { ActivateOrgFetchAction, CardInstanceId, GameAction, PlayerId } from '@meccg/shared';
import { findOrgPhaseFetchAction } from './company-block.js';

const STRIDENT_SPAWN = 'p1-31' as CardInstanceId; // wh-61, in play as a permanent-event
const OTHER_PERMANENT = 'p1-22' as CardInstanceId;

const fetchAction: ActivateOrgFetchAction = {
  type: 'activate-org-fetch',
  player: 'p1' as PlayerId,
  cardInstanceId: STRIDENT_SPAWN,
};

const actions: GameAction[] = [fetchAction];

describe('A Strident Spawn\'s org-phase fetch is reachable from the board', () => {
  test('resolves the viable activate-org-fetch action whose source is the clicked in-play card', () => {
    expect(findOrgPhaseFetchAction(actions, STRIDENT_SPAWN)).toEqual(fetchAction);
  });

  test('no fetch action for an unrelated in-play card', () => {
    expect(findOrgPhaseFetchAction(actions, OTHER_PERMANENT)).toBeNull();
    expect(findOrgPhaseFetchAction([], STRIDENT_SPAWN)).toBeNull();
  });
});
