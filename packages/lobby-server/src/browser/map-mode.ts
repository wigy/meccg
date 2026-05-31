/**
 * @module map-mode
 *
 * Shared map layer mode that persists across radar renders and full-map opens.
 * Both the radar and the full-screen overlay read from and write to this module
 * so switching mode in the full map is immediately reflected in the radar on
 * the next state render.
 */

import { getUnderDeepsCoordinates } from './map-under-deeps.js';

export type MapMode = 'surface' | 'under-deeps';

const STORAGE_KEY = 'meccg-map-mode';

function loadMode(): MapMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'under-deeps' ? 'under-deeps' : 'surface';
  } catch {
    return 'surface';
  }
}

let mode: MapMode = loadMode();
const listeners: Array<(m: MapMode) => void> = [];

export function getMapMode(): MapMode { return mode; }

export function setMapMode(m: MapMode): void {
  mode = m;
  try { localStorage.setItem(STORAGE_KEY, m); } catch { /* quota or private mode */ }
  for (const fn of listeners) fn(m);
}

/** Register a callback fired whenever the mode changes. Returns an unsubscribe function. */
export function onMapModeChange(fn: (m: MapMode) => void): () => void {
  listeners.push(fn);
  return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
}

/**
 * Returns true when the given site is on the currently active map level.
 *
 * A site is under-deeps if its card definition carries the `under-deeps` keyword
 * (authoritative, always available synchronously) OR if it has under-deeps
 * coordinates in the loaded cache (fallback for when the definition is absent).
 */
export function isOnCurrentLevel(siteName: string, siteDef?: { keywords?: readonly string[] }): boolean {
  const isUnder =
    (siteDef?.keywords?.includes('under-deeps') ?? false) ||
    getUnderDeepsCoordinates(siteName) !== null;
  return mode === 'under-deeps' ? isUnder : !isUnder;
}
