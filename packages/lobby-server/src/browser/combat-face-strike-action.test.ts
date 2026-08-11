/**
 * @module combat-face-strike-action.test
 *
 * Regression test for bug report "Bow of Alatar" (game msokycb7-bbprzs, seq
 * 1160): during the Great Hunt, a strike was pending against Alatar's
 * company and the engine offered a `face-strike-on-tap` action (tap the Bow
 * of Alatar item so Alatar faces it instead of Gollum, the ally attached to
 * him), but the player could not tap the bow — clicking it did nothing.
 *
 * combat-view.ts never wired a click handler for `face-strike-on-tap` items
 * at all, so `resolveFaceStrikeOnTapAction` (the lookup now used to gate that
 * handler) previously did not exist. This asserts it resolves the action for
 * the bow's own instance ID and not for an unrelated item/ally, matching the
 * `cardInstanceId`-keyed shape the engine emits.
 */

import { describe, test, expect } from 'vitest';
import type { FaceStrikeOnTapAction, CardInstanceId, PlayerId } from '@meccg/shared';
import { resolveFaceStrikeOnTapAction } from './combat-face-strike-action.js';

const BOW_INSTANCE_ID = 'p1-24' as CardInstanceId;
const ALATAR_INSTANCE_ID = 'p1-5' as CardInstanceId;
const GOLLUM_INSTANCE_ID = 'p1-106' as CardInstanceId;

const BOW_ACTION: FaceStrikeOnTapAction = {
  type: 'face-strike-on-tap',
  player: 'p1' as PlayerId,
  cardInstanceId: BOW_INSTANCE_ID,
  characterInstanceId: ALATAR_INSTANCE_ID,
};

describe('resolveFaceStrikeOnTapAction', () => {
  test('resolves the action for the bow item facing the strike', () => {
    const action = resolveFaceStrikeOnTapAction([BOW_ACTION], BOW_INSTANCE_ID as string);
    expect(action).toBe(BOW_ACTION);
  });

  test('does not resolve for an unrelated ally (Gollum) in the same company', () => {
    const action = resolveFaceStrikeOnTapAction([BOW_ACTION], GOLLUM_INSTANCE_ID as string);
    expect(action).toBeUndefined();
  });

  test('returns undefined when no face-strike-on-tap action is legal', () => {
    const action = resolveFaceStrikeOnTapAction([], BOW_INSTANCE_ID as string);
    expect(action).toBeUndefined();
  });
});
