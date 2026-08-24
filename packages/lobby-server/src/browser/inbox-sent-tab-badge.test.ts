/**
 * @module inbox-sent-tab-badge.test
 *
 * Regression test for the unread-mail badge being wiped by the Sent tab.
 * `openSent()` unconditionally called `updateMailBadge(0)`, but the badge
 * tracks the INBOX unread count — seeded by the server's `mail-notification`
 * on every lobby WS connect and set from the fetched `unreadCount` by
 * `openInbox()`. Viewing the Sent tab reads nothing and marks nothing read,
 * so zeroing it there showed "no unread mail" while unread messages
 * remained, until the next mail event or reconnect corrected it.
 *
 * Uses the hand-rolled DOM stub + vi.mock pattern of
 * `inbox-sent-tab-delete.test.ts` (vitest runs in the default node
 * environment, with no jsdom).
 */

import './test-dom-bootstrap.js'; // must precede the inbox import (load-time window access)
import { describe, test, expect, beforeEach, vi } from 'vitest';

const { apiGet, apiSend } = vi.hoisted(() => ({ apiGet: vi.fn(), apiSend: vi.fn() }));
vi.mock('./api.js', () => ({ apiGet, apiSend }));

import { openInbox, openSent } from './inbox.js';

class StubEl {
  tagName: string;
  id = '';
  className = '';
  textContent = '';
  innerHTML = '';
  dataset: Record<string, string> = {};
  children: StubEl[] = [];
  classList = {
    classes: new Set<string>(),
    add: (...cs: string[]) => { for (const c of cs) this.classList.classes.add(c); },
    remove: (...cs: string[]) => { for (const c of cs) this.classList.classes.delete(c); },
    contains: (c: string) => this.classList.classes.has(c),
  };
  constructor(tagName: string) { this.tagName = tagName; }
  appendChild(child: StubEl): StubEl { this.children.push(child); return child; }
  addEventListener(): void { /* no-op */ }
  querySelector(): null { return null; }
  querySelectorAll(): StubEl[] { return []; }
}

let badgeEl: StubEl;

const installFreshDom = (): void => {
  badgeEl = new StubEl('span');
  const byId: Record<string, StubEl> = {
    'inbox-list': new StubEl('div'),
    'inbox-message': new StubEl('div'),
    'nav-mail-badge': badgeEl,
  };
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
};

beforeEach(() => {
  installFreshDom();
  apiGet.mockReset();
  apiSend.mockReset();
});

describe('the unread-mail badge', () => {
  test('is not wiped by opening the Sent tab while unread inbox mail remains', async () => {
    // Server seeded the badge with the real unread count (3 unread).
    badgeEl.textContent = '(3)';
    apiGet.mockResolvedValue({ ok: true, data: { messages: [] } });

    await openSent();

    expect(badgeEl.textContent).toBe('(3)');
  });

  test('is set from the fetched unreadCount when opening the inbox', async () => {
    badgeEl.textContent = '(3)';
    apiGet.mockResolvedValue({ ok: true, data: { messages: [], unreadCount: 2 } });

    await openInbox();

    expect(badgeEl.textContent).toBe('(2)');
  });
});
