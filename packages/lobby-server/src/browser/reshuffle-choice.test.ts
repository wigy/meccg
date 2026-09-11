/**
 * @module reshuffle-choice.test
 *
 * Regression test for bug e610cd522546fe4b (game mtuihznt-inn090, seq
 * 1901-1902): Sudden Call (le-235) is playable both as a short event
 * (`play-short-event`) and as a "return to play deck" reshuffle
 * (`reshuffle-card-from-hand`, CRF 22: "you may reshuffle this card into
 * your play deck at any time that it is in your hand"). Clicking the
 * highlighted card always dispatched the short-event play, silently
 * dropping the reshuffle option — the same defect class already fixed for
 * discard (short-event-onguard-choice.test.ts) and on-guard placement.
 *
 * `shortEventPlayChoices` now appends "Return to play deck" whenever a
 * reshuffle action is also legal, and `discardOnlyChoices` offers it even
 * when no short-event play action exists at all.
 */

import './test-dom-bootstrap.js'; // must precede the render-hand import (load-time window access)
import { describe, test, expect } from 'vitest';
import type { CardInstanceId, GameAction, PlayerId } from '@meccg/shared';
import { discardOnlyChoices, shortEventPlayChoices, type ShortEventPlayChoice } from './render-hand.js';

const SUDDEN_CALL = 'p1-97' as CardInstanceId;
const RESOURCE_PLAYER = 'p1' as PlayerId;

const playShortEventAction: GameAction = {
  type: 'play-short-event',
  player: RESOURCE_PLAYER,
  cardInstanceId: SUDDEN_CALL,
} as GameAction;

const playChoice: ShortEventPlayChoice = { label: 'Play Sudden Call', action: playShortEventAction };

const reshuffleAction: GameAction = {
  type: 'reshuffle-card-from-hand',
  player: RESOURCE_PLAYER,
  cardInstanceId: SUDDEN_CALL,
} as GameAction;

describe('a hand card offers "return to play deck" alongside playing it', () => {
  test('when a reshuffle action exists, both the play and reshuffle choices are offered', () => {
    const choices = shortEventPlayChoices([playChoice], undefined, undefined, reshuffleAction);

    expect(choices).toHaveLength(2);
    expect(choices.map(c => c.label)).toEqual(['Play Sudden Call', 'Return to play deck']);
    const reshuffleChoice = choices.find(c => c.label === 'Return to play deck');
    expect(reshuffleChoice?.action).toBe(reshuffleAction);
  });

  test('without a reshuffle action, only the short-event play choice is offered', () => {
    const choices = shortEventPlayChoices([playChoice], undefined, undefined, undefined);

    expect(choices).toHaveLength(1);
    expect(choices[0]).toBe(playChoice);
  });

  test('a reshuffle-only card (no other viable action) still offers a confirm menu', () => {
    const choices = discardOnlyChoices(undefined, undefined, reshuffleAction);

    expect(choices).toHaveLength(1);
    expect(choices[0]).toEqual({ label: 'Return to play deck', action: reshuffleAction });
  });
});
