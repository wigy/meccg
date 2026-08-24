/**
 * @module mail/peek-message.test
 *
 * Regression tests for the review-approve finalizer's handling of the
 * original AI request. The approve path used `readMessage('ai', id)` as its
 * double-send guard — but readMessage is not a pure read: it flips a
 * status-'new' message to 'read' (the request topics are not in its exempt
 * list). A request the admin had just RENEWED back into the AI work queue is
 * exactly status 'new', so approving a stale review-request silently dropped
 * it from the queue (`listUnhandledRequests` and /api/system/ai-requests
 * filter on status === 'new') and then re-finalized it to 'success' —
 * undoing the renew with no error anywhere. routes.ts even documents the
 * rule at the admin request-view route ("Deliberately not readMessage").
 *
 * The approve path now uses the side-effect-free `peekMessage` and the
 * `reviewFinalizeDisposition` rule, both pinned here.
 */

import { describe, test, expect, vi } from 'vitest';
import * as fs from 'fs';

// config.ts reads PLAYERS_DIR once at import time, so the redirect must run
// before the store import below — which is exactly what vi.hoisted
// guarantees (same pattern as game-session-observer.test.ts).
const { TMP } = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? '/tmp'}/meccg-peek-message-test`;
  process.env.PLAYERS_DIR = dir;
  return { TMP: dir };
});

fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

import { sendMail, peekMessage, readMessage, reviewFinalizeDisposition } from './store.js';
import type { MailMessage, MailStatus } from './types.js';

const sendRequest = (): string => sendMail(['ai'], {
  from: 'wigy',
  sender: 'player',
  topic: 'card-request',
  subject: 'Certify tw-1',
  body: 'please',
  keywords: {},
});

const withStatus = (status: MailStatus): MailMessage =>
  ({ id: 'x', status, topic: 'card-request' } as unknown as MailMessage);

describe('peekMessage', () => {
  test('returns the message without flipping a new request to read', () => {
    const id = sendRequest();

    expect(peekMessage('ai', id)?.status).toBe('new');
    // Still 'new' on disk after the peek — the whole point.
    expect(peekMessage('ai', id)?.status).toBe('new');
  });

  test('readMessage, by contrast, flips it — which is why the approve path must not use it', () => {
    const id = sendRequest();
    expect(readMessage('ai', id)?.status).toBe('read');
    expect(peekMessage('ai', id)?.status).toBe('read');
  });

  test('returns null for a missing message', () => {
    expect(peekMessage('ai', 'no-such-id')).toBeNull();
  });
});

describe('reviewFinalizeDisposition', () => {
  test('skips a renewed original instead of un-queueing it', () => {
    expect(reviewFinalizeDisposition(withStatus('new'))).toBe('skip-requeued');
  });

  test('skips an original the run-ai sweep already finalized', () => {
    expect(reviewFinalizeDisposition(withStatus('success'))).toBe('skip-already-finalized');
    expect(reviewFinalizeDisposition(withStatus('failed'))).toBe('skip-already-finalized');
  });

  test('sends and finalizes for an in-flight or unknown original', () => {
    expect(reviewFinalizeDisposition(withStatus('read'))).toBe('send-and-finalize');
    expect(reviewFinalizeDisposition(withStatus('processing'))).toBe('send-and-finalize');
    expect(reviewFinalizeDisposition(withStatus('waiting'))).toBe('send-and-finalize');
    expect(reviewFinalizeDisposition(null)).toBe('send-and-finalize');
  });
});
