# Spec: Ask AI — an Observer that Explains What the Selected Agent Would Do

*Status: design, 2026-08-17. Nothing here is implemented.*

## Overview

Three pieces, one feature:

1. **`bin/observe`** launches a headless *observer* process with one AI agent
   selected by registry spec (`--agent h2`, `--agent 'mc:ms=2000/turns=2'`, …).
   It attaches to the most recently launched game and follows that game's log.
2. While an observer is attached, the game screen grows one toolbar icon:
   **Ask AI**.
3. Clicking it asks the observer *"what would this agent do in this position,
   and why"*. The observer reads the position, runs the selected agent's own
   reasoning over it, and returns a verbose explanation, which the browser
   shows in a scrollable panel.

The point is to make the AI legible *while a game is happening*, in the same
window the game is in. Today the same information is only reachable after the
fact, from a terminal: `bin/watch-game --ai` shows what the *playing* AI
considered, and `npm run explain -w @meccg/sim -- --game <id> --seq <n>` shows
what a *chosen* agent would do at a recorded position. This feature is the
second one, live, for the position on screen, for the seat you are sitting in.

Non-goals: the observer never plays, never submits actions, and never changes
game state. It is not a hint system for rated play (see §8) and not an LLM —
"AI" here means one of the sim package's agents.

## What the codebase already gives us

| Need | Existing piece |
|---|---|
| Full game state for any position of a live game | `game-server/src/ws/game-log.ts` writes `~/.meccg/logs/games/<gameId>.jsonl`, one record per state change, each with the complete `GameState` |
| Reader for those logs | `sim/src/ai/h2/game-log.ts` — `readGameLog`, `findGameLogRecord`, `gameLogDir` |
| Turning a state into what one player may see | `projectPlayerView(state, playerId)` from `@meccg/game-server` |
| Agents by spec string | `resolveAgent` / `AGENT_NAMES` in `sim/src/cli/common.ts` — `random`, `heuristic`, `noisy-heuristic`, `h2`, `bc`, `search`, `search-h2`, `mc`, `route` |
| Verbose H2 explanation rendering | `sim/src/ai/h2/explain.ts` (`renderExplanation`) plus the assembly in `sim/src/cli/explain.ts` |
| Ranked-candidate rendering for *any* agent | `text-client/src/ai-client.ts` (`describeWeighted` / `logCandidates`) |
| A headless WebSocket client that joins a game server | `text-client/src/ai-client.ts` + `client-common.ts` (`parseSpawnedClientArgs`, `spawnedJoinPayload`, `installReconnect`, `parseServerMessage`) |
| Presence pushed to game clients out of band | `GameSession.broadcastSpectators()` → `SpectatorsMessage`, rendered by `browser/spectators.ts` |
| Toolbar icon slot + dev-gated icons | `public/index.html` `#toolbar-main`, `browser/game-entry.ts` `applyDevMode` |
| A master-key HTTP surface for local tools | `/api/system/*` in `lobby-server/src/http/routes.ts` (Bearer `MASTER_KEY` from `~/.meccg/secrets.json`) |
| Game tokens for non-players | `signGameToken(name, gameId)`; the game server's `verifyJoinToken` checks only `sub === name` and expiry, which is how spectator tokens (`watch-<port>`) already work |

Almost nothing here is new machinery. The work is a relay, a launcher, and one
new rendering entry point.

## Design summary

```text
bin/observe --agent h2
      │
      │ 1. GET /api/system/observer-target   (Bearer MASTER_KEY)
      ▼                                       → { port, gameId, token, … }
  lobby-server ──────────────── launches ───────────────► game-server (port N)
                                                              │
      │ 2. ws://localhost:N   join { name: "Observer",         │
      │                              token, observer:{agent} } │
      └──────────────────────────────────────────────────────► │
                                                              │
      3. tail ~/.meccg/logs/games/<gameId>.jsonl ◄── written by┘
         (full GameState per stateSeq)

  browser (seated player)                        observer
      │  ask-ai {requestId}                          │
      ├──────────────► game-server ─── ai-question ─►│  project view for
      │                                              │  forPlayer, run agent,
      │◄─ ai-explanation {lines} ◄─── ai-answer ─────┤  render explanation
```

