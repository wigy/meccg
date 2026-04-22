# Plan: Game Messages Redesign — Top-Right Log with Per-Game History

## Context

General game messages (toasts) are currently rendered at top-center of the screen, directly above the instruction line and situation banner. This is the most visually prominent slot on the board — yet the information is usually informational ("Alice drew 3 cards", "Bob discarded Goblin Raiders"), not something the user has to act on. The important central real estate gets covered by transient text, and once a toast auto-fades there is no way to recover it.

We want to:

1. Move general messages out of the center and into the currently under-used top-right corner.
2. Free the top-right by relocating the dev/debug buttons into the dead vertical space on the left, between the two score boards.
3. Keep timely auto-hide behavior for new messages (unchanged feel).
4. Store every message for the lifetime of the game and let the user scroll back through history with Page Up / Page Down.

Per-game scope: the history is cleared when a new game starts. It is not persisted across sessions.

## Current State (Reference)

Relevant files and elements (for implementation, not part of the design):

- `packages/lobby-server/src/browser/render-log.ts` — `showNotification()` appends a `<div class="toast">` to `#toast-container`. Toasts auto-remove on `animationend` (~9.4s CSS animation). No history is kept.
- `#toast-container` — fixed, `top: 3.5rem`, horizontally centered, z-index 200 (`style.css:2990-3054`).
- `#instruction-text` — fixed, `top: 0.5rem`, horizontally centered, z-index 60 (`render-instructions.ts:320-330`, `style.css:2321-2337`).
- `.situation-banner-row` — rendered inside the visual board, above company blocks (`company-view.ts:54-154`).
- `#toolbar` — fixed top-right, contains `#toolbar-main` (bug/settings/disconnect, always visible), `#toolbar-dev` (dev actions, hidden unless dev mode), `#toolbar-view` (visual/debug toggle) (`app.ts:80-86, 262-283`, `style.css:1953-2034`).
- `#self-deck-box` (bottom-left) and `#opponent-deck-box` (top-left) — fixed at `left: 1rem`, width 8.5rem (`render-player-names.ts:113-176`, `style.css:2528-2650`). The vertical gutter between them is currently empty.
- `packages/lobby-server/src/browser/keyboard-shortcuts.ts` — global keydown handler. Page Up / Page Down are **not** currently bound.

## Proposed Layout

```text
┌──────────────┐                                    ┌──────────────────┐
│ #opponent-   │    #instruction-text (top-ctr)     │ #toolbar-main    │
│ deck-box     │                                    │ (bug/set/disc)   │
│ (top-left)   │                                    │                  │
│              │                                    │ #game-log-panel  │
│              │                                    │ (new: messages,  │
│              │                                    │  right-aligned,  │
│              │                                    │  auto-fade, with │
│              │                                    │  PgUp/PgDn scroll│
│ ┌──────────┐ │                                    │  for history)    │
│ │ #toolbar-│ │                                    │                  │
│ │ dev      │ │    #visual-board                   │                  │
│ │ (moved   │ │                                    │                  │
│ │ here)    │ │                                    │                  │
│ └──────────┘ │                                    │                  │
│              │                                    │                  │
│ #self-deck-  │                                    │ #toolbar-view    │
│ box          │                                    │ (visual/debug)   │
│ (bottom-left)│                                    │                  │
└──────────────┘                                    └──────────────────┘
```

Key moves:

- **Top-center (situation banner area) is no longer covered by toasts** — it stays for the situation banner and instruction line only, which is what they're for.
- **Top-right becomes the dedicated message log.** `#toolbar-main` stays where it is (small icon row); the new `#game-log-panel` sits below it and grows downward, right-aligned.
- **Dev buttons (`#toolbar-dev`) move to the left gutter** between the two score boards. They retain their vertical-stack layout. `#toolbar-view` (visual/debug switch) stays top-right or moves to bottom of the dev stack — to be decided in implementation, but should stay near the dev buttons.

## Message System Redesign

### Data Model

