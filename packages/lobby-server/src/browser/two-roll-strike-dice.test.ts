/**
 * @module two-roll-strike-dice.test
 *
 * Feature request "Lucky Strike card" (b6aca8d777693af3): playing Lucky Strike
 * (tw-270) or Swift Strokes (le-238) makes two strike rolls and keeps the
 * better one, but the player only ever saw one pair of dice. The engine used
 * to emit the discarded roll and the kept roll as two separate `dice-roll`
 * effects, so the second animation replaced the first almost instantly, and
 * no message-panel line mentioned the other roll.
 *
 * The engine now sends one `dice-roll` effect carrying the kept roll plus
 * `alternateRoll`. These tests cover the client side of that:
 * - the log line quotes both rolls, and the message panel leaves the line to
 *   the engine's text notification (no duplicate);
 * - `rollDice()` animates both pairs, marks the discarded one, and only the
 *   kept roll ends up in the tray;
 * - a second same-colour roll arriving mid-animation is no longer dismissed
 *   early by the first roll's leftover timer.
 *
 * Uses a hand-rolled DOM stub (the package runs vitest in the default node
 * environment, with no jsdom), like `dice-view-toggle.test.ts`.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import type { DiceRollEffect } from '@meccg/shared';
import { rollDice, clearDice, waitForDice } from './dice.js';
import { diceRollLogLine, diceRollNotification, isLegacyDiscardedRoll } from './dice-roll-log.js';

class StubEl {
  tagName: string;
  children: StubEl[] = [];
  parent: StubEl | null = null;
  style: Record<string, string> = {};
  attributes: Record<string, string> = {};
  textContent = '';
  offsetWidth = 0;
  classList = {
    classes: new Set<string>(),
    add: (...cs: string[]) => { for (const c of cs) this.classList.classes.add(c); },
    remove: (...cs: string[]) => { for (const c of cs) this.classList.classes.delete(c); },
    contains: (c: string) => this.classList.classes.has(c),
  };

  constructor(tagName: string) { this.tagName = tagName; }
  appendChild(child: StubEl): StubEl {
    child.remove();
    child.parent = this;
    this.children.push(child);
    return child;
  }
  set className(v: string) { this.classList.classes = new Set(v.split(/\s+/).filter(Boolean)); }
  get className(): string { return Array.from(this.classList.classes).join(' '); }
  remove(): void {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter(c => c !== this);
    this.parent = null;
  }
  addEventListener(): void { /* clicks are not simulated */ }
  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return { left: 0, top: 0, width: 100, height: 100 };
  }
  getAttribute(name: string): string | null { return name in this.attributes ? this.attributes[name] : null; }
  setAttribute(name: string, value: string): void { this.attributes[name] = value; }
  removeAttribute(name: string): void { delete this.attributes[name]; }
  querySelectorAll(selector: string): StubEl[] {
    const wantsClass = selector.startsWith('.') ? selector.slice(1) : selector;
    const out: StubEl[] = [];
    for (const child of this.children) {
      if (child.classList.contains(wantsClass)) out.push(child);
      out.push(...child.querySelectorAll(selector));
    }
    return out;
  }
  querySelector(selector: string): StubEl | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  set innerHTML(v: string) { if (v === '') this.children = []; }
  get innerHTML(): string { return ''; }
}

let byId: Record<string, StubEl>;
let body: StubEl;

/** All dice overlays currently attached to the document body. */
const overlaysInBody = (): StubEl[] => body.children.filter(c => c.classList.contains('dice-overlay'));

beforeEach(() => {
  vi.useFakeTimers();
  body = new StubEl('body');
  byId = {
    'self-dice-tray': new StubEl('div'),
    'opponent-dice-tray': new StubEl('div'),
  };
  (globalThis as unknown as { document: unknown }).document = {
    createElement: (tag: string) => new StubEl(tag),
    getElementById: (id: string) => byId[id] ?? null,
    body,
  };
  (globalThis as unknown as { requestAnimationFrame: (cb: () => void) => void }).requestAnimationFrame =
    (cb: () => void) => { cb(); };
  clearDice();
});

afterEach(() => {
  clearDice();
  vi.useRealTimers();
  delete (globalThis as unknown as { document?: unknown }).document;
  delete (globalThis as unknown as { requestAnimationFrame?: unknown }).requestAnimationFrame;
});

