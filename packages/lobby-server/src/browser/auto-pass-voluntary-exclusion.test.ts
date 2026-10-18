/**
 * @module auto-pass-voluntary-exclusion.test
 *
 * Regression test for bug report ed2f27e91cfb36a1 ("lore of the ages", game
 * mvdf3lc3-zu4f6d, stateSeq 1278): with the auto-pass toggle on, the client
 * tapped the defender's Lore of the Ages on their behalf. Against Ambusher
 * (attacker chooses defenders) the defender passed, letting the attacker
 * assign strikes; while waiting, the defender's only viable action was the
 * optional `tap-ally-combat-boost` from Lore of the Ages, so auto-pass fired
 * it as "the one thing to do".
 *
 * `getAutoPassAction` now never fires an optional card play / ability use.
 */

import './test-dom-bootstrap.js'; // must precede browser-module imports (load-time window access)
import { describe, test, expect } from 'vitest';
import type { CardInstanceId, EvaluatedAction, PlayerId } from '@meccg/shared';
import { getAutoPassAction } from './game-connection.js';

const PLAYER = 'p1' as PlayerId;

describe('auto-pass never fires an optional card use', () => {
  test('does not tap Lore of the Ages while the attacker assigns strikes', () => {
    const legalActions: EvaluatedAction[] = [
      {
        action: {
          type: 'tap-ally-combat-boost',
          player: PLAYER,
          cardInstanceId: 'p1-49' as CardInstanceId,
          characterInstanceId: 'p1-243' as CardInstanceId,
        },
        viable: true,
      },
      { action: { type: 'concede', player: PLAYER }, viable: true },
    ];

    expect(getAutoPassAction(legalActions)).toBeNull();
  });

  test('still fires a lone pass', () => {
    const passAction = { type: 'pass', player: PLAYER } as const;
    const legalActions: EvaluatedAction[] = [
      { action: passAction, viable: true },
      { action: { type: 'concede', player: PLAYER }, viable: true },
    ];

    expect(getAutoPassAction(legalActions)).toEqual(passAction);
  });
});
