# Plan: Remove web-client Package

Absorb `@meccg/web-client` into `@meccg/lobby-server` and delete the package.

## Background

The web-client package has two halves:
- **Browser code** (`src/browser/`, ~9,400 lines) — bundled by esbuild into `public/bundle.js`
- **Standalone server** (`src/server/serve.ts`) — HTTP+WS server, fully superseded by lobby-server

The lobby-server already serves web-client's static assets via filesystem path (`../web-client/public`). There is no npm dependency — the coupling is purely path-based.

## Steps

### Phase 1: Move browser source into lobby-server

Move `packages/web-client/src/browser/*.ts` (8 files) to `packages/lobby-server/src/browser/`. No content changes needed — these files only import from `@meccg/shared` and each other via relative imports.

### Phase 2: Move static assets into lobby-server

Move `packages/web-client/public/` contents to `packages/lobby-server/public/`:
- `index.html`, `style.css`, `favicon.svg`
- `fonts/` (Cinzel-Bold.ttf, MedievalSharp.ttf)
- `images/` (~15MB of card backs, icons, backgrounds)

Skip `bundle.js` — it will be regenerated.

### Phase 3: Add esbuild to lobby-server

- Add `esbuild` as devDependency in lobby-server
- Add `build:browser` script: `esbuild src/browser/app.ts --bundle --outfile=public/bundle.js --format=iife --platform=browser`
- Update `build` script to run both tsc and `build:browser`
- Update `dev` script to watch local `public/` instead of `../web-client/public`

### Phase 4: Update lobby-server routes.ts

Change `WEB_CLIENT_PUBLIC` path from `../../../web-client/public` to `../../public` (lobby-server's own public dir). The `fs.watch` call follows automatically.

### Phase 5: Update bin/run-dev-server

- Remove `npm run build -w @meccg/web-client`
- Change esbuild entry point to `packages/lobby-server/src/browser/app.ts`
- Change esbuild output to `packages/lobby-server/public/bundle.js`

### Phase 6: Update root configuration

- **`tsconfig.json`**: Remove `{ "path": "packages/web-client" }` from references
- **`package.json`**: Remove `packages/web-client/tsconfig.json` from build script
- **`.claude/commands/release.md`**: Remove `packages/web-client/package.json` from version bump list

### Phase 7: Handle tsconfig for browser code

Create `packages/lobby-server/tsconfig.browser.json` with `"lib": ["ES2022", "DOM"]` and `"include": ["src/browser"]`. Add to root build script. This keeps DOM types out of the server code.

### Phase 8: Update documentation

- **CLAUDE.md**: Remove web-client commands/description, note browser UI lives in lobby-server
- **README.md**: Remove web-client from directory tree and descriptions

### Phase 9: Delete web-client package

Remove `packages/web-client/` entirely.

### Phase 10: Regenerate lock file

Run `npm install` to update `package-lock.json`.

## What Gets Dropped

- `src/server/serve.ts` — standalone server fully superseded by lobby-server

## Potential Challenges

1. **TypeScript lib conflict**: Browser code needs DOM types; server code shouldn't have them. Separate tsconfig solves this.
2. **esbuild path resolution**: `@meccg/shared` imports should resolve fine since lobby-server already depends on it.
3. **`__dirname` in routes.ts**: Verify the new relative path resolves correctly under both `tsx` (dev) and compiled output.
4. **Git history**: Use `git mv` for clean rename tracking.
