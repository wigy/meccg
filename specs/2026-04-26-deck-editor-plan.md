# Full-Featured Deck Editor

## Current State

`deck-editor.ts` (278 lines) and `deck-browser.ts` (352 lines) provide a minimal deck
management UI: list decks, view card entries with certify/request buttons, and a hover
preview. There is no way to search for cards, browse the full card pool, or add/remove
cards from within the UI.

Card images are served via the server-side caching proxy at `/cards/images/{set}/{filename}`,
which fetches from the meccg-remaster GitHub repository on cache miss.

---

## Goal

A standalone, full-featured deck editor reachable from the lobby navigation. The editor
has two panes side by side:

- **Left — Card Browser**: search and filter the full card pool; click a card to add it to
  the active deck
- **Right — Deck View**: the current deck split into resource deck and site deck; click a
  card to remove it; live validation feedback

---

## Plan

### Phase 1 — Server API

#### `GET /api/cards`

Returns the full card pool as JSON. Shape:

```typescript
interface CardEntry {
  id: string;           // definition ID, e.g. "tw-156"
  name: string;
  type: string;         // "hero-character", "minion-site", etc.
  alignment: string;    // "hero" | "minion" | "fallen-wizard" | "balrog"
  set: string;          // "TW" | "AS" | "LE" | "DM" | "TD" | "WH" | "BA"
  unique: boolean;
  image?: string;       // proxy path, e.g. "/cards/images/tw/Gandalf.jpg"
  text?: string;        // rules text
  // character-specific
  race?: string;
  mind?: number;
  prowess?: number;
  body?: number;
  // site-specific
  siteType?: string;    // "free-hold" | "border-hold" | etc.
  region?: string;
  // creature-specific
  strikes?: number;
  // resource/hazard
  mp?: number;
}
```

This endpoint is used by the deck-editor bundle so it does not need `cardPool` injected
from `app.ts`. The server already has the card pool in memory; serialising it is trivial.

#### `GET /api/decks/:id` / `PUT /api/decks/:id`

Return and update a full deck. The `PUT` body is the deck's resource and site card lists.
These endpoints likely already exist in part; extend as needed to support full card lists.

---

### Phase 2 — Card Browser (left pane)

#### Filter bar

Persistent filter controls above the card grid:

| Filter | Type | Options |
|--------|------|---------|
| Name search | text input | substring match, case-insensitive |
| Set | multi-select | TW, AS, LE, DM, TD, WH, BA |
| Alignment | multi-select | hero, minion, fallen-wizard, balrog |
| Card type | multi-select | character, site, resource, hazard, creature |
| Race | multi-select | (populated from data: Hobbit, Elf, Dwarf, etc.) |
| Site type | multi-select | free-hold, border-hold, dark-hold, ruins-and-lairs, haven |

All filters are AND-combined. Filter state is kept in URL query params so links are
shareable and the browser back button works.

#### Card grid

Filtered cards shown as a scrollable grid of card thumbnails. Each cell:

- Card image (proxied, lazy-loaded with `loading="lazy"`)
- Card name below the image
- Small alignment/type badge overlay

Clicking a card opens the **card detail panel** (see below) and optionally adds it to
the deck (configurable: click-to-preview vs click-to-add).

#### Card detail panel

Appears as a fixed sidebar or modal on card click:

- Full-size card image
- Name, set, type, alignment, unique indicator
- Stats (mind/prowess/body for characters; strikes for creatures; MP; site type/region for sites)
- Full rules text (rendered with the existing `render-text-format.ts` markup)
- "Add to deck" button (greyed out with reason if adding would violate a rule)

---

### Phase 3 — Deck View (right pane)

Two sub-sections: **Resource Deck** and **Site Deck**, each collapsible.

Within each section, cards are grouped by type then sorted alphabetically. Each row:

- Card name
- Copy count badge (`×2`, `×3`)
- Remove button (decrements count; removes row at 0)
- Hover → card detail panel appears

#### Live validation

A validation bar at the top of the pane shows:

| Check | Rule |
|-------|------|
| Deck size | Resource deck: 25–50 cards (CoE rules) |
| Unique limit | Max 1 copy of any unique card |
| Non-unique limit | Max 3 copies of any non-unique card |
| Alignment consistency | All characters must share alignment; resources must match |
| Site deck size | Exactly the right number of sites for the alignment |

Each failing check is shown as a red pill with a short message. Passing → green pill "Valid".

---

### Phase 4 — Persistence

- **Auto-save**: debounced write to `PUT /api/decks/:id` 800 ms after any change
- **Save indicator**: small "Saved" / "Saving…" / "Error" status next to deck name
- **Deck name editing**: inline edit of the deck name in the header
- **New deck**: button in lobby deck list creates a blank deck and opens the editor
- **Duplicate deck**: copies a deck under a new name
- **Delete deck**: confirmation dialog, then redirects to deck list

---

### Phase 5 — UI Polish

- **Keyboard shortcuts**: `/` focuses the name search; `Escape` clears filters
- **Responsive layout**: on narrow screens the two panes stack vertically with a toggle tab
- **Card image caching**: the proxy already caches on disk; the browser caches via normal
  HTTP cache headers — no extra work needed
- **Empty states**: friendly message when filters return no cards; prompt to relax filters
- **Loading skeleton**: card grid shows placeholder shimmer while `/api/cards` loads

---

## File Layout

All new browser code lives in `packages/lobby-server/src/browser/`:

| File | Purpose |
|------|---------|
| `deck-editor-entry.ts` | Bundle entry point (see bundle-split spec) |
| `deck-editor-new.ts` | Top-level layout, pane wiring, URL state |
| `card-browser.ts` | Filter bar + card grid |
| `card-detail.ts` | Card detail panel / sidebar |
| `deck-view.ts` | Deck pane with grouped card list and validation |
| `deck-validation.ts` | Pure validation functions (reusable, no DOM) |

The existing `deck-editor.ts` and `deck-browser.ts` are replaced by the new files.
Keep them in place and functional until the new editor is wired in, then delete.

Server-side additions in `packages/lobby-server/src/`:

| File | Purpose |
|------|---------|
| `routes/cards.ts` | `GET /api/cards` handler |
| Extend `routes/decks.ts` | `PUT /api/decks/:id` full card list support |

---

## Expected Outcome

- Players can browse, search, and filter the full card pool with images
- Adding and removing cards from a deck requires no page reload
- Deck validity is visible at a glance while editing
- The editor is fully self-contained in `deck-editor-bundle.js` and loads only on demand

---

## Visual Design Specification

Interactive HTML mock: `/tmp/meccg-deck-editor-mock.html` (open in browser to preview).

### Aesthetic Direction

Dark mahogany + candlelit gold — a Rivendell library at night. The interface feels like an
ancient tome: grain texture overlay, gold filigree borders, deep shadows, no bright whites.

### Typography

| Role | Font | Notes |
|------|------|-------|
| Logo | `Cinzel Decorative` | Gold, animated breathing glow |
| All labels, numbers, buttons | `Cinzel` | Uppercase, wide letter-spacing |
| Body text, card flavour | `Cormorant Garamond` | Italic for tooltips/placeholders |

### Design Tokens

```css
--void:      #070504   /* page background */
--deep:      #0E0A07   /* header, card grid background */
--panel:     #171009   /* filter panel, deck panel */
--card-bg:   #1F1510   /* card info strip, input backgrounds */
--hover-bg:  #261A10   /* hover state */
--gold:      #C8A84B   /* primary accent — borders, counts, labels */
--gold-lt:   #E8C870   /* glow highlights */
--gold-dim:  #6A5828   /* subdued gold, scrollbar thumbs */
--cream:     #EAE0CC   /* primary text */
--cream-dim: #9A8A74   /* secondary text, placeholders */

/* Type accent colours */
--c-char:  #C8A84B   /* character (gold) */
--c-res:   #4A9B6A   /* resource (forest green) */
--c-haz:   #CC4444   /* hazard (crimson) */
--c-site:  #7B8FA0   /* site (slate blue) */
```

### Layout

Three-column grid, full-viewport height, no outer scroll:

```text
┌─────────────────── HEADER (58px) ───────────────────────────┐
│ Logo │ Deck Name │              │ Stats │ Save               │
├──────────┬───────────────────────────────┬───────────────────┤
│  FILTER  │         CARD GRID             │    DECK PANEL     │
│  210px   │           1fr                 │      290px        │
│          │  [toolbar: count + sort]      │  Progress bars    │
│ Search   │  ┌────┐ ┌────┐ ┌────┐        │  ─────────────── │
│ Alignment│  │card│ │card│ │card│ …      │  Deck list       │
│ Type     │  └────┘ └────┘ └────┘        │  ─────────────── │
│ Set      │  (auto-fill, scrollable)      │  [Clear][Export] │
└──────────┴───────────────────────────────┴───────────────────┘
```

### Header

- Deck name: `Cinzel` inline input with underline-only border, lights gold on focus.
- Stats: four live counters (Total / Characters / Resources / Hazards).
- Save button: ghost with gold border; fills solid gold on hover.

### Filter Panel

Each section has a small-caps `Cinzel` heading + gold underline, then filter chips.
Active chip: subtle background + gold border + gold text. Inactive: `cream-dim`, brightens on hover.

### Card Grid (browser pane)

- `auto-fill` columns, min 132px wide.
- Each card: art placeholder (3:4 aspect, type-specific gradient + SVG illustration) + info strip
  (name in `Cinzel 10px`, type tag with colour-coded border, stat string).
- **In-deck state**: `gold-dim` border, gold glow, gold circular badge showing count (top-right).
- **Hover**: `translateY(-5px) scale(1.02)`, stronger shadow, z-index lift.
- **Staggered fade-in**: `cardFadeIn` animation with 20ms delay per child index.
- When real card images are available, the `<img>` replaces the SVG placeholder (same aspect ratio).

### Deck Panel

- **Progress bars** (2px height): Characters/10, Resources/25, Hazards/25.
  Fill colours match type accents. Smooth CSS `transition: width 0.35s`.
- **Deck list**: grouped by type, each group has small-caps header + gold rule.
  Each row: count (gold `Cinzel`) · name · stat · ✕ button (fades in on row hover).
- **Footer**: ghost buttons — Clear All · Export · Validate.

### Interactions

| Action | Result |
|--------|--------|
| Left-click card in grid | Add one copy (max: 1 unique, 3 non-unique) |
| Right-click card in grid | Remove one copy |
| Click / right-click deck entry | Add / remove one copy |
| ✕ in deck entry | Remove one copy |
| Hover card | Tooltip (210px, card name + italic rules text, repositions to avoid edges) |
| Over limit | Toast notification (bottom-centre, slide-up, auto-dismiss 1.6s) |
