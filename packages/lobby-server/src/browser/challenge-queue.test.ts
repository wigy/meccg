/**
 * @module challenge-queue.test
 *
 * Regression tests for the incoming-challenge queue. The client used to keep
 * a single `challengeFrom` slot: a second incoming challenge overwrote the
 * first one's prompt, and declining the second left the first challenge
 * pending server-side with no UI to ever answer it (the pair was deadlocked
 * until the challenger cancelled). The queue shows one challenge at a time
 * and reveals the next when the shown one is answered or withdrawn.
 *
 * Uses the hand-rolled DOM stub pattern of the other browser tests (vitest
 * runs in the default node environment, with no jsdom).
 */

import './test-dom-bootstrap.js'; // must precede the app-state import (load-time window access)
import { describe, test, expect, beforeEach } from 'vitest';
import {
  challengeReceived, challengeWithdrawn, shownChallengeResolved, clearChallenges,
} from './challenge-queue.js';
import { appState } from './app-state.js';

class StubEl {
  textContent = '';
  classList = {
    classes: new Set<string>(),
    add: (...cs: string[]) => { for (const c of cs) this.classList.classes.add(c); },
    remove: (...cs: string[]) => { for (const c of cs) this.classList.classes.delete(c); },
    contains: (c: string) => this.classList.classes.has(c),
  };
}

let incomingEl: StubEl;
let textEl: StubEl;

const hidden = (): boolean => incomingEl.classList.contains('hidden');

beforeEach(() => {
  incomingEl = new StubEl();
  incomingEl.classList.add('hidden');
  textEl = new StubEl();
  const byId: Record<string, StubEl> = {
    'challenge-incoming': incomingEl,
    'challenge-text': textEl,
  };
  (globalThis as unknown as { document: unknown }).document = {
    getElementById: (id: string) => byId[id] ?? null,
  };
  appState.pendingChallenges = [];
  appState.challengeFrom = null;
});

describe('the incoming-challenge queue', () => {
  test('a second challenge queues behind the shown one instead of overwriting it', () => {
    challengeReceived('alice', 'Alice');
    challengeReceived('bob', 'Bob');

    expect(hidden()).toBe(false);
    expect(textEl.textContent).toBe('Alice wants to play! (1 more waiting)');
    expect(appState.challengeFrom).toBe('alice');
  });

  test('answering the shown challenge reveals the next waiting one', () => {
    challengeReceived('alice', 'Alice');
    challengeReceived('bob', 'Bob');

    shownChallengeResolved(); // Alice accepted or declined

    expect(hidden()).toBe(false);
    expect(textEl.textContent).toBe('Bob wants to play!');
    expect(appState.challengeFrom).toBe('bob');
  });

  test('answering the last challenge hides the prompt', () => {
    challengeReceived('alice', 'Alice');
    shownChallengeResolved();

    expect(hidden()).toBe(true);
    expect(appState.challengeFrom).toBeNull();
    expect(appState.pendingChallenges).toHaveLength(0);
  });

  test('withdrawing the shown challenge reveals the next waiting one', () => {
    challengeReceived('alice', 'Alice');
    challengeReceived('bob', 'Bob');

    challengeWithdrawn('alice');

    expect(hidden()).toBe(false);
    expect(textEl.textContent).toBe('Bob wants to play!');
    expect(appState.challengeFrom).toBe('bob');
  });

  test('withdrawing a waiting (not shown) challenge leaves the shown one up', () => {
    challengeReceived('alice', 'Alice');
    challengeReceived('bob', 'Bob');

    challengeWithdrawn('bob');

    expect(hidden()).toBe(false);
    expect(textEl.textContent).toBe('Alice wants to play!');
    expect(appState.challengeFrom).toBe('alice');
  });

  test('a repeated challenge from the same player is not queued twice', () => {
    challengeReceived('alice', 'Alice');
    challengeReceived('alice', 'Alice');

    expect(appState.pendingChallenges).toHaveLength(1);
    expect(textEl.textContent).toBe('Alice wants to play!');
  });

  test('clearChallenges empties the queue and hides the prompt (game start)', () => {
    challengeReceived('alice', 'Alice');
    challengeReceived('bob', 'Bob');

    clearChallenges();

    expect(hidden()).toBe(true);
    expect(appState.challengeFrom).toBeNull();
    expect(appState.pendingChallenges).toHaveLength(0);
  });
});
