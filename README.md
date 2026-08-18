# MECCG

A web-based implementation of the **Middle-Earth Collectible Card Game** (MECCG), widely regarded as the most complex trading card game in existence, set in Tolkien's Middle-earth. Built entirely by AI using Claude Code — across three roles: **coding** (game engine, rules enforcement, browser UI), **gameplay** (AI opponents you can play against), and **workflow** (AI agents manage the full development lifecycle: triaging bug reports, planning features, implementing fixes, certifying cards, and opening pull requests). The codebase uses TypeScript and Node.js with a client/server architecture.

**Play it now** on the dev server at **<https://ai-meccg.com>** — register an account and start a game against another player or against AI.

For player information, see the [Player Guide](docs/player-guide.md).

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
| Rule tests | 291 | 339 | 85.8% |
| Card tests | 1158 | 1158 | 100.0% |
| Cards created | 1683 | 1683 | 100.0% |
| Cards certified | 1209 | 1683 | 71.8% |
| **Total** | **4341** | **4863** | **89.3%** |

### Deck Catalog

| Deck | Alignment | Cards | Data Available | Certified |
|:-----|:----------|------:|---------------:|----------:|
| (#1) The Shadow-deeps | balrog | 129 | 129 (100.0%) | 129 (100.0%) |
| (#2) Balrog's Host | balrog | 121 | 121 (100.0%) | 121 (100.0%) |
| (A) Stewards of Gondor | hero | 110 | 110 (100.0%) | 110 (100.0%) |
| (B) Release the Prisoners | hero | 110 | 110 (100.0%) | 110 (100.0%) |
| (C) Dwarven Quest | hero | 110 | 110 (100.0%) | 110 (100.0%) |
| (D) Bargain between Friends | hero | 110 | 110 (100.0%) | 110 (100.0%) |
| (E) Return of the King | hero | 110 | 110 (100.0%) | 110 (100.0%) |
| (F) Spies and Traitors | minion | 110 | 110 (100.0%) | 110 (100.0%) |
| (G) Marauding Brood of Uglies | minion | 110 | 110 (100.0%) | 110 (100.0%) |
| (H) Stealthy Tribe | minion | 110 | 110 (100.0%) | 110 (100.0%) |
| (I) Morgul Rallying Cry | minion | 110 | 110 (100.0%) | 110 (100.0%) |
| (J) Seducing Nations of Men | minion | 110 | 110 (100.0%) | 110 (100.0%) |
| (K) Lord of Rings | minion | 110 | 110 (100.0%) | 110 (100.0%) |
| (L) Wolves! | minion | 110 | 110 (100.0%) | 110 (100.0%) |
| (M) It's magic! | minion | 110 | 110 (100.0%) | 110 (100.0%) |
| (N) Smoke on the Water | minion | 110 | 110 (100.0%) | 110 (100.0%) |
| (O) Men of Skill | fallen-wizard | 110 | 110 (100.0%) | 110 (100.0%) |
| (P) Join the Hunt | fallen-wizard | 110 | 110 (100.0%) | 110 (100.0%) |
| (Q) Prophet of Doom | fallen-wizard | 110 | 110 (100.0%) | 110 (100.0%) |
| (R) The Ally-Armada | fallen-wizard | 110 | 110 (100.0%) | 110 (100.0%) |
| (S) Await the Onset | fallen-wizard | 110 | 110 (100.0%) | 110 (100.0%) |
| (T) Feel Free | hero | 110 | 110 (100.0%) | 110 (100.0%) |
| (U) Come by Night upon them | minion | 110 | 110 (100.0%) | 110 (100.0%) |
| (V) Great Shadow | balrog | 110 | 110 (100.0%) | 110 (100.0%) |

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
