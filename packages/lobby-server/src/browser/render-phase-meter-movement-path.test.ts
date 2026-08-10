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
 */

import './test-dom-bootstrap.js'; // must precede the render import (load-time window access)
import { describe, test, expect } from 'vitest';
import { buildMovementPathHtml } from './render-phase-meter.js';

describe('buildMovementPathHtml (opponent-turn movement path readout)', () => {
  test('shows Anfalas as wilderness, not the unrelated site-path leg type', () => {
    const html = buildMovementPathHtml({
      resolvedSitePathNames: ['Wold & Foothills', 'Anfalas'],
    });

    expect(html).toContain('Anfalas');
    // Anfalas's printed region type is wilderness (icon code "w"), never the
    // border-land icon ("b") the stale index-parallel zip produced.
    const anfalasSegment = html?.split('Wold & Foothills')[1] ?? '';
    expect(anfalasSegment).toContain('/w.png');
    expect(anfalasSegment).not.toContain('/b.png');
  });

  test('returns null when the company is not moving', () => {
    expect(buildMovementPathHtml({ resolvedSitePathNames: [] })).toBeNull();
  });
});
