/**
 * @module credits-page
 *
 * Renders the "Credit Usage" page — a chronological audit log of every
 * change to the current player's credit balance. Data is fetched from
 * `GET /api/me/credits/history`, which returns the entries written by
 * `bin/credits` (the sole writer of credits across both manual admin
 * commands and automated deductions performed by `bin/handle-mail`).
 */

import { appState, type ScreenId } from './app-state.js';
import { apiGet } from './api.js';
import { escapeHtml, formatDateTime } from './html-utils.js';

// Forward-declared showScreen, set by the lobby module at startup to
// avoid a circular dependency with lobby-screens.ts.
let showScreenFn: ((id: ScreenId) => void) | null = null;

/** Register the showScreen callback. Called once during app init. */
export function setCreditsPageCallbacks(showScreen: (id: ScreenId) => void): void {
  showScreenFn = showScreen;
}

/** Update the credits badge in the nav bar. */
export function updateCreditsBadge(): void {
  const el = document.getElementById('lobby-credits-badge');
  if (el) el.textContent = String(appState.lobbyPlayerCredits);
}

/** One credit history entry as returned by the API. */
interface CreditHistoryEntry {
  readonly datetime: string;
  readonly amount: number;
  readonly balance: number;
  readonly explanation: string;
}

/** Show the credits page and load the history from the server. */
export async function openCreditsPage(): Promise<void> {
  showScreenFn?.('credits-screen');

  const summaryEl = document.getElementById('credits-page-summary');
  const listEl = document.getElementById('credits-page-list');
  if (!summaryEl || !listEl) return;

  summaryEl.textContent = '';
  listEl.innerHTML = '<p class="lobby-empty">Loading...</p>';

  const r = await apiGet<{ credits: number; history: CreditHistoryEntry[] }>('/api/me/credits/history');
  if (!r.ok) {
    listEl.innerHTML = `<p class="lobby-empty">${r.error ?? 'Failed to load credit history'}</p>`;
    return;
  }
  const data = r.data;

  // Refresh the cached balance + nav badge while we're at it.
  appState.lobbyPlayerCredits = data.credits;
  updateCreditsBadge();

  summaryEl.innerHTML = `<strong>Current balance: ${data.credits} credits</strong><p class="credits-page-note">Credits are used to limit unexpected AI expenses. Each bug report or feature request processed by the AI deducts credits from your balance. If you want to actively contribute testing, you can ask for more credits.</p>`;

  if (data.history.length === 0) {
    listEl.innerHTML = '<p class="lobby-empty">No credit changes recorded yet.</p>';
    return;
  }

  // Newest first; the file stores chronological order.
  const rows = [...data.history].reverse();

  const table = document.createElement('table');
  table.className = 'credits-page-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th>Date</th>
        <th class="credits-col-amount">Change</th>
        <th class="credits-col-balance">Balance</th>
        <th>Reason</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector('tbody')!;
  for (const entry of rows) {
    const tr = document.createElement('tr');
    const sign = entry.amount > 0 ? '+' : '';
    const amountClass = entry.amount > 0 ? 'credits-amount-pos' : entry.amount < 0 ? 'credits-amount-neg' : 'credits-amount-zero';
    tr.innerHTML = `
      <td>${escapeHtml(formatDateTime(entry.datetime))}</td>
      <td class="credits-col-amount ${amountClass}">${sign}${entry.amount}</td>
      <td class="credits-col-balance">${entry.balance}</td>
      <td>${escapeHtml(entry.explanation)}</td>
    `;
    tbody.appendChild(tr);
  }

  listEl.innerHTML = '';
  listEl.appendChild(table);
}