Four decisions worth stating up front, because the rest follows from them.

**The observer reads the position from the game log, not from the wire.** An
explanation is only honest if it is computed from the acting player's *own*
projected view — the same redacted view the agent would get if it were playing
that seat. That needs the full `GameState`, and the game server deliberately
never ships one: it projects per player. The log already holds every position
of every game, addressed by `gameId#stateSeq`, and `explain --game` already
reads exactly that. Consequence: the observer runs on the same host as the game
server. That is true by construction — it authenticates with the local master
key and is a development tool.

**The relay goes through the game server, not the lobby.** The browser closes
its lobby WebSocket for the duration of a game (`game-connection.ts`: *"Close
lobby WS during game"*), so during play the only socket the game screen holds
is the game-server one. Presence and request/response therefore ride that
socket, which is also where the analogous `spectators` presence already lives.

**One observer per game, replacing on re-attach.** The icon names one agent, so
a second attached observer would make "Ask AI" ambiguous. A new observer join
replaces the old connection the same way a reconnecting player does. Serving
several agents from one observer is a follow-up (§10).

**The observer survives the game it was watching.** When the game ends it goes
back to waiting for the next launched game and re-attaches. That is what
"follow the latest game" has to mean in practice: you start the observer once
and keep testing.

### Why not the alternatives

- *Compute the explanation inside the game server.* It has the full state
  already, so no log tailing and no second process. Rejected: it would drag the
  agent registry, weights loading, and (for `mc`) a multi-second search with
  worker threads into the process that owns the authoritative game. `mc` at
  `ms=2000` would stall broadcasts for every client. The game server stays a
  rules-and-state service.
- *Route through the lobby.* The lobby knows which game is newest, but the
  browser has no lobby socket during a game, so this would mean reopening one
  just for this feature.
- *Have the observer replay the game itself from actions.* The log's full-state
  records make replay unnecessary, and a replay would drift the moment a dev
  command (`undo`, `load`, `reseed`) rewrote history.

## Protocol changes

All in `packages/shared/src/types/protocol.ts`, all additive.

```ts
/** Extra join field: this connection is an observer, not a player or spectator. */
export interface JoinMessage {
  // … existing fields …
  /**
   * Attach as an observer, offering explanations from `agent` (a sim registry
   * spec). Observers never act, never receive state broadcasts, and never keep
   * a session alive.
   */
  readonly observer?: { readonly agent: string };
}

/** Ask the attached observer what its agent would do right now. */
export interface AskAiMessage {
  readonly type: 'ask-ai';
  /** Client-generated id, echoed back on the answer. */
  readonly requestId: string;
}

/** Observer → server: the finished explanation. */
export interface AiAnswerMessage {
  readonly type: 'ai-answer';
  readonly requestId: string;
  /** Rendered explanation, one array element per line. */
  readonly lines: readonly string[];
  /** Agent that produced it (spec as launched, e.g. `mc:ms=2000`). */
  readonly agent: string;
  /** Wall-clock time the agent spent, milliseconds. */
  readonly elapsedMs: number;
}

/** Observer → server: the request could not be answered. */
export interface AiErrorMessage {
  readonly type: 'ai-error';
  readonly requestId: string;
  readonly message: string;
}
```

Server → client:

```ts
/**
 * Whether an observer is attached, and which agent it offers. Broadcast on
 * attach, detach, and on each seating — for the same reason SpectatorsMessage
 * is: an observer arriving does not change game state and so never reaches the
 * state broadcast.
 */
export interface ObserverMessage {
  readonly type: 'observer';
  readonly attached: boolean;
  /** Agent spec, or null when nothing is attached. */
  readonly agent: string | null;
}

/** Server → observer: please explain this position. */
export interface AiQuestionMessage {
  readonly type: 'ai-question';
  readonly requestId: string;
  /** Engine state sequence number to explain — addresses the log record. */
  readonly stateSeq: number;
  /** Whose decision to explain. */
  readonly forPlayer: PlayerId;
  readonly turn: number;
  readonly phase: string;
  readonly step?: string;
}

/** Server → asker: the answer, or why there is none. */
export interface AiExplanationMessage {
  readonly type: 'ai-explanation';
  readonly requestId: string;
  readonly status: 'ok' | 'unavailable' | 'error' | 'timeout';
  readonly agent: string | null;
  readonly forPlayer?: PlayerId;
  readonly stateSeq?: number;
  readonly lines?: readonly string[];
  readonly elapsedMs?: number;
  /** Present when status is not `ok`. */
  readonly message?: string;
}
```

`ClientMessage` gains `AskAiMessage | AiAnswerMessage | AiErrorMessage`;
`ServerMessage` gains `ObserverMessage | AiQuestionMessage |
AiExplanationMessage`.

## Game-server behaviour (`ws/game-session.ts`)

New state: `private observer: { ws: WebSocket; agent: string } | null`, and
`private pendingAsk: Map<string, { ws: WebSocket; timer: NodeJS.Timeout; forPlayer: PlayerId }>`.

**Attach (`handleJoin` with `msg.observer`).** Token verification is unchanged
(`sub === name`, unexpired — the lobby mints one, §7). Then:

- If the name matches a designated player name, reject with an error rather
  than seating it. An observer must never occupy a seat.
- Replace any existing observer (`close()` the old socket, log
  `observer-replace`).
- Reply `assigned` with `playerId: 'observer'` and the real `gameId` — this is
  how the observer learns which log file to tail.
- Do **not** send a state projection, and exclude observers from
  `broadcastState` / `broadcastStateWithLogs`. An `mc` observer would otherwise
  be shipped a full spectator view per state change and ignore every one of
  them.
- Exclude observers from the spectator badge (they are not people watching) and
  from whatever keeps the session alive — an attached observer alone must let a
  game idle-exit exactly as spectators do.
- `broadcastObserver()`.

**Detach (`handleDisconnect`).** Clear `observer`, fail every pending request
for it with `status: 'unavailable'`, `broadcastObserver()`.

**`ask-ai` from a client.**

1. No observer attached → `{ status: 'unavailable', message: 'No observer is attached.' }`.
2. Resolve `forPlayer`: the asking connection's own `playerId`. A spectator
   connection resolves to the current active player, but only when the server
   runs `--dev`; otherwise `{ status: 'error' }`. A seated player may never ask
   about the opponent's seat — the explanation is derived from that seat's
   private view, so answering would leak the opponent's hand.
3. No active player (simultaneous phase with nothing to decide, game over) →
   `{ status: 'error', message: 'Nothing to decide in this position.' }`.
4. One in-flight request per connection; a second gets
   `{ status: 'error', message: 'Still thinking about the previous question.' }`.
5. `markCheated('ask-ai')` and broadcast the flag (§8).
6. Forward `ai-question` with the authoritative `state.stateSeq`, `forPlayer`,
   turn/phase/step. Arm a 90-second timer: `mc:ms=2000` plus view projection is
   seconds, and a cold `bc` weights load on first use is more.
7. On `ai-answer` / `ai-error`, deliver to the *asking connection only* — never
   `broadcastToAll`. Unknown `requestId` (timed out, asker gone) is dropped
   with a `serverLog` line.
8. `ai-answer` / `ai-error` from a connection that is not the observer is an
   error, like `action` from a spectator.

## The observer process

New file `packages/text-client/src/observer-client.ts`, wrapped by
`bin/observe`. It sits in `text-client` because that is where headless
WebSocket game clients already live (`ai-client.ts`, `pseudo-ai-client.ts`) and
because it reuses `client-common.ts`; the *explanation* itself belongs to
`@meccg/sim` (§6), which `text-client` already depends on.

```text
Usage: bin/observe [--agent <spec>] [--new] [--lobby <url>] [--once]

  --agent <spec>  Sim registry spec for the explaining agent.
                  Default: h2 (the richest explanation; see below).
  --new           Wait for the NEXT game to be launched instead of
                  attaching to the newest existing one. Same semantics as
                  bin/watch-game --new.
  --lobby <url>   Lobby base URL. Default http://localhost:8080.
  --once          Print one explanation for the newest position on attach,
                  then exit. Makes the process testable without a browser.
```

Startup and lifecycle:

1. `resolveAgent(spec)` immediately, before anything else — a typo in a spec or
   a missing weights file must fail at launch, not at the first question. This
   also pays the `bc` load cost up front.
2. `GET <lobby>/api/system/observer-target` with the master key (§7), polling
   every second until a target exists. With `--new`, pass
   `?since=<startup ISO timestamp>` so an already-running game is skipped.
3. Connect to `ws://localhost:<port>`, `join` with
   `{ name: 'Observer', token, observer: { agent: spec } }`.
4. On `assigned`, open `~/.meccg/logs/games/<gameId>.jsonl` and start tailing:
   watch for appends, parse each complete line, keep a bounded ring of the most
   recent records keyed by `stateSeq` (a few hundred is ample). Skip a
   truncated final line — `readGameLog` already documents that a live log's
   last line may be half-written. If the file *shrinks*, re-read it from the
   start: `undo` / `load` call `truncateAfterSeq`, so the log is not
   append-only across dev commands.
5. On `ai-question`: find the record for `stateSeq`. If it has not landed yet
   (the broadcast can beat the log write), retry every 50 ms for up to 2 s;
   then fall back to the newest record and say so in the output header. If the
   log is unreadable, answer `ai-error`.
6. Call `explainDecision` (§6), send `ai-answer` with the rendered lines and
   elapsed time, and print the same lines to stdout — so the terminal running
   `bin/observe` is also a transcript of everything that was asked.
7. Serialize the work: one question at a time, queue the rest. A `mc` search
   pegs a core (or a worker pool); overlapping searches would make both slow
   and the answers late.
8. On socket close or game end, go back to step 2 and attach to the next game.
   Log every transition to stdout (`attached to <gameId> on port <port>`,
   `game ended, waiting for the next one`).

Default agent is `h2` rather than the stronger `mc`: `h2` is the agent with a
written explanation pipeline (module-by-module contributions in win-probability
units), it answers every decision itself, and it is fast enough to feel
interactive. `mc` is available by spec and is worth asking for a movement or
hazard decision, but it declines to search in combat, mid-chain, or with
effects pending, where it silently delegates to Heuristics 1 — the explanation
must say so, which is why `canDecide` is part of the header (§6).

## The explanation (`@meccg/sim`)

New module `packages/sim/src/ai/explain-decision.ts`, exported from
`sim/src/index.ts`:

```ts
export interface DecisionExplanationInput {
  /** Agent to ask, already resolved (so callers can reuse one instance). */
  readonly agent: Agent;
  /** Spec the agent was built from, for the header and the reproduce line. */
  readonly agentSpec: string;
  /** Full state from the game log. */
  readonly state: GameState;
  /** Whose decision to explain. */
  readonly playerId: PlayerId;
  /** Heading line, e.g. `game <id>#<seq>`. */
  readonly title: string;
  /** How many candidates to expand fully. Default 5. */
  readonly topN?: number;
  /** Seed for the agent's random stream, so an answer is reproducible. */
  readonly seed?: number;
  /** Game id and seq for the reproduce footer, when the position came from a log. */
  readonly source?: { readonly gameId: string; readonly stateSeq: number };
}

