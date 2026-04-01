# Implementation Glossary

Non-game-rule concepts used in the MECCG codebase. For game rules, see `docs/rules.md`.

## Core Architecture

- **Game State** — The full, authoritative server-side state containing all hidden information. Never sent to clients.
- **Player View** — Per-player projection of game state with opponent's hidden info redacted. What the client receives over WebSocket.
- **Projection** — The transformation from GameState → PlayerView that enforces information hiding. Implemented in `packages/game-server/src/ws/projection.ts`.
- **Reducer** — The pure function `(state, action) → state` that implements all state transitions. No side effects. Returns a `ReducerResult` containing the new state, optional error, and optional effects.

## Cards

- **Card Definition** — Static, immutable card data from JSON (stats, effects, text). Identified by `CardDefinitionId` (e.g. `tw-156`).
- **Card Instance** — A runtime copy of a card with a unique `CardInstanceId`. Multiple instances can share one definition (e.g. two Daggers of Westernesse).
- **Instance Map** — Lookup table `CardInstanceId → CardInstance` stored in game state. Used to resolve what card an instance refers to.
- **Card Pool** — Lookup table `CardDefinitionId → CardDefinition` loaded once at game start.

## Actions

- **Action** (`GameAction`) — A player input command representing a game decision (e.g. `play-character`, `pass`). Defined in `packages/shared/src/types/actions.ts`.
- **Legal Action** (`EvaluatedAction`) — An action annotated with viability: `{ action, viable, reason? }`. Non-viable actions include a human-readable explanation (e.g. "Gimli: mind 6 would exceed limit"). Sent to the client so it can show all options with non-viable ones dimmed and tooltipped.
- **Effect** (`GameEffect`) — A side effect produced by the reducer (e.g. notify client), separate from the pure state transition.
- **Regress** — An optional `regress: true` flag on an action indicating it undoes a previous move within the same phase (e.g. canceling a just-planned movement, or moving a character back to its previous influence pool). Regressive actions are still legal but the AI avoids them and the UI renders them distinctly (lighter color / red glow). Tracked via `GameState.reverseActions`, which stores the computed reverse of each organization action taken during the current phase and is cleared on every phase transition. A legal action is marked regressive if it matches a stored reverse action.

## Game Flow

- **Phase** — Top-level stage in the turn cycle: Untap → Organization → Long-event → Movement/Hazard → Site → End-of-Turn. Enum in `Phase`.
- **Step** — Sub-stage within the Setup phase (CharacterDraft, SiteSelection, CharacterPlacement, etc.). Enum in `SetupStep`.
- **Phase State** — Phase-specific bookkeeping stored in game state, discriminated by the `phase` field. Each phase has its own state interface (e.g. `MovementHazardPhaseState` tracks hazards played per company).

## Game Concepts (Implementation-Specific)

- **Company** — A group of characters traveling together. The fundamental unit of movement, hazard-facing, and site actions. Contains character list, current site, destination site, and movement path.
- **Card Certification** — The process of implementing a card's effects in the DSL and verifying with a dedicated test that the card works as its text defines. Each certified card has a test in `packages/shared/src/tests/cards/` that builds a game state triggering the card's rules and asserts correct behavior. Cards are certified one at a time, and new effect types discovered during certification are added to the DSL and documented in `docs/card-effects-dsl.md`.
- **DSL Effect** — A declarative JSON entry in a card definition's `effects` array that describes what the card does at runtime (stat modifiers, check modifiers, triggered abilities, etc.). Each effect has a `type` discriminant and an optional `when` condition. Effects on items/characters are bearer-scoped by default; environment events use a `target` field (`"all-characters"`, `"all-attacks"`) for global scope. Defined in `packages/shared/src/types/effects.ts`, resolved by `packages/shared/src/engine/effects/resolver.ts`.
- **Effective Stats** — Derived character stats (prowess, body, direct influence, corruption) computed from base definition + equipped items + attached effects. Recomputed after every action via `recomputeDerived`.
- **Faded Character** — A character card rendered with reduced opacity (`company-card--faded`) to indicate it has attachments (items, allies, or followers) displayed beneath it. The faded style visually connects the character to its attachments while keeping the overlapping cards readable. Badge positions (stats, mind, DI) shift downward on faded cards to remain visible above the attachment stack.
- **Title Character** — The character whose name is used for a company's display label (e.g. "Aragorn's Company"). Chosen by highest mind (avatar always wins), with tiebreakers on marshalling points, prowess, then name. Rendered first (leftmost) in the company row and marked with a star badge. Not a game rule — purely a UI/display concept.
- **Region Distance** — The number of consecutive regions in a movement path, counting both origin and destination regions. Two sites in the same region have region distance 1. Sites in adjacent regions have region distance 2. The default maximum for region movement is 4 (up to 6 with special effects). Internally the region graph stores edge counts (adjacent = 1); the conversion to rules-style region distance is `edges + 1`.
- **Movement Map** — A precomputed graph built once from the card pool at game start. Contains the region adjacency graph, all-pairs shortest paths, site-to-region lookup, and haven connectivity. Queried via `getReachableSites()` to determine legal movement destinations for a company.

