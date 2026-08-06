/**
 * @module tooltip-menu-viewport-clamp.test
 *
 * Regression test for bug report b46b2f0bf6ea7387 (game msgipmcq-i19x9h, seq
 * 20, tutorial step "org-di-annalena"): the guided tutorial gates legal
 * actions down to a single "Move under DI of Glorfindel II" choice, which
 * `showCharacterActionTooltip` surfaces via `showTooltipMenu`'s default
 * placement. That placement computed `left`/`top` purely from the anchor's
 * own bounding rect, with no clamp against the viewport (unlike the `auto`
 * placement branch, which already clamped) — a character card sitting near
 * the right edge of a narrow tablet screen pushed the whole menu off-screen,
 * leaving its buttons untappable. The player reported being able to click
 * only the always-visible company-view-toggle button and never advancing.
 *
 * `showTooltipMenu` now clamps the rendered menu's left/top into the
 * viewport for every placement, not just `auto`.
 *
 * Uses a tiny hand-rolled DOM stub (the package runs vitest in the default
 * node environment, with no jsdom), matching the pattern in
 * keyboard-shortcuts-spectator-hints.test.ts.
 */

import './test-dom-bootstrap.js'; // must precede the tooltip-menu import (load-time window access)
import { describe, test, expect } from 'vitest';
import { showTooltipMenu } from './tooltip-menu.js';

class StubEl {
  style: Record<string, string> = {};
  className = '';
  textContent = '';
  children: StubEl[] = [];
  onclick: (() => void) | null = null;
  /** Simulated rendered box; overridden per-instance where the test cares (the anchor). */
  rect = { left: 0, top: 0, width: 160, height: 80 };
  addEventListener(): void { /* no-op */ }
  appendChild(child: StubEl): StubEl {
    this.children.push(child);
    return child;
  }
  getBoundingClientRect() {
    const left = this.style.left ? parseFloat(this.style.left) : this.rect.left;
    const top = this.style.top ? parseFloat(this.style.top) : this.rect.top;
    return { left, top, width: this.rect.width, height: this.rect.height, bottom: top + this.rect.height };
  }
}

function installFreshDom(): StubEl {
  const bodyEl = new StubEl();
  (globalThis as unknown as { document: unknown }).document = {
    body: bodyEl,
    createElement: () => new StubEl(),
    querySelector: () => null,
  };
  (globalThis as unknown as { window: unknown }).window = { innerWidth: 768, innerHeight: 1024 };
  return bodyEl;
}

describe('showTooltipMenu clamps the default placement into the viewport', () => {
  test('a menu anchored near the right edge of a narrow screen is pulled back on-screen', () => {
    const bodyEl = installFreshDom();
    // A character card packed against the right edge of a 768px-wide tablet.
    const anchor = new StubEl();
    anchor.rect = { left: 700, top: 200, width: 100, height: 140 };

    showTooltipMenu(anchor as unknown as HTMLElement, [{ label: 'Move under DI of Glorfindel II', onClick: () => { /* no-op */ } }]);

    const tooltip = bodyEl.children.find(c => c.className === 'char-action-tooltip')!;
    expect(tooltip).toBeDefined();
    // Unclamped this would be left=750 (anchor's horizontal center), which
    // plus the menu's own 160px width overflows the 768px-wide viewport.
    const left = parseFloat(tooltip.style.left);
    expect(left + tooltip.rect.width).toBeLessThanOrEqual(768);
    expect(left).toBe(768 - tooltip.rect.width - 4);
  });

  test('a menu anchored comfortably on-screen keeps its natural position', () => {
    const bodyEl = installFreshDom();
    const anchor = new StubEl();
    anchor.rect = { left: 100, top: 200, width: 100, height: 140 };

    showTooltipMenu(anchor as unknown as HTMLElement, [{ label: 'Move under DI of Glorfindel II', onClick: () => { /* no-op */ } }]);

    const tooltip = bodyEl.children.find(c => c.className === 'char-action-tooltip')!;
    // Natural placement: left + width/2 = 150, well within the viewport.
    expect(tooltip.style.left).toBe('150px');
  });
});