export interface DecisionExplanation {
  readonly agent: string;
  readonly lines: readonly string[];
  readonly chosen: GameAction | null;
  readonly chosenDescription: string;
  readonly viableCount: number;
  readonly candidateCount: number;
}

export function explainDecision(input: DecisionExplanationInput): DecisionExplanation;
```

**The invariant, stated once and tested:** every line is derived from
`projectPlayerView(state, playerId)`, never from `state`. The full state is the
input only because projection needs it. This is the same rule `explain
--state full` breaks on purpose and warns about; here it must not be breakable
at all, because the output travels over a socket to a browser.

Rendered sections, in order:

1. **Header** — title; agent name and spec; the seat being explained and
   whether it is the asker's own; turn, phase, step; marshalling points for
   both sides; hand size; number of viable actions (the branching factor); and
   `canDecide` — for an agent that reports `false`, a line naming what actually
   answers the decision (`mc cannot search a combat position; this is
   Heuristics 1's answer`). An agent that does not implement `canDecide` says
   nothing, since absent means "does not draw the distinction".
2. **What is being asked** — the distinct action types on offer, so the reader
   can see the decision's shape before the ranking.
3. **The ranking.** Two paths, one renderer per agent family:
   - `h2`: the existing pipeline — `resolveModules`, `computeStanding` /
     `computeBudget` / `computeExposure` / `computeCardPrices` /
     `computeHazardPlan`, `proposePlans`, `evaluateDecision`, `select`,
     `rankWithPlans`, then `renderExplanation`. This body lives in
     `cli/explain.ts` today; the refactor moves it here and has the CLI call
     it, so the CLI and the panel cannot drift apart.
   - anything else: one `agent.chooseAction(context)` call, then the
     `considered` list sorted by weight, each rendered with `describeAction`
     (+ `stripCardMarkers`), the pick marked, weights labelled by
     `weightUnit` — `tsd` renders as "expected tournament-score differential",
     absent renders as "relative preference (ordering only)". `decision.note`
     is printed verbatim. This is `ai-client.ts`'s `logCandidates` output,
     which moves here so both use one implementation.
