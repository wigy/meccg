import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regression test for the combat "Attack" panel's placement.
 *
 * Bug report (game mw6rsio6-y1dtx5, seq 1625): when an attack started, the new
 * Attack panel was hidden under the opponent's MP score box whenever that deck
 * box was expanded. The panel was docked at the arena's top-left corner — the
 * same spot as the fixed opponent deck box, which grows downward when expanded
 * and is raised above other panels.
 *
 * The fix pins the panel to the viewport just right of the opponent deck box
 * (left: 1rem + width: 8.5rem) and below the HL chip. jsdom does not compute
 * layout, so the relationship is asserted from the stylesheet.
 */
describe('attack panel does not sit under the opponent deck box', () => {
  const css = readFileSync(resolve(__dirname, '../../public/style.css'), 'utf8');

  /** Extract the declaration block for a single CSS selector. */
  function ruleBlock(selector: string): string {
    const start = css.indexOf(`${selector} {`);
    expect(start, `selector ${selector} not found in style.css`).toBeGreaterThanOrEqual(0);
    return css.slice(start, css.indexOf('}', start) + 1);
  }

  /** Read a `rem` length declaration from a block. */
  function rem(block: string, prop: string): number {
    const m = new RegExp(`(?:^|[\\s;{])${prop}:\\s*(\\d+(?:\\.\\d+)?)rem\\s*;`).exec(block);
    expect(m, `${prop} rem value not found`).not.toBeNull();
    return Number(m![1]);
  }

  it('is fixed to the viewport, starting to the right of the opponent deck box', () => {
    const deckLeft = rem(ruleBlock('.deck-box'), 'left');
    const deckWidth = rem(ruleBlock('.deck-box'), 'width');
    const panel = ruleBlock('.attack-log-panel');
    expect(panel).toMatch(/position:\s*fixed\s*;/);
    const left = /left:\s*calc\((\d+(?:\.\d+)?)rem\s*\+\s*\d+px\)\s*;/.exec(panel);
    expect(left, '.attack-log-panel left must be calc(<deck box right>rem + <gap>px)').not.toBeNull();
    expect(Number(left![1])).toBeGreaterThanOrEqual(deckLeft + deckWidth);
  });

  it('starts below the HL chip at the top of the screen', () => {
    expect(rem(ruleBlock('.attack-log-panel'), 'top')).toBeGreaterThanOrEqual(3);
  });
});
