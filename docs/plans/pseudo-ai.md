# Pseudo-AI Mode

## Context

New AI mode where the human player makes all decisions for the AI opponent. The AI client becomes a dumb message relay. This lets a single player play both sides, useful for learning, testing, and exploring game mechanics.

## Architecture: Lobby as IPC Relay

```
Game Server  <--WS-->  Pseudo-AI Client  <--IPC-->  Lobby Server  <--WS-->  Web Client
```

The pseudo-AI client connects to the game server like the regular AI client. Instead of picking actions randomly, it relays legal actions to the lobby via Node IPC (`process.send()`). The lobby forwards them to the human player's browser over the existing lobby WebSocket (which stays open during pseudo-AI games). The human picks an action, which flows back through the same path in reverse.

## Changes

### 1. Protocol types — `packages/lobby-server/src/lobby/protocol.ts`

New client-to-lobby messages:
- `PlayPseudoAiMessage` — `{ type: 'play-pseudo-ai', deckId: string }`
- `PseudoAiPickMessage` — `{ type: 'pseudo-ai-pick', action: GameAction }`

New lobby-to-client message:
- `PseudoAiActionsMessage` — `{ type: 'pseudo-ai-actions', actions: EvaluatedAction[], phase: string }`

Add `pseudoAi?: boolean` to `GameStartingMessage`.

### 2. Pseudo-AI client — `packages/lobby-server/src/games/pseudo-ai-client.ts` (new)

Fork of `ai-client.ts` with these differences:
- On receiving `state` message, instead of `pickAction()`, sends IPC: `process.send({ type: 'pseudo-ai-actions', actions: evaluated, phase })`
- Listens for IPC: `process.on('message', msg => ...)`, when `pseudo-ai-pick` received, sends `{ type: 'action', action }` to game server WS
- Shares deck loading, join message, reconnection logic with `ai-client.ts`

### 3. Launcher — `packages/lobby-server/src/games/launcher.ts`

- Add `pseudoAi?: boolean` to `LaunchOptions`
- Add `pseudoAiRelay: PseudoAiRelay | null` to `LaunchResult`
- `PseudoAiRelay` interface: `{ onActions(cb): void; sendPick(action): void }`
- When `options.pseudoAi`, spawn `pseudo-ai-client.ts` with `stdio: ['ignore', 'pipe', 'pipe', 'ipc']`
- Wire up IPC: `aiChild.on('message')` → relay's `onActions` callback; `relay.sendPick()` → `aiChild.send()`

### 4. Lobby — `packages/lobby-server/src/lobby/lobby.ts`

- Handle `play-pseudo-ai` message: call `launchGame(player, 'AI-Pseudo', { ai: true, pseudoAi: true, aiDeckId })`
- Wire relay: `relay.onActions(...)` → send `pseudo-ai-actions` to player's WS
- Handle `pseudo-ai-pick` message: forward to stored `relay.sendPick(action)`
- Send `game-starting` with `pseudoAi: true`
- Store relay reference on the player's game state

### 5. HTML — `packages/web-client/public/index.html`

- Add `<button id="play-pseudo-ai-btn">Play vs Pseudo-AI</button>` after the existing Play vs AI button
- Add save prompt for pseudo-AI (similar to existing `save-prompt`)
- Add pseudo-AI action panel in `#game`:
  ```html
  <div id="pseudo-ai-panel" class="hidden">
    <div class="pseudo-ai-header">
      <span>Opponent Actions</span>
      <button id="pseudo-ai-toggle-btn" title="Show/hide">_</button>
    </div>
    <div id="pseudo-ai-actions"></div>
    <button id="pseudo-ai-nonviable-toggle" class="hidden">+ Show non-viable</button>
  </div>
  ```

### 6. Web client — `packages/web-client/src/browser/app.ts`

- Add `let isPseudoAi = false` flag
- On `game-starting` with `pseudoAi: true`: set flag, do NOT close lobby WS
- Handle `pseudo-ai-actions` lobby message: render actions into `#pseudo-ai-panel`
- On action button click: send `{ type: 'pseudo-ai-pick', action }` via lobby WS
- Toggle button to minimize/restore the panel
- Toggle button to show/hide non-viable actions
- `play-pseudo-ai-btn` click handler: send `{ type: 'play-pseudo-ai', deckId }` (with save check against `'AI-Pseudo'`)
- On disconnect/cleanup: reset `isPseudoAi`, hide panel
- Store `isPseudoAi` in sessionStorage for rejoin support

### 7. CSS — `packages/web-client/public/style.css`

- `#pseudo-ai-panel`: floating overlay, right side, scrollable, distinct border/background
- Minimized state: small restore icon only
- Action buttons: same styling as debug view actions
- Non-viable section: collapsed by default

## Verification

1. Start lobby in dev mode: `bin/run-dev-server`
2. Register, select decks, click "Play vs Pseudo-AI"
3. Game starts — player sees own actions normally
4. When it's AI's turn, the pseudo-AI panel appears with AI's legal actions
5. Click an action in the panel — it executes as the AI's move
6. Toggle non-viable actions with "+" button
7. Minimize/restore panel with toggle icon
8. Test rejoin: refresh page mid-game, should reconnect with panel
