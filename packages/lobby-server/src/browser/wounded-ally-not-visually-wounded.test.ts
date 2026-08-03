/**
 * @module wounded-ally-not-visually-wounded.test
 *
 * Regression test for bug report 91fb995dbf2cc9a1 (game msd2n90b-jidxrb, seq
 * 305): "gollum not tapped after fight and not wounded after loosing."
 *
 * The engine correctly wounds an ally that loses a strike (CoE 2.V.2.2:
 * allies face strikes and are wounded/tapped like characters) — the ally's
 * `status` becomes `CardStatus.Inverted`. But `renderCharacterColumn`'s
 * attachment loop (items/allies/hazards shown under their bearer) only ever
 * checked `CardStatus.Tapped` on the attachment element, never
 * `CardStatus.Inverted`, so a wounded ally rendered identically to an
 * untapped one — no rotation, no visual difference at all. The `.company-card
 * --wounded` CSS class (rotate 180deg) already existed but nothing applied
 * it to a wounded ally.
 */

import './test-dom-bootstrap.js'; // must precede the render-utils import (load-time window access)
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { loadCardPool, CardStatus, ARAGORN } from '@meccg/shared';
import type { CharacterInPlay, CardDefinitionId, CardInstanceId } from '@meccg/shared';
import { renderCharacterColumn } from './company-character.js';

const pool = loadCardPool();

const GOLLUM = 'tw-246' as CardDefinitionId; // hero-resource-ally, faces strikes like a character (CoE 2.V.2.2)

const HOST_CHAR_INST = 'p1-1' as CardInstanceId;
const ALLY_INST = 'p1-2' as CardInstanceId;

// --- Minimal DOM stub with a working classList ------------------------------

class StubEl {
  tagName: string;
  children: StubEl[] = [];
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  alt = '';
  src = '';
  textContent = '';
  private classes = new Set<string>();
  constructor(tagName: string) { this.tagName = tagName; }
  appendChild(child: StubEl): StubEl { this.children.push(child); return child; }
  addEventListener(): void { /* no-op */ }
  set innerHTML(v: string) { if (v === '') this.children = []; }
  get innerHTML(): string { return ''; }
  set className(v: string) { this.classes = new Set(v.split(' ').filter(Boolean)); }
  get className(): string { return [...this.classes].join(' '); }
  get classList(): { add: (...cls: string[]) => void; contains: (cls: string) => boolean } {
    return {
      add: (...cls: string[]) => cls.forEach(c => this.classes.add(c)),
      contains: (cls: string) => this.classes.has(cls),
    };
  }
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

const allyElement = (col: StubEl): StubEl | undefined =>
  col.all().find(e => e.dataset.instanceId === (ALLY_INST as string));

describe('a wounded ally renders with the wounded transform', () => {
  test('an ally inverted (wounded) by a lost strike gets company-card--wounded', () => {
    const char = {
      instanceId: HOST_CHAR_INST,
      definitionId: ARAGORN,
      status: CardStatus.Untapped,
      items: [],
      hazards: [],
      followers: [],
      allies: [{ instanceId: ALLY_INST, definitionId: GOLLUM, status: CardStatus.Inverted }],
      effectiveStats: { prowess: 0, body: 0, directInfluence: 0, corruptionPoints: 0 },
    } as unknown as CharacterInPlay;

    const col = renderCharacterColumn(char, pool, true) as unknown as StubEl;
    const ally = allyElement(col);

    expect(ally).toBeDefined();
    expect(ally!.classList.contains('company-card--wounded')).toBe(true);
    expect(ally!.classList.contains('company-card--tapped')).toBe(false);
  });

  test('an untapped ally gets neither transform class', () => {
    const char = {
      instanceId: HOST_CHAR_INST,
      definitionId: ARAGORN,
      status: CardStatus.Untapped,
      items: [],
      hazards: [],
      followers: [],
      allies: [{ instanceId: ALLY_INST, definitionId: GOLLUM, status: CardStatus.Untapped }],
      effectiveStats: { prowess: 0, body: 0, directInfluence: 0, corruptionPoints: 0 },
    } as unknown as CharacterInPlay;

    const col = renderCharacterColumn(char, pool, true) as unknown as StubEl;
    const ally = allyElement(col);

    expect(ally).toBeDefined();
    expect(ally!.classList.contains('company-card--wounded')).toBe(false);
    expect(ally!.classList.contains('company-card--tapped')).toBe(false);
  });
});
