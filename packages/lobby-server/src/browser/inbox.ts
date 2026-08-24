/**
 * @module inbox
 *
 * Mail inbox and sent-mail UI for the lobby. Renders message lists,
 * individual messages with review/implement/delete actions, and handles
 * tab switching between inbox and sent views.
 */

import { appState, type ScreenId, VIEWING_INBOX_KEY, MAIL_TAB_KEY, MAIL_MSG_KEY } from './app-state.js';
import { renderMarkdown } from './markdown.js';
import { apiGet, apiSend } from './api.js';
import { escapeHtml } from './html-utils.js';

// Forward-declared showScreen, set by the lobby module at startup.
let showScreenFn: ((id: ScreenId) => void) | null = null;

/** Register the showScreen callback to break the circular dependency. */
export function setInboxCallbacks(
  showScreen: (id: ScreenId) => void,
): void {
  showScreenFn = showScreen;
}

/** Shape of a mail message from the API. */
export interface InboxMessage {
  readonly id: string;
  readonly status: string;
  readonly from: string;
  readonly sender: string;
  readonly topic: string;
  readonly body: string;
  readonly timestamp: string;
  readonly updatedAt: string;
  readonly subject: string;
  readonly keywords: Record<string, string>;
  readonly replyTo?: string;
  readonly recipients?: readonly string[];
}

/** Shape of an open request entry from GET /api/mail/requests. */
interface OpenRequest {
  readonly id: string;
  readonly subject: string;
  readonly topic: string;
  readonly status: string;
  readonly timestamp: string;
  readonly ahead: number;
}

/**
 * Short note shown after an open request's title in the requests box. The
 * queue position is only in the summary line, not repeated per row.
 */
function openRequestNote(req: OpenRequest): string {
  return req.topic === 'feature-request' ? 'awaiting approval' : '';
}

/** Fetch the player's open requests and fill the box; it stays hidden when there are none. */
async function loadOpenRequests(box: HTMLElement): Promise<void> {
  const [r, me] = await Promise.all([
    apiGet<{ requests: OpenRequest[] }>('/api/mail/requests'),
    apiGet<{ credits?: number }>('/api/me'),
  ]);
  if (me.ok) appState.lobbyPlayerCredits = me.data.credits ?? 0;
  if (!r.ok || r.data.requests.length === 0) return;
  const requests = r.data.requests;

  const title = document.createElement('div');
  title.className = 'inbox-requests-title';
  title.textContent = `Open requests (${requests.length})`;
  box.appendChild(title);

  if (appState.lobbyPlayerCredits <= 0) {
    // Filing is always allowed, but the AI worker skips requests from players
    // with no balance — say so instead of showing a queue position that will
    // never advance.
    const warning = document.createElement('div');
    warning.className = 'inbox-requests-nofunds';
    warning.textContent = 'You are out of credits — your requests will not progress until your balance is topped up.';
    box.appendChild(warning);
  } else {
    // Summary line: how far the player's next request is from being handled.
    // The list arrives in handling order, so the first entry is the next one.
    const summary = document.createElement('div');
    summary.className = 'inbox-requests-summary';
    const ahead = requests[0].ahead;
    summary.textContent = ahead === 0
      ? 'Your next request is first in the queue.'
      : `${ahead} request${ahead === 1 ? '' : 's'} ahead of your next one.`;
    box.appendChild(summary);
  }

  for (const req of requests) {
    const row = document.createElement('div');
    row.className = 'inbox-requests-item';
    const subject = document.createElement('span');
    subject.className = 'inbox-requests-subject';
    subject.textContent = req.subject;
    subject.title = req.subject;
    row.appendChild(subject);
    const noteText = openRequestNote(req);
    if (noteText) {
      const note = document.createElement('span');
      note.className = 'inbox-requests-note';
      note.textContent = noteText;
      row.appendChild(note);
    }
    box.appendChild(row);
  }

  box.classList.remove('hidden');
}

