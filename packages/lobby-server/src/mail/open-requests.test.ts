/**
 * @module mail/open-requests.test
 *
 * Tests for the open-requests box data: only the viewing player's queued
 * requests are listed, with positions in the priority order `bin/run-ai`
 * drains the queue in (bug reports first, certifications last).
 */

import { describe, test, expect } from 'vitest';
import { annotateOpenRequests, requestPriority } from './store.js';
import type { UnhandledRequest } from './store.js';
import type { MailStatus, MailTopic } from './types.js';

/** Build a global queue entry as listUnhandledRequests returns it (oldest first). */
function request(id: string, topic: MailTopic, status: MailStatus = 'new'): UnhandledRequest {
  return {
    id,
    timestamp: '2026-07-30T00:00:00.000Z',
    topic,
    status,
    subject: `subject-${id}`,
    from: 'someone',
    keywords: {},
    inbox: 'ai',
  };
}

describe('requestPriority', () => {
  test('mirrors the run-ai tier order', () => {
    expect(requestPriority('bug-report')).toBeLessThan(requestPriority('feature-planning-request'));
    expect(requestPriority('feature-planning-request')).toBe(requestPriority('feature-implementation-request'));
    expect(requestPriority('feature-implementation-request')).toBeLessThan(requestPriority('card-request'));
    expect(requestPriority('card-request')).toBeLessThan(requestPriority('certification-request'));
  });
});

describe('annotateOpenRequests', () => {
  test('lists only the viewing player requests', () => {
    const all = [request('other', 'card-request'), request('own', 'certification-request')];
    const result = annotateOpenRequests(all, new Set(['own']));
    expect(result.map(r => r.id)).toEqual(['own']);
  });

  test('drops everything not in the new queue, like bin/requests', () => {
    const all = [
      request('done', 'certification-request', 'success'),
      request('stale', 'certification-request', 'processing'),
      request('open', 'card-request'),
      request('review', 'review-request', 'waiting'),
    ];
    const result = annotateOpenRequests(all, new Set(['done', 'stale', 'open', 'review']));
    expect(result.map(r => r.id)).toEqual(['open']);
  });

  test('a bug report jumps ahead of earlier lower-priority requests', () => {
    const all = [
      request('cert1', 'certification-request'),
      request('card1', 'card-request'),
      request('my-bug', 'bug-report'),
    ];
    const result = annotateOpenRequests(all, new Set(['my-bug']));
    expect(result).toEqual([expect.objectContaining({ id: 'my-bug', ahead: 0 })]);
  });

  test('counts every request served before mine, whoever filed it', () => {
    const all = [
      request('bug1', 'bug-report'),
      request('card1', 'card-request'),
      request('my-cert', 'certification-request'),
    ];
    const result = annotateOpenRequests(all, new Set(['my-cert']));
    expect(result[0].ahead).toBe(2);
  });

  test('preserves arrival order within a priority tier', () => {
    const all = [
      request('card1', 'card-request'),
      request('my-card', 'card-request'),
    ];
    const result = annotateOpenRequests(all, new Set(['my-card']));
    expect(result[0].ahead).toBe(1);
  });

  test('returns my requests in handling order, next one first', () => {
    const all = [
      request('my-cert', 'certification-request'),
      request('my-bug', 'bug-report'),
    ];
    const result = annotateOpenRequests(all, new Set(['my-cert', 'my-bug']));
    expect(result.map(r => [r.id, r.ahead])).toEqual([['my-bug', 0], ['my-cert', 1]]);
  });
});
