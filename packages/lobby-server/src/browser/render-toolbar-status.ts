/**
 * @module render-toolbar-status
 *
 * Builds the plain-text "Game X · Turn N · Phase" readout shown in the
 * always-visible toolbar, so a game and its current turn/phase can be
 * identified without opening the (normally hidden) debug view. The same
 * text is reused verbatim in bug-report bodies so a report is
 * self-describing without extra steps from the reporter.
 */

import { Phase } from '@meccg/shared';
import { PHASE_LABELS } from './render-phase-meter.js';

/**
 * Build the toolbar status text from the pieces known at call time.
 *
 * Returns `''` before a game has been assigned (`gameId` is `null`).
 * The turn number is omitted during {@link Phase.Setup}, since `turnNumber`
 * stays `0` until the first real turn begins.
 */
export function buildToolbarStatusText(
  gameId: string | null,
  turnNumber: number | null,
  phase: Phase | undefined,
): string {
  if (gameId === null) return '';
  const parts = [`Game ${gameId}`];
  if (turnNumber !== null && phase !== Phase.Setup) {
    parts.push(`Turn ${turnNumber}`);
  }
  if (phase !== undefined) {
    parts.push(`${PHASE_LABELS[phase] ?? phase} Phase`);
  }
  return parts.join(' · ');
}
