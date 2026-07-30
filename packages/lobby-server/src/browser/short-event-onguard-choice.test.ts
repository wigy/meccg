/**
 * @module short-event-onguard-choice.test
 *
 * Regression test for bug 91c9a0708a8f52e6 (game ms78ax9w-3okul6, seq 517):
 * the hazard player reported being unable to place arbitrary hand cards
 * on-guard — only cards playable through the normal `play-hazard` action
 * ("marked in yellow") were offered on-guard placement.
 *
 * Some hazard-deck short-events are emitted with the `play-short-event`
 * action type rather than `play-hazard` (e.g. Twilight tw-106, an
 * environment-canceler; Searching Eye, a skill-canceler — see
 * movement-hazard.ts's "Hazard short-event" loop). The engine correctly
 * offers `place-on-guard` for every hand card per CoE 2.IV.vii.4, but the
 * hand renderer's `isShortEvent` branch never consulted the on-guard action:
 * clicking such a card dispatched straight into playing the short event (or a
 * two-step targeting flow), silently dropping the on-guard choice. This is
 * the same defect already fixed for agent cards (agent-onguard-choice.test.ts)
 * and character-targeting hazard cards (hazard-onguard-choice.test.ts).
 *
 * `shortEventPlayChoices` now appends "Place on-guard" to a short event's own
 * play choices whenever an on-guard action is also legal.
 */

import './test-dom-bootstrap.js'; // must precede the render-hand import (load-time window access)
import { describe, test, expect } from 'vitest';
import type { CardInstanceId, GameAction, PlayerId } from '@meccg/shared';
import { shortEventPlayChoices, type ShortEventPlayChoice } from './render-hand.js';

const TWILIGHT = 'p1-54' as CardInstanceId;
const HAZARD_PLAYER = 'p1' as PlayerId;

const cancelEnvironmentAction: GameAction = {
  type: 'play-short-event',
  player: HAZARD_PLAYER,
  cardInstanceId: TWILIGHT,
  targetInstanceId: 'p2-10' as CardInstanceId,
} as GameAction;

const playChoice: ShortEventPlayChoice = { label: 'Cancel Gwaihir', action: cancelEnvironmentAction };

const onGuardAction: GameAction = {
  type: 'place-on-guard',
  player: HAZARD_PLAYER,
  cardInstanceId: TWILIGHT,
} as GameAction;

describe('short-event hazard card offers an on-guard placement alongside playing it', () => {
  test('when an on-guard action exists, both the play and on-guard choices are offered', () => {
    const choices = shortEventPlayChoices([playChoice], undefined, onGuardAction);

    expect(choices).toHaveLength(2);
    expect(choices.map(c => c.label)).toEqual(['Cancel Gwaihir', 'Place on-guard']);
    const onGuardChoice = choices.find(c => c.label === 'Place on-guard');
    expect(onGuardChoice?.action).toBe(onGuardAction);
  });

  test('without an on-guard action, only the short-event play choice is offered', () => {
    const choices = shortEventPlayChoices([playChoice], undefined, undefined);

    expect(choices).toHaveLength(1);
    expect(choices[0]).toBe(playChoice);
  });

  test('discard and on-guard choices can both be appended alongside the play choice', () => {
    const discardAction: GameAction = {
      type: 'discard-card',
      player: HAZARD_PLAYER,
      cardInstanceId: TWILIGHT,
    } as GameAction;

    const choices = shortEventPlayChoices([playChoice], discardAction, onGuardAction);

    expect(choices.map(c => c.label)).toEqual(['Cancel Gwaihir', 'Discard', 'Place on-guard']);
  });
});
