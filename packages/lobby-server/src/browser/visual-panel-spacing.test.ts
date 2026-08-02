import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regression test for the visual-panel action button spacing.
 *
 * Bug report (game msbx7hzq-ujy1o8, seq ~44): during the movement/hazard
 * phase's draw-cards step, the panel shows the primary "Draw" button
 * (`#pass-btn`) plus a secondary "Pass Draw" button (`render-instructions.ts`,
 * `renderPassButton()`) stacked directly above it via `panel?.appendChild(...)`.
 * With only 0.5rem between two same-size buttons, clicking "Draw" repeatedly
 * made it easy to overshoot onto "Pass Draw" and skip the rest of the step —
 * "tous les boutons de validation les uns sur les autres" ("all the
 * validation buttons on top of each other").
 *
 * The fix widens the gap in `#visual-panel` so the buttons are not jammed
 * together. jsdom does not compute layout, so this asserts the gap value
 * directly from the stylesheet.
 */
describe('#visual-panel gives stacked action buttons enough room apart', () => {
  // Resolved from this file, not from the working directory: `vitest run` from
  // the repository root looks for `<root>/public/style.css` and the suite dies
  // on ENOENT before a single assertion runs.
  const cssPath = resolve(__dirname, '../../public/style.css');
  const css = readFileSync(cssPath, 'utf8');

  function ruleBlock(selector: string): string {
    const start = css.indexOf(`${selector} {`);
    expect(start, `selector ${selector} not found in style.css`).toBeGreaterThanOrEqual(0);
    const end = css.indexOf('}', start);
    return css.slice(start, end + 1);
  }

  it('declares a gap of at least 1rem between stacked buttons', () => {
    const block = ruleBlock('#visual-panel');
    const decl = /gap:\s*([^;]+);/.exec(block);
    expect(decl, '#visual-panel must declare a gap').not.toBeNull();

    const rem = /^(\d+(?:\.\d+)?)rem$/.exec(decl![1].trim());
    expect(rem, `gap must be a rem value, got "${decl![1].trim()}"`).not.toBeNull();
    expect(Number(rem![1])).toBeGreaterThanOrEqual(1);
  });
});