const luckyStrikeRoll: DiceRollEffect = {
  effect: 'dice-roll',
  playerName: 'wigy',
  die1: 5,
  die2: 6,
  label: 'Lucky Strike: Aragorn II',
  alternateRoll: { die1: 3, die2: 4 },
};

describe('two-roll strike log lines', () => {
  test('the debug log line quotes both the kept and the discarded roll', () => {
    expect(diceRollLogLine(luckyStrikeRoll))
      .toBe('Lucky Strike: Aragorn II: wigy rolled 5 + 6 = 11 (other roll 3 + 4 = 7, discarded)');
  });

  test('no separate message-panel line for either player — the engine text notification covers it', () => {
    expect(diceRollNotification(luckyStrikeRoll, 'wigy', 'bob')).toBeNull();
    expect(diceRollNotification(luckyStrikeRoll, 'bob', 'wigy')).toBeNull();
  });

  test('the discarded half of an old-format two-roll strike is recognised as log-only', () => {
    expect(isLegacyDiscardedRoll({ ...luckyStrikeRoll, label: 'Strike (reroll) (discarded): Aragorn II' })).toBe(true);
    expect(isLegacyDiscardedRoll({ ...luckyStrikeRoll, label: 'Strike (reroll): Aragorn II' })).toBe(false);
    expect(isLegacyDiscardedRoll(luckyStrikeRoll)).toBe(false);
  });
});

describe('two-roll strike dice animation', () => {
  test('both pairs tumble, the discarded one is marked, and only the kept roll lands in the tray', async () => {
    rollDice(5, 6, 'black', { die1: 3, die2: 4 });

    const [overlay] = overlaysInBody();
    expect(overlay).toBeDefined();
    const groups = overlay.querySelectorAll('.dice-group');
    expect(groups.map(g => g.className)).toEqual(['dice-group dice-group-discarded', 'dice-group dice-group-kept']);
    expect(overlay.querySelectorAll('.dice-scene').length).toBe(4);
    expect(groups.map(g => g.querySelector('.dice-caption')?.textContent)).toEqual(['discarded', 'kept']);

    // Once the dice land, the container is marked resolved (captions shown,
    // discarded pair dimmed via CSS).
    const container = overlay.querySelector('.dice-container')!;
    expect(container.classList.contains('dice-resolved')).toBe(false);
    vi.advanceTimersByTime(1600);
    expect(container.classList.contains('dice-resolved')).toBe(true);

    // The pair is held longer than a single roll (2800 ms) before sliding.
    vi.advanceTimersByTime(2800 - 1600);
    expect(overlay.querySelectorAll('.dice-group').length).toBe(2);
    vi.advanceTimersByTime(800);
    // Sliding: only the kept pair remains in the overlay.
    expect(overlay.querySelectorAll('.dice-group').map(g => g.className))
      .toEqual(['dice-group dice-group-kept dice-sliding']);

    vi.advanceTimersByTime(650 + 300);
    await waitForDice();
    expect(overlaysInBody().length).toBe(0);
    const tray = byId['self-dice-tray'];
    expect(tray.children.length).toBe(2);
    expect(tray.getAttribute('data-roll')).toBe('5-6');
  });

  test('a second same-colour roll is not dismissed by the first roll\'s leftover timer', async () => {
    rollDice(2, 3, 'red');
    vi.advanceTimersByTime(100);
    rollDice(6, 6, 'red');

    const overlays = overlaysInBody();
    expect(overlays.length).toBe(1);
    const second = overlays[0];

    // The first roll's slide/dismiss timers have fired by t=3500 (2800 +
    // 650 ms after it started), while the second is still sliding (its own
    // dismiss is due at t=3550) — the old timers must leave it alone.
    vi.advanceTimersByTime(3500 - 100);
    expect(overlaysInBody()).toEqual([second]);
    expect(second.classList.contains('dice-fade-out')).toBe(false);

    vi.advanceTimersByTime(1000);
    await waitForDice();
    expect(overlaysInBody().length).toBe(0);
    expect(byId['opponent-dice-tray'].getAttribute('data-roll')).toBe('6-6');
  });
});
