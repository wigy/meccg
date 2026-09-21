/**
 * @module dragon-ambush-offer-hand-click.test
 *
 * Regression test for bug report f8c9a3a84fd9b7d3 (game mubdege4-fhv839, seq
 * 196-199): after Rumor of Wealth (td-58) opened a Dragon-ambush window and
 * the opponent played a major item (High Helm, le-313), the engine correctly
 * queued a `dragon-ambush-offer` resolution offering `play-dragon-ambush-
 * creature` for each Dragon hazard creature in hand (Itangast, Daelomin) plus
 * `pass` — but nothing in the hand renderer looked for that action type, so
 * neither dragon ever highlighted and the player had no way to play them.
 *
 * `findDragonAmbushOfferAction` (extracted from `render-hand.ts`'s per-card
 * dispatch) now surfaces that action so the hand click handler can dispatch
 * it directly, the same way `findRingAfterTestAction` does for Rule 9.21's
 * ring-play-offer.
 */

import './test-dom-bootstrap.js'; // must precede the render-hand import (load-time window access)
import { describe, test, expect } from 'vitest';
import type { CardInstanceId, GameAction } from '@meccg/shared';
import { findDragonAmbushOfferAction } from './render-hand.js';

const ITANGAST_INSTANCE = 'p1-39' as CardInstanceId;
const DAELOMIN_INSTANCE = 'p1-41' as CardInstanceId;
const OTHER_HAND_CARD_INSTANCE = 'p1-19' as CardInstanceId;

const dragonAmbushOfferActions: GameAction[] = [
  { type: 'pass', player: 'p1' } as GameAction,
  { type: 'play-dragon-ambush-creature', player: 'p1', cardInstanceId: ITANGAST_INSTANCE } as GameAction,
  { type: 'play-dragon-ambush-creature', player: 'p1', cardInstanceId: DAELOMIN_INSTANCE } as GameAction,
];

describe('play-dragon-ambush-creature hand click (Rumor of Wealth dragon-ambush-offer)', () => {
  test('surfaces the play-dragon-ambush-creature action for each offered dragon', () => {
    const itangastAction = findDragonAmbushOfferAction(ITANGAST_INSTANCE, dragonAmbushOfferActions);
    expect(itangastAction).not.toBeNull();
    expect(itangastAction?.type).toBe('play-dragon-ambush-creature');

    const daelominAction = findDragonAmbushOfferAction(DAELOMIN_INSTANCE, dragonAmbushOfferActions);
    expect(daelominAction).not.toBeNull();
    expect(daelominAction?.type).toBe('play-dragon-ambush-creature');
  });

  test('ignores actions for a different hand card instance', () => {
    const action = findDragonAmbushOfferAction(OTHER_HAND_CARD_INSTANCE, dragonAmbushOfferActions);
    expect(action).toBeNull();
  });

  test('returns null when only pass is legal (no dragon offered)', () => {
    const action = findDragonAmbushOfferAction(ITANGAST_INSTANCE, [{ type: 'pass', player: 'p1' } as GameAction]);
    expect(action).toBeNull();
  });

  test('returns null when instanceId is null', () => {
    const action = findDragonAmbushOfferAction(null, dragonAmbushOfferActions);
    expect(action).toBeNull();
  });
});
