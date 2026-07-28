import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regression test for the on-guard / site-attachment stacking order.
 *
 * Bug report (game mquqgy3v-pina1b, seq 115): an on-guard card (Gwaihir) was
 * placed on a company whose site (Ettenmoors) had a Hidden Haven bound to it
 * via `attachedToSite`. The on-guard card is rendered overlapping the site,
 * offset downward over the `site-attachments` strip. Because `.on-guard-wrapper`
 * established no stacking context, its on-guard cards (z-index 1) tied with the
 * `.site-attachments` strip (z-index `--z-attachment` = 1); the later DOM sibling
 * (the attachments strip) therefore painted on top, so the on-guard card appeared
 * UNDER the cards bound to the site instead of on top of them.
 *
 * The fix gives `.on-guard-wrapper` a z-index above `--z-attachment`, lifting the
 * whole on-guard overlay above the site-attachments strip. This test asserts that
 * stacking relationship directly from the stylesheet so it cannot silently regress.
 */
describe('on-guard cards stack above site-attachments', () => {
  // Resolved from this file, not from the working directory: `vitest run` from
  // the repository root looks for `<root>/public/style.css` and the suite dies
  // on ENOENT before a single assertion runs.
  const cssPath = resolve(__dirname, '../../public/style.css');
  const css = readFileSync(cssPath, 'utf8');

  /** Extract the declaration block (between braces) for a single CSS selector. */
  function ruleBlock(selector: string): string {
    const start = css.indexOf(`${selector} {`);
    expect(start, `selector ${selector} not found in style.css`).toBeGreaterThanOrEqual(0);
    const end = css.indexOf('}', start);
    return css.slice(start, end + 1);
  }

  /** Resolve a small set of `--z-*` custom properties declared in :root. */
  function resolveVar(name: string): number {
    const m = new RegExp(`--${name}:\\s*(\\d+)`).exec(css);
    expect(m, `--${name} not declared`).not.toBeNull();
    return Number(m![1]);
  }

  /** Resolve a `z-index` value that is either a literal, `var(--z-*)`, or `calc(var(--z-*) +/- n)`. */
  function resolveZIndex(block: string): number {
    const decl = /z-index:\s*([^;]+);/.exec(block);
    expect(decl, 'z-index declaration missing').not.toBeNull();
    const value = decl![1].trim();

    const literal = /^(\d+)$/.exec(value);
    if (literal) return Number(literal[1]);

    const plainVar = /^var\(--([\w-]+)\)$/.exec(value);
    if (plainVar) return resolveVar(plainVar[1]);

    const calcVar = /^calc\(\s*var\(--([\w-]+)\)\s*([+-])\s*(\d+)\s*\)$/.exec(value);
    if (calcVar) {
      const base = resolveVar(calcVar[1]);
      const offset = Number(calcVar[3]);
      return calcVar[2] === '+' ? base + offset : base - offset;
    }

    throw new Error(`Unsupported z-index expression: ${value}`);
  }

  it('renders the on-guard wrapper above the site-attachments strip', () => {
    const wrapperZ = resolveZIndex(ruleBlock('.on-guard-wrapper'));
    const attachmentsZ = resolveZIndex(ruleBlock('.site-attachments'));
    expect(wrapperZ).toBeGreaterThan(attachmentsZ);
  });
});
