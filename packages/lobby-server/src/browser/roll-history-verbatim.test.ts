/**
 * @module roll-history-verbatim.test
 *
 * Regression test for feature request "Can we have the full roll in the
 * developpers tools" (388d788bbb24b92f): the per-game toast panel ellipsis-
 * truncates long character/site names via `MAX_NAME_LENGTH` in
 * `dice-roll-log.ts` (deliberately, per CHANGELOG #3049, to keep the roll
 * numbers visible), and that truncation happens at the point
 * `diceRollNotification()` builds the toast text — the full name cannot be
 * recovered from the toast log afterwards.
 *
 * `roll-history.ts` instead records the untruncated `diceRollLogLine()` text
 * for every roll as it arrives (independent of `gameMessageLog`) and exposes
 * it through the Developer Tools "Roll History" panel, so a long name that
 * the toast view clips is still readable in full there.
 *
 * Uses the hand-rolled DOM stub pattern of `replay-exit-clears-text-log.test.ts`
 * (the package runs vitest in the default node environment, with no jsdom).
 */

import './test-dom-bootstrap.js'; // must precede browser-module imports (load-time window access)
import { describe, test, expect, beforeEach } from 'vitest';
import type { DiceRollEffect } from '@meccg/shared';
import { diceRollLogLine, diceRollNotification } from './dice-roll-log.js';
import {
  recordRollHistoryLine, clearRollHistory, openRollHistoryPanel, closeRollHistoryPanel,
} from './roll-history.js';

class StubClassList {
  private classes = new Set<string>();
  add(...cs: string[]): void { for (const c of cs) this.classes.add(c); }
  remove(...cs: string[]): void { for (const c of cs) this.classes.delete(c); }
  contains(c: string): boolean { return this.classes.has(c); }
}

class StubEl {
  id = '';
  classList = new StubClassList();
  children: StubEl[] = [];
  textContent = '';
  scrollTop = 0;
  scrollHeight = 0;
  appendChild(child: StubEl): StubEl { this.children.push(child); return child; }
  replaceChildren(): void { this.children = []; }
}

const PANEL_IDS = ['roll-history-modal', 'roll-history-list'];

let elements: Record<string, StubEl>;

function installFreshDom(): void {
  elements = {};
  for (const id of PANEL_IDS) {
    const el = new StubEl();
    el.id = id;
    elements[id] = el;
  }
  elements['roll-history-modal'].classList.add('hidden');
  (globalThis as unknown as { document: unknown }).document = {
    getElementById: (id: string) => elements[id] ?? null,
    createElement: () => new StubEl(),
  };
}

const longLabel = 'Necklace of Silver and Pearls (Emerald of Doriath)';
const longRoll: DiceRollEffect = {
  effect: 'dice-roll', playerName: 'AI-Real', die1: 3, die2: 4, label: longLabel,
};

beforeEach(() => {
  installFreshDom();
  clearRollHistory();
});

describe('roll-history panel', () => {
  test('the toast notification for a long name is truncated, confirming the panel is needed', () => {
    const notification = diceRollNotification(longRoll, 'wigy', 'AI-Real');
    expect(notification?.message).toContain('…');
    expect(notification?.message).not.toContain(longLabel);
  });

  test('opening the panel shows the full, untruncated line', () => {
    const line = diceRollLogLine(longRoll);
    recordRollHistoryLine(line);

    openRollHistoryPanel();

    expect(elements['roll-history-modal'].classList.contains('hidden')).toBe(false);
    expect(elements['roll-history-list'].children).toHaveLength(1);
    expect(elements['roll-history-list'].children[0].textContent).toBe(line);
    expect(elements['roll-history-list'].children[0].textContent).toContain(longLabel);
  });

  test('a line recorded while the panel is already open appends live', () => {
    openRollHistoryPanel();
    expect(elements['roll-history-list'].children).toHaveLength(0);

    recordRollHistoryLine(diceRollLogLine(longRoll));

    expect(elements['roll-history-list'].children).toHaveLength(1);
  });

  test('a line recorded while the panel is closed is not drawn until the next open', () => {
    closeRollHistoryPanel();
    recordRollHistoryLine(diceRollLogLine(longRoll));

    expect(elements['roll-history-list'].children).toHaveLength(0);

    openRollHistoryPanel();

    expect(elements['roll-history-list'].children).toHaveLength(1);
  });

  test('clearRollHistory empties both the stored lines and the rendered list', () => {
    recordRollHistoryLine(diceRollLogLine(longRoll));
    openRollHistoryPanel();
    expect(elements['roll-history-list'].children).toHaveLength(1);

    clearRollHistory();

    expect(elements['roll-history-list'].children).toHaveLength(0);

    openRollHistoryPanel();
    expect(elements['roll-history-list'].children).toHaveLength(0);
  });
});
