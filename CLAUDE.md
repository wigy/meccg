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
- **Type-check all packages:** `npx tsc --build packages/server/tsconfig.json packages/client/tsconfig.json`
- **Type-check shared only:** `npx tsc --noEmit -p packages/shared/tsconfig.json`

## Architecture

- **Monorepo** using npm workspaces: `packages/shared`, `packages/server`, `packages/client`
- **`@meccg/shared`** — Pure TypeScript types (cards, game state, actions, phases, player view) and constants. No runtime dependencies.
- **`@meccg/server`** — Game engine built as a pure reducer: `(state, action) → state`. Phase handlers in `src/engine/phases/`.
- **`@meccg/client`** — Browser UI (placeholder).
- **State model:** Full game state (server-only) → projection function → player view (per-player, hidden info redacted).
- Project references: server and client reference shared via `tsconfig.json` references + path mappings.

### Key Design Principles

- The server is the authority on game state — clients never modify state directly
- Game rules are enforced server-side; the client is a presentation layer
