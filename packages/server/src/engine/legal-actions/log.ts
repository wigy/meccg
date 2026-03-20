/**
 * @module legal-actions/log
 *
 * Lightweight logger for the legal-actions subsystem. Always emits output
 * so that the server console shows the reasoning behind which actions are
 * offered or excluded.
 *
 * Uses indentation to visually group log lines under the phase/step that
 * produced them.
 */

const PREFIX = '\x1b[36m[legal-actions]\x1b[0m';

/**
 * Log a top-level heading (phase / step entry).
 */
export function logHeading(message: string): void {
  console.log(`${PREFIX} ${message}`);
}

/**
 * Log a detail line (reasoning about a specific action or constraint).
 */
export function logDetail(message: string): void {
  console.log(`${PREFIX}   ${message}`);
}

/**
 * Formats a single action as "type {arg1: val, arg2: val}".
 * Omits the `type` and `player` fields from the args since they're redundant.
 */
function formatAction(action: Record<string, unknown>): string {
  const { type, player: _player, ...args } = action;
  const argKeys = Object.keys(args);
  if (argKeys.length === 0) return type as string;
  const argStr = argKeys.map(k => `${k}: ${args[k]}`).join(', ');
  return `${type as string} {${argStr}}`;
}

/**
 * Log the final list of legal actions produced for a player,
 * including each action's arguments for full traceability.
 */
export function logResult(actionCount: number, actions?: readonly Record<string, unknown>[]): void {
  if (actions && actions.length <= 20) {
    const formatted = actions.map(formatAction);
    console.log(`${PREFIX}   → ${actionCount} legal action(s):`);
    for (const line of formatted) {
      console.log(`${PREFIX}     • ${line}`);
    }
  } else {
    console.log(`${PREFIX}   → ${actionCount} legal action(s)`);
  }
}
