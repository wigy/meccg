# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MECCG is a web-based implementation of the Middle-Earth Collectible Card Game (MECCG). It uses a client/server architecture where the server manages game state and rules enforcement, and the client provides the browser-based UI.

For implementation-specific terminology (mail, game state, card instances, etc.), see `docs/glossary.md`.

## Tech Stack

- **Language:** TypeScript (strict mode)
- **Runtime:** Node.js
- **Architecture:** Client/server
  - **Server:** Game engine, state management, rules enforcement, WebSocket API
  - **Client:** Browser-based UI communicating with the server over WebSockets

## Build & Development Commands

- **Install dependencies:** `npm install`
- **Build (type-check all packages):** `npm run build`
- **Type-check shared only:** `npx tsc --noEmit -p packages/shared/tsconfig.json`
- **Run tests:** `npm test` (excludes card tests)
- **Run card tests (nightly):** `npm run test:nightly`
- **Lint:** `npm run lint` (auto-fix: `npm run lint:fix`)
- **Build API docs:** `npm run docs` (outputs to `docs/api/`)
- **Start server:** `npm run start -w @meccg/game-server -- <player1> <player2>` (two player names required)
- **Start text client:** `npm run start -w @meccg/text-client -- <name>`
- **Hot reload:** Use `dev` instead of `start` (e.g. `npm run dev -w @meccg/game-server -- Alice Bob`)
- **Start lobby server:** `npm run start -w @meccg/lobby-server` (serves on port 8080 with auth + matchmaking, includes browser UI)
- **Lobby dev mode:** `npm run dev -w @meccg/lobby-server` (hot-reload, spawns game servers on demand)

### Verification During Development

Do NOT run tests or lint after making changes. Tests and lint are run once before pushing, not during development.

### Pre-Commit Checklist

Before every commit, run:

1. `npm run build` — type-check (must pass)

### Pre-Push Checklist

Before every push, always run all five of these **in parallel** and fix any failures:

1. `npm run build` — type-check (must pass)
2. `npm test` — rules tests (must all pass)
3. `npm run test:nightly` — card tests (must not introduce new failures)
4. `npm run lint` — linting (fix with `npm run lint:fix`)
5. `npm run lint:md` — markdown linting (fix with `npm run lint:md:fix`)

### Git Policy

- **NEVER rebase.** Do not use `git rebase` under any circumstances.
- **NEVER amend commits.** Do not use `git commit --amend`. Always create new commits.
- No history-rewriting operations of any kind (`rebase`, `amend`, `reset --hard`, `filter-branch`, etc.).
- To move a commit to another branch, use `git cherry-pick` and create a new revert commit on the original branch.
- In PRs, always push new fix commits — never squash or rewrite.

## Architecture

- **Monorepo** using npm workspaces: `packages/shared`, `packages/game-server`, `packages/text-client`, `packages/lobby-server`
- **`@meccg/shared`** — Pure TypeScript types, constants, and the game engine (pure reducer: `(state, action) → state`). Engine code in `src/engine/`, phase handlers in `src/engine/legal-actions/`. Tests in `src/tests/`.
- **`@meccg/game-server`** — WebSocket server, game session management, and state projection. Re-exports engine from shared.
- **`@meccg/text-client`** — Text console client over WebSocket.
- **`@meccg/lobby-server`** — Lobby server with player registration, auth, online presence, matchmaking, game lifecycle management, and browser UI. Spawns game-server child processes on demand.
- **State model:** Full game state (server-only) → projection function → player view (per-player, hidden info redacted).
- Project references: game-server and clients reference shared via `tsconfig.json` references + path mappings.

### Mail System API

- When calling `/api/system/mail`, the `recipients` field **must** be a JSON array of strings (e.g. `["wigy"]`), never a plain string. Passing a string causes it to be split into individual characters, sending mail to wrong users.
