/**
 * @module admin-page
 *
 * Renders the admin screen — a list of every account (`GET /api/admin/users`)
 * that drills into one account's full detail (`GET /api/admin/users/:name`):
 * account fields, credit balance history, and completed games.
 *
 * The detail view carries the top-up button. The amount it adds is decided
 * server-side (`POST /api/admin/users/:name/credits/top-up`): everything
 * consumed since the last credit addition, rounded up to the nearest hundred,
 * plus a 200-credit bonus. When nothing was consumed since the last addition
 * there is nothing to add, so pressing the button twice in a row is a no-op
 * the second time.
 */

import { appState, type ScreenId } from './app-state.js';
import { apiGet, apiSend } from './api.js';
import { escapeHtml } from './html-utils.js';

// Forward-declared showScreen, set by the lobby module at startup to
// avoid a circular dependency with lobby-screens.ts.
let showScreenFn: ((id: ScreenId) => void) | null = null;

/** Register the showScreen callback. Called once during app init. */
export function setAdminPageCallbacks(showScreen: (id: ScreenId) => void): void {
  showScreenFn = showScreen;
}

/** Show or hide the Admin nav item to match the current player's rights. */
export function updateAdminNavVisibility(): void {
  document.getElementById('nav-admin')?.classList.toggle('hidden', !appState.lobbyPlayerIsAdmin);
}

/** One row of the user list as returned by the API. */
interface AdminUser {
  readonly name: string;
  readonly displayName: string;
  readonly email: string;
  readonly credits: number;
  readonly createdAt: string;
  readonly system: boolean;
}

/** One account's stored fields, password hash excluded. */
interface AdminProfile {
  readonly name: string;
  readonly displayName?: string;
  readonly email: string;
  readonly createdAt: string;
  readonly credits?: number;
  readonly currentDeck?: string;
  readonly lastMailView?: string;
  readonly allowMasterKey?: boolean;
  readonly hasPassword: boolean;
  readonly system: boolean;
}

/** One entry of a player's credit history. */
interface CreditHistoryEntry {
  readonly datetime: string;
  readonly amount: number;
  readonly balance: number;
  readonly explanation: string;
}

/** One completed game, as the scoreboard API projects it. */
interface AdminGame {
  readonly gameId: string | null;
  readonly endedAt: string | null;
  readonly turns: number | null;
  readonly durationSeconds: number | null;
  readonly result: 'win' | 'loss' | 'draw';
  readonly winReason: string | null;
  readonly self: { readonly finalScore: number | null };
  readonly opponent: { readonly name: string; readonly human: boolean; readonly finalScore: number | null } | null;
}

/** The full detail payload for one account. */
interface AdminUserDetail {
  readonly profile: AdminProfile;
  readonly history: readonly CreditHistoryEntry[];
  readonly games: readonly AdminGame[];
  readonly pendingTopUp: number;
}

/** Format an ISO datetime as a locale-friendly date + time. */
function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

/** Format a duration in seconds as `1h 04m` / `12m 30s` / `45s`. */
function formatDuration(seconds: number | null): string {
  if (seconds == null) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

/** Fall back to an em dash for missing values. */
function orDash(value: string | number | boolean | null | undefined): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return value == null || value === '' ? '—' : String(value);
}

