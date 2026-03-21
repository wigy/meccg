# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MECCG is a web-based implementation of the Middle-Earth Collectible Card Game (MECCG). It uses a client/server architecture where the server manages game state and rules enforcement, and the client provides the browser-based UI.

## Tech Stack

- **Language:** TypeScript (strict mode)
- **Runtime:** Node.js
- **Architecture:** Client/server
  - **Server:** Game engine, state management, rules enforcement, WebSocket API
  - **Client:** Browser-based UI communicating with the server over WebSockets

## Build & Development Commands

- **Install dependencies:** `npm install`
- **Type-check all packages:** `npx tsc --build packages/server/tsconfig.json packages/client-text/tsconfig.json packages/client-web/tsconfig.json`
- **Type-check shared only:** `npx tsc --noEmit -p packages/shared/tsconfig.json`
- **Run tests:** `npm test`
- **Lint:** `npm run lint` (auto-fix: `npm run lint:fix`)
- **Start server:** `npm run start -w @meccg/server -- <player1> <player2>` (two player names required)
- **Start text client:** `npm run start -w @meccg/client-text -- <name>`
- **Start web client:** `npm run start -w @meccg/client-web` (serves on port 8080, proxies WS to game server on 3000)
- **Hot reload:** Use `dev` instead of `start` (e.g. `npm run dev -w @meccg/server -- Alice Bob`)
- **Web client dev mode:** `npm run dev -w @meccg/client-web` (esbuild watch + live-reload via SSE)
- **Debug mode:** Add `--debug` flag or set `DEBUG=1` env var to show raw JSON messages and card IDs

## Architecture

- **Monorepo** using npm workspaces: `packages/shared`, `packages/server`, `packages/client-text`, `packages/client-web`
- **`@meccg/shared`** — Pure TypeScript types (cards, game state, actions, phases, player view) and constants. No runtime dependencies.
- **`@meccg/server`** — Game engine built as a pure reducer: `(state, action) → state`. Phase handlers in `src/engine/phases/`.
- **`@meccg/client-text`** — Text console client over WebSocket.
- **`@meccg/client-web`** — Browser web client. Serves HTML/JS/CSS on HTTP, proxies WebSocket to game server, and caches card images from GitHub to `~/.meccg/image-cache/`.
- **State model:** Full game state (server-only) → projection function → player view (per-player, hidden info redacted).
- Project references: server and client reference shared via `tsconfig.json` references + path mappings.

### Key Design Principles

- The server is the authority on game state — clients never modify state directly
- Game rules are enforced server-side; the client is a presentation layer
- The game engine is a pure reducer — no side effects in state transitions

### Server-Side Logging Policy

All server-side logic must include detailed logging so that the game's decision-making is fully traceable from the console output. This is critical for debugging complex rule interactions.

- **Use the logging helpers** from `src/engine/legal-actions/log.ts` (`logHeading`, `logDetail`, `logResult`) — never use bare `console.log` in engine code.
- **Log every decision and conclusion**, not just the final result. When the engine evaluates a condition, checks a constraint, rejects an action, or chooses between alternatives, log the reasoning with the relevant values.
- **Log at entry and exit** of phase handlers and legal-action computations. Entry logs should state what step/phase is being processed and for which player. Exit logs should summarize the outcome.
- **Log constraint checks with values**: don't just log "mind limit exceeded" — log "Gimli mind 6 would exceed limit (current 15 + 6 > 20)".
- **Log state transitions**: when the game advances to a new phase or setup step, log the transition with the reason (e.g. "Both players stopped drafting → finalizing draft").

### Card Data Organization

- Card data lives in `packages/shared/src/data/` as JSON files, aggregated by `index.ts`.
- **Separate files per extension set:** Each expansion set uses its own data files with a set prefix:
  - `tw-characters.json`, `tw-items.json`, `tw-creatures.json`, `tw-sites.json`, `tw-regions.json`, `tw-other.json` — The Wizards (TW, base set)
  - `as-characters.json`, `as-sites.json` — Against the Shadow (AS, minion expansion)
  - `le-characters.json`, `le-resources.json`, `le-sites.json` — The Lidless Eye (LE, minion expansion)
  - `wh-sites.json` — The White Hand (WH, fallen-wizard expansion)
  - `ba-characters.json`, `ba-sites.json` — The Balrog (BA, balrog expansion)
- **Card ID convention:** All card IDs use the pattern `{set}-{number}` (e.g. `tw-156`, `le-24`, `wh-58`, `ba-93`). Set prefixes are lowercase.
- **Card types by alignment:** Each alignment has its own card types:
  - Hero: `hero-character`, `hero-site`, `hero-resource-item`, etc.
  - Minion: `minion-character`, `minion-site`
  - Fallen-wizard: `fallen-wizard-site`
  - Balrog: `balrog-site`
- When adding cards from a new extension set, create new data files with the set prefix (e.g. `ba-sites.json` for The Balrog) rather than mixing sets in existing files.

### Card Data Policy

- When adding or modifying card data, always fetch the card from the authoritative card database at https://raw.githubusercontent.com/council-of-elrond-meccg/meccg-cards-database/master/cards.json — never rely on model knowledge for card text, stats, or IDs. The database is keyed by set code (AS, BA, DM, LE, TD, TW, WH), each containing a `cards` dict keyed by card ID.

### Card Uniqueness Rules

- Unique cards: only 1 copy allowed per deck.
- Non-unique cards: up to 3 copies allowed per deck.
- All characters and major items in the current card pool are unique. Hazard creatures, minor items (Dagger of Westernesse, Horn of Anor) are non-unique.
- Test fixtures (`makePlayDeck` etc.) must respect these limits.

### Debugging with Game Saves

- Game saves are stored in `~/.meccg/saves/` as JSON files containing the full game state.
- To debug a problem, load the save and inspect `state.phaseState` (current phase/step), `state.players[N]` (player data), and `state.instanceMap` (card instances).
- Key fields to check: `phaseState.setupStep.step` (which setup step), per-step state (e.g. `siteSelectionState`, `placementDone`), `players[N].siteDeck`, `players[N].hand`, `players[N].companies`.
- To verify legal actions, trace through the legal action function for the current step with the player's index and state.
- The server logs detailed decision-making to the console — run with `--debug` to see raw JSON messages and card IDs.

### Testing Philosophy

Tests verify the **official CoE rules**, not internal implementation. There are no unit tests — only rules-as-specification tests and card tests.

- **Rules tests** (`packages/server/src/tests/rules/`): Each sentence in the official Council of Elrond rules (source: `docs/coe-rules.txt`) maps to a `test()` or `test.todo()`. Tests set up a valid game state and verify the engine computes correct legal actions.
- **Card tests** (`packages/server/src/tests/cards/`, nightly): One test per card with special rules/effects. Builds game states that trigger each card's rules and verifies correct legal actions.
- **Pattern**: Every test follows: build state → call `computeLegalActions()` or `reduce()` → assert on legal actions or resulting state.
- **`test.todo()`** marks unimplemented rules — a living spec showing what's left to build.
- **No utility tests**: If internal utilities (condition matcher, formatting) break, the rules tests catch it.
- See `docs/testing-plan.md` for the full plan.

### Code Documentation Policy

- All modules must have a `@module` JSDoc comment explaining their purpose and how they fit into the architecture.
- All exported interfaces, types, enums, functions, and constants must have JSDoc comments.
- Comments should explain the "why" (game mechanics context, architectural decisions) not just the "what".
- Focus on how pieces fit together and what game rules motivate the design.
