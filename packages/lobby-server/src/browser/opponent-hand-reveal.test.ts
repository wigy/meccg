/**
 * @module opponent-hand-reveal.test
 *
 * Regression test for bug report 07e8f9c33918d4d4 (game msxg9t0x-n4rcvj, seq
 * 787-788): activating Palantír of Amon Sûl's "amon-sul-peek-hand" granted
 * action correctly reveals the opponent's hand server-side
 * (`state.handRevealedInstances` grows, and `buildOpponentView` resolves the
 * revealed instances' real `definitionId`s into the projected
 * `PlayerView.opponent.hand`), but the client's `getOpponentCards` ignored
 * those resolved identities and always rendered every opponent hand slot as
 * an unconditional card back, so the activating player had no way to see
 * what they had just revealed.
 *
 * The fix passes `view.opponent.hand`'s definition IDs straight through:
 * unrevealed cards still carry `UNKNOWN_CARD` from the server projection and
 * render as backs, but revealed cards now render their real face.
 *
 * Uses the hand-rolled DOM stub pattern of `hand-arc-scale-target.test.ts`
 * (the package runs vitest in the default node environment, with no jsdom).
 */

import './test-dom-bootstrap.js'; // must precede the render-hand import (load-time window access)
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { loadCardPool, Phase, UNKNOWN_CARD } from '@meccg/shared';
import type { PlayerView, CardInstanceId } from '@meccg/shared';
import { renderOpponentHand } from './render-hand.js';

const pool = loadCardPool();

const AMON_SUL = 'tw-296'; // Palantír of Amon Sûl, the revealed card in the reported game

class StubEl {
  tagName: string;
  children: StubEl[] = [];
  className = '';
  alt = '';
  src = '';
  dataset: Record<string, string> = {};
  style: Record<string, unknown> = { setProperty: () => { /* no-op */ } };
  constructor(tagName: string) { this.tagName = tagName; }
  appendChild(child: StubEl): StubEl { this.children.push(child); return child; }
  set innerHTML(v: string) { if (v === '') this.children = []; }
  get innerHTML(): string { return ''; }
}

let opponentArc: StubEl;

beforeEach(() => {
  opponentArc = new StubEl('div');
  (globalThis as unknown as { document: unknown }).document = {
    createElement: (tag: string) => new StubEl(tag),
    getElementById: (id: string) => (id === 'opponent-arc' ? opponentArc : null),
  };
});

afterEach(() => {
  delete (globalThis as unknown as { document?: unknown }).document;
});

/** A view where the opponent's hand has one revealed card and one still-hidden card. */
function partiallyRevealedOpponentHandView(): PlayerView {
  const emptySide = {
    hand: [] as unknown[], playDeck: [], siteDeck: [], discardPile: [], siteDiscardPile: [],
    sideboard: [], killPile: [], outOfPlayPile: [], cardsInPlay: [], characters: {}, companies: [], agents: [],
  };
  const opponentHand = [
    { instanceId: 'p2-1' as CardInstanceId, definitionId: AMON_SUL },
    { instanceId: 'p2-2' as CardInstanceId, definitionId: UNKNOWN_CARD },
  ];
  return {
    self: { ...emptySide, id: 'p1' },
    opponent: { ...emptySide, id: 'p2', hand: opponentHand },
    activePlayer: 'p1',
    phaseState: { phase: Phase.Organization, step: null },
    legalActions: [],
  } as unknown as PlayerView;
}

describe('opponent hand rendering after a hand-reveal effect', () => {
  test('a revealed instance shows its real card face; an unrevealed one stays a back', () => {
    renderOpponentHand(partiallyRevealedOpponentHandView(), pool);

    expect(opponentArc.children).toHaveLength(2);
    const [revealed, hidden] = opponentArc.children;

    expect(revealed.dataset.cardId).toBe(AMON_SUL);
    expect(revealed.alt).toBe('Palantír of Amon Sûl');
    expect(revealed.src).not.toBe('/images/card-back.jpg');

    expect(hidden.src).toBe('/images/card-back.jpg');
    expect(hidden.dataset.cardId).toBeUndefined();
  });
});
