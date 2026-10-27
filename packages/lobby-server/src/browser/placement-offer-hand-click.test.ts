/**
 * @module placement-offer-hand-click.test
 *
 * Regression test for bug report f8a092e82b8a3532 (game mvnwyjjg-77q6f9, seq
 * 773): after a successful Necklace of Girion (dm-174) corruption check the
 * engine opened an `item-placement-offer` and offered
 * `play-item-placement-offer` for Wormsbane (td-172) in hand — but nothing in
 * the hand renderer looked for that action type, so the card never
 * highlighted and the player could only pass.
 *
 * `findPlacementOfferAction` now surfaces both the item and ally placement
 * offer actions so the hand click handler can dispatch them directly — the
 * bearer is already fixed by the pending resolution.
 */

import './test-dom-bootstrap.js'; // must precede the render-hand import (load-time window access)
import { describe, test, expect } from 'vitest';
import type { CardInstanceId, GameAction } from '@meccg/shared';
import { findPlacementOfferAction } from './render-hand.js';

const WORMSBANE_INSTANCE = 'p1-20' as CardInstanceId;
const OTHER_HAND_CARD_INSTANCE = 'p1-6' as CardInstanceId;
const ALLY_INSTANCE = 'p1-30' as CardInstanceId;

const itemOfferActions: GameAction[] = [
  { type: 'pass', player: 'p1' } as GameAction,
  { type: 'play-item-placement-offer', player: 'p1', cardInstanceId: WORMSBANE_INSTANCE } as GameAction,
];

describe('placement-offer hand click (Necklace of Girion dm-174)', () => {
  test('surfaces the play-item-placement-offer action for the item in hand', () => {
    const action = findPlacementOfferAction(WORMSBANE_INSTANCE, itemOfferActions);
    expect(action?.type).toBe('play-item-placement-offer');
  });

  test('surfaces the play-ally-placement-offer action for an ally in hand', () => {
    const action = findPlacementOfferAction(ALLY_INSTANCE, [
      { type: 'pass', player: 'p1' } as GameAction,
      { type: 'play-ally-placement-offer', player: 'p1', cardInstanceId: ALLY_INSTANCE } as GameAction,
    ]);
    expect(action?.type).toBe('play-ally-placement-offer');
  });

  test('ignores actions for a different hand card instance', () => {
    expect(findPlacementOfferAction(OTHER_HAND_CARD_INSTANCE, itemOfferActions)).toBeNull();
  });

  test('returns null when instanceId is null', () => {
    expect(findPlacementOfferAction(null, itemOfferActions)).toBeNull();
  });
});
