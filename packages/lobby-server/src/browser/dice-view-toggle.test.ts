/**
 * @module dice-view-toggle.test
 *
 * Regression test for bug report ad68e911b5b5163f (game msq7niva-zys3dg, seq
 * 832, turn 17): "I dont have a roll anymore on the right hand side of the
 * screen. It disappeared (as I copied from it earlier around turn 12)."
 *
 * The game log shows both players' `lastDiceRoll` still populated at seq 832
 * (Gamling: 3+1, unchanged since a turn-16 roll) — the server state never
 * lost the roll, so this was a client rendering bug.
 *
 * `game-entry.ts`'s `setViewMode()` called `clearDice()` when switching to
 * the debug view, which deletes the module-level `lastRolls` cache along
 * with the tray DOM. Switching back to visual view then calls
 * `restoreDice()`, which finds no stored roll for the tray and leaves it
 * empty — and `.dice-tray:empty { display: none }` makes it vanish — until
 * the next dice-roll action broadcasts fresh state and reseeds `lastRolls`
 * via `seedDiceFromState()`. If a player toggles the debug view and back
 * while waiting on a step with no roll of their own (e.g. an end-of-turn
 * discard), their tray stays empty indefinitely.
 *
 * Fixed by adding `dismissDiceOverlays()`, which only removes the in-flight
 * roll overlay (needed so it doesn't float above the debug view) and leaves
 * `lastRolls` and the tray DOM untouched. `setViewMode()` now calls that
 * instead of `clearDice()` for the debug-view toggle.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import type { PlayerView } from '@meccg/shared';
import { seedDiceFromState, restoreDice, dismissDiceOverlays, clearDice } from './dice.js';

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
  // dice.ts keeps `lastRolls`/`overlays` as module-level state; reset it
  // here (while the document stub is in place) so tests don't leak into
  // each other.
  clearDice();
});

afterEach(() => {
  clearDice();
  delete (globalThis as unknown as { document?: unknown }).document;
});

const view = (selfDie: { die1: number; die2: number } | null): { self: PlayerView['self']; opponent: PlayerView['opponent'] } =>
  ({
    self: { lastDiceRoll: selfDie },
    opponent: { lastDiceRoll: null },
  }) as unknown as { self: PlayerView['self']; opponent: PlayerView['opponent'] };

describe('dice tray survives a debug-view toggle (game msq7niva-zys3dg, seq 832)', () => {
  test('dismissDiceOverlays() (used for the debug-view toggle) keeps the stored roll so restoreDice() repopulates the tray', () => {
    seedDiceFromState(view({ die1: 3, die2: 1 }));
    restoreDice();
    expect(byId['self-dice-tray'].children.length).toBe(2);

    // Simulate switching to the debug view and back, as setViewMode() now does.
    dismissDiceOverlays();
    restoreDice();

    expect(byId['self-dice-tray'].children.length).toBe(2);
  });

  test('clearDice() (the pre-fix behaviour) wipes the roll and leaves the tray empty on restore', () => {
    seedDiceFromState(view({ die1: 3, die2: 1 }));
    restoreDice();
    expect(byId['self-dice-tray'].children.length).toBe(2);

    // This is what setViewMode() used to call for a mere view toggle — it
    // over-clears, which is exactly the reported bug.
    clearDice();
    restoreDice();

    expect(byId['self-dice-tray'].children.length).toBe(0);
  });
});

describe('dice tray repaints when the roll changed while it was hidden', () => {
  // The debug view hides the trays via CSS but leaves their DOM intact. A
  // dice-roll broadcast arriving while the debug view is showing updates the
  // stored roll through seedDiceFromState() but does not run rollDice() (which
  // is guarded behind the visual view being visible and is the only thing that
  // clears the tray). Restoring must then repaint the stale dice, not keep
  // them — the pre-fix `children.length > 0` guard kept them.
  //
  // FACE_ROTATIONS maps die value → the resting cube transform: 3 → rotateY
  // -90deg, 4 → rotateY +90deg, 1 → rotateY 0deg. Reading the first die's cube
  // transform proves which value the tray actually shows.
  const firstDieTransform = (): string =>
    byId['self-dice-tray'].children[0]?.querySelector('.dice-cube')?.style.transform ?? '';

  test('restoreDice() replaces the old dice when lastRolls changed under a hidden tray', () => {
    // Roll 3+4 shows in the visual view.
    seedDiceFromState(view({ die1: 3, die2: 4 }));
    restoreDice();
    expect(byId['self-dice-tray'].children.length).toBe(2);
    expect(firstDieTransform()).toBe('rotateX(0deg) rotateY(-90deg)'); // die 3

    // Switch to the debug view (tray DOM + lastRolls kept), then a fresh roll
    // of 1+1 arrives while it is hidden: only seedDiceFromState() runs.
    dismissDiceOverlays();
    seedDiceFromState(view({ die1: 1, die2: 1 }));

    // Switch back to the visual view.
    restoreDice();

    expect(byId['self-dice-tray'].children.length).toBe(2);
    expect(firstDieTransform()).toBe('rotateX(0deg) rotateY(0deg)'); // die 1, not the stale 3
  });
});
