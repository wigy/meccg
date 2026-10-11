/**
 * @module log-card-name-hover-preview.test
 *
 * Regression test for improvement report 30e54e2012bffd64 (game
 * mv2oilo0-ymdvqj, seq 612): "for the rolling log text, when a card is
 * listed and underlined, it would be nice to be able to hover or click to
 * display the card".
 *
 * The text-log panel is `pointer-events: none` and sits outside
 * `#visual-view`, so its underlined `.card-name` spans never reached the
 * delegated hover listener in `setupCardPreview`. `installLogCardPreview`
 * now wires the panel so hovering a card name fills `#card-preview`.
 */

import './test-dom-bootstrap.js';
import { describe, test, expect } from 'vitest';
import { loadCardPool } from '@meccg/shared';
import { installLogCardPreview } from './render-card-preview.js';

const pool = loadCardPool();

/** Minimal element stub: enough DOM for `buildCardPreviewInfo` and delegation. */
class StubEl {
  tagName: string;
  children: StubEl[] = [];
  className = '';
  textContent = '';
  alt = '';
  src = '';
  private _innerHTML = '';
  dataset: Record<string, string> = {};
  listeners: Record<string, ((e: unknown) => void)[]> = {};
  constructor(tagName: string) { this.tagName = tagName; }
  appendChild(child: StubEl): StubEl { this.children.push(child); return child; }
  get innerHTML(): string { return this._innerHTML; }
  set innerHTML(value: string) { this._innerHTML = value; this.children = []; }
  addEventListener(type: string, handler: (e: unknown) => void): void {
    (this.listeners[type] ??= []).push(handler);
  }
  closest(selector: string): StubEl | null {
    return selector.startsWith('.card-name') && this.className === 'card-name' && this.dataset.cardId ? this : null;
  }
  dispatch(type: string, target: StubEl): void {
    for (const h of this.listeners[type] ?? []) h({ target });
  }
  all(): StubEl[] { return [this, ...this.children.flatMap(c => c.all())]; }
}

(globalThis as unknown as { document: unknown }).document = {
  createElement: (tag: string) => new StubEl(tag),
};

function setup(): { panel: StubEl; preview: StubEl; cardName: StubEl; plainText: StubEl } {
  const panel = new StubEl('div');
  const preview = new StubEl('div');
  const cardName = new StubEl('span');
  cardName.className = 'card-name';
  cardName.dataset.cardId = 'tw-67'; // Muster Disperses
  const plainText = new StubEl('div');
  plainText.className = 'toast';
  installLogCardPreview(panel as unknown as HTMLElement, preview as unknown as HTMLElement, pool);
  return { panel, preview, cardName, plainText };
}

describe('text log — card name hover preview', () => {
  test('hovering an underlined card name shows the card in #card-preview', () => {
    const { panel, preview, cardName } = setup();
    panel.dispatch('mouseover', cardName);
    const nameEl = preview.all().find(el => el.className === 'card-preview-name');
    expect(nameEl?.textContent).toBe(pool['tw-67'].name);
  });

  test('leaving the card name clears the preview', () => {
    const { panel, preview, cardName } = setup();
    panel.dispatch('mouseover', cardName);
    panel.dispatch('mouseout', cardName);
    expect(preview.children.length).toBe(0);
  });

  test('hovering plain log text does not touch the preview', () => {
    const { panel, preview, plainText } = setup();
    panel.dispatch('mouseover', plainText);
    expect(preview.children.length).toBe(0);
  });
});
