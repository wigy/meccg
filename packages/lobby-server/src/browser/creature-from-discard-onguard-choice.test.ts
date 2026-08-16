/**
 * @module creature-from-discard-onguard-choice.test
 *
 * Regression test for bug report 887552d9ed05d4f0 (game msuhv0u9-w8joja, seq
 * 135): Exhalation of Decay (dm-55) was "unplayable on a Chill Douser that
 * would have been playable against my opponent's site path — could only play
 * on-guard." The engine correctly offered a `play-creature-from-discard`
 * action keyed by the destination's site type (shadow-hold), alongside
 * `place-on-guard` — but the hand renderer only ever looked for `play-hazard`
 * actions when deciding whether a card was a playable hazard. A card whose
 * sole play action was `play-creature-from-discard` fell through every
 * branch and landed in the `onGuardAction` fallback, which opens a menu with
 * *only* the on-guard choice, silently dropping the actual play.
 *
 * `findCreatureFromDiscardActions` and `showHazardKeyingMenu` now recognize
 * `play-creature-from-discard` the same way `play-hazard` creature plays are
 * recognized, so both choices appear.
 */

import './test-dom-bootstrap.js'; // must precede the render-hand import (load-time window access)
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { loadCardPool, Phase } from '@meccg/shared';
import type { PlayerView, CardDefinitionId, CardInstanceId, GameAction } from '@meccg/shared';
import { renderHand } from './render-hand.js';

const pool = loadCardPool();

const EXHALATION_OF_DECAY = 'dm-55' as CardDefinitionId;
const CHILL_DOUSER = 'dm-106' as CardDefinitionId;
const EXHALATION_INSTANCE = 'p1-51' as CardInstanceId;
const CHILL_DOUSER_INSTANCE = 'p1-36' as CardInstanceId;

const playCreatureFromDiscardAction: GameAction = {
  type: 'play-creature-from-discard',
  player: 'p1',
  cardInstanceId: EXHALATION_INSTANCE,
  creatureInstanceId: CHILL_DOUSER_INSTANCE,
  targetCompanyId: 'company-p2-0',
  keyedBy: { method: 'site-type', value: 'shadow-hold' },
} as GameAction;

const onGuardAction: GameAction = {
  type: 'place-on-guard',
  player: 'p1',
  cardInstanceId: EXHALATION_INSTANCE,
} as GameAction;

const passAction: GameAction = { type: 'pass', player: 'p1' } as GameAction;

class StubEl {
  tagName: string;
  children: StubEl[] = [];
  className = '';
  alt = '';
  src = '';
  title = '';
  dataset: Record<string, string> = {};
  style = { setProperty: () => { /* no-op */ }, cursor: '' };
  listeners: Record<string, ((e: unknown) => void)[]> = {};
  constructor(tagName: string) { this.tagName = tagName; }
  appendChild(child: StubEl): StubEl { this.children.push(child); return child; }
  addEventListener(type: string, cb: (e: unknown) => void): void {
    (this.listeners[type] ??= []).push(cb);
  }
  remove(): void { /* no-op */ }
  dispatch(type: string, event: unknown = { clientX: 0, clientY: 0, stopPropagation() { /* no-op */ } }): void {
    for (const cb of this.listeners[type] ?? []) cb(event);
  }
  set innerHTML(v: string) { if (v === '') this.children = []; }
  get innerHTML(): string { return ''; }
  /** Depth-first collect self + every descendant. */
  all(): StubEl[] { return [this, ...this.children.flatMap(c => c.all())]; }
}

let handArc: StubEl;
let body: StubEl;

beforeEach(() => {
  handArc = new StubEl('div');
  body = new StubEl('body');
  (globalThis as unknown as { document: unknown }).document = {
    createElement: (tag: string) => new StubEl(tag),
    getElementById: (id: string) => (id === 'hand-arc' ? handArc : null),
    querySelector: () => null,
    body,
  };
});

afterEach(() => {
  delete (globalThis as unknown as { document?: unknown }).document;
});

/** A view where the hazard player holds Exhalation of Decay and Chill Douser sits in their discard pile. */
function exhalationOfDecayView(): PlayerView {
  const emptySide = {
    hand: [] as unknown[], playDeck: [], siteDeck: [], discardPile: [], siteDiscardPile: [],
    sideboard: [], killPile: [], outOfPlayPile: [], cardsInPlay: [], characters: {}, companies: [], agents: [],
  };
  return {
    self: {
      ...emptySide,
      id: 'p1',
      hand: [{ instanceId: EXHALATION_INSTANCE, definitionId: EXHALATION_OF_DECAY }],
      discardPile: [{ instanceId: CHILL_DOUSER_INSTANCE, definitionId: CHILL_DOUSER }],
    },
    opponent: { ...emptySide, id: 'p2' },
    activePlayer: 'p2',
    phaseState: { phase: Phase.MovementHazard, step: null },
    legalActions: [
      { action: playCreatureFromDiscardAction, viable: true },
      { action: onGuardAction, viable: true },
      { action: passAction, viable: true },
    ],
  } as unknown as PlayerView;
}

describe('a hand card with a play-creature-from-discard action alongside place-on-guard', () => {
  test('clicking it offers both bringing back the discarded creature and placing on-guard', () => {
    let sent: GameAction | null = null;
    renderHand(exhalationOfDecayView(), pool, action => { sent = action; });

    const img = handArc.children[0].children[0];
    img.dispatch('click');

    const buttons = body.all().filter(el => el.tagName === 'button');
    const labels = buttons.map(b => (b as unknown as { textContent: string }).textContent);
    expect(labels).toContain('Bring back Chill Douser (keyed by site-type: shadow-hold)');
    expect(labels).toContain('Place on-guard');

    // Clicking the "bring back" button must dispatch the creature-from-discard
    // play, not silently fall back to on-guard (the reported defect).
    const bringBackButton = buttons[labels.indexOf('Bring back Chill Douser (keyed by site-type: shadow-hold)')];
    bringBackButton.dispatch('click');
    expect(sent).toEqual(playCreatureFromDiscardAction);
  });
});
