/**
 * @module render-game-over-reveals.test
 *
 * Regression test for bug report 75c72548a626d63c (game mtmcha9w-3zw75e, seq
 * 979): CoE rule 10.3.v ("Revealing Duplicates") reduces a player's final
 * score by 1 for each unique card their opponent holds unplayed in hand that
 * matches an MP-giving unique card already in play. The engine's
 * authoritative `finalScores` already applies this penalty, but nothing on
 * the Game Over screen explained *why* the Total row was lower than the sum
 * of the category rows — the reporter could see the deduction happening but
 * had no way to tell what caused it.
 *
 * Fix: the reducer now records each match as a `uniqueCardReveals` entry on
 * the game-over phase state, and the Game Over screen renders one note per
 * entry below the scoring table.
 *
 * Uses the hand-rolled DOM stub pattern of `render-game-over-total.test.ts`
 * (the package runs vitest in the default node environment, with no jsdom).
 */

import './test-dom-bootstrap.js'; // must precede the render-game-over import (load-time window access)
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import type { CardDefinition, CardDefinitionId, PlayerView } from '@meccg/shared';
import { Phase } from '@meccg/shared';
import { renderGameOverView } from './render-game-over.js';

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

const RANGERS_OF_THE_NORTH = 'tw-263' as CardDefinitionId;

const cardPool = {
  [RANGERS_OF_THE_NORTH]: { id: RANGERS_OF_THE_NORTH, name: 'Rangers of the North' },
} as unknown as Readonly<Record<string, CardDefinition>>;

const rawPoints = (character: number, item: number, faction: number, ally: number, kill: number, misc: number) => ({
  character, item, faction, ally, kill, misc,
});

const view = {
  self: {
    id: 'p1',
    name: 'Fatty75',
    marshallingPoints: rawPoints(6, 14, 6, 1, 1, 0),
    characters: {},
    cardsInPlay: [],
    killPile: [],
  },
  opponent: {
    id: 'p2',
    name: 'AI-Modular',
    marshallingPoints: rawPoints(0, 0, 3, 2, 1, 0),
    characters: {},
    cardsInPlay: [],
    killPile: [],
  },
  phaseState: {
    phase: Phase.GameOver,
    winner: 'p1',
    finalScores: { p1: 39, p2: 5 },
    finishedPlayers: ['p2', 'p1'],
    winReason: { kind: 'marshalling-points' },
    uniqueCardReveals: [
      { revealedBy: 'p1', penalizedPlayer: 'p2', cardId: RANGERS_OF_THE_NORTH },
    ],
  },
} as unknown as PlayerView;

describe('renderGameOverView unique card reveal notes', () => {
  test('explains each CoE 10.3.v deduction folded into the Total row', () => {
    renderGameOverView(view, cardPool);

    const notes = board.all().filter(el => el.className === 'go-reveal-note');
    expect(notes.map(el => el.textContent)).toEqual([
      'Unique card reveal: Fatty75 held "Rangers of the North" matching AI-Modular\'s in-play copy — AI-Modular -1',
    ]);
  });

  test('renders no notes when there are no reveal matches', () => {
    const noReveals = {
      ...view,
      phaseState: { ...view.phaseState, uniqueCardReveals: [] },
    } as unknown as PlayerView;

    renderGameOverView(noReveals, cardPool);

    const notes = board.all().filter(el => el.className === 'go-reveal-note');
    expect(notes).toHaveLength(0);
  });
});
