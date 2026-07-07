/**
 * @module adunaphel-tap.test
 *
 * Regression test for bug report d312c322d5f3da80 (game mr9jvlnw-2ldyce, seq
 * 720): "Can't tap from UI" for Adûnaphel (tw-2).
 *
 * Adûnaphel had been played as a permanent-event and sat, untapped, in the
 * hazard player's `cardsInPlay`. The engine correctly offered
 * `tap-alt-permanent-event` (one action per eligible target character, since
 * tapping Adûnaphel taps any one character), but the cards-in-play row rendered
 * the card as a plain image with no click handler — so the only way to tap it
 * was the debug action panel. `findTapAltPermanentEventActions` /
 * `findTapAltPermanentEventTarget` now resolve the viable activations for a
 * board card so the renderer can wire the two-step tap flow; this test asserts
 * that resolution. Ûvatha (tw-107), whose tap has no character target, is
 * covered as the immediate-fire variant.
 */

import './test-dom-bootstrap.js'; // must precede the company-block import (load-time window access)
import { describe, test, expect } from 'vitest';
import type { CardInstanceId, GameAction } from '@meccg/shared';
import { findTapAltPermanentEventActions, findTapAltPermanentEventTarget } from './company-block.js';

const ADUNAPHEL = 'p1-33' as CardInstanceId; // tw-2, in play as a permanent-event
const UVATHA = 'p1-61' as CardInstanceId; // tw-107, in play as a permanent-event
const OPP_CHAR = 'p2-102' as CardInstanceId; // the character tapped in the reported game
const OWN_CHAR = 'p1-1' as CardInstanceId;

// tw-2 emits one tap action per eligible target character (either player's).
const tapAdunaphelOpp: GameAction = {
  type: 'tap-alt-permanent-event',
  player: 'p1',
  cardInstanceId: ADUNAPHEL,
  targetCharacterId: OPP_CHAR,
} as GameAction;

const tapAdunaphelOwn: GameAction = {
  type: 'tap-alt-permanent-event',
  player: 'p1',
  cardInstanceId: ADUNAPHEL,
  targetCharacterId: OWN_CHAR,
} as GameAction;

// tw-107 emits a single targetless action (its fetch is a follow-up flow).
const tapUvatha: GameAction = {
  type: 'tap-alt-permanent-event',
  player: 'p1',
  cardInstanceId: UVATHA,
} as GameAction;

const actions: GameAction[] = [tapAdunaphelOpp, tapAdunaphelOwn, tapUvatha];

describe('tap-alt-permanent-event surfaces Adûnaphel/Ûvatha on the board', () => {
  test('resolves every tap action for the clicked in-play permanent-event', () => {
    expect(findTapAltPermanentEventActions(actions, ADUNAPHEL)).toEqual([
      tapAdunaphelOpp,
      tapAdunaphelOwn,
    ]);
  });

  test('a targetless tap (Ûvatha tw-107) fires immediately — one action, no target', () => {
    const uvathaActions = findTapAltPermanentEventActions(actions, UVATHA);
    expect(uvathaActions).toEqual([tapUvatha]);
    expect(uvathaActions.every(a => a.targetCharacterId === undefined)).toBe(true);
  });

  test('second click resolves the tap action for the chosen target character', () => {
    expect(findTapAltPermanentEventTarget(actions, ADUNAPHEL, OPP_CHAR)).toEqual(tapAdunaphelOpp);
    expect(findTapAltPermanentEventTarget(actions, ADUNAPHEL, OWN_CHAR)).toEqual(tapAdunaphelOwn);
  });

  test('no tap action for an unrelated card or an ineligible target', () => {
    expect(findTapAltPermanentEventActions(actions, 'p1-8' as CardInstanceId)).toEqual([]);
    expect(findTapAltPermanentEventTarget(actions, ADUNAPHEL, 'p2-999' as CardInstanceId)).toBeNull();
  });
});