4. **Why not the runner-up** — the top two candidates and the gap between
   them, in the ranking's own unit. One line; it is the question people
   actually have.
5. **What is not available** — the count of non-viable candidates and the top
   few with the engine's own `reason`. Half of "explain this position" is "why
   can't I do X".
6. **Reproduce** — the exact command to dig further offline:
   `npm run explain -w @meccg/sim -- --game <gameId> --seq <n> --player <p> --hash <hash>`.
   Any answer in the panel can be re-derived, extended with `--module`, or
   captured as a scenario.

## Lobby endpoint

`GET /api/system/observer-target` — under `/api/system/`, so it inherits the
existing Bearer `MASTER_KEY` gate, and additionally requires `DEV`.

Query: `?since=<ISO timestamp>` (optional) — only consider games launched
strictly after it, which is how `--new` waits.

Response 200:

```json
{
  "port": 4001,
  "gameId": "wigy-vs-AI-MC-1755400000000",
  "player1": "wigy",
  "player2": "AI-MC",
  "launchedAt": "2026-08-17T09:00:00.000Z",
  "token": "<JWT for sub=Observer>"
}
```

404 `{ "error": "no game" }` when nothing matches.

Supporting changes:

- `launchGame` returns its `gameId` (it already computes one) in `LaunchResult`.
- `WatchableGame` gains `gameId` and `launchedAt`; "latest launched" is the
  entry with the greatest `launchedAt`.
