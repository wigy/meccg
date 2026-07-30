/**
 * @module spectators
 *
 * Toolbar badge showing how many people are watching the current game.
 * Hovering the badge shows the watchers by name in a tooltip — no click or
 * dialog needed, so glancing at who is watching never interrupts play.
 *
 * The server pushes a `spectators` message whenever the watching set changes
 * (and once as each client is seated), because spectators arriving and leaving
 * does not change the game state and so never reaches the state broadcast.
 */

/** Names of everyone currently watching, as last reported by the server. */
let spectatorNames: readonly string[] = [];

/**
 * How the badge should render for a given watcher list, or null when the
 * badge must not be shown at all.
 *
 * An empty list hides the badge outright rather than showing a zero: a "0"
 * next to the other toolbar icons reads as a broken counter, and there is
 * nothing to list in the tooltip.
 */
export function spectatorBadge(names: readonly string[]): { count: string; title: string } | null {
  if (names.length === 0) return null;
  return {
    count: String(names.length),
    title: names.length === 1 ? '1 person watching' : `${names.length} people watching`,
  };
}

/** Text of the hover tooltip: a heading, then one watcher per line. */
export function spectatorListText(names: readonly string[]): string {
  const heading = names.length === 1 ? 'Watching this game:' : `Watching this game (${names.length}):`;
  return `${heading}\n\n${names.join('\n')}`;
}

/** Apply the current watcher list to the toolbar button and its tooltip. */
function render(): void {
  const btn = document.getElementById('spectators-btn');
  const count = document.getElementById('spectators-count');
  const tooltip = document.getElementById('spectators-tooltip');
  if (!btn || !count || !tooltip) return;

  const badge = spectatorBadge(spectatorNames);
  if (!badge) {
    btn.style.display = 'none';
    count.textContent = '';
    tooltip.textContent = '';
    return;
  }
  btn.style.display = '';
  // The name list renders in the custom hover tooltip; a title attribute
  // would pop a second, native tooltip on top of it.
  btn.removeAttribute('title');
  btn.setAttribute('aria-label', badge.title);
  count.textContent = badge.count;
  tooltip.textContent = spectatorListText(spectatorNames);
}

/** Record the watcher list pushed by the server and refresh the badge. */
export function setSpectators(names: readonly string[]): void {
  spectatorNames = names;
  render();
}

/** Clear the watcher list. Call when leaving the game screen. */
export function resetSpectators(): void {
  setSpectators([]);
}
