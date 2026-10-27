/**
 * @module render-game-over-avatar-penalty.test
 *
 * Regression test for bug report 17c0a168a0a29dac (game mvqrmvuc-hd8r6o, seq
 * 1453): Dain's Saruman was eliminated by a failed corruption check while The
 * White Tree (tw-348, 5 misc MP) was in play. The engine scored this correctly
 * — misc 5 with the CoE 2.2 eliminated-avatar -5 folded in, i.e. a net misc of
 * 0 and `avatarPenalty: -5` — but the Game Over table skipped every category
 * where both players had 0, so the Misc row vanished, hiding both The White
 * Tree's 5 points and the -5 penalty.
 *
 * Fix: the penalty is shown on its own "Eliminated avatar" row, the Misc row
 * shows the misc points without it, and a category is kept whenever either
 * player has contributing cards in it.
 *
 * Uses the hand-rolled DOM stub pattern of `render-game-over-total.test.ts`
 * (the package runs vitest in the default node environment, with no jsdom).
 */

import './test-dom-bootstrap.js'; // must precede the render-game-over import (load-time window access)
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import type { CardDefinition, PlayerView } from '@meccg/shared';
import { Phase } from '@meccg/shared';
import { renderGameOverView } from './render-game-over.js';

// --- Minimal DOM stub -------------------------------------------------------

class StubEl {
  tagName: string;
  children: StubEl[] = [];
  className = '';
  textContent = '';
  dataset: Record<string, string> = {};
  style = { setProperty: () => { /* no-op */ } };
  classList = {
    classes: new Set<string>(),
    add: (...cs: string[]) => { for (const c of cs) this.classList.classes.add(c); },
    contains: (c: string) => this.classList.classes.has(c),
  };
  constructor(tagName: string) { this.tagName = tagName; }
  appendChild(child: StubEl): StubEl { this.children.push(child); return child; }
  addEventListener(): void { /* no-op */ }
  set innerHTML(v: string) { if (v === '') this.children = []; }
  get innerHTML(): string { return ''; }
  /** Depth-first collect self + every descendant. */
  all(): StubEl[] { return [this, ...this.children.flatMap(c => c.all())]; }
}

let board: StubEl;

beforeEach(() => {
  board = new StubEl('div');
  (globalThis as unknown as { document: unknown }).document = {
    createElement: (tag: string) => new StubEl(tag),
    getElementById: (id: string) => (id === 'visual-board' ? board : null),
  };
});

afterEach(() => {
  delete (globalThis as unknown as { document?: unknown }).document;
});

const cardPool = {
  'tw-348': {
    cardType: 'hero-resource-event',
    id: 'tw-348',
    name: 'The White Tree',
    image: 'https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/TheWhiteTree.jpg',
    marshallingPoints: 5,
    marshallingCategory: 'misc',
  },
} as unknown as Readonly<Record<string, CardDefinition>>;

const view = {
  self: {
    id: 'p1',
    name: 'Dain',
    marshallingPoints: { character: 3, item: 2, faction: 10, ally: 5, kill: 1, misc: 0, avatarPenalty: -5 },
    characters: {},
    cardsInPlay: [{ instanceId: 'p1-84', definitionId: 'tw-348' }],
    killPile: [],
  },
  opponent: {
    id: 'p2',
    name: 'AI-Modular',
    marshallingPoints: { character: 6, item: 4, faction: 0, ally: 1, kill: 2, misc: 0 },
    characters: {},
    cardsInPlay: [],
    killPile: [],
  },
  phaseState: {
    phase: Phase.GameOver,
    winner: 'p1',
    finalScores: { p1: 27, p2: 13 },
    finishedPlayers: ['p2', 'p1'],
    winReason: { kind: 'marshalling-points' },
    uniqueCardReveals: [],
  },
} as unknown as PlayerView;

/** Score texts of the body row with the given category label. */
function rowScores(label: string): string[] | undefined {
  const row = board.all().find(el => el.tagName === 'tr' && el.children[0]?.textContent === label);
  return row?.children.slice(1).map(cell => cell.children[0]?.textContent ?? '');
}

describe('renderGameOverView eliminated-avatar penalty', () => {
  test('shows misc points and the -5 penalty on separate rows when they net to 0', () => {
    renderGameOverView(view, cardPool);

    expect(rowScores('Misc')).toEqual(['5', '0']);
    expect(rowScores('Eliminated avatar')).toEqual(['-5', '0']);
    const totalCells = board.all().filter(el => el.className === 'go-score go-total');
    expect(totalCells.map(el => el.textContent)).toEqual(['27', '13']);
  });
});
