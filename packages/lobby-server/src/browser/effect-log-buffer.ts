/**
 * @module effect-log-buffer
 *
 * Orders text-log output for a single server-side action.
 *
 * The game server broadcasts a reducer's `effect` messages (dice rolls, text
 * notifications) *before* the `state` message produced by the same action —
 * the dice animation has to start before the new state renders, otherwise the
 * board would spoil the outcome while the dice are still spinning.
 *
 * The text log needs the opposite order: the line announcing what a player did
 * must come before the outcome of the dice they rolled. Logging effects as
 * they arrive produced e.g.
 *
 * ```text
 * AI-Real: rolled 5 + 5 = 10 (Corruption: Glorfindel II)
 * AI-Real: Corruption check for Glorfindel II (CP 4)
 * ```
 *
 * — the result of a roll printed above the line announcing that roll.
 *
 * Effect *log* output is therefore deferred: the `effect` handler queues the
 * log work here and the `state` handler flushes it right after logging the
 * action description. Dice *animation* is never deferred — only the lines.
 */

/** Queued log emitters, in arrival order. */
const queued: (() => void)[] = [];

/**
 * Defer log output for an incoming effect message until the state message
 * belonging to the same action arrives.
 */
export function queueEffectLog(emit: () => void): void {
  queued.push(emit);
}

/**
 * Emit all deferred effect log output, in arrival order. Called from the
 * `state` handler once the action that caused the effects has been logged.
 */
export function flushEffectLog(): void {
  const pending = queued.splice(0, queued.length);
  for (const emit of pending) emit();
}

/** Drop deferred output without emitting it (new game / reset). */
export function clearEffectLog(): void {
  queued.length = 0;
}

/** Number of effect log emitters still waiting for their state message. */
export function pendingEffectLogCount(): number {
  return queued.length;
}