- Token: `signGameToken('Observer', 'observe-<port>')`, mirroring the spectator
  token's `watch-<port>`.
- `bin/observe` reads `MASTER_KEY` from the environment, falling back to
  `masterKey` in `~/.meccg/secrets.json` — the same file the lobby writes.

Returning `gameId` here (rather than only via `assigned`) lets the observer
open the right log immediately and cross-check that the socket it attached to
is the game it thinks it is.

## Browser

New module `packages/lobby-server/src/browser/ask-ai.ts` and one new toolbar
button in `public/index.html`, next to `#spectators-btn`:

```html
<button id="ask-ai-btn" class="toolbar-icon-btn" style="display:none;">…</button>
```

Icon: a speech bubble with a question mark (same 20×20 stroked SVG family as
the existing icons, `stroke="#888"`).

- `setObserver({ attached, agent })` — called from `game-connection.ts`'s
  message switch on `observer`, stores it and re-renders. `resetObserver()` is
  called from `clearGameBoard()` alongside `resetSpectators()`.
- Visibility (pure function `askAiButtonState`, unit-tested): shown when an
  observer is attached **and** the client is a seated player; a spectator sees
  it only when server dev mode is on, matching how the debug view and dev menu
  are already withheld from spectators. Title: `Ask AI (h2)` — the agent spec
  is the point, since the answer differs per agent.
- Click → `confirmCheat()` on first use (§8) → send
  `{ type: 'ask-ai', requestId }` (a counter plus the connection's own name is
  enough) → open the panel showing `Asking h2 …` with the existing spinner
  treatment, and disable the button while in flight.
- `ai-explanation` → render. The panel is a modal built from the same markup
  and CSS classes as `#bug-report-modal`: backdrop, dialog, heading, a
  scrollable monospace body (`white-space: pre-wrap`), a **Copy** button, and
  Esc / backdrop-click to close. No new overlay system.
