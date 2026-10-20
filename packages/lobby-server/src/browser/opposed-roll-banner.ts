/**
 * @module opposed-roll-banner
 *
 * Pure logic for the opposed-roll situation banner (e.g. No More Nonsense
 * le-210). Kept DOM-free so it can be unit-tested, like
 * `corruption-check-banner.ts`.
 */

import type { OpposedRollAction } from '@meccg/shared';

/** Title and detail lines of the opposed-roll situation banner. */
export interface OpposedRollBannerText {
  readonly title: string;
  readonly detail: string;
}

/**
 * Build the banner text for a pending opposed roll. The controlling player
 * rolls twice — once for the challenger, then once for the opponent — and
 * nothing else on screen says a roll is expected, so the banner names the
 * source card (the `"<card>: roll for ..."` prefix of the explanation) and
 * shows the contest breakdown with a prompt to roll.
 *
 * Returns null when no opposed roll is pending.
 */
export function opposedRollBannerText(
  actions: readonly OpposedRollAction[],
): OpposedRollBannerText | null {
  if (actions.length === 0) return null;
  const action = actions[0];
  const source = /^(.*?): roll for /.exec(action.explanation)?.[1];
  return {
    title: source ? `Opposed Roll — ${source}` : 'Opposed Roll',
    detail: `${action.explanation} — click Roll to roll the dice`,
  };
}
