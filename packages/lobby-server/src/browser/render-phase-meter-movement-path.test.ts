/**
 * @module render-phase-meter-movement-path.test
 *
 * Regression test for bug report ca4af32d6b7827ae (game msm2xfv5-19l1o2, seq
 * 185): Adrazar's company used Starter Movement from Lórien (region "Wold &
 * Foothills") to Edhellond (region "Anfalas"). The opponent-facing movement
 * path readout showed Anfalas with a "border-land" icon, but Anfalas's
 * printed region type is "wilderness".
 *
 * `buildMovementPathHtml` paired `resolvedSitePathNames[i]` with
 * `resolvedSitePath[i]` by index. For starter (haven-to-haven) movement those
 * arrays are not index-parallel: `resolvedSitePathNames` holds just the two
 * endpoint region names, while `resolvedSitePath` holds every leg of the
 * printed haven-to-haven site path (here: wilderness/border/free/free/
 * border/wilderness — 6 legs), so `resolvedSitePath[1]` ("border") got
 * attached to the destination name "Anfalas" instead of its own printed type.
 *
 * The fix resolves each region name's icon from its own region card instead
 * of indexing into the unrelated site-path leg array.
 *
 * Also covers bug report cf1a46eed29ea0ac (game mt7a24d0-qcbgun, seq 149):
 * that first fix still only rendered 2 icons (one per endpoint name) for a
 * Lórien→Edhellond starter move, even though the printed site path has 6
 * legs. `buildMovementPathHtml` now renders one icon per
 * `resolvedSitePath` leg for non-region movement, labeling only the first
 * and last legs with their endpoint region names.
 */

import './test-dom-bootstrap.js'; // must precede the render import (load-time window access)
import { describe, test, expect } from 'vitest';
import { buildMovementPathHtml } from './render-phase-meter.js';

describe('buildMovementPathHtml (opponent-turn movement path readout)', () => {
  test('shows Anfalas as wilderness, not the unrelated site-path leg type', () => {
    const html = buildMovementPathHtml({
      resolvedSitePathNames: ['Wold & Foothills', 'Anfalas'],
      resolvedSitePath: ['wilderness', 'wilderness'],
      movementType: 'starter',
    });

    expect(html).toContain('Anfalas');
    // Anfalas's printed region type is wilderness (icon code "w"), never the
    // border-land icon ("b") the stale index-parallel zip produced.
    const anfalasSegment = html?.split('Wold & Foothills')[1] ?? '';
    expect(anfalasSegment).toContain('/w.png');
    expect(anfalasSegment).not.toContain('/b.png');
  });

  test('returns null when the company is not moving', () => {
    expect(buildMovementPathHtml({ resolvedSitePathNames: [], resolvedSitePath: [] })).toBeNull();
  });

  test('renders all 6 legs of a starter haven-to-haven path, not just the 2 endpoint names', () => {
    const html = buildMovementPathHtml({
      resolvedSitePathNames: ['Wold & Foothills', 'Anfalas'],
      resolvedSitePath: ['wilderness', 'border', 'free', 'free', 'border', 'wilderness'],
      movementType: 'starter',
    });

    const iconCount = (html?.match(/<img /g) ?? []).length;
    expect(iconCount).toBe(6);
    expect(html).toContain('Wold & Foothills');
    expect(html).toContain('Anfalas');
  });
});
