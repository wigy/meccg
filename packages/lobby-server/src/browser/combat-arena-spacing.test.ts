import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regression test for combat-arena vertical spacing.
 *
 * Bug report (game mr9jvlnw-2ldyce, seq 133): during a site auto-attack the site
 * card (rendered as the attacker on the top row) appeared jammed right up against
 * the defending characters on the bottom row — "site is too close to characters".
 *
 * Root cause: `.combat-arena` separates the attacker and defender rows with
 * `justify-content: space-between`, which only distributes *free* vertical space.
 * The arena declared `height: 100%`, but its parent `#visual-board` has only a
 * `min-height` (no definite `height`), so the percentage resolved to `auto`
 * (content height). With no free space, `space-between` was inert and the two rows
 * collapsed to within the 0.5rem `gap`.
 *
 * The fix gives `.combat-arena` its own definite `min-height` (a viewport unit),
 * so the flex column always has free space to push the rows apart regardless of
 * the parent's indefinite height. This test asserts that relationship directly
 * from the stylesheet so it cannot silently regress. jsdom does not compute
 * layout, so a rendered-geometry assertion is not possible here.
 */
describe('combat-arena spreads attacker and defender rows apart', () => {
  // `vitest run` executes with the package directory as cwd.
  const cssPath = resolve(process.cwd(), 'public/style.css');
  const css = readFileSync(cssPath, 'utf8');

  /** Extract the declaration block (between braces) for a single CSS selector. */
  function ruleBlock(selector: string): string {
    const start = css.indexOf(`${selector} {`);
    expect(start, `selector ${selector} not found in style.css`).toBeGreaterThanOrEqual(0);
    const end = css.indexOf('}', start);
    return css.slice(start, end + 1);
  }

  it('uses space-between to separate the rows', () => {
    const block = ruleBlock('.combat-arena');
    expect(block).toMatch(/justify-content:\s*space-between\s*;/);
  });

  it('declares a self-contained definite min-height so space-between has free space', () => {
    const block = ruleBlock('.combat-arena');
    const decl = /min-height:\s*([^;]+);/.exec(block);
    expect(decl, '.combat-arena must declare a min-height so it does not collapse to content height').not.toBeNull();

    // The value must be a viewport-relative (or otherwise definite) height, not a
    // percentage — a percentage would again resolve against the indefinite parent.
    const vh = /^(\d+(?:\.\d+)?)(vh|vmin|vmax)$/.exec(decl![1].trim());
    expect(vh, `min-height must be a definite viewport unit, got "${decl![1].trim()}"`).not.toBeNull();
    expect(Number(vh![1])).toBeGreaterThanOrEqual(50);
  });

  it('parent #visual-board provides no definite height, which is why the arena needs its own', () => {
    // Documents the reason the fix lives on `.combat-arena` and not on `height: 100%`.
    const block = ruleBlock('#visual-board');
    expect(block).not.toMatch(/[^-]height:\s*\d/);
  });
});
