/**
 * @module power-built-by-waiting-tap.test
 *
 * Regression test for bug report f56bd0ef7cecbffb (game mqzhpuzp-hvmzds, seq
 * 113): "Tapping operation is not on UI. Is tapping implemented?" for Power
 * Built by Waiting (as-34).
 *
 * The engine correctly offered `tap-hazard-card-for-limit` (and, once tapped,
 * `pay-hazard-limit-to-untap-card`), but the cards-in-play row on the board
 * rendered the permanent as a plain image with no click handler — so the only
 * way to activate it was the debug action panel. `findCardsInPlayTapAction`
 * now resolves the viable activation for a board card so the renderer can wire
 * a click handler; this test asserts that resolution.
 */

import './test-dom-bootstrap.js'; // must precede the company-block import (load-time window access)
import { describe, test, expect } from 'vitest';
import type { CardInstanceId, GameAction } from '@meccg/shared';
import { findCardsInPlayTapAction } from './company-block.js';

const POWER_BUILT_BY_WAITING = 'p1-54' as CardInstanceId; // as-34, the card in play
const OTHER_PERMANENT = 'p1-42' as CardInstanceId;

const tapForLimit: GameAction = {
  type: 'tap-hazard-card-for-limit',
  player: 'p1',
  cardInstanceId: POWER_BUILT_BY_WAITING,
  targetCompanyId: 'company-p2-0',
} as GameAction;

const payToUntap: GameAction = {
  type: 'pay-hazard-limit-to-untap-card',
  player: 'p1',
  cardInstanceId: POWER_BUILT_BY_WAITING,
  targetCompanyId: 'company-p2-0',
} as GameAction;

describe('findCardsInPlayTapAction surfaces Power Built by Waiting on the board', () => {
  test('returns the tap-for-limit action for the untapped card', () => {
    const action = findCardsInPlayTapAction([tapForLimit], POWER_BUILT_BY_WAITING);
    expect(action).toEqual(tapForLimit);
  });

  test('returns the untap action when the card is already tapped', () => {
    const action = findCardsInPlayTapAction([payToUntap], POWER_BUILT_BY_WAITING);
    expect(action?.type).toBe('pay-hazard-limit-to-untap-card');
  });

  test('returns null when no tap action targets that card', () => {
    expect(findCardsInPlayTapAction([tapForLimit], OTHER_PERMANENT)).toBeNull();
    expect(findCardsInPlayTapAction([], POWER_BUILT_BY_WAITING)).toBeNull();
  });
});