New per-game state in the browser's `app-state.ts`:

```ts
interface GameMessage {
  id: number;                  // monotonic, for React-like keying / scroll targeting
  at: number;                  // Date.now() when created
  kind: 'info' | 'error' | 'opponent' | 'system';
  html: string;                // pre-formatted via textToHtml()
}

interface GameMessageLog {
  messages: GameMessage[];     // appended-to; cleared when a new game starts
  scrollOffset: number;        // 0 = viewing live tail; N = scrolled back N pages
}
```

Cleared on: new-game start, disconnect→reconnect-into-different-game. Not persisted.

### Rendering

Replace `#toast-container` with `#game-log-panel`, fixed in the top-right under `#toolbar-main`:

- Right-aligned text.
- Shows the most recent N messages as visible "cards" (each with a fade-out animation), same styling intent as current toasts.
- When `scrollOffset === 0`, new messages appear at the bottom of the visible stack, older visible ones drift up and fade out on the existing timer (keeps the timely-hide feel).
- When `scrollOffset > 0`, the panel switches to **history mode**: no fading, shows a fixed window of messages from the history, with a small header indicator like `◀ history (12–21 of 47)`. Incoming new messages still append to the underlying list but do not disturb the view.

### Keyboard

Add to `keyboard-shortcuts.ts`:

- `PageUp` — scroll history one page older (`scrollOffset += pageSize`, clamped to `messages.length`). Also (re)arms the browse timer (see below).
- `PageDown` — scroll history one page newer (`scrollOffset -= pageSize`, clamped to 0). Also (re)arms the browse timer.
- `End` (optional) — jump back to live tail immediately (`scrollOffset = 0`, clear the timer).

Same gating as other shortcuts: skip when `isTyping()` or when the pile-browser modal is open.

### Browse Timer: Auto-Return to Live Tail

When the user presses PgUp or PgDn, start a 10-second "browse" window:

```ts
interface GameMessageLog {
  messages: GameMessage[];
  scrollOffset: number;
  browseUntil: number | null;  // Date.now() + 10_000 when armed; null when not browsing
}
```

Behavior:

- Each PgUp / PgDn press sets `browseUntil = Date.now() + 10_000` (refreshes the window — each keypress extends the browsing time).
- While `browseUntil !== null && Date.now() < browseUntil` (**browsing mode**):
  - New messages arrive silently: appended to `messages`, no visible re-render of the panel, no fade animation, no toast flash.
  - The view stays frozen at the user's chosen `scrollOffset`.
