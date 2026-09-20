/**
 * @module bug-report-dice.test
 *
 * Regression test for feature request aef8720fbbd67342: "After reporting a
 * bug, the roll doesnt return."
 *
 * Opening the in-game bug-report modal (`#bug-report-btn`) did not touch the
 * dice module at all: the roll's own `setTimeout` chain kept running in the
 * background while `.dice-overlay` (`--z-overlay`, 300) visually sat above
 * the modal (`--z-modal`, 200) — both are full-viewport `position: fixed;
 * inset: 0` elements. Tumbling dice bled through the modal the player was
 * filling in, and by the time they closed it the overlay had already been
 * dismissed by its own timers, leaving only the resting tray behind — which
 * reads as "the roll doesn't return."
 *
 * This is the same underlying failure mode as bug report ad68e911b5b5163f
 * (see `dice-view-toggle.test.ts`), fixed there by calling
 * `dismissDiceOverlays()` before the interfering UI change. The bug-report
 * handler in `app.ts` now does the same: `dismissDiceOverlays()` before
 * showing the modal, which removes the overlay immediately but leaves
 * `lastRolls` intact so a later `restoreDice()` still repopulates the tray.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import type { PlayerView } from '@meccg/shared';
import { seedDiceFromState, restoreDice, dismissDiceOverlays } from './dice.js';

class StubEl {
  tagName: string;
  children: StubEl[] = [];
  style: Record<string, string> = {};
  attributes: Record<string, string> = {};
  classList = {
    classes: new Set<string>(),
    add: (...cs: string[]) => { for (const c of cs) this.classList.classes.add(c); },
    remove: (...cs: string[]) => { for (const c of cs) this.classList.classes.delete(c); },
    contains: (c: string) => this.classList.classes.has(c),
  };

  constructor(tagName: string) { this.tagName = tagName; }
  appendChild(child: StubEl): StubEl { this.children.push(child); return child; }
  set className(v: string) { this.classList.classes = new Set(v.split(/\s+/).filter(Boolean)); }
  get className(): string { return Array.from(this.classList.classes).join(' '); }
  remove(): void { /* detached from a parentless stub tree; no-op is fine */ }
  getAttribute(name: string): string | null { return name in this.attributes ? this.attributes[name] : null; }
  setAttribute(name: string, value: string): void { this.attributes[name] = value; }
  removeAttribute(name: string): void { delete this.attributes[name]; }
  querySelector(selector: string): StubEl | null {
    const wantsClass = selector.startsWith('.') ? selector.slice(1) : selector;
    for (const child of this.children) {
      if (child.classList.contains(wantsClass)) return child;
      const nested = child.querySelector(selector);
      if (nested) return nested;
    }
    return null;
  }
  set innerHTML(v: string) { if (v === '') this.children = []; }
  get innerHTML(): string { return ''; }
}

let byId: Record<string, StubEl>;

beforeEach(() => {
  byId = {
    'self-dice-tray': new StubEl('div'),
    'opponent-dice-tray': new StubEl('div'),
  };
  (globalThis as unknown as { document: unknown }).document = {
    createElement: (tag: string) => new StubEl(tag),
    getElementById: (id: string) => byId[id] ?? null,
  };
  dismissDiceOverlays();
});

afterEach(() => {
  dismissDiceOverlays();
  delete (globalThis as unknown as { document?: unknown }).document;
});

const view = (selfDie: { die1: number; die2: number } | null): { self: PlayerView['self']; opponent: PlayerView['opponent'] } =>
  ({
    self: { lastDiceRoll: selfDie },
    opponent: { lastDiceRoll: null },
  }) as unknown as { self: PlayerView['self']; opponent: PlayerView['opponent'] };

describe('dice tray survives opening the in-game bug-report modal (feature request aef8720fbbd67342)', () => {
  test('dismissDiceOverlays() (called when the bug-report modal opens) keeps the stored roll so restoreDice() repopulates the tray', () => {
    seedDiceFromState(view({ die1: 5, die2: 2 }));
    restoreDice();
    expect(byId['self-dice-tray'].children.length).toBe(2);

    // Simulate clicking "Report Bug" mid-roll, as the #bug-report-btn handler
    // in app.ts now does before showing the modal.
    dismissDiceOverlays();

    // The roll's own setTimeout chain still fires on schedule and calls
    // restoreDice() once the player closes the modal — the tray must still
    // show the correct resting values.
    restoreDice();
    expect(byId['self-dice-tray'].children.length).toBe(2);
  });
});
