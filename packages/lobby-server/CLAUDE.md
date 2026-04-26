# CLAUDE.md — `@meccg/lobby-server`

This package is the lobby server: player registration, auth, online presence, matchmaking, game lifecycle management, and the browser UI. It spawns `@meccg/game-server` child processes on demand.

## Directory Layout

- `src/browser/` — Browser-side TypeScript (bundled via esbuild)
- `public/` — Static assets served directly (HTML, CSS, bundled JS output)

## Build

The browser bundle is built separately from the server TypeScript:

```sh
npm run build:browser -w @meccg/lobby-server
```

This invokes esbuild to bundle `src/browser/` into `public/`.

## Auth & Player Store

- Auth is JWT-based; tokens are issued on login and validated on every protected request.
- The player store is file-backed (no external database required).

## Game Lifecycle

- The lobby spawns a `@meccg/game-server` child process for each matched game.
- Child processes are managed by the lobby and cleaned up when games end.
