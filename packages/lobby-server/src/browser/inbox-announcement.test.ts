/**
 * @module inbox-announcement.test
 *
 * Admin "Send Mail to All" mails (topic `announcement`) must stand out:
 * they are highlighted and sorted to the top of the inbox, and the nav-bar
 * Mail count pulses while any of them is still unread.
 *
 * Uses the hand-rolled DOM stub + vi.mock pattern of
 * `inbox-sent-tab-badge.test.ts` (vitest runs in the default node
 * environment, with no jsdom).
 */

import './test-dom-bootstrap.js'; // must precede the inbox import (load-time window access)
import { describe, test, expect, beforeEach, vi } from 'vitest';

const { apiGet, apiSend } = vi.hoisted(() => ({ apiGet: vi.fn(), apiSend: vi.fn() }));
vi.mock('./api.js', () => ({ apiGet, apiSend }));

import { openInbox, updateMailBadge } from './inbox.js';

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
let listEl: StubEl;

const installFreshDom = (): void => {
  badgeEl = new StubEl('span');
  listEl = new StubEl('div');
  const byId: Record<string, StubEl> = {
    'inbox-list': listEl,
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

const mail = (id: string, topic: string, timestamp: string, status = 'read') => ({
  id, status, from: 'Admin', sender: 'player', topic, body: '', timestamp,
  updatedAt: timestamp, subject: id, keywords: {},
});

beforeEach(() => {
  installFreshDom();
  apiGet.mockReset();
  apiSend.mockReset();
});

describe('admin announcements in the inbox', () => {
  test('are sorted above newer ordinary mail and highlighted', async () => {
    apiGet.mockResolvedValue({
      ok: true,
      data: {
        unreadCount: 0,
        unreadAnnouncements: 0,
        messages: [
          mail('newest-reply', 'card-reply', '2026-09-25T12:00:00Z'),
          mail('new-announcement', 'announcement', '2026-09-24T12:00:00Z'),
          mail('older-reply', 'bug-reply', '2026-09-23T12:00:00Z'),
          mail('old-announcement', 'announcement', '2026-09-20T12:00:00Z'),
        ],
      },
    });

    await openInbox();

    const rows = listEl.children.filter(c => c.className.includes('inbox-item'));
    expect(rows.map(r => r.dataset.msgId)).toEqual([
      'new-announcement', 'old-announcement', 'newest-reply', 'older-reply',
    ]);
    expect(rows.map(r => r.className.includes('inbox-item--announcement')))
      .toEqual([true, true, false, false]);
  });
});

describe('the Mail badge pulse', () => {
  test('pulses while an announcement is unread', () => {
    updateMailBadge(4, 1);
    expect(badgeEl.textContent).toBe('(4)');
    expect(badgeEl.classList.contains('lobby-nav-badge--pulse')).toBe(true);
  });

  test('stops pulsing once no announcement is unread', () => {
    updateMailBadge(4, 1);
    updateMailBadge(3, 0);
    expect(badgeEl.textContent).toBe('(3)');
    expect(badgeEl.classList.contains('lobby-nav-badge--pulse')).toBe(false);
  });
});
