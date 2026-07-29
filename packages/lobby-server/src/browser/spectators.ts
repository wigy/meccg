/**
 * @module spectators
 *
 * Toolbar badge showing how many people are watching the current game, and
 * the dialog listing them by name.
 *
 * The server pushes a `spectators` message whenever the watching set changes
 * (and once as each client is seated), because spectators arriving and leaving
 * does not change the game state and so never reaches the state broadcast.
 */

import { showAlert } from './dialog.js';

/** Names of everyone currently watching, as last reported by the server. */
let spectatorNames: readonly string[] = [];

/**
 * How the badge should render for a given watcher list, or null when the
 * badge must not be shown at all.
 *
 * An empty list hides the badge outright rather than showing a zero: a "0"
 * next to the other toolbar icons reads as a broken counter, and there is
 * nothing to open a dialog for.
 */
export function spectatorBadge(names: readonly string[]): { count: string; title: string } | null {
  if (names.length === 0) return null;
  return {
    count: String(names.length),
    title: names.length === 1 ? '1 person watching' : `${names.length} people watching`,
  };
}

/** Body text of the spectator dialog: one watcher per line. */
export function spectatorListText(names: readonly string[]): string {
  const heading = names.length === 1 ? 'Watching this game:' : `Watching this game (${names.length}):`;
  return `${heading}\n\n${names.join('\n')}`;
}

/** Apply the current watcher list to the toolbar button. */
function render(): void {
  const btn = document.getElementById('spectators-btn');
  const count = document.getElementById('spectators-count');
  if (!btn || !count) return;

  const badge = spectatorBadge(spectatorNames);
  if (!badge) {
    btn.style.display = 'none';
    count.textContent = '';
    return;
  }
  btn.style.display = '';
  btn.title = badge.title;
  count.textContent = badge.count;
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

/** Wire the toolbar button to open the watcher list. Call once on load. */
export function initSpectatorsButton(): void {
  document.getElementById('spectators-btn')?.addEventListener('click', () => {
    if (spectatorNames.length === 0) return;
    void showAlert(spectatorListText(spectatorNames));
  });
}
