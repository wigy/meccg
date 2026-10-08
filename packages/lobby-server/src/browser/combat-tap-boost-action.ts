/**
 * @module combat-tap-boost-action
 *
 * Click-target resolution for `tap-ally-combat-boost` actions in the visual
 * combat view. The action is keyed by the in-play source card's instance ID —
 * an ally that taps itself (Great Lord of Goblin-gate as-75) or an item /
 * attached permanent-event whose bearer taps (Lore of the Ages td-129) — so
 * the source card's image under its character is the click target.
 *
 * Regression for bug report "Lore of Ages" (game muz5vlfa-7ohebq, seq 1508):
 * the engine offered the boost in both the assign-strikes and resolve-strike
 * windows, but combat-view.ts never wired a click handler for this action
 * type, so the ability had no click target anywhere in the UI.
 */

import type { GameAction, TapAllyCombatBoostAction } from '@meccg/shared';

/** A labeled choice for a combat card that offers more than one action. */
export interface TapCombatBoostChoice {
  /** Menu label shown to the player. */
  readonly label: string;
  /** Action dispatched when the choice is picked. */
  readonly action: GameAction;
}

/** Finds the `tap-ally-combat-boost` action, if any, whose source card is `sourceInstanceId`. */
export function resolveTapCombatBoostAction(
  actions: readonly TapAllyCombatBoostAction[],
  sourceInstanceId: string,
): TapAllyCombatBoostAction | undefined {
  return actions.find(a => (a.cardInstanceId as string) === sourceInstanceId);
}

/**
 * Choices offered when clicking a boost source card. An ally source may
 * simultaneously be assignable a strike or able to support the current
 * strike — those choices are listed alongside the boost so activating the
 * boost never hides them (and vice versa).
 */
export function tapCombatBoostChoices(
  boost: TapAllyCombatBoostAction,
  assign?: GameAction,
  support?: GameAction,
): readonly TapCombatBoostChoice[] {
  const choices: TapCombatBoostChoice[] = [{ label: 'Tap for company combat boost', action: boost }];
  if (assign) choices.push({ label: 'Assign strike', action: assign });
  if (support) choices.push({ label: 'Tap for +1 Support', action: support });
  return choices;
}
