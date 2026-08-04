/**
 * @module combat-button-label
 *
 * Pure label logic for the combat action buttons rendered in the visual combat
 * view. Extracted from `combat-view.ts` so it can be unit-tested without a DOM
 * environment.
 */
import type { GameAction } from '@meccg/shared';

/**
 * Short label for a combat action button in the visual view.
 *
 * Resolve-strike labels depend on the character's tap status, which is conveyed
 * by `hasStayUntappedOption` — whether the engine offered the -3 "stay untapped"
 * choice. That option is only ever available to an untapped character
 * (CoE 3.iv.3), so its presence/absence tells us the character's status:
 *
 * - `tapToFight: false` → "Untapped": applies -3 to keep the character untapped
 *   after the strike (CoE 3.iv.3).
 * - `tapToFight: true` with the stay-untapped option present → "Tapping": the
 *   untapped character taps to face the strike at full prowess.
 * - `tapToFight: true` with no stay-untapped option → "Not tapping": the
 *   character is already tapped or wounded and cannot tap (CoE 3.iv.6), so it
 *   faces the strike without tapping.
 *
 * `play-strike-event` reroll-mode cards (e.g. Swift Strokes, Lucky Strike)
 * carry the same independent `tapToFight` choice (CoE 3.iv.3) — the card's
 * own text says nothing about tapping — so they share this labeling.
 * Non-reroll strike-modifier modes (cancel/dodge/default) never set
 * `tapToFight` and fall through to the generic `action.type` label below.
 */
export function combatButtonLabel(action: GameAction, hasStayUntappedOption: boolean): string {
  if (action.type === 'resolve-strike' || (action.type === 'play-strike-event' && action.tapToFight !== undefined)) {
    if (!action.tapToFight) return 'Untapped';
    return hasStayUntappedOption ? 'Tapping' : 'Not tapping';
  }
  if (action.type === 'agent-strike-roll') return 'Roll for Agent';
  if (action.type === 'body-check-roll') return 'Body Check';
  if (action.type === 'allocate-cvcc-excess') return 'Assign −1';
  if (action.type === 'pass') return 'Pass';
  return action.type;
}
