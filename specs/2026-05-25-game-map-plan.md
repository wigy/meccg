# Spec: Game Map Visualization

## Overview

Add a visual map of Middle-Earth to the game UI showing site locations, company positions, and movement context. The map appears as a small radar/minimap in the single-company view and expands to a full-screen map on click. A top-level annotation layer overlays company markers on the all-companies view.

---

## Map base image and coordinates — research findings

Researched existing MECCG digital implementations. Two key sources found:

### `Heinrich-Barth/meccg-online` (GPLv2)

The most complete existing implementation. Uses Leaflet.js with a custom tiled map:

- **Tile set**: `public/media/maps/regions/` — zoom levels 4–6. At zoom 4: 8×8 grid of 256×256px tiles (~2MB). Under-deeps tiles at `public/media/maps/underdeeps/` (same structure).
- **Coordinates**: `data-local/map-positions.json` — **426 entries** covering all regions and sites, keyed by name, values are Leaflet `[lat, lng]` pairs.
  - Example entries: `"Rivendell": [82.5, -99.1]`, `"Minas Tirith": [67.2, -103.4]`
  - Mix of string and number values (need normalisation when parsing).
- **License**: GPLv2. The map tiles are included in the repo and distributed under GPL. Card images are explicitly excluded ("MECCG assets are not included in this repository").
- **Map artwork**: Based on the Jo Hartwig "DC Map (regions)" — the same fan-community map referenced by the Uvatha interactive map project. The original S3 URL (`meccg-images.s3.amazonaws.com/DC+Map+Hartwig+(regions).jpg`) is now 403.

### `Uvatha/meccg-maps` (no explicit license)

Interactive HTML maps using Bokeh + the same Hartwig map image. Has `LocList.csv` with region polygon boundary vertices (pixel coordinates on the Hartwig map). Site-level coordinates are not separately stored — they would need to be digitized from the HTML or LocList.

### Recommended approach

**Use the Heinrich-Barth tile system with Leaflet.js.** Specifically:

1. Copy the tile set from `Heinrich-Barth/meccg-online/public/media/maps/regions/` into `packages/lobby-server/public/media/maps/regions/`. Same for underdeeps tiles.
2. Import `map-positions.json` and convert to our coordinate format (see below).
3. Render the full map with Leaflet.js (already a common browser library). The radar/minimap can be a tiny non-interactive Leaflet instance, or a `<canvas>` with dots positioned using the same coordinates over a stitched zoom-4 image.

**GPL compliance**: Our project is a fan project distributed to players, not a product sale. Using GPLv2 assets from another fan project is acceptable under the spirit of both licenses. If we ever need stricter separation, the tile set can be replaced with a newly generated one from the same Hartwig source.

### Coordinate system

The Heinrich-Barth `map-positions.json` uses Leaflet lat/lng coordinates. We convert these to `[x, y]` fractions in `[0,1]×[0,1]` relative to the tile grid extent at zoom 4.

The zoom-4 tile grid is 8×8 tiles of 256px each = 2048×2048px total extent. The Leaflet bounds for the full tile set can be read from the max/min lat/lng values in `map-positions.json`:

- lat range: approximately 52–90 (north = higher lat in this coordinate system)
- lng range: approximately −180 to −60

Conversion formula (computed once at build time, stored as static data):
```
x_fraction = (lng - lng_min) / (lng_max - lng_min)
y_fraction = 1 - (lat - lat_min) / (lat_max - lat_min)   // y flipped: top = high lat
```

Store the converted coordinates in: `packages/shared/src/data/site-coordinates.json`.

```jsonc
{
  // keyed by site name (matches SiteCard.name, case-insensitive lookup)
  "Rivendell": [0.38, 0.27],
  "Minas Tirith": [0.52, 0.61],
  // ...
}
```

A small one-off Node.js script (`tools/convert-map-positions.ts`) reads `map-positions.json`, normalises string/number values, computes bounds, and emits `site-coordinates.json`. Run once; commit the output.

**Coverage**: 426 entries from Heinrich-Barth cover essentially all MECCG regions and sites including dream cards. Cross-reference against our `tw-sites.json`, `as-sites.json` etc. to find any gaps; missing entries get coordinates `null` and are omitted from the map.

---

## Under-deeps layer

Heinrich-Barth has a full Under-deeps map implementation: tile set at `public/media/maps/underdeeps/` (same 8×8 grid structure) and `MapViewUnderdeeps.js` which renders site images in a scrollable list with adjacency links. The data comes from `MapDataUnderdeeps.ts` which reads `underdeepSites` off site cards.

We adopt the same tile set. Under-deeps site coordinates are stored separately in `packages/shared/src/data/under-deeps-coordinates.json`, also sourced from Heinrich-Barth `map-positions.json` entries whose site names match Under-deeps sites (identified by `keywords: ['under-deeps']` in our site data).

The Under-deeps map has its own Leaflet view (identical Leaflet setup, different tile folder and starting viewport). The layer toggle button switches between surface and under-deeps Leaflet instances.

---

