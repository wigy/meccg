/**
 * @module test-dom-bootstrap
 *
 * Test-only side-effect module: installs a bare `window`/`document` on
 * `globalThis` so importing browser modules (several read `window.__meccg` at
 * module-load time) does not crash under vitest's default node environment.
 * Import this BEFORE any `./render-*` module. Individual tests typically replace
 * `globalThis.document` with a richer stub in a `beforeEach`.
 */

const g = globalThis as unknown as { window?: unknown; document?: unknown };
g.window = g.window ?? {};
g.document = g.document ?? {
  createElement: () => ({ dataset: {}, style: {}, children: [], appendChild() { /* no-op */ }, addEventListener() { /* no-op */ } }),
  getElementById: () => null,
  addEventListener() { /* no-op */ },
};
