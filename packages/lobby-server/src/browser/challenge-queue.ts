/**
 * @module challenge-queue
 *
 * Queue of unanswered incoming challenges backing the lobby's single
 * incoming-challenge prompt.
 *
 * The server tracks pending challenges as a *set* per player (`pendingFrom`)
 * and `accept-challenge` / `decline-challenge` act on a challenger name — but
 * the prompt can show only one challenge at a time. The client used to keep a
 * single `challengeFrom` slot, so a second incoming challenge overwrote the
 * first one's UI: the earlier challenge stayed pending server-side (its
 * sender kept seeing a live "Cancel" button) with no UI left to answer it.
 *
 * This module keeps a FIFO instead: the head is what the prompt shows
 * (`appState.challengeFrom` is kept in sync for the accept/decline senders in
 * app.ts), later challengers wait their turn, and resolving or withdrawing
 * the shown challenge reveals the next one.
 */

import { appState } from './app-state.js';

/** Re-render the prompt from the queue head, hiding it when the queue is empty. */
function renderPrompt(): void {
  const head = appState.pendingChallenges[0] ?? null;
  appState.challengeFrom = head?.from ?? null;
  const incoming = document.getElementById('challenge-incoming');
  const text = document.getElementById('challenge-text');
  if (!incoming || !text) return;
  if (head) {
    const waiting = appState.pendingChallenges.length - 1;
    text.textContent = `${head.display} wants to play!`
      + (waiting > 0 ? ` (${waiting} more waiting)` : '');
    incoming.classList.remove('hidden');
  } else {
    incoming.classList.add('hidden');
  }
}

/** An incoming challenge arrived: queue it (idempotent per challenger). */
export function challengeReceived(from: string, display: string): void {
  if (!appState.pendingChallenges.some(c => c.from === from)) {
    appState.pendingChallenges.push({ from, display });
  }
  renderPrompt();
}

/**
 * A challenger withdrew (or entered a game): drop their challenge whether it
 * is the one shown or still waiting, and reveal the next one if any.
 */
export function challengeWithdrawn(from: string): void {
  appState.pendingChallenges = appState.pendingChallenges.filter(c => c.from !== from);
  renderPrompt();
}

/**
 * The shown challenge was answered (accepted or declined): drop it and show
 * the next waiting challenge, if any.
 */
export function shownChallengeResolved(): void {
  appState.pendingChallenges = appState.pendingChallenges.slice(1);
  renderPrompt();
}

/** Forget every pending challenge (entering a game cancels them server-side). */
export function clearChallenges(): void {
  appState.pendingChallenges = [];
  renderPrompt();
}
