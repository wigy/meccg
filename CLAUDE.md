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
- **Type-check all packages:** `npx tsc --build packages/server/tsconfig.json packages/client-text/tsconfig.json`
- **Type-check shared only:** `npx tsc --noEmit -p packages/shared/tsconfig.json`
- **Run tests:** `npm test`
- **Start server:** `npm run start -w @meccg/server` (or `npm run dev -w @meccg/server` for hot reload)
- **Start text client:** `npm run start -w @meccg/client-text -- <name>` (or `npm run dev -w @meccg/client-text -- <name>`)
- **Debug mode:** Add `--debug` flag to server or client to show raw JSON messages and card IDs

## Architecture

- **Monorepo** using npm workspaces: `packages/shared`, `packages/server`, `packages/client-text`
- **`@meccg/shared`** — Pure TypeScript types (cards, game state, actions, phases, player view) and constants. No runtime dependencies.
- **`@meccg/server`** — Game engine built as a pure reducer: `(state, action) → state`. Phase handlers in `src/engine/phases/`.
- **`@meccg/client-text`** — Text console client over WebSocket.
- **State model:** Full game state (server-only) → projection function → player view (per-player, hidden info redacted).
- Project references: server and client reference shared via `tsconfig.json` references + path mappings.

### Key Design Principles

- The server is the authority on game state — clients never modify state directly
- Game rules are enforced server-side; the client is a presentation layer

### Code Documentation Policy

- All modules must have a `@module` JSDoc comment explaining their purpose and how they fit into the architecture.
- All exported interfaces, types, enums, functions, and constants must have JSDoc comments.
- Comments should explain the "why" (game mechanics context, architectural decisions) not just the "what".
- Focus on how pieces fit together and what game rules motivate the design.