## Mail

- **Mail** — The internal asynchronous messaging system between players, the AI assistant, and the server. Messages are stored as individual JSON files in each player's mail directory (`~/.meccg/players/{name}/mail/inbox/` and `sent/`). Used for card requests, certification requests, review requests, and automated replies. Each message has a status lifecycle (`new` → `read` → `deleted`, or `new` → `processing` → `processed`, or `waiting` → `approved`/`declined` for reviews). The system mail API (`/api/system/mail`) allows the AI and server to send messages programmatically; player-facing inbox is accessed via `/api/mail/inbox`. Implemented in `packages/lobby-server/src/mail/`.

## Persistence

- **Game Save** — A JSON snapshot of the full `GameState` plus the player name-to-ID mapping, written to `~/.meccg/saves/{player1_vs_player2}.json`. Saved on disconnect, on explicit save, and as a backup (`-saved.json`) before load. The save contains everything needed to restore a game session. A save is a **single point-in-time snapshot** — it has no history.
- **Game Log** — Two files per game in `~/.meccg/logs/games/`:
  - `{gameId}.jsonl` — JSONL state log recording a state snapshot after every action, tagged with `stateSeq`, a `reason` string, and the full `action` object with all parameters for action-triggered entries. State snapshots omit `cardPool` (static within a game and stored in the cards file).
  - `{gameId}-cards.json` — Static game data written once at game start. Contains `instances` (compact instance-to-definition mapping) and `cards` (card definitions used in this game).
  The game log is the **complete history** of every state the game has been in — use it (not saves) for debugging and tracing how a state arose. The JSONL log can be truncated via `truncateAfterSeq()` to stay consistent after undo or save load.
- **Server Log** — A daily JSONL file at `~/.meccg/logs/server/YYYY-MM-DD.jsonl` that records server lifecycle events (boot, connect, disconnect), WebSocket messages, and action submissions with error details. Does **not** contain full game state — use the game log for state inspection.

## Client & Debugging

- **Situation Banner** — A styled banner (`.situation-banner`) that provides contextual status text explaining the current game situation and what action is expected. Used in the combat overlay to show phase-specific information like "Dragon — Assign 2 strikes at 15 prowess" or "Choose next strike to resolve (1 of 3 resolved)". Designed to be reusable anywhere the UI needs to explain what is happening and why — e.g. upcoming dice roll context, phase transitions, or pending decisions.
- **Instruction Line** — The `<div id="instruction-text">` element displayed on the visual board that tells the player what to do next. Uses a heavy multi-layer text shadow for readability against card backgrounds. Phase-specific text (e.g. "Character Draft — Pick a character…") is generated by `getInstructionText()` in `render.ts`. Targeting instructions (set via `setTargetingInstruction()` during two-step selection flows like play-character or move-to-influence) take priority over phase text. Also displays contextual prompts like the pending corruption check message after an item transfer. Always positioned at the top center of the screen, above the opponent's hand arc. Styled in `#instruction-text` in `style.css`.
- **Victory Display** — A pile shown in the deck box combining the eliminated pile and kill pile. Clicking it opens the pile browser modal showing all cards. Both players' victory displays are visible and clickable.
- **Pile Browser** — A generic modal dialog (`#pile-browser-modal`) for browsing card piles as image grids. Opened by clicking the site deck, sideboard, or victory display piles. Handles known cards (shows card image) and unknown cards (shows card back). In interactive modes (site selection, movement planning), cards are highlighted as selectable or dimmed with a non-viable reason tooltip. Implemented by `openPileBrowser()` and `populateBrowserGrid()` in `render.ts`.
- **Deck Box** — The fixed-position panel (`.deck-box`) anchored to the bottom-left (self) or top-left (opponent) of the visual view. Contains the player's name and score label plus a grid of pile thumbnails. Self layout: top row = victory display + sideboard, middle row = site deck + play deck, bottom = discard. Opponent layout is mirrored: top row = sideboard + victory display, then discard + site deck, then play deck. Clickable piles (victory display, sideboard, site deck) open the pile browser. Styled in `style.css`, populated by `renderDeckPiles()` and `renderPlayerNames()` in `render.ts`.
- **Debug Mode** — Server flag (`--debug` or `DEBUG=1`) that logs raw JSON messages and card IDs to the console for tracing game logic.
- **Developer Mode** — Client-side toggle (`meccg-dev-mode` in localStorage) that shows dev-only toolbar buttons: Undo, Save, Load, Reseed, Reset, and the Debug/Visual view toggle.
- **Visible Instances** — Subset of the instance map included in PlayerView. Contains only cards the player is allowed to see, used by the client to resolve instance IDs to card names and images.
