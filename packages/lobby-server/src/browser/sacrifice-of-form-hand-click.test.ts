/**
 * @module sacrifice-of-form-hand-click.test
 *
 * Regression test for bug report f4e06aa2336b6351 (game mufe2xu9-l05yz6, seq
 * 1012): during the choose-strike-order window of a creature attack on
 * Gandalf's company, the engine correctly offered `play-sacrifice-of-form`
 * for Sacrifice of Form (tw-321) in hand — but nothing in the hand renderer
 * looked for that action type, so the card never highlighted and the player
 * had no way to play it.
 *
 * `findSacrificeOfFormAction` (mirroring `findRingAfterTestAction` and
 * `findDragonAmbushOfferAction`) now surfaces that action so the hand click
 * handler can dispatch it directly — the Wizard being sacrificed is already
 * fixed by the live attack, so no target step is needed.
 */

import './test-dom-bootstrap.js'; // must precede the render-hand import (load-time window access)
import { describe, test, expect } from 'vitest';
import type { CardInstanceId, GameAction } from '@meccg/shared';
import { findSacrificeOfFormAction } from './render-hand.js';

const SACRIFICE_OF_FORM_INSTANCE = 'p1-99' as CardInstanceId;
const OTHER_HAND_CARD_INSTANCE = 'p1-6' as CardInstanceId;
const GANDALF_INSTANCE = 'p1-1' as CardInstanceId;

const chooseStrikeOrderActions: GameAction[] = [
  { type: 'choose-strike-order', player: 'p1', strikeIndex: 0, characterId: 'p1-1', tapped: false } as GameAction,
  { type: 'choose-strike-order', player: 'p1', strikeIndex: 1, characterId: 'p1-16', tapped: false } as GameAction,
  {
    type: 'play-sacrifice-of-form',
    player: 'p1',
    cardInstanceId: SACRIFICE_OF_FORM_INSTANCE,
    characterInstanceId: GANDALF_INSTANCE,
  } as GameAction,
];

describe('play-sacrifice-of-form hand click (Sacrifice of Form tw-321)', () => {
  test('surfaces the play-sacrifice-of-form action for the card in hand', () => {
    const action = findSacrificeOfFormAction(SACRIFICE_OF_FORM_INSTANCE, chooseStrikeOrderActions);
    expect(action).not.toBeNull();
    expect(action?.type).toBe('play-sacrifice-of-form');
  });

  test('ignores actions for a different hand card instance', () => {
    const action = findSacrificeOfFormAction(OTHER_HAND_CARD_INSTANCE, chooseStrikeOrderActions);
    expect(action).toBeNull();
  });

  test('returns null when no sacrifice-of-form action is legal', () => {
    const action = findSacrificeOfFormAction(SACRIFICE_OF_FORM_INSTANCE, [
      { type: 'choose-strike-order', player: 'p1', strikeIndex: 0, characterId: 'p1-1', tapped: false } as GameAction,
    ]);
    expect(action).toBeNull();
  });

  test('returns null when instanceId is null', () => {
    const action = findSacrificeOfFormAction(null, chooseStrikeOrderActions);
    expect(action).toBeNull();
  });
});
