/**
 * @module combat-cancel-by-tap-ally-action.test
 *
 * Regression test for bug report "Slayer" (game mttrgt9q-d2jegf, seq 423):
 * during a Slayer's cancel-by-tap window, the engine correctly offered a
 * `cancel-by-tap` action targeting an ally (Gollum, wh-33) attached to a
 * company character, but the player could not tap the ally to cancel the
 * attack — clicking it did nothing.
 *
 * combat-view.ts wired `cancel-by-tap` click handlers for company characters
 * but never checked `cancelByTapIds`/`cancelByTapActions` for allies, so
 * `resolveCancelByTapAllyAction` (the lookup now used to gate that handler)
 * previously did not exist. This asserts it resolves the action for the
 * ally's own instance ID and not for an unrelated character in the company.
 */

import { describe, test, expect } from 'vitest';
import type { CancelByTapAction, CardInstanceId, PlayerId } from '@meccg/shared';
import { resolveCancelByTapAllyAction } from './combat-cancel-by-tap-ally-action.js';

const ALLY_INSTANCE_ID = 'p1-17' as CardInstanceId;
const GANDALF_INSTANCE_ID = 'p1-1' as CardInstanceId;

const ALLY_ACTION: CancelByTapAction = {
  type: 'cancel-by-tap',
  player: 'p1' as PlayerId,
  characterId: ALLY_INSTANCE_ID,
};

describe('resolveCancelByTapAllyAction', () => {
  test('resolves the action for the ally tapping to cancel an attack', () => {
    const action = resolveCancelByTapAllyAction([ALLY_ACTION], ALLY_INSTANCE_ID as string);
    expect(action).toBe(ALLY_ACTION);
  });

  test('does not resolve for an unrelated character (Gandalf) in the same company', () => {
    const action = resolveCancelByTapAllyAction([ALLY_ACTION], GANDALF_INSTANCE_ID as string);
    expect(action).toBeUndefined();
  });

  test('returns undefined when no cancel-by-tap action is legal', () => {
    const action = resolveCancelByTapAllyAction([], ALLY_INSTANCE_ID as string);
    expect(action).toBeUndefined();
  });
});
