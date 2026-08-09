/**
 * @module render-chain.test
 *
 * Regression test for bug report 5299d73969e80265 (game ms8y3wig-1bg5qc, seq
 * 53): a player found the "Pass Priority" button inconvenient because it sat
 * in the fixed bottom-right action panel, far from the chain-of-effects
 * window it actually resolves. The button is now also rendered inside the
 * chain panel itself (see render-chain.ts), alongside the existing
 * bottom-right button (see render-instructions.ts), so the action is
 * available in both places.
 *
 * Uses the hand-rolled DOM stub pattern of `company-attachments-render.test.ts`
 * (the package runs vitest in the default node environment, with no jsdom).
 */

import './test-dom-bootstrap.js'; // must precede the render-chain import (load-time window access)
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import type { PlayerView, EvaluatedAction, CardDefinition } from '@meccg/shared';
import { renderChainPanel } from './render-chain.js';
import { renderPassButton } from './render-instructions.js';

class StubEl {
  tagName: string;
  children: StubEl[] = [];
  className = '';
  textContent = '';
  onclick: (() => void) | null = null;
  dataset: Record<string, string> = {};
  classList = {
    classes: new Set<string>(),
    add: (...cs: string[]) => { for (const c of cs) this.classList.classes.add(c); },
    remove: (...cs: string[]) => { for (const c of cs) this.classList.classes.delete(c); },
    contains: (c: string) => this.classList.classes.has(c),
  };
  constructor(tagName: string) { this.tagName = tagName; }
  appendChild(child: StubEl): StubEl { this.children.push(child); return child; }
  set innerHTML(v: string) { if (v === '') this.children = []; }
  get innerHTML(): string { return ''; }
  all(): StubEl[] { return [this, ...this.children.flatMap(c => c.all())]; }
}

let chainPanel: StubEl;
let passBtn: StubEl;
let waitingEl: StubEl;

beforeEach(() => {
  chainPanel = new StubEl('div');
  passBtn = new StubEl('button');
  waitingEl = new StubEl('div');
  const byId: Record<string, StubEl | null> = {
    'chain-panel': chainPanel,
    'pass-btn': passBtn,
    'waiting-indicator': waitingEl,
  };
  (globalThis as unknown as { document: unknown }).document = {
    createElement: (tag: string) => new StubEl(tag),
    getElementById: (id: string) => (id in byId ? byId[id] : null),
    querySelectorAll: () => [],
  };
});

afterEach(() => {
  delete (globalThis as unknown as { document?: unknown }).document;
});

const cardPool = {} as Readonly<Record<string, CardDefinition>>;

const passChainPriority: EvaluatedAction = {
  action: { type: 'pass-chain-priority', player: 'p1' },
  viable: true,
} as unknown as EvaluatedAction;

const viewWith = (opts: { selfHasPriority: boolean; legalActions: EvaluatedAction[] }): PlayerView =>
  ({
    self: { id: 'p1', name: 'You' },
    opponent: { id: 'p2', name: 'Rival' },
    chain: {
      mode: 'resolving',
      priority: opts.selfHasPriority ? 'p1' : 'p2',
      entries: [],
      parentChain: null,
    },
    legalActions: opts.legalActions,
  } as unknown as PlayerView);

describe('renderChainPanel — Pass Priority button', () => {
  test('renders a Pass Priority button inside the chain panel when self has priority', () => {
    let sent: unknown = null;
    renderChainPanel(
      viewWith({ selfHasPriority: true, legalActions: [passChainPriority] }),
      cardPool,
      action => { sent = action; },
    );

    const found = chainPanel.all().find(el => el.tagName === 'button' && el.textContent === 'Pass Priority');
    expect(found).toBeDefined();

    found?.onclick?.();
    expect(sent).toEqual(passChainPriority.action);
  });

  test('does not render a Pass Priority button when the opponent has priority', () => {
    renderChainPanel(
      viewWith({ selfHasPriority: false, legalActions: [] }),
      cardPool,
      () => { /* no-op */ },
    );

    const found = chainPanel.all().find(el => el.tagName === 'button' && el.textContent === 'Pass Priority');
    expect(found).toBeUndefined();
  });
});

const cancelChainEntry: EvaluatedAction = {
  action: {
    type: 'activate-granted-action',
    player: 'p1',
    characterId: 'p1-101',
    sourceCardId: 'p1-12',
    sourceCardDefinitionId: 'tw-350',
    actionId: 'cancel-chain-entry',
    rollThreshold: 0,
  },
  viable: true,
} as unknown as EvaluatedAction;

describe('renderChainPanel — granted-action responses', () => {
  test('renders a response button for a viable activate-granted-action (Tom Bombadil cancel-chain-entry) when self has priority', () => {
    let sent: unknown = null;
    renderChainPanel(
      viewWith({ selfHasPriority: true, legalActions: [cancelChainEntry, passChainPriority] }),
      cardPool,
      action => { sent = action; },
    );

    const found = chainPanel.all().find(el => el.tagName === 'button' && el.className === 'chain-response-btn');
    expect(found).toBeDefined();

    found?.onclick?.();
    expect(sent).toEqual(cancelChainEntry.action);
  });

  test('does not render a response button when the opponent has priority', () => {
    renderChainPanel(
      viewWith({ selfHasPriority: false, legalActions: [] }),
      cardPool,
      () => { /* no-op */ },
    );

    const found = chainPanel.all().find(el => el.tagName === 'button' && el.className === 'chain-response-btn');
    expect(found).toBeUndefined();
  });
});

describe('renderPassButton — pass-chain-priority', () => {
  test('also shows the bottom-right button, labeled Pass Priority', () => {
    renderPassButton(
      { phaseState: { phase: 'movement-hazard', step: null }, legalActions: [passChainPriority], self: { id: 'p1' }, activePlayer: 'p1' } as unknown as PlayerView,
      () => { /* no-op */ },
    );

    expect(passBtn.classList.contains('hidden')).toBe(false);
    expect(passBtn.textContent).toBe('Pass Priority');
  });
});
