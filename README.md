# MECCG

A web-based implementation of the **Middle-Earth Collectible Card Game** (MECCG), the classic trading card game set in Tolkien's Middle-earth. Built almost entirely by AI using Claude Code — from the game engine and rules enforcement to the browser UI and AI opponents. The codebase uses TypeScript and Node.js with a client/server architecture, and AI agents handle ongoing development tasks like bug fixes, feature planning, and card certification.

## Features

- **Pure reducer game engine** — all game state transitions are side-effect-free: `(state, action) → state`
- **Server-authoritative** — the server enforces all rules; clients are presentation layers
- **Card data** from The Wizards, The Lidless Eye, Against the Shadow, The White Hand, and The Balrog sets
- **Card images** served via caching proxy from the [council-of-rivendell/meccg-remaster](https://github.com/council-of-rivendell/meccg-remaster) repository
- **Play against AI** — built-in AI opponents let you play solo; just start a game from the lobby
- **Easy to learn** — the server handles all rules, so new players can focus on strategy without memorizing the rulebook

## Screenshots

![Organization phase](docs/screenshot-organization.png)

## Project Status

| Metric | Done | Total | Progress |
|:-------|-----:|------:|---------:|
| Rule tests | 12 | 295 | 4.1% |
| Card tests | 51 | 70 | 72.9% |
| Cards created | 276 | 1683 | 16.4% |
| Cards certified | 56 | 276 | 20.3% |
| **Total** | **395** | **2324** | **17.0%** |

### Deck Catalog

| Deck | Alignment | Cards | Data Available | Certified |
|:-----|:----------|------:|---------------:|----------:|
| (A) Stewards of Gondor | hero | 117 | 117 (100.0%) | 13 (11.1%) |
| (B) Release the Prisoners | hero | 119 | 48 (40.3%) | 12 (10.1%) |
| (C) Dwarven Quest | hero | 120 | 37 (30.8%) | 10 (8.3%) |
| (D) Bargain between Friends | hero | 119 | 38 (31.9%) | 11 (9.2%) |
| (E) Return of the King | hero | 119 | 56 (47.1%) | 10 (8.4%) |
| (F) Spies and Traitors | minion | 117 | 18 (15.4%) | 3 (2.6%) |
| (G) Marauding Brood of Uglies | minion | 118 | 29 (24.6%) | 3 (2.5%) |
| (H) Stealthy Tribe | minion | 122 | 24 (19.7%) | 3 (2.5%) |
| (I) Morgul Rallying Cry | minion | 122 | 19 (15.6%) | 3 (2.5%) |
| (J) Seducing Nations of Men | minion | 120 | 19 (15.8%) | 0 (0.0%) |
| The Balrog (Development only) | balrog | 28 | 28 (100.0%) | 0 (0.0%) |
| Fallen Wizard (Development only) | fallen-wizard | 33 | 33 (100.0%) | 1 (3.0%) |
| Hero (Development only) | hero | 76 | 76 (100.0%) | 15 (19.7%) |
| Minion (Development only) | minion | 28 | 28 (100.0%) | 0 (0.0%) |

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

Open **<http://localhost:8080>**, register an account, and start a game against another player or against AI.

## Project Structure

```text
packages/
├── shared/         # Game engine, types, card data, tests (pure TypeScript)
├── lobby-server/   # Lobby: auth, matchmaking, game lifecycle, browser UI
├── game-server/    # WebSocket game server, state projection
└── text-client/    # Text console client
```

- **`@meccg/shared`** — The game engine (pure reducer), card definitions, type system, and all tests
- **`@meccg/lobby-server`** — Lobby server with player registration, login, online presence, matchmaking, game server lifecycle management, and browser UI (card art, dice, hand arcs)
- **`@meccg/game-server`** — WebSocket server managing game sessions, projecting per-player views with hidden info redacted
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
| `/handle-certify-card` | Verify a card's effects are supported by the game engine |
| `/handle-implementation-request` | Implement a feature from a mailed implementation plan |
| `/handle-mail` | Dispatch a mail message to the appropriate handler |
| `/handle-planning-request` | Create an implementation plan from a feature description |
| `/investigate` | Analyze a game log to diagnose an unexpected game state |
| `/requests` | List or delete incoming requests in the AI user's inbox |
| `/release` | Perform a versioned release with changelog and git tag |
| `/update-readme` | Refresh the Project Status section with current metrics |

## License

[GNU General Public License v3.0](LICENSE)
