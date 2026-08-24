/**
 * @module mail/recipients-validation.test
 *
 * Regression tests for the mail recipients contract: `recipients` must be a
 * JSON array of player names. A plain string passes a naive `.length`
 * truthiness check and then spreads character-by-character, creating one
 * bogus single-letter inbox per character (a real incident; see the Mail
 * System API note in CLAUDE.md). `isRecipientList` is the route-level guard
 * and `sendMail` refuses non-arrays outright.
 */

import { describe, test, expect } from 'vitest';
import { isRecipientList, sendMail } from './store.js';
import type { SendMailOptions } from './store.js';

const OPTIONS: SendMailOptions = {
  from: 'wigy',
  sender: 'player',
  topic: 'announcement',
  body: 'hello',
  subject: 'hi',
  keywords: {},
};

describe('isRecipientList', () => {
  test('accepts a non-empty array of names', () => {
    expect(isRecipientList(['wigy'])).toBe(true);
    expect(isRecipientList(['wigy', 'ai'])).toBe(true);
  });

  test('rejects a plain string — the character-split footgun', () => {
    expect(isRecipientList('wigy')).toBe(false);
  });

  test('rejects an empty array, non-string members, and empty names', () => {
    expect(isRecipientList([])).toBe(false);
    expect(isRecipientList([42])).toBe(false);
    expect(isRecipientList(['wigy', ''])).toBe(false);
    expect(isRecipientList(undefined)).toBe(false);
    expect(isRecipientList(null)).toBe(false);
    expect(isRecipientList({ 0: 'wigy', length: 1 })).toBe(false);
  });
});

describe('sendMail recipients guard', () => {
  test('throws on a string instead of writing one inbox per character', () => {
    expect(() => sendMail('wigy' as unknown as readonly string[], OPTIONS))
      .toThrow(/recipients must be an array/);
  });
});