/** IDs of inbox rows currently in a read (deletable) state — not unread, not waiting. */
function readRowIds(): string[] {
  return [...document.querySelectorAll<HTMLElement>('.inbox-item')]
    .filter(r => !r.classList.contains('inbox-item--unread')
      && !r.classList.contains('inbox-item--waiting'))
    .map(r => r.dataset.msgId ?? '')
    .filter(Boolean);
}

/** Enable the Delete Read button only while at least one read message remains. */
function refreshDeleteReadState(): void {
  const btn = document.getElementById('delete-read-btn') as HTMLButtonElement | null;
  if (btn) btn.disabled = readRowIds().length === 0;
}

/** Render a full message into the message panel. */
function renderMessage(messageEl: HTMLElement, full: InboxMessage): void {
  messageEl.innerHTML = '';

  // Subject
  const h = document.createElement('h3');
  h.className = 'inbox-msg-subject';
  h.textContent = full.subject;
  messageEl.appendChild(h);

  // Metadata table
  const meta = document.createElement('div');
  meta.className = 'inbox-msg-meta';
  const rows = [
    ['Message ID', `<span class="inbox-meta-id">${escapeHtml(full.id)}<span class="inbox-copy-btn" data-copy="${escapeHtml(full.id)}" title="Copy to clipboard">&#x2398;</span></span>`],
    ['From', escapeHtml(full.from)],
    ['Sender', `<span class="inbox-tag inbox-tag--${full.sender}">${escapeHtml(full.sender)}</span>`],
    ['Topic', `<span class="inbox-tag inbox-tag--topic">${escapeHtml(full.topic)}</span>`],
    ...(full.recipients?.length ? [['Recipients', full.recipients.map(escapeHtml).join(', ')]] : []),
    ['Date', new Date(full.timestamp).toLocaleString()],
    ...(full.updatedAt && full.updatedAt !== full.timestamp
      ? [['Updated', new Date(full.updatedAt).toLocaleString()]]
      : []),
    ['Status', `<span class="inbox-status inbox-status--${full.status}">${escapeHtml(full.status)}</span>`],
    ...(full.replyTo ? [['Reply To', `<span class="inbox-meta-id">${escapeHtml(full.replyTo)}<span class="inbox-copy-btn" data-copy="${escapeHtml(full.replyTo)}" title="Copy to clipboard">&#x2398;</span></span>`]] : []),
  ];
  meta.innerHTML = rows.map(([label, value]) =>
    `<span><span class="inbox-meta-label">${label}:</span> <span class="inbox-meta-value">${value}</span></span>`,
  ).join('');
  messageEl.appendChild(meta);

  // Copy button handler
  for (const copyBtn of meta.querySelectorAll('.inbox-copy-btn')) {
    copyBtn.addEventListener('click', (e) => {
      const target = e.currentTarget as HTMLElement;
      void navigator.clipboard.writeText(target.dataset.copy ?? '');
      target.textContent = '\u2713';
      setTimeout(() => { target.textContent = '\u2398'; }, 1500);
    });
  }

  // Keywords
  const kwKeys = Object.keys(full.keywords);
  if (kwKeys.length > 0) {
    const kwSection = document.createElement('div');
    kwSection.className = 'inbox-msg-keywords';
    kwSection.innerHTML = kwKeys.map(key => {
      const val = full.keywords[key];
      const escaped = escapeHtml(val);
      const rendered = /^https?:\/\/\S+$/.test(val)
        ? `<a href="${escaped}" target="_blank" rel="noopener">${escaped}</a>`
        : escaped;
      return `<span><span class="inbox-meta-label">${escapeHtml(key)}:</span> <span class="inbox-meta-value">${rendered}</span></span>`;
    }).join('');
    messageEl.appendChild(kwSection);
  }

  // Body
  const body = document.createElement('div');
  body.className = 'inbox-message-body';
  body.innerHTML = renderMarkdown(full.body);
  messageEl.appendChild(body);

  // Approve / Decline buttons for review-request and feature-request messages
  const reviewable = full.topic === 'review-request'
    || (full.topic === 'feature-request' && appState.lobbyPlayerName === 'admin');
  const actionable = full.status === 'waiting' || full.status === 'new' || full.status === 'read';
  if (actionable && reviewable && appState.lobbyPlayerIsReviewer) {
    const btnContainer = document.createElement('div');
    btnContainer.className = 'inbox-review-actions';

    const approveBtn = document.createElement('button');
    approveBtn.className = 'inbox-approve-btn';
    approveBtn.textContent = 'Approve';

    const declineBtn = document.createElement('button');
    declineBtn.className = 'inbox-decline-btn';
    declineBtn.textContent = 'Decline';

    const handleReview = (action: 'approve' | 'decline', btn: HTMLButtonElement) => {
      void (async () => {
        const resp = await apiSend(`/api/mail/inbox/${full.id}/${action}`, 'POST', {});
        if (resp.ok) {
          const newStatus = action === 'approve' ? 'approved' : 'declined';
          btn.textContent = newStatus.charAt(0).toUpperCase() + newStatus.slice(1);
          approveBtn.disabled = true;
          declineBtn.disabled = true;
          const statusEl = messageEl.querySelector('.inbox-status');
          if (statusEl) {
            statusEl.className = `inbox-status inbox-status--${newStatus}`;
            statusEl.textContent = newStatus;
          }
          // Also update the status badge in the mail list row and
          // remove the waiting highlight now that the review is resolved.
          const listRow = document.querySelector(`.inbox-item[data-msg-id="${full.id}"]`);
          if (listRow) {
            listRow.classList.remove('inbox-item--waiting');
            const listStatus = listRow.querySelector('.inbox-status');
            if (listStatus) {
              listStatus.className = `inbox-status inbox-status--${newStatus}`;
              listStatus.textContent = newStatus;
            }
          }
          // The row is no longer waiting — it is now bulk-deletable.
          refreshDeleteReadState();
        }
      })();
    };

    approveBtn.addEventListener('click', () => handleReview('approve', approveBtn));
    declineBtn.addEventListener('click', () => handleReview('decline', declineBtn));

    btnContainer.appendChild(approveBtn);
    btnContainer.appendChild(declineBtn);
    messageEl.appendChild(btnContainer);
  }

  // Implement button for feature-planning-reply messages
  if (full.topic === 'feature-planning-reply' && appState.lobbyPlayerName === 'admin' && appState.lobbyPlayerIsReviewer) {
    const btnContainer = document.createElement('div');
    btnContainer.className = 'inbox-review-actions';

    const implementBtn = document.createElement('button');
    implementBtn.className = 'inbox-approve-btn';
    implementBtn.textContent = 'Implement';

    implementBtn.addEventListener('click', () => {
      void (async () => {
        implementBtn.disabled = true;
        implementBtn.textContent = 'Sending...';
        const resp = await apiSend(`/api/mail/inbox/${full.id}/implement`, 'POST');
        if (resp.ok) {
          implementBtn.textContent = 'Sent to AI';
        } else {
          implementBtn.textContent = 'Failed';
          implementBtn.disabled = false;
        }
      })();
    });

    btnContainer.appendChild(implementBtn);
    messageEl.appendChild(btnContainer);
  }

  // Delete button — inbox messages only. The delete endpoint is
  // DELETE /api/mail/inbox/:id and no sent-mail counterpart exists, so on
  // the Sent tab (whose messages live in the sender's sent store, not the
  // inbox) the button could never succeed: every click went "Deleting..."
  // → "Failed". Same tab gate as the "Delete Read" bulk button.
  if (appState.activeMailTab === 'inbox') {
    const deleteContainer = document.createElement('div');
    deleteContainer.className = 'inbox-review-actions';
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'inbox-delete-btn';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => {
      void (async () => {
        deleteBtn.disabled = true;
        deleteBtn.textContent = 'Deleting...';
        const resp = await apiSend(`/api/mail/inbox/${full.id}`, 'DELETE');
        if (resp.ok) {
          deleteBtn.textContent = 'Deleted';
          const listRow = document.querySelector(`.inbox-item[data-msg-id="${full.id}"]`);
          if (listRow) listRow.remove();
          // A row was removed — the last read message may now be gone.
          refreshDeleteReadState();
          messageEl.innerHTML = '';
        } else {
          deleteBtn.textContent = 'Failed';
          deleteBtn.disabled = false;
        }
      })();
    });
    deleteContainer.appendChild(deleteBtn);
    messageEl.appendChild(deleteContainer);
  }
}

