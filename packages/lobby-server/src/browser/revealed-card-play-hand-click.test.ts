/**
 * @module revealed-card-play-hand-click.test
 *
 * Regression test for bug report 040432a55d844cb4 (game mt9bzwlu-s8pf26, seq
 * 771): the resource player attempted an opponent-influence attempt against
 * the opponent's copy of the unique faction Men of Anórien (tw-277), revealing
 * their own identical copy from hand. The attempt succeeded, and the engine
 * correctly enqueued the CoE rule 10.13 `influence-reveal-play-offer`
 * resolution, offering a `play-revealed-card` action for the revealed hand
 * card (plus `pass` to decline) — but nothing in the hand renderer looked for
 * that action type, so the card never highlighted and clicking it did
 * nothing (reported as "j'ai eu un bug d'ergo en cliquant dessus" — a UI bug
 * when clicking it), leaving the player unable to accept the offer before it
 * was implicitly declined by their next action.
 *
 * `findRevealedCardPlayActions` (added to `render-hand.ts`) now surfaces the
 * offer so the hand click handler can dispatch it directly, the same way
 * `findRingAfterTestAction` does for the analogous Rule 9.21 ring-play-offer.
 */

import './test-dom-bootstrap.js'; // must precede the render-hand import (load-time window access)
import { describe, test, expect } from 'vitest';
import type { CardInstanceId, GameAction } from '@meccg/shared';
import { findRevealedCardPlayActions } from './render-hand.js';

const MEN_OF_ANORIEN_INSTANCE = 'p1-182' as CardInstanceId;
const OTHER_HAND_CARD_INSTANCE = 'p1-183' as CardInstanceId;

const factionRevealOfferActions: GameAction[] = [
  { type: 'pass', player: 'p1' } as GameAction,
  { type: 'play-revealed-card', player: 'p1', cardInstanceId: MEN_OF_ANORIEN_INSTANCE } as GameAction,
];

describe('play-revealed-card hand click (Rule 10.13 influence-reveal-play-offer)', () => {
  test('surfaces the single play-revealed-card action for a faction/item/ally reveal', () => {
    const actions = findRevealedCardPlayActions(MEN_OF_ANORIEN_INSTANCE, factionRevealOfferActions);
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe('play-revealed-card');
  });

  test('surfaces every controlledBy variant for a character reveal', () => {
    const CHARACTER_INSTANCE = 'p1-190' as CardInstanceId;
    const characterRevealOfferActions: GameAction[] = [
      { type: 'pass', player: 'p1' } as GameAction,
      { type: 'play-revealed-card', player: 'p1', cardInstanceId: CHARACTER_INSTANCE, controlledBy: 'general' } as GameAction,
      { type: 'play-revealed-card', player: 'p1', cardInstanceId: CHARACTER_INSTANCE, controlledBy: 'p1-189' as CardInstanceId } as GameAction,
    ];
    const actions = findRevealedCardPlayActions(CHARACTER_INSTANCE, characterRevealOfferActions);
    expect(actions).toHaveLength(2);
  });

  test('ignores actions for a different hand card instance', () => {
    const actions = findRevealedCardPlayActions(OTHER_HAND_CARD_INSTANCE, factionRevealOfferActions);
    expect(actions).toEqual([]);
  });

  test('returns empty when only pass is legal (no reveal-play offer)', () => {
    const actions = findRevealedCardPlayActions(MEN_OF_ANORIEN_INSTANCE, [{ type: 'pass', player: 'p1' } as GameAction]);
    expect(actions).toEqual([]);
  });

  test('returns empty when instanceId is null', () => {
    const actions = findRevealedCardPlayActions(null, factionRevealOfferActions);
    expect(actions).toEqual([]);
  });
});
