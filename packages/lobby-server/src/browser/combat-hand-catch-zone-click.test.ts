import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regression test for bug report 90dbe65d3290522b (game msgpp1fw-rifeyo, seq
 * 427): "I could not target my tapped Ringwraith with this card because the
 * cards in my hand were always in the way". The player wanted to play The
 * Tormented Earth (as-102), which the engine correctly offered as a legal
 * `cancel-attack` action targeting the defending Ringwraith -- but no click
 * landed on the character.
 *
 * Root cause: `#hand-arc:not(:empty)::before` is an always-present, 28vh-tall,
 * `pointer-events: auto` hover catch zone glued to the very bottom of the
 * viewport (used so the mouse can reveal a fully-tucked hand and not lose
 * :hover crossing the gaps between fanned cards). It inherits its stacking
 * position from its parent, #hand-arc.
 *
 * `.combat-active #hand-arc` used to set `z-index: var(--z-hover)`
 * unconditionally -- not just on hover/peek -- lifting the catch zone above
 * `.combat-arena` (z-index: var(--z-panel)) even while the hand sat fully
 * tucked off-screen. Any combat-arena target near the bottom of the viewport
 * (the defender row, pushed down by `.combat-arena`'s
 * `justify-content: space-between`) had its clicks swallowed by that
 * invisible strip instead of reaching the character underneath.
 *
 * The fix raises the catch zone's z-index above the combat arena only while
 * the hand is actually hovered/peeked, mirroring the non-combat rule, so the
 * idle catch zone stays below the arena and arena clicks land normally.
 *
 * jsdom does not compute layout or stacking order, so (per the established
 * pattern in combat-arena-spacing.test.ts) this asserts directly against the
 * stylesheet text.
 */
describe('combat hand-arc catch zone does not block combat-arena clicks while idle', () => {
  const cssPath = resolve(__dirname, '../../public/style.css');
  const css = readFileSync(cssPath, 'utf8');

  /** Extract the declaration block (between braces) for a single CSS selector list. */
  function ruleBlock(selector: string): string {
    const start = css.indexOf(`${selector} {`);
    expect(start, `selector ${selector} not found in style.css`).toBeGreaterThanOrEqual(0);
    const end = css.indexOf('}', start);
    return css.slice(start, end + 1);
  }

  it('does not raise the idle #hand-arc z-index above the combat arena', () => {
    const block = ruleBlock('.combat-active #hand-arc');
    expect(block).not.toMatch(/z-index/);
  });

  it('raises #hand-arc z-index above the combat arena only on hover/peek', () => {
    const block = ruleBlock('.combat-active #hand-arc:hover,\n.combat-active #hand-arc.kbd-peek');
    expect(block).toMatch(/z-index:\s*var\(--z-hover\)\s*;/);
  });

  it('combat arena outranks the idle (non-raised) hand-arc z-index', () => {
    const arenaBlock = ruleBlock('.combat-arena');
    expect(arenaBlock).toMatch(/z-index:\s*var\(--z-panel\)\s*;/);

    const baseHandArcBlock = ruleBlock('#hand-arc, #opponent-arc');
    expect(baseHandArcBlock).toMatch(/z-index:\s*var\(--z-board\)\s*;/);

    const rootBlock = ruleBlock(':root');
    const panelZ = Number(/--z-panel:\s*(\d+)/.exec(rootBlock)![1]);
    const boardZ = Number(/--z-board:\s*(\d+)/.exec(rootBlock)![1]);
    expect(panelZ).toBeGreaterThan(boardZ);
  });
});
