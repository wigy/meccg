# Tech Stack

## Language & Runtime

- **TypeScript** (strict mode) — all source code.
- **Node.js** — server and tooling runtime.
- **tsx** — TypeScript execution for dev/start scripts.
- **nodemon** — file watching / hot reload during development.

## Architecture

- **Monorepo** using npm workspaces under `packages/*`.
- **Packages:**
  - `@meccg/shared` — pure types, constants, and game engine (pure reducer).
  - `@meccg/game-server` — WebSocket server and session management.
  - `@meccg/lobby-server` — auth, matchmaking, game lifecycle, browser UI.
  - `@meccg/text-client` — text console client over WebSocket.
- **TypeScript project references** wire the packages together.

## Server

- **ws** (`ws` package) — WebSocket transport between clients and servers.
- **mathjs** — expression evaluation inside the shared engine.
- Pure reducer game engine: `(state, action) → state`, no side effects.
- Per-player state projection to redact hidden information.

## Client

- **Browser UI** served by the lobby server from `packages/lobby-server/public/`.
- **esbuild** — bundles browser TypeScript into `public/bundle.js` (IIFE).
- **Text client** — terminal-based client for scripting/testing.

## Testing

- **Vitest** — test runner.
- Rules tests (default `npm test`) and nightly card tests (`npm run test:nightly`).
- Tests verify official CoE rules, not internal implementation details.

## Tooling

- **ESLint** + **typescript-eslint** — linting.
- **markdownlint-cli2** — markdown linting.
- **TypeDoc** — API documentation generation (`docs/api/`).

## Data & Storage

- Card data as JSON in `packages/shared/src/data/`, split per expansion set.
- Game saves under `~/.meccg/saves/` as JSON.
- Game logs under `~/.meccg/logs/games/<gameId>.jsonl`.
