# Changelog

## 0.2.0 — 2026-03-20

Complete pre-game setup flow, alignment system, and visual feedback.

### Game Engine
- **Setup phase consolidation:** All pre-game steps (character draft, item draft,
  deck draft, site selection, character placement, shuffle, draw, initiative roll)
  merged into a single `Phase.Setup` with `SetupStep` discriminant
- **Alignment system:** `Alignment` enum (wizard, ringwraith, fallen-wizard, balrog)
  with per-alignment rules: max starting company size, allowed starting sites,
  max starting sites
- **Alignment rules module:** `alignment-rules.ts` with extensible per-alignment constants
- **Item draft:** Players assign starting minor items to characters, with definition
  ID-based deduplication for duplicate items
- **Character deck draft:** Players add remaining pool characters to play deck
  (max 10 non-avatar characters)
- **Starting site selection:** Players choose sites from site deck filtered by
  alignment-allowed havens
- **Character placement:** When 2 sites selected, players distribute characters
  between companies; empty companies cleaned up with sites returned to deck
- **Deck shuffle:** Explicit `shuffle-play-deck` action (reusable for future phases)
- **Initial hand draw:** Explicit `draw-cards` action for 8-card starting hand
- **Initiative roll:** 2d6 roll to determine first player, with tie rerolling
- **Visual effects system:** `GameEffect` / `EffectMessage` for client-side feedback,
  starting with dice roll results broadcast from reducer
- **Save/Load/Reset:** Explicit save with backup copy, load from backup, and
  full reset with client reconnection
- **Card data corrections:** Character stats verified against Council of Elrond database

### Web Client
- Card image hover preview on card names (ID-based lookup via STX markers)
- Card back images for unknown cards/sites
- Live-reload in dev mode (esbuild watch + SSE)
- Save/Load/Reset toolbar buttons (hidden in visual mode)
- Draft section hidden after character draft step
- Card names with hover in log messages
- Animated 3D dice roller styled after MECCG Lidless Eye dice
- Debug/visual view toggle persisted in localStorage

### Text Client
- Number-only action selection (removed text commands)
- Reset command for game state
- Pretty-printed debug JSON (over 80 chars)
- AI strategy handles optional actions to avoid infinite loops

### Infrastructure
- Tests moved to `packages/server/src/tests/`
- `/release` slash command for automated releases
- Card data policy in CLAUDE.md (fetch from authoritative database)
- All lint errors resolved

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