/** Render a list of messages into the list panel. */
function renderMailList(
  listEl: HTMLElement, messageEl: HTMLElement, messages: InboxMessage[],
  options: { fetchOnClick?: string },
): void {
  listEl.innerHTML = '';

  // Render Inbox/Sent tabs at the top of the list panel
  const tabsDiv = document.createElement('div');
  tabsDiv.className = 'inbox-tabs';
  const inboxTab = document.createElement('button');
  inboxTab.className = 'inbox-tab' + (appState.activeMailTab === 'inbox' ? ' inbox-tab--active' : '');
  inboxTab.textContent = 'Inbox';
  inboxTab.addEventListener('click', () => { void openInbox(); });
  const sentTab = document.createElement('button');
  sentTab.className = 'inbox-tab' + (appState.activeMailTab === 'sent' ? ' inbox-tab--active' : '');
  sentTab.textContent = 'Sent';
  sentTab.addEventListener('click', () => { void openSent(); });
  tabsDiv.appendChild(inboxTab);
  tabsDiv.appendChild(sentTab);
  listEl.appendChild(tabsDiv);

  // Delete Read button — always shown on the inbox tab. Its enabled state is derived
  // from the list rows (see refreshDeleteReadState), so it is disabled whenever there
  // are no read messages and enabled as soon as one is read.
  if (appState.activeMailTab === 'inbox') {
    const deleteReadBtn = document.createElement('button');
    deleteReadBtn.id = 'delete-read-btn';
    deleteReadBtn.className = 'inbox-action-btn inbox-action-btn--danger';
    deleteReadBtn.textContent = 'Delete Read';
    deleteReadBtn.addEventListener('click', () => {
      const ids = readRowIds();
      if (ids.length === 0) return;
      void (async () => {
        deleteReadBtn.disabled = true;
        deleteReadBtn.textContent = 'Deleting...';
        await Promise.all(ids.map(id =>
          fetch(`/api/mail/inbox/${id}`, { method: 'DELETE' }),
        ));
        void openInbox();
      })();
    });
    listEl.appendChild(deleteReadBtn);
  }

  // Open-requests panel above the list — populated asynchronously and
  // revealed only when the player has open requests.
  const requestsBox = document.getElementById('inbox-requests');
  if (requestsBox) {
    requestsBox.innerHTML = '';
    requestsBox.classList.add('hidden');
    void loadOpenRequests(requestsBox);
  }

  if (messages.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'lobby-empty';
    empty.textContent = 'No messages';
    listEl.appendChild(empty);
    refreshDeleteReadState();
    return;
  }
  for (const msg of messages) {
    const row = document.createElement('div');
    row.className = 'inbox-item'
      + (msg.status === 'new' ? ' inbox-item--unread' : '')
      + (msg.status === 'waiting' ? ' inbox-item--waiting' : '');
    row.dataset.msgId = msg.id;

    const info = document.createElement('div');
    info.className = 'inbox-item-info';
    const subject = document.createElement('span');
    subject.className = 'inbox-item-subject';
    subject.textContent = msg.subject;
    const from = document.createElement('span');
    from.className = 'inbox-item-from';
    from.textContent = msg.from;
    const date = document.createElement('span');
    date.className = 'inbox-item-date';
    date.textContent = new Date(msg.timestamp).toLocaleDateString();
    info.appendChild(subject);
    info.appendChild(from);

    const actions = document.createElement('div');
    actions.className = 'inbox-item-actions';
    const statusEl = document.createElement('span');
    statusEl.className = `inbox-status inbox-status--${msg.status}`;
    statusEl.textContent = msg.status;
    actions.appendChild(statusEl);
    actions.appendChild(date);

    row.appendChild(info);
    row.appendChild(actions);

    row.addEventListener('click', () => {
      void (async () => {
        sessionStorage.setItem(MAIL_MSG_KEY, msg.id);
        if (options.fetchOnClick) {
          const msgResp = await apiGet<InboxMessage>(`${options.fetchOnClick}/${msg.id}`);
          if (!msgResp.ok) return;
          row.classList.remove('inbox-item--unread');
          // The message is now read — re-derive the Delete Read enabled state.
          refreshDeleteReadState();
          renderMessage(messageEl, msgResp.data);
        } else {
          renderMessage(messageEl, msg);
        }
      })();
    });

    listEl.appendChild(row);
  }

  // Now that all rows exist, set the Delete Read button's initial enabled state.
  refreshDeleteReadState();
}