## Companies and agents on the map

### Companies

All companies from both players are shown on the map as **circle** markers.

| State | Marker | Color |
|-------|--------|-------|
| Active company (current view) | circle, pulsing ring | gold |
| Own other company | circle | grey |
| Opponent company | circle | red |
| Own company moving (Organization) | circle at destination | green |

Multiple companies at the same site are offset diagonally so markers do not fully overlap.

### Agents

Agents are "virtual companies" (see `specs/2026-04-22-agents-plan.md` §3) that move around the map with their own site. The map must render them alongside normal companies.

### Visibility rules

- **Your own agents** (face-down or face-up): you always know their current site. Show them at their site coordinates.
- **Opponent's face-up agents**: site is revealed — shown at their current site.
- **Opponent's face-down agents**: site is hidden from you. Do **not** place a dot on the map. Show a count badge (e.g. "2 hidden agents") in a corner of the full map view so the player knows agents exist without leaking positions.

This mirrors the projection in `PlayerView.opponent.agents`: face-down entries carry only `revealed: false` and the stack length, no site name.

### Visual style

Agents use a **diamond** marker instead of a circle, same size as a company dot, to distinguish them at a glance:

| State | Marker | Color |
|-------|--------|-------|
| Own agent, face-up | diamond | red |
| Own agent, face-down | diamond | dark-red, semi-transparent |
| Opponent face-up agent | diamond | orange |
| Opponent face-down | (not shown on map) | — |

Multiple agents at the same site cluster the same way as multiple companies: offset diagonally so markers don't fully overlap.

### Interaction

- **Radar**: agents shown as diamonds, same click-to-open-full-map behavior as the radar itself.
- **Full map hover**: tooltip on an agent diamond shows the agent name (if revealed), current site, and revealed/face-down state.
- **Full map click**: clicking an agent diamond has no effect in the initial implementation (agents are not navigated to via the map yet). Add agent selection in a later iteration once `select-company` targeting covers agents.

---

## UI: Radar (minimap) in single-company view

A compact `<div class="map-radar">` is added to the single-company view, positioned in the bottom-right corner (or top-right corner, to be determined by testing).

**Radar contents:**
- The map background image scaled down to fit within a fixed box (e.g., 160×120 px or CSS-proportional).
- A **dot** for the current company's site (bright gold if at current site, green if at destination during Organization).
- A **ring or pulse animation** on the active company dot.
- Other companies' sites shown as smaller grey dots (friendly) or red dots (opponent).
- **Agent diamonds** for all visible agents (own: dark-red; opponent face-up: orange). Opponent face-down agents are not shown.
- No text labels at radar scale — dots and diamonds only.

