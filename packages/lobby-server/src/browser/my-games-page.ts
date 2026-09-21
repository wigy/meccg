/**
 * @module my-games-page
 *
 * Renders the "My Games" screen — the one place a player can find every
 * game they have a stake in: the game they are currently connected to (if
 * any), games left mid-play with a save/autosave still on disk but nobody
 * connected, and their most recently finished games. Solves "I can't find
 * the game I left off yesterday" — Scores only surfaces games that have
 * already ended.
 *
 * Every row with a game id offers a Replay button using the same
 * `window.__meccg.startReplay(gameId, seatName)` hook the Scores page uses
 * (`scoreboard-game-id-cell.ts`) — the JSONL action log is written
 * continuously, not just at game-over, so this works even for a game still
 * in progress. The seat is always the calling player's own name, since
 * every row on this page is one of *their* games.
 */

import { type ScreenId, appState } from './app-state.js';
import { apiGet } from './api.js';
import { escapeHtml, formatDateTime } from './html-utils.js';
import { loadGameBundle } from './lazy-load.js';
import { gameIdCell } from './scoreboard-game-id-cell.js';
import { renderGame, type PlayerGame } from './scoreboard-page.js';

// Forward-declared showScreen, set by the lobby module at startup to
// avoid a circular dependency with lobby-screens.ts.
let showScreenFn: ((id: ScreenId) => void) | null = null;

/** Register the showScreen callback. Called once during app init. */
export function setMyGamesPageCallbacks(showScreen: (id: ScreenId) => void): void {
  showScreenFn = showScreen;
}

/** The caller's own game currently in progress, as returned by the API. */
interface InProgressGame {
  readonly opponent: string;
  readonly opponentDisplayName: string;
  readonly gameId: string | null;
}

/** One of the caller's unfinished/left-off games, as returned by the API. */
interface UnfinishedGame {
  readonly gameId: string | null;
  readonly opponent: string;
  readonly savedAt: string;
}

/** The full `GET /api/games/mine` response. */
interface MyGamesResponse {
  readonly inProgress: InProgressGame | null;
  readonly unfinished: readonly UnfinishedGame[];
  readonly finished: readonly PlayerGame[];
}

/** One row: an opponent, a status line, and a game-id cell offering Replay. */
function gameRow(opponent: string, status: string, gameId: string | null): string {
  return `
    <dl class="my-games-row">
      <dt>vs ${escapeHtml(opponent)}</dt>
      <dd class="my-games-row-status">${escapeHtml(status)}</dd>
      ${gameIdCell(gameId)}
    </dl>
  `;
}

/** The "In progress" section: at most the caller's one live game. */
function renderInProgress(game: InProgressGame | null): string {
  if (!game) return '';
  return `
    <section class="my-games-section">
      <h3 class="my-games-section-title">In progress</h3>
      ${gameRow(game.opponentDisplayName, 'Currently connected', game.gameId)}
    </section>
  `;
}

/** The "Unfinished" section: games with a save on disk but no live connection. */
function renderUnfinished(games: readonly UnfinishedGame[]): string {
  if (games.length === 0) return '';
  const rows = games.map(g => gameRow(g.opponent, `Left off ${formatDateTime(g.savedAt)}`, g.gameId)).join('');
  return `
    <section class="my-games-section">
      <h3 class="my-games-section-title">Unfinished</h3>
      ${rows}
    </section>
  `;
}

/** The "Finished" section: reuses the Scores page's own game-card markup. */
function renderFinished(games: readonly PlayerGame[]): string {
  const body = games.length === 0
    ? '<p class="lobby-empty">No completed games yet.</p>'
    : games.map(renderGame).join('');
  return `
    <section class="my-games-section">
      <h3 class="my-games-section-title">Finished</h3>
      ${body}
    </section>
  `;
}

/** Show the "My Games" page and load its rows from the server. */
export async function openMyGamesPage(): Promise<void> {
  showScreenFn?.('my-games-screen');

  const listEl = document.getElementById('my-games-list');
  if (!listEl) return;

  listEl.innerHTML = '<p class="lobby-empty">Loading...</p>';

  const r = await apiGet<MyGamesResponse>('/api/games/mine');
  if (!r.ok) {
    listEl.innerHTML = `<p class="lobby-empty">${escapeHtml(r.error ?? 'Failed to load your games')}</p>`;
    return;
  }

  const { inProgress, unfinished, finished } = r.data;
  if (!inProgress && unfinished.length === 0 && finished.length === 0) {
    listEl.innerHTML = '<p class="lobby-empty">No games yet — start one from the lobby.</p>';
    return;
  }

  listEl.innerHTML = renderInProgress(inProgress) + renderUnfinished(unfinished) + renderFinished(finished);

  // Delegated so one listener covers every row on the page, across visits —
  // this container's rows are always the calling player's own games, so
  // (unlike the Scores page's per-player list) the replay seat never
  // changes between renders and the listener needs installing only once.
  if (!listEl.dataset.replayListenerInstalled) {
    listEl.dataset.replayListenerInstalled = 'true';
    listEl.addEventListener('click', (event) => {
      const btn = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('[data-replay-game]');
      const gameId = btn?.dataset.replayGame;
      if (!btn || !gameId || btn.disabled) return;
      btn.disabled = true;
      void loadGameBundle()
        .then(() => window.__meccg?.startReplay?.(gameId, appState.lobbyPlayerName))
        .finally(() => { btn.disabled = false; });
    });
  }
}
