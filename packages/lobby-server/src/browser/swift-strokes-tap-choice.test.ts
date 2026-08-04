/**
 * @module swift-strokes-tap-choice.test
 *
 * Regression test for bug report 73deca14307b4922 (game msd5rpsh-fhc6rm,
 * seq ~1363): "Swift Strokes always triggers character tapping when used ->
 * no choice to stay untapped".
 *
 * The engine correctly offers both `tapToFight` variants for reroll-mode
 * strike-modifier cards (CoE 3.iv.3 — see le-238.test.ts), but the hand
 * renderer's `isStrikeEvent` click handler dispatched `strikeEventActions[0]`
 * unconditionally, silently dropping the stay-untapped choice: the tap
 * variant is always pushed first by the legal-action computer
 * (`combat.ts`'s reroll branch), so every click tapped the character.
 *
 * `strikeEventPlayChoices` now builds a labelled choice per action so the
 * hand renderer can offer both through a disambiguation menu instead of
 * picking one for the player.
 */

import './test-dom-bootstrap.js'; // must precede the render-hand import (load-time window access)
import { describe, test, expect } from 'vitest';
import type { CardInstanceId, GameAction, PlayerId } from '@meccg/shared';
import { strikeEventPlayChoices } from './render-hand.js';

const SWIFT_STROKES = 'p1-31' as CardInstanceId;
const PLAYER = 'p1' as PlayerId;

const rerollTapAction: GameAction = {
  type: 'play-strike-event',
  player: PLAYER,
  cardInstanceId: SWIFT_STROKES,
  tapToFight: true,
  need: 5,
  explanation: 'Reroll (tapped): need 5+ (prowess 6 vs 10, better of two rolls, +1)',
} as GameAction;

const rerollStayUntappedAction: GameAction = {
  type: 'play-strike-event',
  player: PLAYER,
  cardInstanceId: SWIFT_STROKES,
  tapToFight: false,
  need: 8,
  explanation: 'Reroll (stay untapped): need 8+ (prowess 3 vs 10, better of two rolls, +1)',
} as GameAction;

describe('strikeEventPlayChoices offers both tap and stay-untapped options for reroll cards', () => {
  test('both variants are offered, each labelled distinctly', () => {
    const choices = strikeEventPlayChoices([rerollTapAction, rerollStayUntappedAction]);

    expect(choices).toHaveLength(2);
    expect(choices.map(c => c.label)).toEqual(['Tapping', 'Untapped']);
    expect(choices.find(c => c.label === 'Tapping')?.action).toBe(rerollTapAction);
    expect(choices.find(c => c.label === 'Untapped')?.action).toBe(rerollStayUntappedAction);
  });

  test('a single non-reroll action (dodge/cancel/default) is labelled by its own action type, not force-collapsed', () => {
    const dodgeAction: GameAction = {
      type: 'play-strike-event',
      player: PLAYER,
      cardInstanceId: SWIFT_STROKES,
      need: 6,
      explanation: 'Dodge: need 6+ (prowess 5 vs 10, no tap)',
    } as GameAction;

    const choices = strikeEventPlayChoices([dodgeAction]);

    expect(choices).toHaveLength(1);
    expect(choices[0].action).toBe(dodgeAction);
  });
});