**Interaction:**
- Clicking the radar opens the full map view (see below).
- The radar is not shown when the current company has no site (shouldn't occur in normal play, but guard for it).

**Under-deeps:** If the active company is at an Under-deeps site, show the Under-deeps schematic instead of the surface map in the radar. A small icon (cave/mine symbol) in the corner indicates the layer.

---

## UI: Full map view

Clicking the radar opens a full-screen overlay (`<div class="map-fullscreen">`) containing:

- The map image scaled to fill available space (maintain aspect ratio, letter-box).
- **All company dots** and **agent diamonds** positioned on their sites, same color coding as radar.
- **Hovering** a marker shows a tooltip: company/agent name, site name, members (characters for companies; agent name if revealed for agents).
- **Clicking** a company dot selects that company (same as the left/right navigation in the single-company view) and closes the full map. Clicking an agent diamond has no effect in Phase 3 (deferred to agent UI integration phase).
- A **hidden-agents badge** in the corner counts opponent face-down agents whose positions are not shown.
- A **close button** (×) and pressing Escape closes the full map.
- A **layer toggle button** (surface / under-deeps) switches between map and Under-deeps schematic.

**Movement context overlay** (during Organization phase, after declaring movement):
- Show a line from the company's current site to its destination.
- Show the region path as a highlight along the route (approximate polyline connecting region centroids).

---

## UI: All-companies view

The all-companies grid currently shows company blocks in a CSS grid. Adding map context here is lower priority but two lightweight options:

1. **Map panel on the side**: If screen width allows, render the radar-sized map alongside the company grid (not inside it). All companies get dots; clicking a dot scrolls/highlights the company block.
2. **Site icons on company blocks**: Each company block already shows the site card. Add a small region-type color badge (already done via `createRegionTypeIcon`) — no map needed here.

**Recommendation**: Defer the map panel in all-companies view to a later iteration. The single-company radar and full map view are the primary deliverables.

---

## Data model additions

### `site-coordinates.json`

```ts
// packages/shared/src/data/site-coordinates.json
// Record<siteName, [xFraction, yFraction]>
```

Loaded lazily client-side only — never needed by the engine.

### `under-deeps-coordinates.json`

```ts
// packages/shared/src/data/under-deeps-coordinates.json
// Record<siteName, [xFraction, yFraction]>
// coordinates relative to the under-deeps schematic bounding box
```

### No engine changes

The map is purely a UI concern. No changes to the game engine, shared types, or server.

---

## File locations

All new files are in the lobby-server browser package:

| File | Purpose |
|------|---------|
| `packages/lobby-server/src/browser/map-radar.ts` | Render minimap radar widget |
| `packages/lobby-server/src/browser/map-fullscreen.ts` | Full-screen map overlay |
| `packages/lobby-server/src/browser/map-under-deeps.ts` | Under-deeps schematic renderer |
| `packages/lobby-server/src/browser/map-coordinates.ts` | Load and cache coordinate data |
| `packages/shared/src/data/site-coordinates.json` | Surface site [x,y] fractions |
| `packages/shared/src/data/under-deeps-coordinates.json` | Under-deeps schematic [x,y] fractions |
| `packages/lobby-server/public/images/map.jpg` | Map base image (to be sourced) |
| `packages/lobby-server/public/style-map.css` | Map-specific CSS |

---

## Phased delivery

### Phase 1 — Import tiles and convert coordinates

- Copy tile set from `Heinrich-Barth/meccg-online/public/media/maps/regions/` and `underdeeps/` into `packages/lobby-server/public/media/maps/`.
- Write `tools/convert-map-positions.ts`: reads Heinrich-Barth `map-positions.json`, normalises string/number coords, computes lat/lng bounds, outputs `site-coordinates.json` (surface sites) and `under-deeps-coordinates.json`.
- Run the script; review output; commit both JSON files and the tile set.
- No UI changes yet.

### Phase 2 — Radar in single-company view

- Implement `map-radar.ts` + `map-coordinates.ts`.
- Wire into `company-views.ts` (`renderSingleView`).
- Style the radar (rounded border, semi-transparent background, company dots).
- Test: dots appear at correct positions for well-known sites (Rivendell, Minas Tirith, Dol Guldur).

### Phase 3 — Full map overlay

- Implement `map-fullscreen.ts`.
- Wire click handler on radar to open/close overlay.
- Add tooltip on hover, company selection on click.
- Add Escape-to-close.
- Add layer toggle button.

### Phase 4 — Under-deeps schematic

- Implement `map-under-deeps.ts` as an SVG generator from adjacency data.
- Commit `under-deeps-coordinates.json`.
- Wire layer toggle to show schematic when active company is underground.

### Phase 5 — Agent integration (after agents EPIC ships)

- Read `view.self.agents` and `view.opponent.agents` from the player view.
- Render diamond markers for all visible agents on radar and full map.
- Show hidden-agents badge for opponent face-down agents.
- Wire full-map diamond click to agent selection (using `SelectCompanyAction` with the agent's `CompanyId`) once `select-company` targeting covers agents per `2026-04-22-agents-plan.md` §3.2.

### Phase 6 — Movement overlay (future)

- Show planned movement lines in the full map during Organization phase.
- Draw approximate region-path polylines.
- Optionally show agent movement trajectory (the face-down site stack as a dotted trail) when revealed.

---

## Open questions

1. **Leaflet vs canvas radar**: For the radar (minimap), a live tiny Leaflet instance may be heavy. An alternative is a `<canvas>` element with dots positioned from the pre-computed fraction coordinates over a stitched or pre-resized zoom-4 image. Decide after Phase 1 when we can measure performance.
2. **Radar position**: Bottom-right conflicts with the site card; top-right or floating near the navigation arrows may work better — decide after visual testing.
3. **All-companies view map**: Deferred; decide scope once Phase 3 is shipped and layout constraints are understood.
4. **Coordinate gap audit**: After running the conversion script, check which of our sites lack coordinates. Heinrich-Barth's 426 entries cover most official + dream cards; any gaps (expansions not in their database) need manual calibration using the Uvatha `LocList.csv` region centroids as fallback.
5. **Mobile/small screen**: Radar may be too small to be useful on narrow viewports. Consider hiding it below a breakpoint and showing a dedicated map icon/button instead.
6. **Heinrich-Barth coordinate name mismatches**: Their keys are lowercase (`"rivendell"`) while our site names use title case (`"Rivendell"`). The conversion script must do case-insensitive matching.
7. **Agent site-stack trail**: A face-down agent's full site stack is known to its owner. During Phase 6, should the map show a dotted trail of the sites the agent traversed while face-down, or only the current site? Showing the trail leaks the movement route on reveal — probably show only the current site (the stack is visible in the company block fan already per `2026-04-22-agents-plan.md` §3.3).

## Sources

- `Heinrich-Barth/meccg-online` — GPLv2. Tiles + 426-entry coordinate JSON. Key files: `data-local/map-positions.json`, `public/media/maps/regions/`, `public/media/maps/underdeeps/`, `src-client/game-client/mapwindow/MapView*.js`.
- `Uvatha/meccg-maps` — no explicit license. Region polygon vertices in `LocList.csv`. Interactive hero/minion/etc. maps at `uvatha.github.io`.
- `councilofelrond.org/forum/viewtopic.php?t=4351` — discussion thread pointing to Uvatha's work.