- `formatAskAiPanel(msg)` (pure, unit-tested) turns the message into the
  heading and body text, including the non-`ok` statuses: `unavailable` reads
  *"No observer is attached — start one with `bin/observe --agent h2`"*, and
  `timeout` says which agent was asked and for how long it ran.

## Cheat marking

Asking hands a human player an agent's ranked reading of their own position.
That is a strategic advantage no ordinary player has, so a game in which it was
used must not feed the scoreboard or player histories. The precedent is already
in the codebase: every dev command calls `markCheated`, and `game-entry.ts`'s
`confirmCheat()` asks once per game before the first one.

`ask-ai` therefore follows the dev-tool path exactly — server-side
`markCheated('ask-ai')` plus a broadcast so every client sees the flag flip,
and a browser-side one-time confirmation naming what it costs. Tutorial games
are exempt from the stamp for the same reason `save`/`load` are: they cannot
alter a recorded outcome. Listed in §11 as the one policy choice worth
revisiting.

## File plan

**New**

| File | Purpose |
|---|---|
| `packages/sim/src/ai/explain-decision.ts` | `explainDecision` — the one renderer, both agent families |
| `packages/sim/src/ai/explain-decision.test.ts` | header/ranking/footer, and the view-only invariant |
| `packages/text-client/src/observer-client.ts` | the observer process |
| `packages/text-client/src/observer-log-tail.ts` | log tailing / record lookup (pure enough to test) |
| `packages/text-client/src/observer-log-tail.test.ts` | append, truncation, missing-seq retry |
| `packages/lobby-server/src/browser/ask-ai.ts` | button state, request, panel |
| `packages/lobby-server/src/browser/ask-ai.test.ts` | `askAiButtonState`, `formatAskAiPanel` |
| `packages/game-server/src/ws/game-session-observer.test.ts` | attach/detach, routing, authorization, timeout |
| `packages/lobby-server/src/http/observer-target.test.ts` | auth, newest-game selection, `since` |
| `bin/observe` | launcher with `--help`, mirroring `bin/watch-game`'s style |

**Changed**

| File | Change |
|---|---|
| `packages/shared/src/types/protocol.ts` | the messages in §4 |
| `packages/game-server/src/ws/game-session.ts` | observer set, presence broadcast, ask/answer relay, exclusion from state broadcasts / spectator badge / keep-alive |
| `packages/sim/src/cli/explain.ts` | calls `explainDecision` instead of assembling the H2 pipeline itself |
| `packages/sim/src/index.ts` | export `explainDecision` and its types |
| `packages/text-client/src/ai-client.ts` | `logCandidates` uses the shared renderer |
| `packages/lobby-server/src/games/launcher.ts` | return `gameId` in `LaunchResult` |
| `packages/lobby-server/src/lobby/lobby.ts` | `WatchableGame` gains `gameId` + `launchedAt`; accessor for the newest |
| `packages/lobby-server/src/http/routes.ts` | `GET /api/system/observer-target` |
| `packages/lobby-server/src/browser/game-connection.ts` | handle `observer` and `ai-explanation` |
| `packages/lobby-server/src/browser/game-entry.ts` | wire the button; include it in `applyDevMode`'s spectator rule |
| `packages/lobby-server/public/index.html`, `public/style.css` | the icon and the panel |
| `packages/sim/README.md`, `docs/ai/` | document `bin/observe` beside `explain` |

## Testing

Following the project's *changed tests only* policy, each phase's tests are the
ones run during development.

**`sim/explain-decision.test.ts`**

- A checked-in scenario explained with `heuristic` renders the header, a ranked
  list with the pick marked, the runner-up gap, and the reproduce line.
- The same scenario with `h2` produces the same lines the `explain` CLI does —
  the guard that the refactor did not change behaviour.
- View-only invariant: from a scenario where the opponent's hand is known in
  the state, no rendered line contains an opponent hand card's name or
  instance id.
- An agent reporting `canDecide === false` gets the delegation note; one that
  does not implement it gets no such line.
- `weightUnit: 'tsd'` renders the quantity label; absent renders the
  ordering-only label.

**`game-server/game-session-observer.test.ts`**

