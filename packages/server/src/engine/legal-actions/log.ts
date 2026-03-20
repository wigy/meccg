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
 * Log the final list of legal actions produced for a player.
 */
export function logResult(actionCount: number, actionTypes?: string[]): void {
  if (actionTypes && actionTypes.length <= 20) {
    console.log(`${PREFIX}   → ${actionCount} legal action(s): [${actionTypes.join(', ')}]`);
  } else {
    console.log(`${PREFIX}   → ${actionCount} legal action(s)`);
  }
}
