/**
 * @module bundle
 *
 * esbuild entry alias: bundles the lobby app entry (`app.ts`) into
 * `public/bundle.js`. The alias exists so esbuild's `[name]` output maps
 * straight onto the filename the HTML loads — no post-build renames —
 * which is what lets `esbuild --watch` keep the bundle fresh in dev mode.
 */
import './app.js';
