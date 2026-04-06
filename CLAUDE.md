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
- **`@meccg/lobby-server`** — Lobby server with player registration, auth, online presence, matchmaking, game lifecycle management, and browser UI. Spawns game-server child processes on demand. Browser code lives in `src/browser/`, static assets in `public/`.
- **State model:** Full game state (server-only) → projection function → player view (per-player, hidden info redacted).
- Project references: game-server and clients reference shared via `tsconfig.json` references + path mappings.

### Key Design Principles

- The server is the authority on game state — clients never modify state directly
- Game rules are enforced server-side; the client is a presentation layer
- The game engine is a pure reducer — no side effects in state transitions
- **Card instance IDs are the universal reference:** Everywhere in the game (state, actions, phase state, UI) cards are referred to by their `CardInstanceId`. A reference may optionally carry the card's identity (definition ID, name), but the instance ID is always the primary key. Never use bare definition IDs or indices where an instance ID should be used.

### Server-Side Logging Policy

All server-side logic must include detailed logging so that the game's decision-making is fully traceable from the console output. This is critical for debugging complex rule interactions.

- **Use the logging helpers** from `src/engine/legal-actions/log.ts` (`logHeading`, `logDetail`, `logResult`) — never use bare `console.log` in engine code.
- **Log every decision and conclusion**, not just the final result. When the engine evaluates a condition, checks a constraint, rejects an action, or chooses between alternatives, log the reasoning with the relevant values.
- **Log at entry and exit** of phase handlers and legal-action computations. Entry logs should state what step/phase is being processed and for which player. Exit logs should summarize the outcome.
- **Log constraint checks with values**: don't just log "mind limit exceeded" — log "Gimli mind 6 would exceed limit (current 15 + 6 > 20)".
- **Log state transitions**: when the game advances to a new phase or setup step, log the transition with the reason (e.g. "Both players stopped drafting → finalizing draft").

### Card Data Organization

- Card data lives in `packages/shared/src/data/` as JSON files, aggregated by `index.ts`.
- **Separate files per extension set:** Each expansion set uses its own data files with a set prefix:
  - `tw-characters.json`, `tw-items.json`, `tw-resources.json`, `tw-creatures.json`, `tw-sites.json`, `tw-regions.json` — The Wizards (TW, base set)
  - `as-characters.json`, `as-sites.json` — Against the Shadow (AS, minion expansion)
  - `le-characters.json`, `le-resources.json`, `le-sites.json` — The Lidless Eye (LE, minion expansion)
  - `wh-sites.json` — The White Hand (WH, fallen-wizard expansion)
  - `ba-characters.json`, `ba-sites.json` — The Balrog (BA, balrog expansion)
- **Card ID convention:** All card IDs use the pattern `{set}-{number}` (e.g. `tw-156`, `le-24`, `wh-58`, `ba-93`). Set prefixes are lowercase.
- **Card types by alignment:** Each alignment has its own card types:
  - Hero: `hero-character`, `hero-site`, `hero-resource-item`, etc.
  - Minion: `minion-character`, `minion-site`
  - Fallen-wizard: `fallen-wizard-site`
  - Balrog: `balrog-site`
- When adding cards from a new extension set, create new data files with the set prefix (e.g. `ba-sites.json` for The Balrog) rather than mixing sets in existing files.

### Card Data Policy

- When adding or modifying card data, always look up the card from the local copy of the authoritative card database at `data/cards.json` — never rely on model knowledge for card text, stats, or IDs. The database is keyed by set code (AS, BA, DM, LE, TD, TW, WH), each containing a `cards` dict keyed by card ID.
- The upstream source is <https://raw.githubusercontent.com/council-of-elrond-meccg/meccg-cards-database/master/cards.json> — refresh the local copy from there when needed.

### Card Certification

- Card certification is the process of implementing a card's effects in the DSL and verifying with a test that the card works as its text defines.
- When certifying a card that requires a new DSL effect type, add the new type to `docs/card-effects-dsl.md` alongside the implementation.

### Card Uniqueness Rules

- Unique cards: only 1 copy allowed per deck.
- Non-unique cards: up to 3 copies allowed per deck.
- All characters and major items in the current card pool are unique. Hazard creatures, minor items (Dagger of Westernesse, Horn of Anor) are non-unique.
- Test fixtures (`makePlayDeck` etc.) must respect these limits.

### Debugging Game Issues

- **Always start from game logs**, not saves. Game logs are at `~/.meccg/logs/games/<gameId>.jsonl` and contain the full history of actions and state transitions.
- Game saves are stored in `~/.meccg/saves/` as JSON files containing the full game state.
- To debug a problem, load the save and inspect `state.phaseState` (current phase/step) and `state.players[N]` (player data — piles contain `CardInstance` objects with `instanceId` and `definitionId`).
- Key fields to check: `phaseState.setupStep.step` (which setup step), per-step state (e.g. `siteSelectionState`, `placementDone`), `players[N].siteDeck`, `players[N].hand`, `players[N].companies`.
- To verify legal actions, trace through the legal action function for the current step with the player's index and state.
- The server logs detailed decision-making to the console.

### Testing Philosophy

Tests verify the **official CoE rules**, not internal implementation. There are no unit tests — only rules-as-specification tests and card tests.

- **Rules tests** (`packages/shared/src/tests/rules/`): Each sentence in the official Council of Elrond rules (source: `docs/coe-rules.md`) maps to a `test()` or `test.todo()`. Tests set up a valid game state and verify the engine computes correct legal actions.
- **Card tests** (`packages/shared/src/tests/cards/`, nightly): One test per card with special rules/effects. Builds game states that trigger each card's rules and verifies correct legal actions.
- **Pattern**: Every test follows: build state → call `computeLegalActions()` or `reduce()` → assert on legal actions or resulting state.
- **`test.todo()`** marks unimplemented rules — a living spec showing what's left to build.
- **No utility tests**: If internal utilities (condition matcher, formatting) break, the rules tests catch it.
- See `docs/testing-plan.md` for the full plan.
- **All test changes must go through a PR** — never commit test modifications directly to master. Create a branch and open a pull request for review.

### Code Documentation Policy

- All modules must have a `@module` JSDoc comment explaining their purpose and how they fit into the architecture.
- All exported interfaces, types, enums, functions, and constants must have JSDoc comments.
- Comments should explain the "why" (game mechanics context, architectural decisions) not just the "what".
- Focus on how pieces fit together and what game rules motivate the design.

### Mail System API

- When calling `/api/system/mail`, the `recipients` field **must** be a JSON array of strings (e.g. `["wigy"]`), never a plain string. Passing a string causes it to be split into individual characters, sending mail to wrong users.
