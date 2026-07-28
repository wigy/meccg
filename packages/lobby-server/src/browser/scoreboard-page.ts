/**
 * @module scoreboard-page
 *
 * Renders the "Scoreboard" page — per-player completed-game tallies from
 * `GET /api/scoreboard`, ordered by games played (no ratings yet). The
 * rows are aggregated server-side from the completed-game records the
 * game-server writes.
 */

import { type ScreenId } from './app-state.js';
import { apiGet } from './api.js';
import { escapeHtml } from './html-utils.js';

// Forward-declared showScreen, set by the lobby module at startup to
// avoid a circular dependency with lobby-screens.ts.
let showScreenFn: ((id: ScreenId) => void) | null = null;

/** Register the showScreen callback. Called once during app init. */
export function setScoreboardPageCallbacks(showScreen: (id: ScreenId) => void): void {
  showScreenFn = showScreen;
}

/** One scoreboard row as returned by the API. */
interface ScoreboardRow {
  readonly name: string;
  readonly human: boolean;
  readonly games: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  readonly lastPlayed: string | null;
}

/** Format an ISO datetime as a locale-friendly date. */
function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString();
}

/** Show the scoreboard page and load the rows from the server. */
export async function openScoreboardPage(): Promise<void> {
  showScreenFn?.('scoreboard-screen');

  const listEl = document.getElementById('scoreboard-page-list');
  if (!listEl) return;

  listEl.innerHTML = '<p class="lobby-empty">Loading...</p>';

  const r = await apiGet<{ rows: ScoreboardRow[] }>('/api/scoreboard');
  if (!r.ok) {
    listEl.innerHTML = `<p class="lobby-empty">${r.error ?? 'Failed to load scoreboard'}</p>`;
    return;
  }

  if (r.data.rows.length === 0) {
    listEl.innerHTML = '<p class="lobby-empty">No completed games yet. The scoreboard fills in as games finish.</p>';
    return;
  }

  const table = document.createElement('table');
  table.className = 'scoreboard-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th class="scoreboard-col-rank">#</th>
        <th>Player</th>
        <th class="scoreboard-col-num">Games</th>
        <th class="scoreboard-col-num">Wins</th>
        <th class="scoreboard-col-num">Losses</th>
        <th class="scoreboard-col-num">Draws</th>
        <th>Last played</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector('tbody')!;
  r.data.rows.forEach((row, index) => {
    const tr = document.createElement('tr');
    const aiBadge = row.human ? '' : ' <span class="scoreboard-ai-badge">AI</span>';
    tr.innerHTML = `
      <td class="scoreboard-col-rank">${index + 1}</td>
      <td>${escapeHtml(row.name)}${aiBadge}</td>
      <td class="scoreboard-col-num">${row.games}</td>
      <td class="scoreboard-col-num">${row.wins}</td>
      <td class="scoreboard-col-num">${row.losses}</td>
      <td class="scoreboard-col-num">${row.draws}</td>
      <td>${escapeHtml(formatDate(row.lastPlayed))}</td>
    `;
    tbody.appendChild(tr);
  });

  listEl.innerHTML = '';
  listEl.appendChild(table);
}
