/**
 * @module dice-roll-log
 *
 * Formats `dice-roll` effect messages for the two text logs: the verbose debug
 * log (`renderLog`) and the per-game message panel (`showNotification`).
 *
 * Kept separate from the connection handler so the wording of a roll line is a
 * pure function of the effect — the handler only decides *when* the line is
 * emitted (see {@link module:effect-log-buffer}).
 */

import type { DiceRollEffect } from '@meccg/shared';
import type { NotificationOptions } from './render-log.js';

/** A roll line destined for the per-game message panel. */
export interface RollNotification {
  /** Message text (the player prefix comes from `opts`). */
  readonly message: string;
  /** Colouring/prefix options for {@link showNotification}. */
  readonly opts: NotificationOptions;
}

/** One-line summary of a roll for the verbose debug log. */
export function diceRollLogLine(effect: DiceRollEffect): string {
  const { playerName, die1, die2, label, total } = effect;
  const totalStr = total !== undefined ? ` (total ${total})` : '';
  return `${label}: ${playerName} rolled ${die1} + ${die2} = ${die1 + die2}${totalStr}`;
}

/**
 * Roll line for the per-game message panel, or null when the roll needs no
 * entry there.
 *
 * A CvCC strike carries a prowess total, so it is formatted as
 * `prowess+d1+d2=total` for both players — the matching result line arrives
 * later with the state. A plain 2d6 roll is only logged for the opponent: the
 * player who rolled watched their own dice animate.
 *
 * @param selfName - Name of the player using this client.
 * @param opponentName - Display name for the opponent, when known.
 */
export function diceRollNotification(
  effect: DiceRollEffect,
  selfName: string,
  opponentName: string | null,
): RollNotification | null {
  const { playerName, die1, die2, label, total } = effect;
  if (total !== undefined) {
    const prowess = total - die1 - die2;
    const charName = label.startsWith('CvCC Strike: ') ? label.slice('CvCC Strike: '.length) : label;
    const message = `rolled ${prowess}+${die1}+${die2}=${total} for ${charName} in CvCC`;
    return playerName === selfName
      ? { message, opts: { self: selfName } }
      : { message, opts: { opponent: opponentName ?? playerName } };
  }
  if (playerName === selfName) return null;
  return {
    message: `rolled ${die1} + ${die2} = ${die1 + die2} (${label})`,
    opts: { opponent: playerName },
  };
}
