# Split CLAUDE.md into Per-Package Files

## Current State

All project guidance lives in a single root `CLAUDE.md` (~300 lines). Claude Code loads
this file on every conversation turn regardless of which part of the codebase is being
worked on. A lobby-server bug fix loads the full card certification policy; a card effect
implementation loads the lobby auth architecture.

---

## Goal

Reduce per-turn token load by moving content to the package where it is relevant.
Claude Code loads per-directory `CLAUDE.md` files hierarchically: the root is always
loaded, but `packages/shared/CLAUDE.md` is only loaded when working inside that subtree.

---

## Plan

### Root `CLAUDE.md` — keep only cross-cutting content

Retain:
- Project Overview (short paragraph)
- Tech Stack
- Build & Development Commands (all packages)
- Pre-Commit / Pre-Push checklists
- Git Policy
- Architecture (monorepo structure, package list, state model, project references)
- Mail System API note (used from lobby-server and any future tooling)

Remove everything else (moved to sub-packages below).

### `packages/shared/CLAUDE.md` — game engine content

Move from root:
- Key Design Principles (instance IDs as universal reference, no-disappear invariant)
- Server-Side Logging Policy
- Card Data Organization
- Card Data Policy
- `card-ids.ts` Constants Policy
- Card Certification (DSL expressions over magic keywords)
- Card Uniqueness Rules
- Debugging Game Issues
- Testing Philosophy (all subsections)

### `packages/lobby-server/CLAUDE.md` — lobby content

New file. Capture lobby-specific notes not already in code comments:
- Browser code lives in `src/browser/`, static assets in `public/`
- Bundle build via esbuild (`build:browser` script)
- Lobby spawns game-server child processes on demand
- Auth is JWT-based; player store is file-backed

---

## Expected Outcome

- Root `CLAUDE.md` shrinks from ~300 lines to ~80 lines
- Lobby-only work pays only ~80 lines of CLAUDE.md context
- Engine/card work pays ~80 (root) + ~180 (shared) lines — same total as today but
  structured for future trimming
- No content is lost; guidance is co-located with the code it describes
