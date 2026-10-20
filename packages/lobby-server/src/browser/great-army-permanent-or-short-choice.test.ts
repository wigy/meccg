/**
 * @module great-army-permanent-or-short-choice.test
 *
 * Regression test for bug report b0f0abbaaaffed68 (game mvh1ws4k-ljkhjz,
 * seq 680): Great Army of the North (ba-38) is a "Permanent-event/Short-event"
 * card, and the engine offered it both as `play-permanent-event` and as
 * `play-short-event` (reshuffle Orc/Troll factions from the discard). The hand
 * renderer's `isShortEvent` branch dispatched the lone short-event action on
 * click, so the permanent-event mode was unreachable.
 *
 * The short-event menu now lists the permanent-event mode too, and
 * `buildShortEventTargetChoices` names both modes.
 */

import './test-dom-bootstrap.js'; // must precede the render-hand import (load-time window access)
import { describe, test, expect } from 'vitest';
import type { CardDefinition, CardInstanceId, GameAction, PlayerView } from '@meccg/shared';
import { buildShortEventTargetChoices } from './render-hand.js';

const GREAT_ARMY = 'p1-36' as CardInstanceId;

const cardPool: Readonly<Record<string, CardDefinition>> = {};
const lookup = (): undefined => undefined;

const view = {
  self: { id: 'p1' },
  opponent: { name: 'Opponent' },
  chain: undefined,
} as unknown as PlayerView;

const playPermanent: GameAction = {
  type: 'play-permanent-event',
  player: 'p1',
  cardInstanceId: GREAT_ARMY,
} as GameAction;

const playShort: GameAction = {
  type: 'play-short-event',
  player: 'p1',
  cardInstanceId: GREAT_ARMY,
} as GameAction;

describe('Great Army of the North offers both permanent-event and short-event modes', () => {
  test('both modes are listed with distinct labels', () => {
    const choices = buildShortEventTargetChoices([playPermanent, playShort], lookup, cardPool, view);

    expect(choices.map(c => c.label)).toEqual(['Play as permanent-event', 'Play as short-event']);
    expect(choices[0].action).toBe(playPermanent);
    expect(choices[1].action).toBe(playShort);
  });

  test('a plain short-event without a permanent mode keeps the "Play" label', () => {
    const choices = buildShortEventTargetChoices([playShort], lookup, cardPool, view);

    expect(choices.map(c => c.label)).toEqual(['Play']);
  });
});
