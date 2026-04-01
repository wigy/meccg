# MECCG

A web-based implementation of the **Middle-Earth Collectible Card Game** (MECCG), the classic trading card game set in Tolkien's Middle-earth. Built almost entirely by AI using Claude Code — from the game engine and rules enforcement to the browser UI and AI opponents. The codebase uses TypeScript and Node.js with a client/server architecture, and AI agents handle ongoing development tasks like bug fixes, feature planning, and card certification.

## Features

- **Pure reducer game engine** — all game state transitions are side-effect-free: `(state, action) → state`
- **Server-authoritative** — the server enforces all rules; clients are presentation layers
- **Card data** from The Wizards, The Lidless Eye, Against the Shadow, The White Hand, and The Balrog sets
- **Card images** served via caching proxy from the [council-of-rivendell/meccg-remaster](https://github.com/council-of-rivendell/meccg-remaster) repository
- **Easy to learn** — the server handles all rules, so new players can focus on strategy without memorizing the rulebook

## Screenshots

![Organization phase](docs/screenshot-organization.png)

## Project Status

| Metric | Done | Total | Progress |
|:-------|-----:|------:|---------:|
| Rule tests | 8 | 295 | 2.7% |
| Card tests | 3 | 39 | 7.7% |
| Cards created | 197 | 1683 | 11.7% |
| Cards certified | 1 | 197 | 0.5% |
| **Total** | **209** | **2214** | **9.4%** |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- npm

### Install

```bash
npm install
```

### Run the Dev Server

Start the development server with hot-reload:

```bash
bin/run-dev-server
```

Open **http://localhost:8080**, register an account, and start a game against another player or against AI.

## Project Structure

```
packages/
├── shared/         # Game engine, types, card data, tests (pure TypeScript)
├── lobby-server/   # Lobby: auth, matchmaking, game lifecycle
├── game-server/    # WebSocket game server, state projection
├── web-client/     # Browser UI (HTML/CSS/JS, esbuild)
└── text-client/    # Text console client
```

- **`@meccg/shared`** — The game engine (pure reducer), card definitions, type system, and all tests
- **`@meccg/lobby-server`** — Lobby server with player registration, login, online presence, matchmaking, and game server lifecycle management
- **`@meccg/game-server`** — WebSocket server managing game sessions, projecting per-player views with hidden info redacted
- **`@meccg/web-client`** — Browser client with a visual board (card art, dice, hand arcs) and a debug view
- **`@meccg/text-client`** — Terminal client with ANSI colors and a pluggable AI strategy system

## Testing

```bash
# Rules tests
npm test

# Card tests (slower, nightly)
npm run test:nightly

# Lint
npm run lint
```

Tests follow a **rules-as-specification** approach: each test maps to a sentence in the official Council of Elrond rules. There are no unit tests — only rules tests and card-specific tests.

## Documentation

```bash
# Generate API docs
npm run docs
```

Additional docs in `docs/`:
- [`coe-rules.md`](docs/coe-rules.md) — CoE rules reference
- [`card-effects-dsl.md`](docs/card-effects-dsl.md) — Declarative card effects DSL design
- [`glossary.md`](docs/glossary.md) — Architecture terms

## Claude Commands

| Command | Description |
|---------|-------------|
| `/ai-processor` | Process the next pending message from the AI inbox |
| `/handle-bug-report` | Investigate and fix a bug from a mail report |
| `/handle-card-request` | Add a card from the CoE database to the card data files |
| `/handle-certify-card` | Verify a card's effects are supported by the game engine |
| `/handle-implementation-request` | Implement a feature from a mailed implementation plan |
| `/handle-mail` | Dispatch a mail message to the appropriate handler |
| `/handle-planning-request` | Create an implementation plan from a feature description |
| `/investigate` | Analyze a game log to diagnose an unexpected game state |
| `/list-requests` | List all incoming requests in the AI user's inbox |
| `/release` | Perform a versioned release with changelog and git tag |
| `/update-readme` | Refresh the Project Status section with current metrics |

## License

[GNU General Public License v3.0](LICENSE)
