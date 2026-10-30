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

/** The Free Council check awaiting support taps (`FreeCouncilPhaseState.pendingCheck`). */
export interface FreeCouncilPendingCheck {
  readonly corruptionPoints: number;
  readonly corruptionModifier: number;
  readonly explanation: string;
  readonly supportCount: number;
}

/**
 * Build the banner text for a declared-but-unrolled Free Council corruption
 * check (CoE 7.1.1 support window).
 *
 * Once a check is declared no `corruption-check` action is offered any more —
 * only `support-corruption-check` taps and the "Roll" pass — so
 * {@link corruptionCheckBannerText} shows nothing and the supporters glow
 * exactly like the characters that were offered for checking a moment ago.
 * This banner names the character who is rolling, the current support
 * total and the resulting target, and says whose characters may support.
 *
 * @param check - The pending check from the Free Council phase state.
 * @param characterName - Name of the character making the check.
 * @param isSelf - Whether the viewing player owns the checking character.
 * @param hasSupportActions - Whether the viewer has support taps available.
 */
export function freeCouncilPendingCheckBannerText(
  check: FreeCouncilPendingCheck,
  characterName: string,
  isSelf: boolean,
  hasSupportActions: boolean,
): CorruptionCheckBannerText {
  const owner = isSelf ? '' : "Opponent's ";
  const parts = [check.explanation];
  if (check.supportCount > 0) {
    const target = check.corruptionPoints - check.corruptionModifier - check.supportCount;
    parts.push(`Support +${check.supportCount} from tapped characters — now need roll > ${target}`);
  } else {
    parts.push('No support yet');
  }
  if (isSelf) {
    parts.push(hasSupportActions
      ? `Click highlighted characters in ${characterName}'s company to tap them in support (+1 each), then Roll`
      : 'Click Roll to make the check');
  }
  return {
    title: `${owner}Corruption Check — ${characterName} is rolling`,
    detail: parts.join(' · '),
  };
}
