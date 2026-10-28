/**
 * @module nazgul-permanent-event-attack-hand-choice.test
 *
 * Regression test for bug report 53a22f7df50a68aa (game mvplml1q-9ahbyw, seq
 * 62): Out of the Black Sky (dm-77) "doesn't work". With Doors of Night and
 * Witch-king of Angmar (as a permanent-event) in play and the opponent's
 * company moving through Angmar to Carn Dûm, the engine offered
 * `attack-nazgul-permanent-event` actions for the card — but the hand
 * renderer never recognized that action type, so the card fell through to
 * the on-guard-only fallback and the attack could not be triggered.
 *
 * The hand renderer now treats `attack-nazgul-permanent-event` like a keyed
 * hazard-creature play and lists each attack option in the click menu.
 */

import './test-dom-bootstrap.js'; // must precede the render-hand import (load-time window access)
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { loadCardPool, Phase } from '@meccg/shared';
import type { PlayerView, CardDefinitionId, CardInstanceId, GameAction } from '@meccg/shared';
import { renderHand } from './render-hand.js';

const pool = loadCardPool();

const OUT_OF_THE_BLACK_SKY = 'dm-77' as CardDefinitionId;
const WITCH_KING = 'tw-113' as CardDefinitionId;
const OOTBS_INSTANCE = 'p1-79' as CardInstanceId;
const WITCH_KING_INSTANCE = 'p1-51' as CardInstanceId;

/** Build the attack action for a given keying match. */
function attackAction(method: string, value: string): GameAction {
  return {
    type: 'attack-nazgul-permanent-event',
    player: 'p1',
    cardInstanceId: OOTBS_INSTANCE,
    targetNazgulInstanceId: WITCH_KING_INSTANCE,
    targetNazgulOwnerId: 'p1',
    targetCompanyId: 'company-p2-0',
    keyedBy: { method, value },
  } as GameAction;
}

const attackByAngmar = attackAction('region-name', 'Angmar');
const attackByDarkHold = attackAction('site-type', 'dark-hold');

const onGuardAction: GameAction = {
  type: 'place-on-guard',
  player: 'p1',
  cardInstanceId: OOTBS_INSTANCE,
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

/** A view where the hazard player holds Out of the Black Sky and Witch-king of Angmar is in play as a permanent-event. */
function outOfTheBlackSkyView(): PlayerView {
  const emptySide = {
    hand: [] as unknown[], playDeck: [], siteDeck: [], discardPile: [], siteDiscardPile: [],
    sideboard: [], killPile: [], outOfPlayPile: [], cardsInPlay: [], characters: {}, companies: [], agents: [],
  };
  return {
    self: {
      ...emptySide,
      id: 'p1',
      hand: [{ instanceId: OOTBS_INSTANCE, definitionId: OUT_OF_THE_BLACK_SKY }],
      cardsInPlay: [{ instanceId: WITCH_KING_INSTANCE, definitionId: WITCH_KING, status: 'untapped' }],
    },
    opponent: { ...emptySide, id: 'p2' },
    activePlayer: 'p2',
    phaseState: { phase: Phase.MovementHazard, step: null },
    legalActions: [
      { action: attackByDarkHold, viable: true },
      { action: attackByAngmar, viable: true },
      { action: onGuardAction, viable: true },
      { action: passAction, viable: true },
    ],
  } as unknown as PlayerView;
}

describe('Out of the Black Sky in hand with attack-nazgul-permanent-event actions', () => {
  test('clicking it offers the Nazgûl attacks alongside placing on-guard', () => {
    let sent: GameAction | null = null;
    renderHand(outOfTheBlackSkyView(), pool, action => { sent = action; });

    const img = handArc.children[0].children[0];
    img.dispatch('click');

    const buttons = body.all().filter(el => el.tagName === 'button');
    const labels = buttons.map(b => (b as unknown as { textContent: string }).textContent);
    expect(labels).toContain('Attack with Witch-king of Angmar (keyed by region-name: Angmar)');
    expect(labels).toContain('Attack with Witch-king of Angmar (keyed by site-type: dark-hold)');
    expect(labels).toContain('Place on-guard');

    const attackButton = buttons[labels.indexOf('Attack with Witch-king of Angmar (keyed by region-name: Angmar)')];
    attackButton.dispatch('click');
    expect(sent).toEqual(attackByAngmar);
  });
});
