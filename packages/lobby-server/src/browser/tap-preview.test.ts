/**
 * @module tap-preview.test
 *
 * Regression test: "small detail, but it would help ... that a character
 * first taps, than does the action" — the board stayed visually untapped
 * through the whole dice-roll animation of a tap-to-fight strike, because
 * the client only applied the new tapped status once the deferred `state`
 * message arrived after the roll (see game-connection.ts's 'effect' case
 * and effect-log-buffer.ts's module doc for why `state` is held back until
 * the animation starts).
 *
 * `applyTapPreview` lets the client apply just that one character's tapped
 * visual the instant the `dice-roll` effect carrying `tappedCharacterId`
 * arrives — before `rollDice()` even starts. This exercises it directly
 * against a hand-rolled DOM stub (the package runs vitest in the default
 * node environment, with no jsdom) covering both places a character can
 * render: the board (`company-character.ts`, `[data-instance-id]`) and the
 * combat overlay (`combat-view.ts`, `[data-combat-char-id]`).
 */

import { describe, test, expect } from 'vitest';
import type { CardInstanceId } from '@meccg/shared';
import { applyTapPreview } from './tap-preview.js';

class StubEl {
  tagName: string;
  children: StubEl[] = [];
  parent: StubEl | null = null;
  dataset: Record<string, string> = {};
  private classes = new Set<string>();
  classList = {
    add: (c: string) => { this.classes.add(c); },
    contains: (c: string) => this.classes.has(c),
  };
  constructor(tagName = 'div') { this.tagName = tagName; }
  appendChild(child: StubEl): StubEl {
    child.parent = this;
    this.children.push(child);
    return child;
  }
  all(): StubEl[] { return [this, ...this.children.flatMap(c => c.all())]; }
  matches(selector: string): boolean {
    if (selector.startsWith('.')) return this.classes.has(selector.slice(1));
    const attr = /^\[data-([\w-]+)="([^"]*)"\]$/.exec(selector);
    if (attr) {
      const key = attr[1].replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
      return this.dataset[key] === attr[2];
    }
    return false;
  }
  querySelectorAll(selector: string): StubEl[] {
    return this.children.flatMap(c => c.all()).filter(el => el.matches(selector));
  }
  querySelector(selector: string): StubEl | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  closest(selector: string): StubEl | null {
    if (this.matches(selector)) return this;
    return this.parent?.closest(selector) ?? null;
  }
}

const CHAR_ID = 'p1-5' as CardInstanceId;
const OTHER_ID = 'p1-6' as CardInstanceId;

/** Board rendering of a character, mirroring company-character.ts's wrap > inner > img. */
function buildBoardCharacter(instanceId: string): { root: StubEl; wrap: StubEl; inner: StubEl } {
  const wrap = new StubEl();
  wrap.classList.add('character-card-wrap');
  const inner = new StubEl();
  inner.classList.add('character-card-inner');
  const img = new StubEl('img');
  img.dataset.instanceId = instanceId;
  inner.appendChild(img);
  wrap.appendChild(inner);
  return { root: wrap, wrap, inner };
}

/** Combat-overlay rendering of a character, mirroring combat-view.ts's col > wrap > inner > img. */
function buildCombatCharacterColumn(instanceId: string): { root: StubEl; wrap: StubEl; inner: StubEl } {
  const col = new StubEl();
  col.dataset.combatCharId = instanceId;
  const wrap = new StubEl();
  wrap.classList.add('character-card-wrap');
  const inner = new StubEl();
  inner.classList.add('character-card-inner');
  const img = new StubEl('img');
  img.dataset.instanceId = instanceId;
  inner.appendChild(img);
  wrap.appendChild(inner);
  col.appendChild(wrap);
  return { root: col, wrap, inner };
}

function installDocument(...roots: StubEl[]): void {
  const document = new StubEl('document');
  for (const root of roots) document.appendChild(root);
  (globalThis as unknown as { document: unknown }).document = document;
}

describe('applyTapPreview', () => {
  test('taps the board card matching the instance ID', () => {
    const board = buildBoardCharacter(CHAR_ID as string);
    installDocument(board.root);

    applyTapPreview(CHAR_ID);

    expect(board.wrap.classList.contains('character-card-wrap--tapped')).toBe(true);
    expect(board.inner.classList.contains('character-card-inner--tapped')).toBe(true);
  });

  test('taps the combat-overlay card matching the instance ID', () => {
    const combat = buildCombatCharacterColumn(CHAR_ID as string);
    installDocument(combat.root);

    applyTapPreview(CHAR_ID);

    expect(combat.wrap.classList.contains('character-card-wrap--tapped')).toBe(true);
    expect(combat.inner.classList.contains('character-card-inner--tapped')).toBe(true);
  });

  test('tapping both board and combat renderings of the same character at once is harmless', () => {
    const board = buildBoardCharacter(CHAR_ID as string);
    const combat = buildCombatCharacterColumn(CHAR_ID as string);
    installDocument(board.root, combat.root);

    applyTapPreview(CHAR_ID);

    expect(board.wrap.classList.contains('character-card-wrap--tapped')).toBe(true);
    expect(combat.wrap.classList.contains('character-card-wrap--tapped')).toBe(true);
  });

  test('does not tap an unrelated character', () => {
    const board = buildBoardCharacter(CHAR_ID as string);
    const other = buildBoardCharacter(OTHER_ID as string);
    installDocument(board.root, other.root);

    applyTapPreview(CHAR_ID);

    expect(board.wrap.classList.contains('character-card-wrap--tapped')).toBe(true);
    expect(other.wrap.classList.contains('character-card-wrap--tapped')).toBe(false);
  });
});
