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
import { describeRollBreakdown, stripCardMarkers } from '@meccg/shared';
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
  const { playerName, die1, die2, label, total, alternateRoll } = effect;
  const totalStr = total !== undefined ? ` (total ${total})` : '';
  const altStr = alternateRoll
    ? ` (other roll ${alternateRoll.die1} + ${alternateRoll.die2} = ${alternateRoll.die1 + alternateRoll.die2}, discarded)`
    : '';
  const caption = diceRollCaption(effect);
  const breakdownStr = caption ? ` — ${caption}` : '';
  return `${label}: ${playerName} rolled ${die1} + ${die2} = ${die1 + die2}${totalStr}${altStr}${breakdownStr}`;
}

/**
 * Plain-text explanation of a strike roll or body check — every prowess,
 * body and roll modifier that applied, the total and the outcome — or
 * `undefined` for rolls that carry no breakdown. Shown under the landed dice
 * and in both players' message panels.
 */
export function diceRollCaption(effect: DiceRollEffect): string | undefined {
  const text = describeRollBreakdown(effect);
  return text ? stripCardMarkers(text) : undefined;
}

/**
 * Whether a `dice-roll` effect is the discarded half of a two-roll strike
 * recorded by older servers, which emitted it as its own effect labelled
 * `"… (discarded): <character>"` right before the kept roll. Such a roll
 * belongs in the logs but must not animate — the kept roll's animation
 * would immediately replace it.
 */
export function isLegacyDiscardedRoll(effect: DiceRollEffect): boolean {
  return /\(discarded\):/.test(effect.label);
}

/**
 * Longest name/label allowed before {@link truncateName} clips it with an
 * ellipsis. Keeps a `dice-roll` line inside `#game-log-panel`'s clipped
 * `32rem` width so the roll numbers at the start of the line stay visible.
 */
const MAX_NAME_LENGTH = 24;

/**
 * Clips `name` to {@link MAX_NAME_LENGTH}, replacing the tail with `…` when it
 * is too long. Used only for the message-panel notification — the verbose
 * debug log is not width-constrained and keeps full names.
 */
function truncateName(name: string): string {
  return name.length > MAX_NAME_LENGTH ? `${name.slice(0, MAX_NAME_LENGTH - 1)}…` : name;
}

/**
 * Roll line for the per-game message panel, or null when the roll needs no
 * entry there.
 *
 * A strike roll or body check carrying a breakdown is logged with its full
 * arithmetic for both players (see {@link diceRollCaption}).
 *
 * A CvCC strike carries a prowess total, so it is formatted as
 * `prowess+d1+d2=total` for both players — the matching result line arrives
 * later with the state. A plain 2d6 roll is only logged for the opponent: the
 * player who rolled watched their own dice animate. A two-roll strike (one
 * carrying `alternateRoll`) gets no line here: the engine sends both players a
 * text notification quoting both rolls and the outcome.
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
  if (effect.alternateRoll) return null;
  // Strike rolls and body checks carry a breakdown: log the full arithmetic
  // for both players, including the roller, so each modifier is visible.
  const caption = diceRollCaption(effect);
  if (caption) {
    const message = `rolled ${die1} + ${die2} — ${caption}`;
    return playerName === selfName
      ? { message, opts: { self: selfName } }
      : { message, opts: { opponent: opponentName ?? playerName } };
  }
  if (total !== undefined) {
    const prowess = total - die1 - die2;
    const charName = truncateName(label.startsWith('CvCC Strike: ') ? label.slice('CvCC Strike: '.length) : label);
    const message = `rolled ${prowess}+${die1}+${die2}=${total} for ${charName} in CvCC`;
    return playerName === selfName
      ? { message, opts: { self: selfName } }
      : { message, opts: { opponent: opponentName ?? playerName } };
  }
  if (playerName === selfName) return null;
  return {
    message: `rolled ${die1} + ${die2} = ${die1 + die2} (${truncateName(label)})`,
    opts: { opponent: playerName },
  };
}
