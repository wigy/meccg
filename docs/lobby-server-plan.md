# Lobby Server Plan

## Overview

A new `packages/lobby-server` package (`@meccg/lobby-server`) that handles player registration, authentication, online presence, and game lifecycle management. The lobby replaces the web-client as the browser entry point — it serves the same static files but adds auth, player management, and game orchestration.

## Architecture

```
Browser
  |--- HTTP (8080) ──→ Lobby Server (login, register, static files, card images)
  |--- WS  (8080)  ──→ Lobby Server (online players, challenges, game signals)
  |
  |--- WS  (4001)  ──→ Game Server #1 (spawned by lobby, direct connection)
  |--- WS  (4002)  ──→ Game Server #2 (spawned by lobby)
```

Browsers connect directly to game servers (no proxy). The lobby spawns game-server child processes on demand and signals players to connect.

## Package Structure

```
packages/lobby-server/
  package.json
  tsconfig.json
  src/
    server.ts              — Entry point: HTTP server + lobby WS
    config.ts              — Constants (ports, paths, JWT secret)
    auth/
      password.ts          — bcrypt hash/verify helpers
      jwt.ts               — Sign/verify lobby sessions + game tokens
      session.ts           — Cookie-based session middleware
    players/
      store.ts             — Read/write ~/.meccg/players/<name>.json
      types.ts             — PlayerRecord interface
    lobby/
      lobby.ts             — Online tracking, challenge flow, game launch trigger
      protocol.ts          — LobbyClientMessage / LobbyServerMessage types
    games/
      launcher.ts          — Spawn game-server child processes, port allocation
      ai-client.ts         — Headless AI player (random legal actions)
    http/
      routes.ts            — POST login/register/logout, GET /api/me, static files, card images
```

## Key Design Decisions

### Auth

- HttpOnly cookie containing a JWT for the lobby session.
- Separate short-lived JWT game tokens (5-minute expiry) passed via the WS `join` message to game servers.
- This cleanly separates lobby auth from game auth.

### Player Storage

- One JSON file per player in `~/.meccg/players/`.
- No database dependency; files are easy to inspect and back up.
- Player record: name, email, bcrypt password hash, creation timestamp.

### Port Allocation

- Incrementing counter from a configurable base port (default 4000).
- Simple and avoids race conditions inherent in OS-assigned port approaches.

### Game-End Cleanup

- Monitor child process `exit` event.
- Game servers already exit when both players disconnect.
- Lobby SIGTERMs children on its own exit to avoid orphans.

### AI Opponent

- Headless WS client that connects to the spawned game server.
- Joins with the hero sample deck and picks random legal actions.
- Spawned as a separate process alongside the game server.

### Backward Compatibility

- Game server verifies JWT only when `JWT_SECRET` env var is set.
- When `JWT_SECRET` is absent, game server works standalone as today (no token required).
- Both players use the fixed hero sample deck for now.

## Lobby WebSocket Protocol

### Client → Lobby

| Message | Fields | Description |
|---------|--------|-------------|
| `challenge` | `opponentName: string` | Invite an online player |
| `accept-challenge` | `from: string` | Accept a pending invitation |
| `decline-challenge` | `from: string` | Decline an invitation |
| `play-ai` | — | Start a game against AI |

### Lobby → Client

| Message | Fields | Description |
|---------|--------|-------------|
| `online-players` | `players: string[]` | Broadcast on connect/disconnect |
| `challenge-received` | `from: string` | Someone wants to play you |
| `challenge-declined` | `by: string` | Your challenge was declined |
| `game-starting` | `port: number; token: string` | Connect to game server |
| `error` | `message: string` | Error message |

## HTTP Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/register` | No | Create account, set session cookie |
| `POST` | `/api/login` | No | Verify credentials, set session cookie |
| `POST` | `/api/logout` | Yes | Clear session cookie |
| `GET` | `/api/me` | Yes | Return current player name (for page reload) |
| `GET` | `/*` | No | Static files from web-client/public/ |
| `GET` | `/cards/images/*` | No | Card image proxy with disk cache |

## Key Interfaces

### PlayerRecord (`players/types.ts`)

