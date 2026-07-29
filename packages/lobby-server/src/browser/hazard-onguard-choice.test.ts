/**
 * @module hazard-onguard-choice.test
 *
 * Regression test for bug 2549634b0c5287f7 (game ms63uxuu-34b0f9, seq 431):
 * Lure of Expedience (le-122) in the hazard player's hand could not be placed
 * on-guard from the UI. The engine offered `place-on-guard` for every one of the
 * nine cards in hand, as CoE 2.IV.vii.4 requires — but the hand renderer's
 * character-targeting hazard branch swallowed it: clicking the card went straight
 * into "click a character" targeting mode, and the on-guard placement was
 * reachable only by clicking the opponent company's site card, an unlabelled
 * shortcut that reads as "play the hazard here".
 *
 * This is the same defect already fixed for agent cards in bug e1a09e9ca89e07e6
 * (see agent-onguard-choice.test.ts). `charTargetHazardPlayChoices` now enumerates
 * both plays so the renderer opens a disambiguation menu.
 */

import './test-dom-bootstrap.js'; // must precede the render-hand import (load-time window access)
import { describe, test, expect } from 'vitest';
import type { CardInstanceId, GameAction, PlayerId } from '@meccg/shared';
import { charTargetHazardPlayChoices } from './render-hand.js';

const LURE_OF_EXPEDIENCE = 'p1-52' as CardInstanceId;
const HAZARD_PLAYER = 'p1' as PlayerId;

const onGuardAction: GameAction = {
  type: 'place-on-guard',
  player: HAZARD_PLAYER,
  cardInstanceId: LURE_OF_EXPEDIENCE,
} as GameAction;

describe('character-targeting hazard offers an on-guard placement alongside playing it', () => {
  test('when an on-guard action exists, both plays are offered', () => {
    const choices = charTargetHazardPlayChoices('Lure of Expedience', onGuardAction);

    expect(choices).toHaveLength(2);
    expect(choices.map(c => c.label)).toContain('Place on-guard');
    const onGuardChoice = choices.find(c => c.label === 'Place on-guard');
    expect(onGuardChoice?.action).toBe(onGuardAction);
  });

  test('the play choice names the card and enters character targeting rather than dispatching', () => {
    const choices = charTargetHazardPlayChoices('Lure of Expedience', onGuardAction);

    const playChoice = choices[0];
    expect(playChoice.label).toBe('Play Lure of Expedience on a character');
    // A null action means "enter two-step targeting" — the character is not known yet.
    expect(playChoice.action).toBeNull();
  });

  test('without an on-guard action, only the character-targeting play is offered', () => {
    const choices = charTargetHazardPlayChoices('Lure of Expedience', undefined);

    expect(choices).toHaveLength(1);
    expect(choices[0].action).toBeNull();
  });
});
