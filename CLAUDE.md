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

### Card Data Policy

- When adding or modifying card data, always fetch the card from the authoritative card database at https://raw.githubusercontent.com/council-of-elrond-meccg/meccg-cards-database/master/cards.json — never rely on model knowledge for card text, stats, or IDs.

### Code Documentation Policy

- All modules must have a `@module` JSDoc comment explaining their purpose and how they fit into the architecture.
- All exported interfaces, types, enums, functions, and constants must have JSDoc comments.
- Comments should explain the "why" (game mechanics context, architectural decisions) not just the "what".
- Focus on how pieces fit together and what game rules motivate the design.
