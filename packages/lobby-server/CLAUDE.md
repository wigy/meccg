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

## Replay

- The Scores page links each completed game to a replay, which plays the game
  back on the ordinary game board.
- Source data is the game server's per-game JSONL state log
  (`~/.meccg/logs/games/<gameId>.jsonl`, overridable with `GAME_LOG_DIR`). Every
  line is a *full* state snapshot, so playback re-projects recorded states and
  never re-runs the reducer.
- `src/games/replay.ts` indexes a log by byte offset once per game and reads one
  line per frame request — logs reach tens of megabytes and must never be held
  in memory as parsed state.
- Old recordings predate later engine state fields; `STATE_DEFAULTS` /
  `PLAYER_DEFAULTS` supply the values those games implicitly had. A recording
  that still fails to project is reported as unreplayable rather than crashing.
- The browser side (`src/browser/replay.ts`) feeds each frame to
  `renderStateMessage` — the same function the live WebSocket handler calls — so
  the replay board is the live board, driven from disk instead of a socket.