- When a new message arrives **after** `browseUntil` has elapsed (browse window expired):
  - The view jumps back to live tail (`scrollOffset = 0`, `browseUntil = null`).
  - The new message renders with its normal fade-in, along with any messages that accumulated silently during the browse window (they appear as static log lines above the fading newcomer — i.e. the scrollback already contains them; they just weren't shown during browsing).
- `End` keypress also clears `browseUntil` immediately and returns to live tail.

Note: the window is not a simple `setTimeout` that forces a return — nothing happens until a new message triggers the check. This avoids yanking the view out from under a user who is still reading but not pressing keys. If no new messages ever arrive, the user can browse indefinitely.

### "Unread / history exists" Indicator

When `scrollOffset === 0` and the user is viewing the live tail, no indicator is needed. When the user scrolls back, the history-mode header shows position (e.g. `◀ history (12–21 of 47)`). The header should also show browse state — e.g. append `· browsing` while `browseUntil` is armed, so the user knows new messages are being buffered silently.

We do **not** need an "N new messages arrived while you were scrolled back" badge in v1. A subtle always-on hint that history exists (e.g. a faint `▲ N messages` line at the top of the panel when `messages.length > visibleCount`) is a nice-to-have; include it if cheap, skip otherwise.

## Debug Buttons Relocation

- Move `#toolbar-dev` out of `#toolbar` and render it as its own fixed element, positioned in the left gutter between `#opponent-deck-box` and `#self-deck-box`.
- Target position: `left: 1rem` (same as the deck boxes), vertically centered between them, width 8.5rem (matches deck box width for visual alignment).
- Keep the existing `applyDevMode(on)` toggle — just point it at the new element.
- `#toolbar-main` and `#toolbar-view` stay in `#toolbar` on the right. If `#toolbar-view` visually clashes with the new `#game-log-panel`, move it to sit beneath the dev stack on the left instead.

**The relocation applies in both visual view and debug view.** Today the dev buttons sit top-right in both views; after this change they must sit in the left gutter in both views. The debug view's own content (`#log`, debug panels) is unaffected, but the dev-action buttons themselves follow the new left-gutter position regardless of which view is active.

No behavior change for any button — pure relocation.

## Non-Goals

- No change to the situation banner or instruction line.
- No change to the debug-view `#log` element (the full scrollable log shown in debug view stays as-is).
- No persistence across games or sessions — history lives only in browser memory for the current game.
- No export / copy / search UI in v1. PgUp/PgDn browsing only.
- No change to `showNotification()`'s call sites — existing callers keep working; we only change what the function does under the hood.

## Implementation Plan

### Part A: Message State & Log Panel

1. Add `GameMessage` / `GameMessageLog` types to `app-state.ts`. Initialize empty log; clear it on new-game start.
2. Rewrite `showNotification()` in `render-log.ts` to:
   - Append a `GameMessage` to the log.
   - Trigger a re-render of `#game-log-panel` (live-tail mode adds a fading entry; history mode no-ops visually).
3. Replace `#toast-container` usage with `#game-log-panel` in `index.html` and `style.css`. New CSS:
   - Fixed position, top-right, below `#toolbar-main`.
   - Right-aligned text.
   - Live-tail child entries keep the current toast fade animation.
   - History-mode children have no animation; use overflow and a fixed height window.
4. Keep the existing color/error/opponent formatting (`kind` field drives the CSS class).

### Part B: Keyboard Scrollback & Browse Timer

1. Add `PageUp` / `PageDown` / `End` handlers in `keyboard-shortcuts.ts`.
2. PgUp/PgDn: mutate `scrollOffset` **and** set `browseUntil = Date.now() + 10_000`. End: set `scrollOffset = 0` and `browseUntil = null`.
3. In `showNotification()`, after appending the new message, check: if `browseUntil !== null && Date.now() >= browseUntil`, clear `browseUntil`, reset `scrollOffset = 0`, and render normally. If still inside the browse window, append silently (no render of the panel). If no browse armed, render normally.
4. Respect `isTyping()` and modal gating, same as existing shortcuts.

### Part C: Relocate Dev Buttons

1. In `app.ts`, create `#toolbar-dev` outside `#toolbar` (or move it in the DOM on first render).
2. Add CSS positioning it in the left gutter between the two deck boxes.
3. Verify `applyDevMode(on)` still toggles visibility correctly.
4. Decide placement of `#toolbar-view`: keep top-right beside `#toolbar-main`, or dock it beneath the new dev stack. Try both and pick whichever looks less cluttered.

### Part D: Polish

1. Confirm the new panel doesn't overlap `#pseudo-ai-panel` (currently top-right at `top: 4rem, right: 110px`). If overlap exists, shift the log panel down or the AI panel further left.
2. Confirm `#pass-btn` / `#enter-site-btn` (bottom-right) are unaffected.
3. Manual check: play through a short game, verify messages accumulate, PgUp scrolls back, End returns to tail, new game clears history.

## Open Questions

- Should `#toolbar-view` (visual/debug toggle) move with the dev buttons or stay top-right? Leaning: move it, so the right column is purely messages + the always-on main icons.
- What page size for PgUp/PgDn? Suggest: the number of currently visible live-tail entries (so one press shows "the previous screenful"). Configurable constant, tune during implementation.
- Do we want a small "history exists" affordance when at live tail? Cheap to add (one line of text), but adds visual noise. Defer to implementation — try without first.
