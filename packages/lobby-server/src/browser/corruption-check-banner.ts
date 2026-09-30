/**
 * @module corruption-check-banner
 *
 * Pure logic for the corruption-check situation banner. Extracted from
 * `company-view.ts` so it can be unit-tested without a DOM environment
 * (same pattern as `combat-detainment-suffix.ts`).
 */

import type { CorruptionCheckAction } from '@meccg/shared';

/** Title and detail lines of the corruption-check situation banner. */
export interface CorruptionCheckBannerText {
  readonly title: string;
  readonly detail: string;
}

/**
 * Build the banner text for the viable corruption-check actions.
 *
 * With a single check the banner names the character and shows the roll
 * breakdown, next to the generic "Roll" button. When several checks are
 * offered at once (CoE 7.1.1: the player decides the order — e.g. Ren the
 * Unclean tw-83 or the Free Council batch), there is no "Roll" button and
 * the player picks who checks next by clicking a highlighted character, so
 * naming just the first one would point at an arbitrary character. The
 * banner says to choose instead, carrying the shared reason (the
 * `"<reason>: need roll > N"` prefix of the explanations) when all checks
 * have the same one.
 *
 * Returns null when no corruption check is pending.
 */
export function corruptionCheckBannerText(
  actions: readonly CorruptionCheckAction[],
  nameOf: (action: CorruptionCheckAction) => string,
): CorruptionCheckBannerText | null {
  if (actions.length === 0) return null;
  if (actions.length === 1) {
    return { title: `Corruption Check — ${nameOf(actions[0])}`, detail: actions[0].explanation };
  }
  const reasons = new Set(actions.map(a => /^(.*?): need roll/.exec(a.explanation)?.[1] ?? ''));
  const [reason] = reasons;
  const title = reasons.size === 1 && reason ? `Corruption Checks — ${reason}` : 'Corruption Checks';
  return {
    title,
    detail: `${actions.length} characters must make a corruption check — click a highlighted character to choose who rolls next`,
  };
}
