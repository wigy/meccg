# Split Browser Bundle into Three Parts

## Current State

The entire browser application is compiled by esbuild as a single entry point:

```text
src/browser/app.ts → public/bundle.js  (688 KB)
```

Every visitor — including those who only log in, read mail, or manage decks —
downloads the full game board renderer, combat view, company management code, and
keyboard shortcuts on first load.

---

## Goal

Three focused bundles loaded on demand so users only pay for what they use:

| Bundle | Entry point | Loaded when |
|--------|-------------|-------------|
| `bundle.js` | `app.ts` | Always (lobby shell) |
| `game-bundle.js` | `game-entry.ts` | User joins or spectates a game |
| `deck-editor-bundle.js` | `deck-editor-entry.ts` | User opens the deck editor |

---

## Plan

### 1. Create `game-entry.ts`

New entry point that imports and initialises all game-only modules:

- `game-connection.ts`
- `render-board.ts`, `render-hand.ts`, `render-piles.ts`, `render-log.ts`
- `render-actions.ts`, `render-instructions.ts`, `render-selection-state.ts`
- `render-chain.ts`, `render-card-preview.ts`, `render-player-names.ts`
- `render-debug-panels.ts`
- `combat-view.ts`
- `company-block.ts`, `company-modals.ts`, `company-site.ts`
- `company-view.ts`, `company-views.ts`, `company-view-state.ts`
- `company-actions.ts`
- `keyboard-shortcuts.ts`
- `dice.ts`
- `pseudo-ai.ts`
- `flip-animate.ts`

Exposes an `initGame()` function the lobby bundle calls after injection.

### 2. Create `deck-editor-entry.ts`

New entry point that imports and initialises deck-editor modules:

- `deck-browser.ts`
- `deck-editor.ts`

Exposes an `initDeckEditor()` function the lobby bundle calls after injection.

### 3. Strip `app.ts` (lobby bundle)

Remove all game and deck-editor imports from `app.ts`. The lobby bundle retains:

- `lobby-screens.ts` — auth, screen management, lobby WebSocket
- `app-state.ts` — shared state
- `inbox.ts`
- `credits-page.ts`
- `dialog.ts`
- `session.ts`
- `render.ts` (notification + card preview used in lobby)
- `markdown.ts`

### 4. Lazy injection helpers

Add two helpers in `app.ts`:

```typescript
function loadScript(src: string): Promise<void>  // injects <script> once, resolves on load
```

Call `loadScript('/game-bundle.js')` when joining a game, then call `window.initGame()`.
Call `loadScript('/deck-editor-bundle.js')` when opening the deck editor screen, then call `window.initDeckEditor()`.

Both helpers are idempotent — a second call while the script is already loaded or
loading is a no-op.

### 5. Update `build:browser` script

```json
"build:browser": "esbuild src/browser/app.ts src/browser/game-entry.ts src/browser/deck-editor-entry.ts --bundle --outdir=public --format=iife --platform=browser"
```

Output filenames default to entry-point names: `app.js`, `game-entry.js`, `deck-editor-entry.js`.
Rename outputs explicitly to `bundle.js`, `game-bundle.js`, `deck-editor-bundle.js` via
esbuild `--entry-names` flag or a small rename step so `index.html` requires no change.

### 6. Cross-bundle shared state

Both game and deck-editor bundles need `appState` and `cardPool` from `app-state.ts`.
Since esbuild bundles each entry independently, shared state must flow through `window`:

- `app.ts` sets `window.__appState` and `window.__cardPool` after init
- `game-entry.ts` and `deck-editor-entry.ts` read these at `initGame()` / `initDeckEditor()` time

Alternatively, expose a thin `window.__meccg` namespace object from `app.ts` and have
sub-bundles attach to it. Either approach avoids duplicating the card pool across bundles.

---

## Expected Outcome

- First load (lobby only) drops significantly — no game renderer or deck editor code
- Game bundle loads once per session on first game join; subsequent games reuse the cached script
- Deck editor bundle loads only if the user visits that screen
- Debug panels remain in the game bundle (they are only used during a game)
- `index.html` unchanged — still loads `bundle.js` only
