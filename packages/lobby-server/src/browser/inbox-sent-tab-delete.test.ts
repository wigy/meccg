/**
 * @module inbox-sent-tab-delete.test
 *
 * Regression test for the Sent tab's Delete button that could never succeed.
 * `renderMessage` unconditionally appended a Delete button wired to
 * `DELETE /api/mail/inbox/:id` — the only mail-delete endpoint the server
 * has. Messages on the Sent tab live in the sender's sent store, not the
 * inbox, so every click went "Deleting..." → "Failed". The button is now
 * rendered only on the inbox tab, the same gate the "Delete Read" bulk
 * button already used.
 *
 * Uses the hand-rolled DOM stub + vi.mock pattern of
 * `scoreboard-replay-button-disabled.test.ts` (the package runs vitest in
 * the default node environment, with no jsdom).
 */

import './test-dom-bootstrap.js'; // must precede the inbox import (load-time window access)
import { describe, test, expect, beforeEach, vi } from 'vitest';

const { apiGet, apiSend } = vi.hoisted(() => ({ apiGet: vi.fn(), apiSend: vi.fn() }));
vi.mock('./api.js', () => ({ apiGet, apiSend }));

// Vitest hoists the vi.mock call above the static import below, so inbox.ts
// picks up the mocked api.js.
import { openInbox, openSent } from './inbox.js';

class StubEl {
  tagName: string;
  id = '';
  className = '';
  textContent = '';
  innerHTML = '';
  dataset: Record<string, string> = {};
  children: StubEl[] = [];
  disabled = false;
  classList = {
    classes: new Set<string>(),
    add: (...cs: string[]) => { for (const c of cs) this.classList.classes.add(c); },
    remove: (...cs: string[]) => { for (const c of cs) this.classList.classes.delete(c); },
    contains: (c: string) => this.classList.classes.has(c),
  };
  private listeners: { type: string; cb: (event: unknown) => void }[] = [];
  constructor(tagName: string) { this.tagName = tagName; }
  appendChild(child: StubEl): StubEl { this.children.push(child); return child; }
  addEventListener(type: string, cb: (event: unknown) => void): void { this.listeners.push({ type, cb }); }
  click(): void { for (const l of this.listeners) { if (l.type === 'click') l.cb({}); } }
  querySelector(): null { return null; }
  querySelectorAll(): StubEl[] { return []; }
  /** Depth-first collect self + every descendant. */
  all(): StubEl[] { return [this, ...this.children.flatMap(c => c.all())]; }
}

let listEl: StubEl;
let messageEl: StubEl;

function installFreshDom(): void {
  listEl = new StubEl('div');
  messageEl = new StubEl('div');
  const byId: Record<string, StubEl> = { 'inbox-list': listEl, 'inbox-message': messageEl };
  (globalThis as unknown as { document: unknown }).document = {
    getElementById: (id: string) => byId[id] ?? null,
    createElement: (tag: string) => new StubEl(tag),
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  (globalThis as unknown as { sessionStorage: unknown }).sessionStorage = {
    setItem: () => { /* no-op */ },
    removeItem: () => { /* no-op */ },
    getItem: () => null,
  };
}

const MESSAGE = {
  id: 'msg-1',
  from: 'alice',
  subject: 'Hello',
  body: 'A body.',
  sender: 'player',
  topic: 'chat',
  status: 'read',
  timestamp: '2026-08-20T10:00:00.000Z',
  keywords: {},
};

const deleteButtons = (): StubEl[] =>
  messageEl.all().filter(e => e.className === 'inbox-delete-btn');

const firstRow = (): StubEl | undefined =>
  listEl.all().find(e => e.className.startsWith('inbox-item'));

beforeEach(() => {
  installFreshDom();
  apiGet.mockReset();
  apiSend.mockReset();
});

describe('the message Delete button', () => {
  test('does not render on the Sent tab, where no delete endpoint exists', async () => {
    apiGet.mockResolvedValue({ ok: true, data: { messages: [MESSAGE] } });
    await openSent();

    firstRow()?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(firstRow()).toBeDefined();
    expect(deleteButtons()).toHaveLength(0);
  });

  test('still renders for an inbox message', async () => {
    apiGet.mockResolvedValue({ ok: true, data: { messages: [MESSAGE], unreadCount: 0 } });
    await openInbox();

    apiGet.mockResolvedValue({ ok: true, data: MESSAGE });
    firstRow()?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(deleteButtons()).toHaveLength(1);
  });
});
