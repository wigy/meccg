/**
 * @module inbox
 *
 * Mail inbox and sent-mail UI for the lobby. Renders message lists,
 * individual messages with review/implement/delete actions, and handles
 * tab switching between inbox and sent views.
 */

import { appState, type ScreenId, VIEWING_INBOX_KEY, MAIL_TAB_KEY, MAIL_MSG_KEY } from './app-state.js';
import { renderMarkdown } from './markdown.js';

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
  readonly subject: string;
  readonly keywords: Record<string, string>;
  readonly replyTo?: string;
  readonly recipients?: readonly string[];
}

/** Escape HTML special characters for safe insertion via innerHTML. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
    kwSection.innerHTML = kwKeys.map(key =>
      `<span><span class="inbox-meta-label">${escapeHtml(key)}:</span> <span class="inbox-meta-value">${escapeHtml(full.keywords[key])}</span></span>`,
    ).join('');
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
        const resp = await fetch(`/api/mail/inbox/${full.id}/${action}`, { method: 'POST' });
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
          // Also update the status badge in the mail list row
          const listRow = document.querySelector(`.inbox-item[data-msg-id="${full.id}"]`);
          if (listRow) {
            const listStatus = listRow.querySelector('.inbox-status');
            if (listStatus) {
              listStatus.className = `inbox-status inbox-status--${newStatus}`;
              listStatus.textContent = newStatus;
            }
          }
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
        const resp = await fetch(`/api/mail/inbox/${full.id}/implement`, { method: 'POST' });
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

  // Delete button
  const deleteContainer = document.createElement('div');
  deleteContainer.className = 'inbox-review-actions';
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'inbox-delete-btn';
  deleteBtn.textContent = 'Delete';
  deleteBtn.addEventListener('click', () => {
    void (async () => {
      deleteBtn.disabled = true;
      deleteBtn.textContent = 'Deleting...';
      const resp = await fetch(`/api/mail/inbox/${full.id}`, { method: 'DELETE' });
      if (resp.ok) {
        deleteBtn.textContent = 'Deleted';
        const listRow = document.querySelector(`.inbox-item[data-msg-id="${full.id}"]`);
        if (listRow) listRow.remove();
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

  // Feature request button
  const featureBtn = document.createElement('button');
  featureBtn.className = 'inbox-action-btn';
  featureBtn.textContent = 'Feature Request';
  featureBtn.addEventListener('click', () => {
    const modal = document.getElementById('feature-request-modal')!;
    const subjectEl = document.getElementById('feature-request-subject') as HTMLInputElement;
    const bodyEl = document.getElementById('feature-request-body') as HTMLTextAreaElement;
    subjectEl.value = '';
    bodyEl.value = '';
    modal.classList.remove('hidden');
    subjectEl.focus();
  });
  listEl.appendChild(featureBtn);

  if (messages.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'lobby-empty';
    empty.textContent = 'No messages';
    listEl.appendChild(empty);
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
          const msgResp = await fetch(`${options.fetchOnClick}/${msg.id}`);
          if (!msgResp.ok) return;
          const full = await msgResp.json() as InboxMessage;
          row.classList.remove('inbox-item--unread');
          renderMessage(messageEl, full);
        } else {
          renderMessage(messageEl, msg);
        }
      })();
    });

    listEl.appendChild(row);
  }
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

  try {
    const resp = await fetch('/api/mail/inbox');
    if (!resp.ok) { listEl.innerHTML = '<p class="lobby-empty">Failed to load inbox</p>'; return; }
    const data = await resp.json() as { messages: InboxMessage[]; unreadCount: number };

    updateMailBadge(data.unreadCount);

    renderMailList(listEl, messageEl, data.messages, {
      fetchOnClick: '/api/mail/inbox',
    });
  } catch {
    listEl.innerHTML = '<p class="lobby-empty">Connection error</p>';
  }
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

  try {
    const resp = await fetch('/api/mail/sent');
    if (!resp.ok) { listEl.innerHTML = '<p class="lobby-empty">Failed to load sent mail</p>'; return; }
    const data = await resp.json() as { messages: InboxMessage[] };

    updateMailBadge(0);

    renderMailList(listEl, messageEl, data.messages, {});
  } catch {
    listEl.innerHTML = '<p class="lobby-empty">Connection error</p>';
  }
}
