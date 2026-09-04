/**
 * @module auto-pass-concede-exclusion.test
 *
 * Regression test for bug report af5f1dee08b94e31 ("still automatically
 * conceding" a couple of actions into the first movement/hazard phase, game
 * mtmiixad-jimgii, stateSeq 51): with the auto-pass toggle on, the client
 * fired a `concede` action on the player's behalf after a short delay.
 *
 * `legalActions` always carries an always-viable `concede` entry
 * (`withConcedeAction` in `@meccg/shared`), so on a player's idle turns —
 * already passed chain priority, waiting on the opponent to resolve a
 * hazard — `concede` was often the *only* entry with `viable: true`. The
 * auto-pass logic in `game-connection.ts` counted that lone entry as "the
 * one thing to auto-fire" and silently conceded the game. This mirrors the
 * keyboard-shortcuts bug fixed for bug report 162fe192d90019b8 (d9cd7a75b),
 * which excluded `concede` from its own single-button auto-fire list but
 * left the auto-pass timer's separate viable-count check untouched.
 *
 * `getAutoPassAction` now excludes `concede` from the "nothing else to do"
 * tally, so it never treats a lone `concede` as the sole real action.
 */

import './test-dom-bootstrap.js'; // must precede browser-module imports (load-time window access)
import { describe, test, expect } from 'vitest';
import type { EvaluatedAction, PlayerId } from '@meccg/shared';
import { getAutoPassAction } from './game-connection.js';

const PLAYER = 'p1' as PlayerId;

describe('auto-pass excludes the always-present concede action', () => {
  test('does not fire when concede is the only viable action', () => {
    const legalActions: EvaluatedAction[] = [
      { action: { type: 'concede', player: PLAYER }, viable: true },
    ];

    expect(getAutoPassAction(legalActions)).toBeNull();
  });

  test('still fires for a genuine sole action alongside the always-present concede entry', () => {
    const passAction = { type: 'pass', player: PLAYER } as const;
    const legalActions: EvaluatedAction[] = [
      { action: passAction, viable: true },
      { action: { type: 'concede', player: PLAYER }, viable: true },
    ];

    expect(getAutoPassAction(legalActions)).toEqual(passAction);
  });

  test('still skips roll actions even when concede is excluded', () => {
    const legalActions: EvaluatedAction[] = [
      { action: { type: 'roll-initiative', player: PLAYER } as const, viable: true },
      { action: { type: 'concede', player: PLAYER }, viable: true },
    ];

    expect(getAutoPassAction(legalActions)).toBeNull();
  });
});
