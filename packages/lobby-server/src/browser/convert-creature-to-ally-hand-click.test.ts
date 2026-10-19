/**
 * @module convert-creature-to-ally-hand-click.test
 *
 * Regression test for bug report 6c1c53a1fdfde272 (game mveu64mu-vtco5g, seq
 * 1583): "Tom" (Tûma) (tw-103, Troll, one strike) attacked the defender's
 * company and the engine correctly offered `convert-creature-to-ally` for
 * Ready to His Will (le-220) — once per untapped character — but nothing in
 * the hand renderer looked for that action type, so the card rendered as
 * unplayable and the player could only assign the strike.
 *
 * `findConvertCreatureToAllyActions` (extracted from `render-hand.ts`'s
 * per-card dispatch) now surfaces those actions so the hand click handler can
 * play the card.
 */

import './test-dom-bootstrap.js'; // must precede the render-hand import (load-time window access)
import { describe, test, expect } from 'vitest';
import type { CardInstanceId, GameAction } from '@meccg/shared';
import { findConvertCreatureToAllyActions } from './render-hand.js';

const READY_TO_HIS_WILL_INSTANCE = 'p1-28' as CardInstanceId;
const OTHER_HAND_INSTANCE = 'p1-22' as CardInstanceId;

const legalActions: GameAction[] = [
  { type: 'convert-creature-to-ally', player: 'p1', cardInstanceId: READY_TO_HIS_WILL_INSTANCE, controllingCharacterId: 'p1-218' } as GameAction,
  { type: 'convert-creature-to-ally', player: 'p1', cardInstanceId: READY_TO_HIS_WILL_INSTANCE, controllingCharacterId: 'p1-211' } as GameAction,
  { type: 'assign-strike', player: 'p1', characterId: 'p1-218', tapped: false } as GameAction,
  { type: 'pass', player: 'p1' } as GameAction,
];

describe('convert-creature-to-ally hand click (Ready to His Will vs "Tom")', () => {
  test('surfaces one action per eligible controlling character', () => {
    expect(findConvertCreatureToAllyActions(READY_TO_HIS_WILL_INSTANCE, legalActions))
      .toEqual([legalActions[0], legalActions[1]]);
  });

  test('ignores actions for a different hand card instance', () => {
    expect(findConvertCreatureToAllyActions(OTHER_HAND_INSTANCE, legalActions)).toEqual([]);
  });

  test('returns nothing when instanceId is null', () => {
    expect(findConvertCreatureToAllyActions(null, legalActions)).toEqual([]);
  });
});
