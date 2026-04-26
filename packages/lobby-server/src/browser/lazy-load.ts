/**
 * @module lazy-load
 *
 * Helpers for lazily injecting split browser bundles on demand.
 * Each helper is idempotent: a second call while the script is already
 * loading or loaded is a no-op that resolves immediately.
 */

/** Map from script src to the in-flight or resolved Promise so we inject each script at most once. */
const pending = new Map<string, Promise<void>>();

/**
 * Inject a `<script>` tag with the given `src` once and return a Promise that
 * resolves when the script has loaded. Subsequent calls with the same `src`
 * return the same Promise (idempotent).
 */
export function loadScript(src: string): Promise<void> {
  const existing = pending.get(src);
  if (existing) return existing;
  const p = new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const el = document.createElement('script');
    el.src = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`Failed to load bundle: ${src}`));
    document.head.appendChild(el);
  });
  pending.set(src, p);
  return p;
}

/** Load the game bundle (rendering, game connection, keyboard shortcuts). */
export function loadGameBundle(): Promise<void> {
  return loadScript('/game-bundle.js');
}

/** Load the deck-editor bundle (deck browser and editor UI). */
export function loadDeckEditorBundle(): Promise<void> {
  return loadScript('/deck-editor-bundle.js');
}
