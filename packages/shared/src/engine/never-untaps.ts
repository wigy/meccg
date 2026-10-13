/**
 * @module never-untaps
 *
 * Enforces the `bearer-never-untaps` play-flag: a character bearing such a
 * card "can never become untapped … Any effect that would move him to an
 * untapped state makes him tapped instead" (Endless Whispers dm-54).
 *
 * Untapping happens through dozens of independent code paths (the untap
 * phase sweep, haven healing, granted-action untaps, end-of-M/H heal-and-untap
 * effects, …), so the rule is evaluated as a prev/next diff after every
 * reducer step — the same reactive pattern as
 * {@link module:engine/hand-discard-trigger}: any character who was not
 * untapped before the step, is untapped after it, and bears a flagged card is
 * put back into the tapped position. A character who was already untapped
 * when the card attached is left alone — the card prevents *becoming*
 * untapped, it does not tap him.
 */

import type { CardInstanceId, CharacterInPlay, GameState } from '../index.js';
import { CardStatus } from '../types/common.js';
import { bearsNeverUntapCard } from './reducer-utils.js';
import { logDetail } from './legal-actions/log.js';

/**
 * Reverts every not-untapped → untapped transition of a character bearing a
 * `bearer-never-untaps` card to the tapped position.
 */
export function applyNeverUntapsLock(prev: GameState, next: GameState): GameState {
  let changed = false;
  const players = next.players.map((player, pi) => {
    const prevChars = prev.players[pi]?.characters;
    let characters: Record<CardInstanceId, CharacterInPlay> | undefined;
    for (const char of Object.values(player.characters)) {
      if (char.status !== CardStatus.Untapped) continue;
      const before = prevChars?.[char.instanceId];
      if (!before || before.status === CardStatus.Untapped) continue;
      if (!bearsNeverUntapCard(next, char)) continue;
      logDetail(`bearer-never-untaps: ${char.instanceId as string} would become untapped — tapped instead`);
      characters ??= { ...player.characters };
      characters[char.instanceId] = { ...char, status: CardStatus.Tapped };
    }
    if (!characters) return player;
    changed = true;
    return { ...player, characters };
  }) as unknown as GameState['players'];
  return changed ? { ...next, players } : next;
}
