/**
 * @module cancel-attack-target-noun.test
 *
 * Regression test for bug report 8abc7c4c4715b67a (game mv2w712f-exwq39, seq
 * 2032): playing Vanishment (tw-356, "Wizard only") the targeting prompt read
 * "Click a highlighted scout to play Vanishment". The hand renderer called the
 * click target a "scout" whenever the cancel-attack action carried a
 * `scoutInstanceId` (the character paying the cost), regardless of the card's
 * actual requirement. The noun now comes from the card's cancel-attack effect.
 */

import { describe, test, expect } from 'vitest';
import { loadCardPool } from '@meccg/shared';
import { cancelAttackTargetNoun } from './cancel-attack-targets.js';

const pool = loadCardPool();

/** Look up a card's effects by definition ID. */
function effectsOf(id: string) {
  const def = pool[id];
  return def && 'effects' in def ? def.effects : undefined;
}

describe('cancel-attack targeting prompt noun', () => {
  test('Vanishment (Wizard only) asks for a Wizard, not a scout', () => {
    expect(cancelAttackTargetNoun(effectsOf('tw-356'))).toBe('Wizard');
  });

  test('Concealment (Scout only) still asks for a scout', () => {
    expect(cancelAttackTargetNoun(effectsOf('tw-204'))).toBe('scout');
  });

  test('a cancel-attack with no skill/race requirement asks for a character', () => {
    expect(cancelAttackTargetNoun([{ type: 'cancel-attack' }])).toBe('character');
  });
});