/** Render the account fields as a definition list. */
function renderProfile(profile: AdminProfile): string {
  const rows: [string, string][] = [
    ['Name', escapeHtml(profile.name)],
    ['Display name', escapeHtml(orDash(profile.displayName))],
    ['Email', escapeHtml(profile.email)],
    ['Registered', escapeHtml(formatDateTime(profile.createdAt))],
    ['Credits', escapeHtml(orDash(profile.credits))],
    ['Current deck', escapeHtml(orDash(profile.currentDeck))],
    ['Last mail view', escapeHtml(formatDateTime(profile.lastMailView))],
    ['Password set', escapeHtml(orDash(profile.hasPassword))],
    ['Master key login', escapeHtml(orDash(profile.allowMasterKey ?? false))],
    ['System account', escapeHtml(orDash(profile.system))],
  ];
  return `<dl class="admin-profile">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
}

/** Render the credit balance history, newest first. */
function renderHistory(history: readonly CreditHistoryEntry[]): string {
  if (history.length === 0) return '<p class="lobby-empty">No credit changes recorded yet.</p>';
  const rows = [...history].reverse().map((entry) => {
    const sign = entry.amount > 0 ? '+' : '';
    const cls = entry.amount > 0 ? 'credits-amount-pos' : entry.amount < 0 ? 'credits-amount-neg' : 'credits-amount-zero';
    return `
      <tr>
        <td>${escapeHtml(formatDateTime(entry.datetime))}</td>
        <td class="credits-col-amount ${cls}">${sign}${entry.amount}</td>
        <td class="credits-col-balance">${entry.balance}</td>
        <td>${escapeHtml(entry.explanation)}</td>
      </tr>`;
  }).join('');
  return `
    <table class="credits-page-table">
      <thead>
        <tr>
          <th>Date</th>
          <th class="credits-col-amount">Change</th>
          <th class="credits-col-balance">Balance</th>
          <th>Reason</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/** How the game was decided, in words. Mirrors the scoreboard's wording. */
function formatWinReason(game: AdminGame): string {
  if (game.result === 'draw') return 'Draw';
  if (game.winReason === 'one-ring') return 'The One Ring';
  if (game.winReason === 'marshalling-points') return 'Marshalling points';
  return orDash(game.winReason);
}

/** Render the account's completed games, newest first. */
function renderGames(games: readonly AdminGame[]): string {
  if (games.length === 0) return '<p class="lobby-empty">No completed games.</p>';
  const rows = games.map((game) => {
    const label = game.result === 'win' ? 'Win' : game.result === 'loss' ? 'Loss' : 'Draw';
    const opponent = game.opponent
      ? escapeHtml(game.opponent.name) + (game.opponent.human ? '' : ' <span class="scoreboard-ai-badge">AI</span>')
      : '—';
    const score = `${orDash(game.self.finalScore)} – ${orDash(game.opponent?.finalScore ?? null)}`;
    return `
      <tr>
        <td>${escapeHtml(formatDateTime(game.endedAt))}</td>
        <td><span class="scoreboard-result scoreboard-result--${game.result}">${label}</span></td>
        <td>${opponent}</td>
        <td>${escapeHtml(score)}</td>
        <td>${escapeHtml(orDash(game.turns))}</td>
        <td>${escapeHtml(formatDuration(game.durationSeconds))}</td>
        <td>${escapeHtml(formatWinReason(game))}</td>
      </tr>`;
  }).join('');
  return `
    <table class="admin-games-table">
      <thead>
        <tr>
          <th>Finished</th>
          <th>Result</th>
          <th>Opponent</th>
          <th>Score</th>
          <th>Turns</th>
          <th>Duration</th>
          <th>Decided by</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/** The top-up control: the offered amount, or why there is nothing to add. */
function renderTopUp(detail: AdminUserDetail): string {
  if (detail.pendingTopUp <= 0) {
    return `<p class="admin-topup-note">Nothing consumed since the last credit addition — no top-up to make.</p>`;
  }
  return `
    <button type="button" class="admin-topup-btn" data-user="${escapeHtml(detail.profile.name)}">
      Add ${detail.pendingTopUp} credits
    </button>
    <p class="admin-topup-note">Covers all consumption since the last addition, rounded up to the nearest hundred, plus 200 extra.</p>`;
}

/** Show one account's full detail: fields, credit history, games. */
export async function openAdminUserPage(userName: string): Promise<void> {
  showScreenFn?.('admin-screen');

  const listEl = document.getElementById('admin-page-list');
  if (!listEl) return;

  listEl.innerHTML = '<p class="lobby-empty">Loading...</p>';

  const r = await apiGet<AdminUserDetail>(`/api/admin/users/${encodeURIComponent(userName)}`);
  if (!r.ok) {
    listEl.innerHTML = `<p class="lobby-empty">${escapeHtml(r.error ?? 'Failed to load user')}</p>`;
    return;
  }
  const detail = r.data;

  listEl.innerHTML = `
    <div class="admin-detail-head">
      <button type="button" class="admin-back">&larr; Back to users</button>
      <h3 class="admin-detail-name">${escapeHtml(detail.profile.displayName ?? detail.profile.name)}</h3>
      <span class="admin-detail-balance">${detail.profile.credits ?? 0} credits</span>
    </div>
    ${renderProfile(detail.profile)}
    <section class="admin-section">
      <h4 class="admin-section-title">Credits</h4>
      <div class="admin-topup">${renderTopUp(detail)}</div>
      ${renderHistory(detail.history)}
    </section>
    <section class="admin-section">
      <h4 class="admin-section-title">Games played (${detail.games.length})</h4>
      ${renderGames(detail.games)}
    </section>
  `;

  listEl.querySelector('.admin-back')?.addEventListener('click', () => {
    void openAdminPage();
  });

  const topUpBtn = listEl.querySelector<HTMLButtonElement>('.admin-topup-btn');
  topUpBtn?.addEventListener('click', () => { void (async () => {
    topUpBtn.disabled = true;
    topUpBtn.textContent = 'Adding...';
    const post = await apiSend(`/api/admin/users/${encodeURIComponent(detail.profile.name)}/credits/top-up`, 'POST');
    if (!post.ok) {
      topUpBtn.disabled = false;
      topUpBtn.textContent = `Add ${detail.pendingTopUp} credits`;
      const note = listEl.querySelector('.admin-topup-note');
      if (note) note.textContent = post.error ?? 'Failed to add credits';
      return;
    }
    // Reload so the balance, history, and the next offered amount all agree
    // with what the server just wrote.
    await openAdminUserPage(detail.profile.name);
  })(); });
}

/** Show the admin screen and load the user list from the server. */
export async function openAdminPage(): Promise<void> {
  showScreenFn?.('admin-screen');

  const listEl = document.getElementById('admin-page-list');
  if (!listEl) return;

  listEl.innerHTML = '<p class="lobby-empty">Loading...</p>';

  const r = await apiGet<{ users: AdminUser[] }>('/api/admin/users');
  if (!r.ok) {
    listEl.innerHTML = `<p class="lobby-empty">${escapeHtml(r.error ?? 'Failed to load users')}</p>`;
    return;
  }

  if (r.data.users.length === 0) {
    listEl.innerHTML = '<p class="lobby-empty">No accounts registered yet.</p>';
    return;
  }

  const nonSystemCount = r.data.users.filter((user) => !user.system).length;
  const totalEl = document.createElement('p');
  totalEl.className = 'admin-users-total';
  totalEl.textContent = `${nonSystemCount} registered user${nonSystemCount === 1 ? '' : 's'} (system accounts excluded)`;

  const table = document.createElement('table');
  table.className = 'admin-users-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th>Name</th>
        <th>Display name</th>
        <th>Email</th>
        <th class="admin-col-num">Credits</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector('tbody')!;
  for (const user of r.data.users) {
    const tr = document.createElement('tr');
    tr.className = 'admin-user-row';
    const systemBadge = user.system ? ' <span class="admin-system-badge">system</span>' : '';
    tr.innerHTML = `
      <td><button type="button" class="admin-user-link" data-user="${escapeHtml(user.name)}"
        title="Show all data for ${escapeHtml(user.name)}">${escapeHtml(user.name)}</button>${systemBadge}</td>
      <td>${escapeHtml(user.displayName)}</td>
      <td>${escapeHtml(user.email)}</td>
      <td class="admin-col-num">${user.credits}</td>
    `;
    tbody.appendChild(tr);
  }

  // Delegated: clicking anywhere in a row drills into that account.
  table.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    const name = target?.closest<HTMLElement>('[data-user]')?.dataset.user
      ?? target?.closest('tr')?.querySelector<HTMLElement>('[data-user]')?.dataset.user;
    if (name) void openAdminUserPage(name);
  });

  listEl.innerHTML = '';
  listEl.appendChild(totalEl);
  listEl.appendChild(table);
}
