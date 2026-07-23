/**
 * @module legal-actions/log
 *
 * Lightweight logger for the legal-actions subsystem. Always emits output
 * so that the server console shows the reasoning behind which actions are
 * offered or excluded.
 *
 * Uses indentation to visually group log lines under the phase/step that
 * produced them.
 *
 * Supports a capture mode: when {@link startCapture} is called, log lines
 * are collected into a buffer in addition to being printed to the console.
 * Call {@link flushCapture} to retrieve and clear the buffer.
 */

import type { EvaluatedAction } from '../../index.js';

const PREFIX = '[legal-actions]';

/** When non-null, log lines are appended here in addition to the console. */
let captureBuffer: string[] | null = null;

/**
 * Whether log lines are written to the console. Defaults to true (the game
 * server relies on the console trace). The headless simulation harness
 * disables it: per-action logging costs orders of magnitude more than the
 * engine work itself when stepping thousands of games in-process.
 * Capture mode ({@link startCapture}) is unaffected by this switch.
 */
let consoleEnabled = true;

/** Enable or disable engine log output to the console. */
export function setEngineConsoleLog(enabled: boolean): void {
  consoleEnabled = enabled;
}

/**
 * Begin capturing log lines into an internal buffer.
 * Any previous buffer contents are discarded.
 */
export function startCapture(): void {
  captureBuffer = [];
}

/**
 * Return all captured log lines and stop capturing.
 * Returns an empty array if capture was not active.
 */
export function flushCapture(): string[] {
  const lines = captureBuffer ?? [];
  captureBuffer = null;
  return lines;
}

/** Write a line to the console and, if capturing, to the buffer. */
function emit(line: string): void {
  if (consoleEnabled) console.log(line);
  if (captureBuffer) captureBuffer.push(line);
}

/**
 * Log a top-level heading (phase / step entry).
 */
export function logHeading(message: string): void {
  emit(`${PREFIX} ${message}`);
}

/**
 * Log a detail line (reasoning about a specific action or constraint).
 */
export function logDetail(message: string): void {
  emit(`${PREFIX}   ${message}`);
}

/**
 * Formats a single action as "type {arg1: val, arg2: val}".
 * Omits the `type` and `player` fields from the args since they're redundant.
 */
function formatAction(action: Record<string, unknown>): string {
  const { type, player: _player, ...args } = action;
  const argKeys = Object.keys(args);
  if (argKeys.length === 0) return type as string;
  const argStr = argKeys.map(k => `${k}: ${String(args[k])}`).join(', ');
  return `${type as string} {${argStr}}`;
}

/**
 * Log the final list of legal actions produced for a player,
 * including each action's arguments for full traceability.
 */
export function logResult(actionCount: number, actions?: readonly Record<string, unknown>[]): void {
  if (actions && actions.length <= 20) {
    const formatted = actions.map(formatAction);
    emit(`${PREFIX}   → ${actionCount} legal action(s):`);
    for (const line of formatted) {
      emit(`${PREFIX}     • ${line}`);
    }
  } else {
    emit(`${PREFIX}   → ${actionCount} legal action(s)`);
  }
}

/**
 * Log the viable subset of an evaluated action list via {@link logResult}
 * and return the list unchanged, so dispatcher branches can end with
 * `return logEvaluated(...)` instead of repeating the filter/log pair.
 */
export function logEvaluated(evaluated: EvaluatedAction[]): EvaluatedAction[] {
  const viable = evaluated.filter(e => e.viable);
  logResult(viable.length, viable.map(e => e.action) as unknown as Record<string, unknown>[]);
  return evaluated;
}