```typescript
interface PlayerRecord {
  name: string;
  email: string;
  passwordHash: string;    // bcrypt
  createdAt: string;       // ISO 8601
}
```

### Game Token Payload (`auth/jwt.ts`)

```typescript
interface GameTokenPayload {
  playerName: string;
  gameId: string;
  iat: number;
  exp: number;             // 5-minute expiry
}
```

### JoinMessage Change (`shared/types/protocol.ts`)

```typescript
export interface JoinMessage {
  // ... existing fields ...
  /** Optional JWT token for authenticated game server connections. */
  readonly token?: string;
}
```

## Changes to Existing Packages

### `@meccg/shared`

- Add optional `token` field to `JoinMessage` in `src/types/protocol.ts`.

### `@meccg/game-server`

- ~10 lines in `handleJoin()` in `src/ws/game-session.ts`: when `process.env.JWT_SECRET` is set, verify the JWT and ensure `msg.name` matches the token's `playerName`. Reject on failure.

### `@meccg/web-client`

- **`public/index.html`**: Add `#login-screen`, `#register-screen`, and `#lobby-screen` sections. Hide existing `#connect-form`.
- **`public/style.css`**: Styles for new screens.
- **`src/browser/app.ts`**: On page load, `GET /api/me` to check session → show login or lobby. Login/register POST to API. Lobby WS for online players and challenges. On `game-starting`, open direct WS to `ws://localhost:<port>` with game token. On game end, return to lobby.

## Implementation Order

### Phase 1: Foundation

1. Create `packages/lobby-server/package.json` (deps: `@meccg/shared`, `ws`, `bcryptjs`, `jsonwebtoken`).
2. Create `packages/lobby-server/tsconfig.json`.
3. Implement `src/config.ts` — `LOBBY_PORT`, `GAME_PORT_BASE`, `JWT_SECRET`, `PLAYERS_DIR`.

### Phase 2: Player Registration and Auth

4. Implement `players/types.ts` and `players/store.ts` — CRUD for player JSON files.
5. Implement `auth/password.ts` — `hashPassword()` and `verifyPassword()` using bcryptjs.
6. Implement `auth/jwt.ts` — `signLobbyToken()`, `verifyLobbyToken()`, `signGameToken()`, `verifyGameToken()`.
7. Implement `auth/session.ts` — parse/set JWT from HttpOnly cookie `meccg-session`.

### Phase 3: HTTP Routes

8. Implement `http/routes.ts` — register, login, logout, /api/me, static files, card image proxy.

### Phase 4: Lobby WebSocket

9. Implement `lobby/protocol.ts` — message type definitions.
10. Implement `lobby/lobby.ts` — online player tracking, challenge/accept/decline, trigger game launch.

### Phase 5: Game Launcher

11. Implement `games/launcher.ts` — spawn game-server with `PORT` and `JWT_SECRET` env vars, track active games, clean up on exit.
12. Implement `games/ai-client.ts` — headless WS client with random strategy.

### Phase 6: Entry Point

13. Implement `src/server.ts` — HTTP server with routes, lobby WS, dev-mode live-reload injection.

### Phase 7: Game Server Token Verification

14. Add `token` field to `JoinMessage` in shared.
15. Add JWT verification to `handleJoin()` in game-server.

### Phase 8: Browser UI

16. Add login/register/lobby HTML screens to `web-client/public/index.html`.
17. Modify `web-client/src/browser/app.ts` for lobby mode.
18. Add CSS for new screens.

### Phase 9: AI Client and Polish

19. Wire up AI client spawning in the launcher.
20. Add package scripts: `start`, `dev`.

## Potential Challenges

- **Direct game server connections**: WebSocket connections are not subject to CORS, so cross-port connections work. HTTPS deployments would need certificates on all ports.
- **Port allocation race**: Extremely unlikely with high base port + incrementing counter. Game server can retry or report failure.
- **AI client timing**: Retry connection with short delay, or wait for game server's "listening" stdout message before spawning AI.
- **Orphaned game servers**: Mitigated by SIGTERM on lobby exit and game servers' existing disconnect-based shutdown.
- **Token expiry**: Tokens are verified once at join time; 5-minute window is sufficient.
