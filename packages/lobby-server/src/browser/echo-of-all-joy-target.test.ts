/**
 * @module echo-of-all-joy-target.test
 *
 * Regression test for bug report e1b9f49abb624834 (game ms7zrew8-h6uhu5, seq
 * 451): playing a second Echo of All Joy (td-110) never let the player choose
 * which of several own in-play "Star of High Hope" (td-154) copies to attach
 * to — `findCardAction`'s generic loop silently returned the first matching
 * `play-permanent-event` action regardless of `targetLongEventInstanceId`, so
 * both Echoes bound to the same long-event and a sibling copy was left
 * unprotected and discarded at the next long-event phase.
 *
 * `findPermanentEventLongEventTargetActions` now surfaces every candidate
 * target so the hand renderer can route through the two-step
 * click-card-then-click-target flow (mirroring the existing character-target
 * flow) instead of auto-picking one.
 */

import './test-dom-bootstrap.js'; // must precede the render-hand import (load-time window access)
import { describe, test, expect } from 'vitest';
import type { CardInstanceId, GameAction } from '@meccg/shared';
import { findPermanentEventLongEventTargetActions } from './render-hand.js';

const ECHO_INSTANCE = 'p1-7' as CardInstanceId;
const OTHER_ECHO_INSTANCE = 'p1-8' as CardInstanceId;
const STAR_UNPROTECTED = 'p1-10' as CardInstanceId;
const STAR_ALREADY_PROTECTED = 'p1-11' as CardInstanceId;

/** One play-permanent-event action per own in-play Star of High Hope copy. */
const longEventActions: GameAction[] = [STAR_UNPROTECTED, STAR_ALREADY_PROTECTED].map(targetLongEventInstanceId => ({
  type: 'play-permanent-event',
  player: 'p1',
  cardInstanceId: ECHO_INSTANCE,
  targetLongEventInstanceId,
})) as GameAction[];

describe('Echo of All Joy long-event targeting', () => {
  test('surfaces every eligible long-event target for the played card', () => {
    const actions = findPermanentEventLongEventTargetActions(ECHO_INSTANCE, longEventActions);
    expect(actions).toHaveLength(2);
    const targets = actions.map(a => (a as { targetLongEventInstanceId?: CardInstanceId }).targetLongEventInstanceId);
    expect(targets).toContain(STAR_UNPROTECTED);
    expect(targets).toContain(STAR_ALREADY_PROTECTED);
  });

  test('ignores actions for a different card instance', () => {
    const actions = [
      ...longEventActions,
      { type: 'play-permanent-event', player: 'p1', cardInstanceId: OTHER_ECHO_INSTANCE, targetLongEventInstanceId: STAR_ALREADY_PROTECTED } as GameAction,
    ];
    const found = findPermanentEventLongEventTargetActions(ECHO_INSTANCE, actions);
    expect(found).toHaveLength(2);
    expect(found.every(a => a.type === 'play-permanent-event' && a.cardInstanceId === ECHO_INSTANCE)).toBe(true);
  });

  test('returns empty for a card with no long-event target actions', () => {
    const actions = findPermanentEventLongEventTargetActions(ECHO_INSTANCE, []);
    expect(actions).toHaveLength(0);
  });

  test('returns empty when instanceId is null', () => {
    const actions = findPermanentEventLongEventTargetActions(null, longEventActions);
    expect(actions).toHaveLength(0);
  });
});
