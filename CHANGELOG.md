# Changelog

## 0.1.0 — 2026-03-19

First milestone release. The core technical stack is functional end-to-end:
game server, text client, web client, card images, and CI.

### Game Engine
- Pure reducer architecture: `(state, action) -> state`
- Character draft with simultaneous picks, collision handling, and set-aside
- Company management: formation, splitting, merging, movement planning
- Combat system: strike assignment, resolution, support, tap-to-fight
- Site phase: play resources, items, factions; influence attempts
- Corruption checks with modifiers
- Marshalling point scoring across all categories
- General influence tracking and overflow detection
- Free Council endgame trigger
- Card draw, discard, and sideboard fetch

### Shared Types & Data
- Full card definition types for all 10 card categories
- Card data (JSON) for The Wizards base set (characters, items, creatures, sites, regions)
- Card image URLs pointing to council-of-rivendell/meccg-remaster repository
- Card back images (standard + site) bundled locally
- Player view projection with hidden information redacted

### Server
- WebSocket game server with two-player sessions
- Spectator support
- Game state save/load
- Auto-restart on code changes (dev mode)

### Text Client
- Interactive terminal client over WebSocket
- ANSI-colored card display by type
- Numbered action selection
- Pluggable AI strategy system with random baseline and smart draft
- Auto-reconnect on server restart
- Debug mode for raw message inspection

### Web Client
- Browser client with HTTP static serving + WebSocket proxy to game server
- Debug view: game state, draft info, action buttons, log panel
- Visual view: card image display (proof of concept)
- Card image hover preview on card names in debug view (ID-based lookup)
- Server-side card image caching proxy (GitHub -> local disk)
- Live-reload in dev mode (esbuild watch + SSE file change notification)
- Persistent view mode and player name in localStorage
- ANSI-to-HTML color conversion for rich text display

### Infrastructure
- TypeScript strict mode throughout
- npm workspaces monorepo
- GitHub Actions CI (lint + test on push)
- ESLint with typescript-eslint
- Vitest test suite
