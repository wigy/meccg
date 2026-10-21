/**
 * @module tapped-character-stats-badge.test
 *
 * Regression test for "when a character has 2 resources under him, his
 * prowess/body is no longer visible".
 *
 * A tapped character's card is rotated 90°, which moves the prowess/body badge
 * to the bottom-left of the sideways card, at ≈0.86 × card height. The
 * attachment row under the character is pulled up by the wrap's negative
 * `margin-bottom` and drawn above the card. A single upright attachment is
 * narrow enough to leave the badge uncovered, but two or more span the whole
 * sideways card and hide it.
 *
 * The fix: every tapped wrap with attachments (main characters, followers and
 * combat columns alike, via `applyCharacterStatusClasses`) carries `character-card-wrap--has-attachments`, and
 * that rule collapses less than the ≈14% empty space below the sideways card,
 * so the attachment row always starts below the badge.
 *
 * jsdom-free: uses a hand-rolled DOM stub, and checks the CSS rule from the
 * stylesheet text since no layout is computed under vitest.
 */

import './test-dom-bootstrap.js'; // must precede the browser-module imports (load-time window access)
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadCardPool, CardStatus, ARAGORN, BILBO, GLAMDRING, DAGGER_OF_WESTERNESSE } from '@meccg/shared';
import type { CharacterInPlay, CardInstanceId, CardDefinitionId } from '@meccg/shared';
import { renderCharacterColumn, applyCharacterStatusClasses } from './company-character.js';

const pool = loadCardPool();

// --- Minimal DOM stub -------------------------------------------------------

/** Element stub whose `classList` writes through to `className`. */
class StubEl {
  tagName: string;
  children: StubEl[] = [];
  className = '';
  alt = '';
  src = '';
  title = '';
  textContent = '';
  dataset: Record<string, string> = {};
  style: Record<string, unknown> = { setProperty: () => { /* no-op */ } };
  classList = {
    add: (...cs: string[]) => { const s = this.classes(); for (const c of cs) s.add(c); this.className = [...s].join(' '); },
    remove: (...cs: string[]) => { const s = this.classes(); for (const c of cs) s.delete(c); this.className = [...s].join(' '); },
    contains: (c: string) => this.classes().has(c),
  };
  constructor(tagName: string) { this.tagName = tagName; }
  private classes(): Set<string> { return new Set(this.className.split(/\s+/).filter(Boolean)); }
  appendChild(child: StubEl): StubEl { this.children.push(child); return child; }
  addEventListener(): void { /* no-op */ }
  setAttribute(): void { /* no-op */ }
  /** Depth-first collect self + every descendant. */
  all(): StubEl[] { return [this, ...this.children.flatMap(c => c.all())]; }
}

beforeEach(() => {
  (globalThis as unknown as { document: unknown }).document = {
    createElement: (tag: string) => new StubEl(tag),
    getElementById: () => null,
  };
});

afterEach(() => {
  delete (globalThis as unknown as { document?: unknown }).document;
});

// --- Fixtures ---------------------------------------------------------------

/** Build a character with the given status, items and followers. */
function character(
  instanceId: string,
  definitionId: CardDefinitionId,
  status: CardStatus,
  itemDefs: CardDefinitionId[],
  followers: string[] = [],
): CharacterInPlay {
  return {
    instanceId: instanceId as CardInstanceId,
    definitionId,
    status,
    items: itemDefs.map((d, i) => ({ instanceId: `${instanceId}-item-${i}` as CardInstanceId, definitionId: d, status: CardStatus.Untapped })),
    allies: [],
    hazards: [],
    followers: followers as CardInstanceId[],
    effectiveStats: { prowess: 6, body: 8, directInfluence: 3, corruptionPoints: 0 },
  } as unknown as CharacterInPlay;
}

/** All character wraps (main + followers) rendered under `root`. */
function wraps(root: StubEl): StubEl[] {
  return root.all().filter(e => e.classList.contains('character-card-wrap'));
}

const TWO_ITEMS = [GLAMDRING, DAGGER_OF_WESTERNESSE];

describe('tapped character with attachments keeps its prowess/body badge visible', () => {
  test('a tapped main character with two items marks its wrap as having attachments', () => {
    const aragorn = character('p1-1', ARAGORN, CardStatus.Tapped, TWO_ITEMS);
    const col = renderCharacterColumn(aragorn, pool, false) as unknown as StubEl;
    const [wrap] = wraps(col);
    expect(wrap.classList.contains('character-card-wrap--tapped')).toBe(true);
    expect(wrap.classList.contains('character-card-wrap--has-attachments')).toBe(true);
  });

  test('a tapped follower with two items marks its own wrap as having attachments', () => {
    const aragorn = character('p1-1', ARAGORN, CardStatus.Untapped, [], ['p1-2']);
    const bilbo = character('p1-2', BILBO, CardStatus.Tapped, TWO_ITEMS);
    const charMap = { 'p1-1': aragorn, 'p1-2': bilbo };
    const col = renderCharacterColumn(aragorn, pool, false, charMap) as unknown as StubEl;
    const followerWrap = wraps(col)[1];
    expect(followerWrap).toBeDefined();
    expect(followerWrap.classList.contains('character-card-wrap--tapped')).toBe(true);
    expect(followerWrap.classList.contains('character-card-wrap--has-attachments')).toBe(true);
  });

  test('a tapped character without attachments keeps the full collapse', () => {
    const aragorn = character('p1-1', ARAGORN, CardStatus.Tapped, []);
    const col = renderCharacterColumn(aragorn, pool, false) as unknown as StubEl;
    const [wrap] = wraps(col);
    expect(wrap.classList.contains('character-card-wrap--tapped')).toBe(true);
    expect(wrap.classList.contains('character-card-wrap--has-attachments')).toBe(false);
  });

  test('the shared status styling (also used by the combat arena) marks a tapped wrap with attachments', () => {
    const [wrap, inner, img] = ['div', 'div', 'img'].map(t => new StubEl(t));
    applyCharacterStatusClasses(CardStatus.Tapped, true, wrap as unknown as HTMLElement, inner as unknown as HTMLElement, img as unknown as HTMLElement);
    expect(wrap.classList.contains('character-card-wrap--tapped')).toBe(true);
    expect(wrap.classList.contains('character-card-wrap--has-attachments')).toBe(true);
    expect(inner.classList.contains('character-card-inner--tapped')).toBe(true);
  });

  test('the has-attachments collapse stays inside the empty space below the sideways card', () => {
    const css = readFileSync(resolve(__dirname, '../../public/style.css'), 'utf8');
    const selector = '.character-card-wrap--tapped.character-card-wrap--has-attachments {';
    const start = css.indexOf(selector);
    expect(start, 'tapped has-attachments rule not found in style.css').toBeGreaterThanOrEqual(0);
    const block = css.slice(start, css.indexOf('}', start) + 1);
    const decl = /margin-bottom:\s*calc\([^;]*\*\s*(-?\d+(?:\.\d+)?)\)\s*;/.exec(block);
    expect(decl, 'margin-bottom multiplier not found').not.toBeNull();
    // Card aspect 420/587: the sideways card leaves (1 - 420/587) / 2 ≈ 0.142 of
    // the card height empty below it. Collapsing more pulls the attachment row
    // over the badge.
    const emptyBelow = (1 - 420 / 587) / 2;
    expect(Number(decl![1])).toBeGreaterThanOrEqual(-emptyBelow);
    expect(Number(decl![1])).toBeLessThan(0);
  });
});