- Attaching broadcasts `observer { attached: true, agent }` to players and
  spectators; disconnecting broadcasts `attached: false`.
- A second observer replaces the first; the old socket is closed.
- An observer join whose name matches a seated player is rejected, and no seat
  changes hands.
- Observers receive no `state` messages and are absent from the `spectators`
  list; an attached observer alone does not keep the session alive.
- `ask-ai` with no observer → `unavailable`.
- `ask-ai` from p1 forwards `ai-question` with the current `stateSeq` and
  `forPlayer: 'p1'`; the `ai-answer` reaches only p1's socket.
- A spectator's `ask-ai` is rejected when not in dev mode.
- Two `ask-ai` messages from one connection: the second is refused.
- Timeout fires `status: 'timeout'`, and a late `ai-answer` for that id is
  dropped rather than delivered.
- `ai-answer` from a non-observer connection is an error.
- `ask-ai` marks the game cheated and broadcasts the flag; a tutorial game does
  not get stamped.

**`text-client/observer-log-tail.test.ts`** — appended records become
retrievable; a requested `stateSeq` that has not landed resolves once written;
a truncated file (dev `undo`) is re-read from the start; a half-written final
line is skipped, not fatal.

**`lobby-server/http/observer-target.test.ts`** — 403 without the master key;
404 with no games; the newest of several games; `since` filtering.

**`lobby-server/browser/ask-ai.test.ts`** — the button-state matrix (attached ×
seated/spectating × dev) and panel formatting for each `status`.

**Manual acceptance** (the feature is a UI loop, so this is the real check):
start the lobby with `npm run dev -w @meccg/lobby-server`, start a game against
the Modular AI, run `bin/observe --agent h2`, confirm the icon appears within a
second, ask on a movement decision and on a combat decision, then run
`bin/observe --agent 'mc:ms=2000/turns=2'` and confirm the icon's title changes
and the answer carries `mc`'s tsd units. Stop the game and confirm the observer
re-attaches to the next one.

## Phased delivery

**Phase 1 — the explanation.** `explainDecision`, the `cli/explain` refactor,
the `ai-client` renderer swap. Delivers value on its own: `explain` keeps
working, and every agent (not just `h2`) becomes explainable from the CLI.

**Phase 2 — the observer process.** Protocol types, game-session attach /
presence / relay, the lobby endpoint, `observer-client.ts`, `bin/observe`.
Testable without any browser work through `--once`, which prints an explanation
of the newest position and exits.

**Phase 3 — the game screen.** Icon, panel, confirmation, wiring. The
user-visible feature lands here.

**Phase 4 — follow-ups, separate specs.** See §10.

## Follow-ups (not in this spec)

- **Several agents per observer.** `bin/observe --agent h2 --agent mc:ms=2000`,
  the icon becoming a small menu, `ask-ai` carrying the chosen spec. The
  protocol is already shaped for it: `ObserverMessage.agent` becomes a list.
- **"Explain the opponent's last move."** Each log record stores the `action`
  that produced it, so the observer can compare what the agent would have done
  against what was actually played — the most interesting question a player has
  while watching an AI.
- **Keyboard shortcut** in `browser/keyboard-shortcuts.ts`.
- **Ask from the replay viewer.** A replay has no socket, but it does have
  `gameId#stateSeq`, so the same explanation could be fetched over HTTP for any
  recorded position.
- **Streaming progress** for slow agents (`mc` rollout counts) instead of a
  spinner.

## Open questions

1. **Cheat marking (§8) is the one policy call.** The spec stamps the game,
   which is right for a rated ladder and mildly annoying for the developer
   who is testing something. The alternative is to stamp only when the asker
   is a *seated player in a rated game* and never for tutorials, self-play, or
   spectators. Decide before Phase 3, since it is a one-line difference.
2. **Default agent** — `h2` is proposed for explanation quality. If `mc` is
   what you actually want to interrogate day to day, the default should be
   `mc:ms=2000/turns=2` and the header should lead with the `canDecide`
   delegation note.
3. **Spectator access in dev mode.** Proposed as allowed, because a spectator
   in dev mode can already open the debug view and see everything. If that
   parity is not wanted, drop it and make Ask AI strictly seated-players-only.
