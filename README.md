# MECCG

A web-based implementation of the **Middle-Earth Collectible Card Game** (MECCG), the classic trading card game set in Tolkien's Middle-earth. Built with TypeScript and Node.js using a client/server architecture.

## Features

- **Pure reducer game engine** — all game state transitions are side-effect-free: `(state, action) → state`
- **Server-authoritative** — the server enforces all rules; clients are presentation layers
- **Two client options** — a browser-based visual client and an interactive text console client
- **Card data** from The Wizards, The Lidless Eye, Against the Shadow, The White Hand, and The Balrog sets
- **Card images** served via caching proxy from the [council-of-rivendell/meccg-remaster](https://github.com/council-of-rivendell/meccg-remaster) repository

## Screenshots

![Character draft](docs/screenshot-character-draft.png)

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- npm

### Install

```bash
npm install
```

### Run a Game

Start the game server with two player names:

```bash
npm run start -w @meccg/server -- Alice Bob
```

Then start the web client in another terminal:

```bash
npm run start -w @meccg/client-web
```

Open **http://localhost:8080** in your browser, enter a player name, and connect.

Alternatively, use the text client:

```bash
npm run start -w @meccg/client-text -- Alice
```

### Development Mode

Use `dev` instead of `start` for hot-reload:

```bash
npm run dev -w @meccg/server -- Alice Bob
npm run dev -w @meccg/client-web
```

Add `--debug` to see raw JSON messages and card IDs.

## Project Structure

```
packages/
├── shared/       # Game engine, types, card data, tests (pure TypeScript)
├── server/       # WebSocket game server, state projection
├── client-web/   # Browser UI (HTML/CSS/JS, esbuild)
└── client-text/  # Text console client
```

- **`@meccg/shared`** — The game engine (pure reducer), card definitions, type system, and all tests
- **`@meccg/server`** — WebSocket server managing game sessions, projecting per-player views with hidden info redacted
- **`@meccg/client-web`** — Browser client with a visual board (card art, dice, hand arcs) and a debug view
- **`@meccg/client-text`** — Terminal client with ANSI colors and a pluggable AI strategy system

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
- `rules.md` — CoE rules reference
- `card-effects-dsl.md` — Declarative card effects DSL design
- `movement-hazard-phase.md` — Movement/Hazard phase rules
- `testing-plan.md` — Testing strategy
- `glossary.md` — Architecture terms

## License

[GNU General Public License v3.0](LICENSE)
