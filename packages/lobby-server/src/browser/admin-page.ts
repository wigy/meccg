/**
 * @module admin-page
 *
 * Renders the admin screen, split into two tabs:
 *
 * **Users** — a list of every account (`GET /api/admin/users`) that drills
 * into one account's full detail (`GET /api/admin/users/:name`): account
 * fields, credit balance history, and completed games. The detail view
 * carries the top-up button. The amount it adds is decided server-side
 * (`POST /api/admin/users/:name/credits/top-up`): 1.5 times everything
 * consumed since the last credit addition, rounded up to the nearest
 * hundred. When nothing was consumed since the last addition there
 * is nothing to add, so pressing the button twice in a row is a no-op the
 * second time.
 *
 * **Requests** — the AI work queue (`GET /api/admin/requests`): every open
 * request across the ai/admin inboxes, plus an "Older Requests" row that
 * pages in already-handled requests 50 at a time
 * (`GET /api/admin/requests/old`). Clicking a row opens the single-request
 * detail view, which carries the delete action and — for already-handled
 * requests — renew, setting the status back to 'new' to re-queue it. A
 * search bar above the list jumps straight to a request by its message ID,
 * probing each request inbox with the detail route.
 *
 * Above the tabs sits the yell bar: a message box whose Yell button
 * broadcasts the text as a system toast to every player online
 * (`POST /api/admin/yell`). Next to it, Send Mail to All opens a
 * subject + message dialog and delivers the mail to every non-system
 * player's inbox (`POST /api/admin/mail-all`).
 */

