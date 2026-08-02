/**
 * @module ring-after-test-hand-click.test
 *
 * Regression test for bug report 0a51cdebe20d8e31 (game msc0bo47-pn2a2n, seq
 * 383): Wizard's Test (tw-365) tested Beautiful Gold Ring as a lesser-ring,
 * queuing a Rule 9.21 `ring-play-offer` resolution — the engine correctly
 * offered `play-ring-after-test` for the Lesser Ring in hand (and `pass` to
 * decline), but nothing in the hand renderer looked for that action type, so
 * the Lesser Ring never highlighted and no button let the player play it.
 *
 * `findRingAfterTestAction` (extracted from `render-hand.ts`'s per-card
 * dispatch) now surfaces that action so the hand click handler can dispatch
 * it directly, the same way `findResourcePlayActions` does for ordinary
 * items.
 */

import './test-dom-bootstrap.js'; // must precede the render-hand import (load-time window access)
import { describe, test, expect } from 'vitest';
import type { CardInstanceId, GameAction } from '@meccg/shared';
import { findRingAfterTestAction } from './render-hand.js';

const LESSER_RING_INSTANCE = 'p1-8' as CardInstanceId;
const OTHER_HAND_CARD_INSTANCE = 'p1-175' as CardInstanceId;

const ringOfferActions: GameAction[] = [
  { type: 'pass', player: 'p1' } as GameAction,
  { type: 'play-ring-after-test', player: 'p1', ringInstanceId: LESSER_RING_INSTANCE } as GameAction,
];

describe('play-ring-after-test hand click (Rule 9.21 ring-play-offer)', () => {
  test('surfaces the play-ring-after-test action for the offered ring card', () => {
    const action = findRingAfterTestAction(LESSER_RING_INSTANCE, ringOfferActions);
    expect(action).not.toBeNull();
    expect(action?.type).toBe('play-ring-after-test');
  });

  test('ignores actions for a different hand card instance', () => {
    const action = findRingAfterTestAction(OTHER_HAND_CARD_INSTANCE, ringOfferActions);
    expect(action).toBeNull();
  });

  test('returns null when only pass is legal (no ring offered)', () => {
    const action = findRingAfterTestAction(LESSER_RING_INSTANCE, [{ type: 'pass', player: 'p1' } as GameAction]);
    expect(action).toBeNull();
  });

  test('returns null when instanceId is null', () => {
    const action = findRingAfterTestAction(null, ringOfferActions);
    expect(action).toBeNull();
  });
});
