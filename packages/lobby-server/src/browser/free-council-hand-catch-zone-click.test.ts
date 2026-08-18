import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regression test for bug report 428ae9e408de09b3 (game msyowa12-x5dnmx,
 * turn 26 free-council phase): "Some characters were not selectable because
 * the final hand cards were always in the foreground, so it was impossible
 * to complete the council rolls."
 *
 * Root cause: `#hand-arc:not(:empty)::before` is an always-present,
 * `pointer-events: auto` hover catch zone glued to the bottom of the
 * viewport (used so the mouse can reveal a fully-tucked hand without losing
 * :hover crossing the gaps between fanned cards). It inherits its stacking
 * position from its parent, #hand-arc, which sits at z-index: var(--z-board).
 *
 * Free Council forces the all-companies overview for the whole phase so
 * corruption-check controls for every character stay reachable (see
 * company-view.ts), and free-council-mode keeps the hand-arc visible there
 * (CoE 10.3.i lets either player react from hand while a check is pending).
 * `.company-block` never sets `position`, so it paints in normal flow, below
 * #hand-arc's fixed, z-board-stacked catch zone -- any character row that
 * lands within the catch zone's band at the bottom of the viewport had its
 * clicks swallowed by that invisible strip instead of reaching the
 * corruption-check button underneath.
 *
 * The fix disables the catch zone's pointer-events while free-council-mode
 * is active. The visible fanned cards themselves remain directly
 * hoverable/clickable (`.hand-arc-cards > *` keeps `pointer-events: auto`),
 * so reactive hand plays are still reachable -- only the invisible
 * full-width strip stops intercepting clicks.
 *
 * jsdom does not compute layout or stacking order, so (per the established
 * pattern in combat-hand-catch-zone-click.test.ts) this asserts directly
 * against the stylesheet text.
 */
describe('free-council hand-arc catch zone does not block corruption-check clicks', () => {
  const cssPath = resolve(__dirname, '../../public/style.css');
  const css = readFileSync(cssPath, 'utf8');

  /** Extract the declaration block (between braces) for a single CSS selector list. */
  function ruleBlock(selector: string): string {
    const start = css.indexOf(`${selector} {`);
    expect(start, `selector ${selector} not found in style.css`).toBeGreaterThanOrEqual(0);
    const end = css.indexOf('}', start);
    return css.slice(start, end + 1);
  }

  it('disables the catch zone while free-council-mode is active', () => {
    const block = ruleBlock('.free-council-mode #hand-arc:not(:empty)::before');
    expect(block).toMatch(/pointer-events:\s*none\s*;/);
  });

  it('leaves the visible fanned cards clickable', () => {
    const block = ruleBlock('.hand-arc-cards > *');
    expect(block).toMatch(/pointer-events:\s*auto\s*;/);
  });

  it('keeps the base catch zone auto (only free-council-mode suppresses it)', () => {
    const block = ruleBlock('#hand-arc:not(:empty)::before');
    expect(block).toMatch(/pointer-events:\s*auto\s*;/);
  });
});