/** Update the mail unread badge in the nav bar. */
export function updateMailBadge(count: number): void {
  const badge = document.getElementById('nav-mail-badge');
  if (badge) badge.textContent = count > 0 ? `(${count})` : '';
}

/** Click the inbox row matching the given message ID to restore selection after reload. */
export function autoSelectMessage(msgId: string): void {
  const listEl = document.getElementById('inbox-list');
  if (!listEl) return;
  const row = listEl.querySelector(`.inbox-item[data-msg-id="${msgId}"]`);
  if (row) (row as HTMLElement).click();
}

/** Fetch and display inbox messages. */
export async function openInbox(): Promise<void> {
  sessionStorage.setItem(VIEWING_INBOX_KEY, '1');
  sessionStorage.setItem(MAIL_TAB_KEY, 'inbox');
  sessionStorage.removeItem(MAIL_MSG_KEY);
  showScreenFn?.('inbox-screen');
  appState.activeMailTab = 'inbox';
  const listEl = document.getElementById('inbox-list')!;
  const messageEl = document.getElementById('inbox-message')!;
  listEl.innerHTML = '<p class="lobby-empty">Loading...</p>';
  messageEl.innerHTML = '<p class="lobby-empty">Select a message to read</p>';

  const r = await apiGet<{ messages: InboxMessage[]; unreadCount: number }>('/api/mail/inbox');
  if (!r.ok) {
    listEl.innerHTML = `<p class="lobby-empty">${r.error ?? 'Failed to load inbox'}</p>`;
    return;
  }

  updateMailBadge(r.data.unreadCount);

  renderMailList(listEl, messageEl, r.data.messages, {
    fetchOnClick: '/api/mail/inbox',
  });
}

/** Fetch and display sent messages. */
export async function openSent(): Promise<void> {
  sessionStorage.setItem(VIEWING_INBOX_KEY, '1');
  sessionStorage.setItem(MAIL_TAB_KEY, 'sent');
  sessionStorage.removeItem(MAIL_MSG_KEY);
  showScreenFn?.('inbox-screen');
  appState.activeMailTab = 'sent';
  const listEl = document.getElementById('inbox-list')!;
  const messageEl = document.getElementById('inbox-message')!;
  listEl.innerHTML = '<p class="lobby-empty">Loading...</p>';
  messageEl.innerHTML = '<p class="lobby-empty">Select a message to read</p>';

  const r = await apiGet<{ messages: InboxMessage[] }>('/api/mail/sent');
  if (!r.ok) {
    listEl.innerHTML = `<p class="lobby-empty">${r.error ?? 'Failed to load sent mail'}</p>`;
    return;
  }

  // Note: the unread badge is NOT touched here. It tracks the INBOX unread
  // count (seeded by the server's mail-notification on connect and by
  // openInbox); viewing the Sent tab reads nothing, so zeroing the badge
  // here showed "no unread mail" while unread messages remained.

  renderMailList(listEl, messageEl, r.data.messages, {});
}
