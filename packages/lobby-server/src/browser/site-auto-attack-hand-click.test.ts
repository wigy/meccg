/**
 * @module site-auto-attack-hand-click.test
 *
 * Regression test for bug report 3072916b6caed150 (game mum57vcq-up9ldx, seq
 * 1277): the opponent's company entered The Gem-deeps (dm-30) and faced its
 * first automatic-attack; for the second ("opponent may play as an
 * automatic-attack one non-unique hazard creature from his hand normally
 * keyed to a Shadow-hold") the engine correctly offered
 * `play-site-auto-attack` for Uruk-lieutenant (le-96) plus `pass` — but
 * nothing in the hand renderer looked for that action type, so the creature
 * rendered as unplayable and the player could only pass.
 *
 * `findSiteAutoAttackAction` (extracted from `render-hand.ts`'s per-card
 * dispatch) now surfaces that action so the hand click handler can dispatch
 * it directly.
 */

import './test-dom-bootstrap.js'; // must precede the render-hand import (load-time window access)
import { describe, test, expect } from 'vitest';
import type { CardInstanceId, GameAction } from '@meccg/shared';
import { findSiteAutoAttackAction } from './render-hand.js';

const URUK_LIEUTENANT_INSTANCE = 'p1-68' as CardInstanceId;
const ARAGORN_INSTANCE = 'p1-119' as CardInstanceId;

const siteAutoAttackActions: GameAction[] = [
  { type: 'play-site-auto-attack', player: 'p1', cardInstanceId: URUK_LIEUTENANT_INSTANCE } as GameAction,
  { type: 'pass', player: 'p1' } as GameAction,
];

describe('play-site-auto-attack hand click (The Gem-deeps 2nd automatic-attack)', () => {
  test('surfaces the play-site-auto-attack action for the eligible creature', () => {
    const action = findSiteAutoAttackAction(URUK_LIEUTENANT_INSTANCE, siteAutoAttackActions);
    expect(action).toEqual(siteAutoAttackActions[0]);
  });

  test('ignores actions for a different hand card instance', () => {
    expect(findSiteAutoAttackAction(ARAGORN_INSTANCE, siteAutoAttackActions)).toBeNull();
  });

  test('returns null when only pass is legal', () => {
    expect(findSiteAutoAttackAction(URUK_LIEUTENANT_INSTANCE, [siteAutoAttackActions[1]])).toBeNull();
  });

  test('returns null when instanceId is null', () => {
    expect(findSiteAutoAttackAction(null, siteAutoAttackActions)).toBeNull();
  });
});
