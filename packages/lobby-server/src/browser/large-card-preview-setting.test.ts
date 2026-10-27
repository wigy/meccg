/**
 * @module large-card-preview-setting.test
 *
 * Regression test for improvement report 186fb2fed67c4ae8 (game
 * mvkp0sg2-188sn7, seq 584): on a laptop screen the hover card preview is
 * too small to read the card text.
 *
 * The Settings dialog now has a "Large card preview" toggle. When on,
 * `applyLargeCardPreview` puts the `large-card-preview` class on the body,
 * and the stylesheet grows the `#card-preview` image to fill the available
 * screen height.
 */

import './test-dom-bootstrap.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, test, expect } from 'vitest';
import { applyLargeCardPreview } from './render-card-preview.js';

const publicDir = resolve(__dirname, '../../public');

describe('Large card preview setting', () => {
  test('toggles the large-card-preview class on the root element', () => {
    const classes = new Set<string>();
    const root = {
      classList: {
        toggle: (name: string, force?: boolean) => {
          if (force ?? !classes.has(name)) classes.add(name);
          else classes.delete(name);
          return classes.has(name);
        },
      } as unknown as DOMTokenList,
    };

    applyLargeCardPreview(root, true);
    expect(classes.has('large-card-preview')).toBe(true);
    applyLargeCardPreview(root, false);
    expect(classes.has('large-card-preview')).toBe(false);
  });

  test('settings dialog offers the toggle and the stylesheet enlarges the preview', () => {
    const html = readFileSync(resolve(publicDir, 'index.html'), 'utf8');
    expect(html).toContain('id="large-preview-toggle"');

    const css = readFileSync(resolve(publicDir, 'style.css'), 'utf8');
    expect(css).toMatch(/body\.large-card-preview #card-preview \.card-preview-info img\s*\{[^}]*width: var\(--large-preview-width\)/);
  });
});
