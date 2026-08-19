/**
 * @module render-game-over-total.test
 *
 * Regression test for bug report 777d84db2d6c5dc8 (game mszxdmm1-v55s34, seq
 * 1289): a player held Knights of Dol Amroth (tw-263) in hand while their
 * opponent had a copy in play. Per CoE rule 10.3.v (unique card reveal),
 * this should reduce the opponent's final score by 1 — the engine's
 * authoritative `finalScores` in the game-over phase state does apply this
 * penalty (15 raw item/character/faction points became 14), but the Game
 * Over screen's Total row recomputed the total from raw marshalling points
 * via `computeTournamentScore`, which only covers CoE steps 2-4 (totaling,
 * doubling, diversity cap) and silently dropped the reveal penalty, so the
 * displayed total (15) diverged from the authoritative one (14).
 *
 * Fix: the Total row now reads `goState.finalScores` directly instead of
 * recomputing it.
 *
 * Uses the hand-rolled DOM stub pattern of `company-attachments-render.test.ts`
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

const cardPool = {} as Readonly<Record<string, CardDefinition>>;

const rawPoints = (character: number, item: number, faction: number, ally: number, kill: number, misc: number) => ({
  character, item, faction, ally, kill, misc,
});

const view = {
  self: {
    id: 'p1',
    name: 'marric1976',
    marshallingPoints: rawPoints(11, 1, 11, 6, 3, 5),
    characters: {},
    cardsInPlay: [],
    killPile: [],
  },
  opponent: {
    id: 'p2',
    name: 'AI-Modular',
    // Raw total is 15; the CoE 10.3.v unique-card-reveal penalty for the
    // duplicated Knights of Dol Amroth brings the authoritative total to 14.
    marshallingPoints: rawPoints(5, 4, 6, 0, 0, 0),
    characters: {},
    cardsInPlay: [],
    killPile: [],
  },
  phaseState: {
    phase: Phase.GameOver,
    winner: 'p1',
    finalScores: { p1: 43, p2: 14 },
    finishedPlayers: ['p2', 'p1'],
    winReason: { kind: 'marshalling-points' },
  },
} as unknown as PlayerView;

describe('renderGameOverView Total row', () => {
  test('reads the authoritative finalScores instead of recomputing from raw MP', () => {
    renderGameOverView(view, cardPool);

    const totalCells = board.all().filter(el => el.className === 'go-score go-total');
    expect(totalCells.map(el => el.textContent)).toEqual(['43', '14']);
  });
});