import { appState, ADMIN_TAB_KEY, type ScreenId } from './app-state.js';
import { apiGet, apiSend } from './api.js';
import { escapeHtml, formatDateTime, formatDuration, orDash } from './html-utils.js';
import { renderMarkdown } from './markdown.js';
import { showConfirm } from './dialog.js';

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
  if (game.winReason === 'concession') return 'Conceded';
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
    <p class="admin-topup-note">Covers 1.5&times; the consumption since the last addition, rounded up to the nearest hundred.</p>`;
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

/** The two admin screen tabs. */
type AdminTab = 'users' | 'requests';

/** The explanatory note under the page title, per tab. */
const TAB_NOTES: Record<AdminTab, string> = {
  users: 'Every registered account. Click a user to see their full record, credit history, and games played.',
  requests: 'Open requests in the AI work queue. Older Requests pages in the already-handled ones, which can be renewed back into the queue. The search box jumps to a request by its message ID.',
};

/** The tab restored on reload: the last one viewed, defaulting to users. */
function storedAdminTab(): AdminTab {
  return sessionStorage.getItem(ADMIN_TAB_KEY) === 'requests' ? 'requests' : 'users';
}

/**
 * The Send Mail to All dialog: subject + message, delivered to every
 * non-system player's inbox. Reports the delivery count in `note`.
 */
function showMailAllDialog(note: HTMLElement): void {
  const modal = document.createElement('div');
  modal.className = 'app-dialog';
  modal.innerHTML = `
    <div class="app-dialog-backdrop"></div>
    <div class="app-dialog-box">
      <h3 class="admin-mail-all-title">Send Mail to All</h3>
      <p class="admin-mail-all-hint">Delivered to every registered player's inbox (system accounts excluded). Markdown supported.</p>
      <input type="text" class="admin-mail-all-subject" maxlength="200" placeholder="Subject...">
      <textarea class="admin-mail-all-body" rows="8" placeholder="Message..."></textarea>
      <div class="app-dialog-actions">
        <span class="admin-mail-all-error"></span>
        <button type="button" class="app-dialog-btn-cancel">Cancel</button>
        <button type="button" class="admin-mail-all-send">Send</button>
      </div>
    </div>`;
  const subject = modal.querySelector<HTMLInputElement>('.admin-mail-all-subject')!;
  const body = modal.querySelector<HTMLTextAreaElement>('.admin-mail-all-body')!;
  const error = modal.querySelector<HTMLElement>('.admin-mail-all-error')!;
  const sendBtn = modal.querySelector<HTMLButtonElement>('.admin-mail-all-send')!;

  const close = (): void => modal.remove();
  modal.querySelector('.app-dialog-backdrop')!.addEventListener('click', close);
  modal.querySelector('.app-dialog-btn-cancel')!.addEventListener('click', close);

  sendBtn.addEventListener('click', () => { void (async () => {
    error.textContent = '';
    if (!subject.value.trim() || !body.value.trim()) {
      error.textContent = 'Subject and message are required.';
      return;
    }
    sendBtn.disabled = true;
    const r = await apiSend<{ recipients: number }>('/api/admin/mail-all', 'POST', {
      subject: subject.value.trim(),
      body: body.value.trim(),
    });
    if (!r.ok) {
      sendBtn.disabled = false;
      error.textContent = r.error ?? 'Failed to send mail';
      return;
    }
    close();
    note.textContent = `Mailed ${r.data.recipients} player${r.data.recipients === 1 ? '' : 's'}.`;
  })(); });

  document.body.appendChild(modal);
  subject.focus();
}

/** The yell bar: broadcast a message as a toast to every player online. */
function renderYellBar(): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'admin-yell';
  bar.innerHTML = `
    <input type="text" class="admin-yell-input" maxlength="500"
      placeholder="Message to yell at every player online...">
    <button type="button" class="admin-yell-btn">Yell</button>
    <button type="button" class="admin-yell-btn admin-mail-all-btn"
      title="Send a mail to every non-system player">Send Mail to All</button>
    <span class="admin-yell-note"></span>`;
  const input = bar.querySelector<HTMLInputElement>('.admin-yell-input')!;
  const btn = bar.querySelector<HTMLButtonElement>('.admin-yell-btn')!;
  const note = bar.querySelector<HTMLElement>('.admin-yell-note')!;
  bar.querySelector<HTMLButtonElement>('.admin-mail-all-btn')!
    .addEventListener('click', () => showMailAllDialog(note));
  const yell = async (): Promise<void> => {
    const message = input.value.trim();
    if (!message) return;
    btn.disabled = true;
    const r = await apiSend('/api/admin/yell', 'POST', { message });
    btn.disabled = false;
    if (!r.ok) {
      note.textContent = r.error ?? 'Failed to yell';
      return;
    }
    note.textContent = 'Yelled.';
    input.value = '';
  };
  btn.addEventListener('click', () => { void yell(); });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void yell();
  });
  return bar;
}

/** Render the Users/Requests tab bar. Clicking a tab re-opens the page on it. */
function renderTabs(active: AdminTab): HTMLElement {
  const tabs = document.createElement('div');
  tabs.className = 'inbox-tabs';
  const entries: [AdminTab, string][] = [['users', 'Users'], ['requests', 'Requests']];
  for (const [tab, label] of entries) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'inbox-tab' + (tab === active ? ' inbox-tab--active' : '');
    btn.textContent = label;
    btn.addEventListener('click', () => { void openAdminPage(tab); });
    tabs.appendChild(btn);
  }
  return tabs;
}

/** Show the admin screen on the given tab (default: the last one viewed). */
export async function openAdminPage(tab?: AdminTab): Promise<void> {
  showScreenFn?.('admin-screen');

  const listEl = document.getElementById('admin-page-list');
  if (!listEl) return;

  const active = tab ?? storedAdminTab();
  sessionStorage.setItem(ADMIN_TAB_KEY, active);
  const note = document.getElementById('admin-page-note');
  if (note) note.textContent = TAB_NOTES[active];

  listEl.innerHTML = '';
  listEl.appendChild(renderYellBar());
  listEl.appendChild(renderTabs(active));
  const content = document.createElement('div');
  listEl.appendChild(content);
  if (active === 'users') await renderUsersTab(content);
  else await renderRequestsTab(content);
}

/** Load and render the user list into the users tab. */
async function renderUsersTab(listEl: HTMLElement): Promise<void> {
  listEl.innerHTML = '<p class="lobby-empty">Loading...</p>';

  const r = await apiGet<{ users: AdminUser[]; initialCredits: number }>('/api/admin/users');
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
  // Accounts that have burned below their initial credits come first, in red,
  // so accounts likely to need a top-up are visible at a glance.
  const lowBalance = (user: AdminUser): boolean => user.credits < r.data.initialCredits;
  const users = [...r.data.users].sort((a, b) => Number(lowBalance(b)) - Number(lowBalance(a)));
  for (const user of users) {
    const tr = document.createElement('tr');
    tr.className = lowBalance(user) ? 'admin-user-row admin-user-row--low' : 'admin-user-row';
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

// ---- Requests tab ----

/** One request row as returned by the admin requests API. */
interface AdminRequest {
  readonly id: string;
  readonly timestamp: string;
  readonly topic: string;
  readonly status: string;
  readonly subject: string;
  readonly from: string;
  readonly keywords: Readonly<Record<string, string>>;
  readonly inbox: string;
}

/** The full mail message behind one request. */
interface AdminRequestDetail {
  readonly id: string;
  readonly status: string;
  readonly from: string;
  readonly sender: string;
  readonly topic: string;
  readonly body: string;
  readonly timestamp: string;
  readonly updatedAt: string;
  readonly subject: string;
  readonly keywords: Readonly<Record<string, string>>;
  readonly inbox: string;
}

/** Inboxes that hold work-queue requests. Mirrors REQUEST_INBOXES in http/routes.ts. */
const REQUEST_INBOXES = ['ai', 'admin'];

/**
 * The request search bar: entering a message ID opens that request's detail
 * page. The detail route needs the inbox, which the ID alone doesn't tell,
 * so each request inbox is probed in turn until one has the message.
 */
function renderRequestSearch(): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'admin-req-search';
  bar.innerHTML = `
    <input type="text" class="admin-req-search-input" maxlength="64"
      placeholder="Message ID...">
    <button type="button" class="admin-req-search-btn">Find</button>
    <span class="admin-req-search-note"></span>`;
  const input = bar.querySelector<HTMLInputElement>('.admin-req-search-input')!;
  const btn = bar.querySelector<HTMLButtonElement>('.admin-req-search-btn')!;
  const note = bar.querySelector<HTMLElement>('.admin-req-search-note')!;
  const search = async (): Promise<void> => {
    const id = input.value.trim().toLowerCase();
    if (!id) return;
    btn.disabled = true;
    note.textContent = '';
    for (const inbox of REQUEST_INBOXES) {
      const r = await apiGet<AdminRequestDetail>(`/api/admin/requests/${inbox}/${encodeURIComponent(id)}`);
      if (r.ok) {
        await openAdminRequestPage(inbox, id);
        return;
      }
    }
    btn.disabled = false;
    note.textContent = 'No request with that ID.';
  };
  btn.addEventListener('click', () => { void search(); });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void search();
  });
  return bar;
}

/** Who filed the request: the keyword the creating route stamped, or the display name. */
function requestor(request: AdminRequest): string {
  return request.keywords.userName ?? request.keywords.reportedBy ?? request.from;
}

/**
 * Build one request row: status badge, title, and requestor. Clicking the
 * row opens the request's detail view, which carries the delete and renew
 * actions.
 */
function requestRow(request: AdminRequest): HTMLTableRowElement {
  const tr = document.createElement('tr');
  tr.className = 'admin-request-row';
  tr.title = 'View request';
  tr.innerHTML = `
    <td><span class="inbox-status inbox-status--${escapeHtml(request.status)}">${escapeHtml(request.status)}</span></td>
    <td>${escapeHtml(request.subject)}</td>
    <td>${escapeHtml(requestor(request))}</td>`;

  tr.addEventListener('click', () => {
    void openAdminRequestPage(request.inbox, request.id);
  });

  return tr;
}

/** Load and render the open-request list into the requests tab. */
async function renderRequestsTab(listEl: HTMLElement): Promise<void> {
  listEl.innerHTML = '<p class="lobby-empty">Loading...</p>';

  const r = await apiGet<{ requests: AdminRequest[] }>('/api/admin/requests');
  if (!r.ok) {
    listEl.innerHTML = `<p class="lobby-empty">${escapeHtml(r.error ?? 'Failed to load requests')}</p>`;
    return;
  }

  const totalEl = document.createElement('p');
  totalEl.className = 'admin-users-total';
  const count = r.data.requests.length;
  totalEl.textContent = `${count} open request${count === 1 ? '' : 's'}`;

  const table = document.createElement('table');
  table.className = 'admin-users-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th>Status</th>
        <th>Title</th>
        <th>Requestor</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector('tbody')!;
  for (const request of r.data.requests) {
    tbody.appendChild(requestRow(request));
  }
  if (count === 0) {
    const empty = document.createElement('tr');
    empty.innerHTML = '<td colspan="3" class="admin-req-empty">No open requests.</td>';
    tbody.appendChild(empty);
  }

  // Last line: pages in already-handled requests, 50 newest-first at a time.
  const olderRow = document.createElement('tr');
  olderRow.className = 'admin-older-row';
  olderRow.innerHTML = '<td colspan="3"><button type="button" class="inbox-action-btn admin-older-btn">Older Requests</button></td>';
  tbody.appendChild(olderRow);
  const olderBtn = olderRow.querySelector<HTMLButtonElement>('.admin-older-btn')!;
  let oldOffset = 0;
  olderBtn.addEventListener('click', () => { void (async () => {
    olderBtn.disabled = true;
    olderBtn.textContent = 'Loading...';
    const old = await apiGet<{ requests: AdminRequest[]; total: number }>(`/api/admin/requests/old?offset=${oldOffset}`);
    if (!old.ok) {
      olderBtn.disabled = false;
      olderBtn.textContent = 'Older Requests';
      return;
    }
    for (const request of old.data.requests) {
      tbody.insertBefore(requestRow(request), olderRow);
    }
    oldOffset += old.data.requests.length;
    if (oldOffset >= old.data.total) {
      olderBtn.textContent = 'No older requests';
    } else {
      olderBtn.disabled = false;
      olderBtn.textContent = 'Older Requests';
    }
  })(); });

  listEl.innerHTML = '';
  listEl.appendChild(renderRequestSearch());
  listEl.appendChild(totalEl);
  listEl.appendChild(table);
}

/** Show one request's full message: metadata, keywords, and body. */
export async function openAdminRequestPage(inbox: string, id: string): Promise<void> {
  showScreenFn?.('admin-screen');

  const listEl = document.getElementById('admin-page-list');
  if (!listEl) return;

  listEl.innerHTML = '<p class="lobby-empty">Loading...</p>';

  const r = await apiGet<AdminRequestDetail>(`/api/admin/requests/${encodeURIComponent(inbox)}/${encodeURIComponent(id)}`);
  if (!r.ok) {
    listEl.innerHTML = `<p class="lobby-empty">${escapeHtml(r.error ?? 'Failed to load request')}</p>`;
    return;
  }
  const detail = r.data;

  const metaRows: [string, string][] = [
    ['From', escapeHtml(detail.from)],
    ['Requestor', escapeHtml(detail.keywords.userName ?? detail.keywords.reportedBy ?? detail.from)],
    ['Topic', escapeHtml(detail.topic)],
    ['Status', `<span class="inbox-status inbox-status--${escapeHtml(detail.status)}">${escapeHtml(detail.status)}</span>`],
    ['Inbox', escapeHtml(detail.inbox)],
    ['Filed', escapeHtml(formatDateTime(detail.timestamp))],
    ...(detail.updatedAt && detail.updatedAt !== detail.timestamp
      ? [['Updated', escapeHtml(formatDateTime(detail.updatedAt))] as [string, string]]
      : []),
    ['Message ID', escapeHtml(detail.id)],
  ];
  const keywordRows = Object.entries(detail.keywords)
    .map(([key, value]) => [escapeHtml(key), escapeHtml(value)] as [string, string]);

  // Renewing a request that is already 'new' would be a no-op, so the
  // renew button only appears on already-handled requests.
  const renewBtn = detail.status !== 'new'
    ? '<button type="button" class="inbox-action-btn" data-action="renew" title="Put back into the queue">Renew</button>'
    : '';
  listEl.innerHTML = `
    <div class="admin-detail-head">
      <button type="button" class="admin-back">&larr; Back to requests</button>
      <h3 class="admin-detail-name">${escapeHtml(detail.subject)}</h3>
      <span class="admin-req-actions">
        ${renewBtn}
        <button type="button" class="inbox-action-btn inbox-action-btn--danger" data-action="delete">Delete</button>
      </span>
    </div>
    <dl class="admin-profile">${metaRows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
    ${keywordRows.length > 0 ? `
    <section class="admin-section">
      <h4 class="admin-section-title">Keywords</h4>
      <dl class="admin-profile">${keywordRows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
    </section>` : ''}
    <section class="admin-section">
      <h4 class="admin-section-title">Message</h4>
      <div class="inbox-message-body">${renderMarkdown(detail.body)}</div>
    </section>
  `;

  listEl.querySelector('.admin-back')?.addEventListener('click', () => {
    void openAdminPage('requests');
  });

  listEl.querySelector('[data-action="renew"]')?.addEventListener('click', () => { void (async () => {
    const post = await apiSend(`/api/admin/requests/${encodeURIComponent(detail.inbox)}/${encodeURIComponent(detail.id)}/renew`, 'POST');
    // Reload the detail so the status badge shows 'new' and the renew
    // button disappears.
    if (post.ok) await openAdminRequestPage(detail.inbox, detail.id);
  })(); });

  listEl.querySelector('[data-action="delete"]')?.addEventListener('click', () => { void (async () => {
    if (!await showConfirm(`Delete request "${detail.subject}"?`, { okLabel: 'Delete' })) return;
    const post = await apiSend(`/api/admin/requests/${encodeURIComponent(detail.inbox)}/${encodeURIComponent(detail.id)}`, 'DELETE');
    if (post.ok) await openAdminPage('requests');
  })(); });
}
