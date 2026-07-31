/**
 * @module item-cp-badge-during-setup.test
 *
 * Regression test for bug report e6d9362ce9f016aa (game ms8r75ta-8kkqyo, seq
 * 34): "starting items don't show their corruption points in the interface."
 *
 * `appendItemCards` (used by the setup-phase renderers in render-board.ts —
 * item draft, character-deck-draft, site selection, character placement, deck
 * shuffle, initial draw) only painted the item's card image, unlike
 * `renderCharacterColumn` (the in-play company view), which wraps each item in
 * a `.item-card-wrap` with an `.item-cp-badge` showing its corruption points.
 * A starting item assigned during setup (e.g. Dagger of Westernesse, printed 1
 * CP) therefore never showed a CP badge until the character reached the
 * company view later in the game, making it look as if starting items carried
 * no corruption at all.
 *
 * Uses the hand-rolled DOM stub pattern of `item-cp-badge-in-play-modifier.test.ts`
 * (the package runs vitest in the default node environment, with no jsdom).
 */

import './test-dom-bootstrap.js'; // must precede the render-utils import (load-time window access)
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { loadCardPool, CardStatus, Alignment } from '@meccg/shared';
import type { PlayerView, CharacterInPlay, CardDefinitionId, CardInstanceId } from '@meccg/shared';
import { appendItemCards } from './render-utils.js';

const pool = loadCardPool();

const DAGGER_OF_WESTERNESSE = 'tw-206' as CardDefinitionId; // starting item, printed 1 CP
const ELF_STONE = 'tw-224' as CardDefinitionId; // starting item, printed 0 CP

const CHAR_INST = 'p1-98' as CardInstanceId;
const ITEM_INST = 'p1-102' as CardInstanceId;

// --- Minimal DOM stub -------------------------------------------------------

class StubEl {
  tagName: string;
  children: StubEl[] = [];
  className = '';
  alt = '';
  src = '';
  textContent = '';
  dataset: Record<string, string> = {};
  constructor(tagName: string) { this.tagName = tagName; }
  appendChild(child: StubEl): StubEl { this.children.push(child); return child; }
  addEventListener(): void { /* no-op */ }
  set innerHTML(v: string) { if (v === '') this.children = []; }
  get innerHTML(): string { return ''; }
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

/** A board view with no other in-play cards — just enough for `appendItemCards`. */
function boardView(): PlayerView {
  return {
    self: { cardsInPlay: [] },
    opponent: { cardsInPlay: [] },
  } as unknown as PlayerView;
}

/** The text of every item CP badge rendered inside an element. */
const cpBadgeTexts = (el: StubEl): string[] =>
  el.all().filter(e => e.className === 'item-cp-badge').map(e => e.textContent);

describe('setup-phase item rendering includes CP badges', () => {
  test('a starting item with printed corruption points shows its CP badge', () => {
    const char = {
      instanceId: CHAR_INST,
      items: [{ instanceId: ITEM_INST, definitionId: DAGGER_OF_WESTERNESSE, status: CardStatus.Untapped }],
    } as unknown as CharacterInPlay;

    const container = new StubEl('div');
    appendItemCards(container as unknown as HTMLElement, char, pool, boardView(), Alignment.Wizard);

    expect(cpBadgeTexts(container)).toEqual(['1 CP']);
  });

  test('a starting item with zero corruption points shows no CP badge', () => {
    const char = {
      instanceId: CHAR_INST,
      items: [{ instanceId: ITEM_INST, definitionId: ELF_STONE, status: CardStatus.Untapped }],
    } as unknown as CharacterInPlay;

    const container = new StubEl('div');
    appendItemCards(container as unknown as HTMLElement, char, pool, boardView(), Alignment.Wizard);

    expect(cpBadgeTexts(container)).toEqual([]);
  });
});
