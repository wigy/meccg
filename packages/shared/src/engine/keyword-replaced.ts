/**
 * @module keyword-replaced
 *
 * Sweep for the `return-to-hand` `replaced-by-keyword` trigger: when a second
 * card carrying some keyword is placed on the same character, the earlier
 * carriers of that keyword return to their owner's hand instead of stacking.
 *
 * The Radagast Shapeshifter forms (Master of Shapes wh-112, Shifter of Hues
 * wh-115, Winged Change-master wh-116) are the motivating family — each is a
 * permanent-event placed on Radagast that reads "Return this card to your hand
 * when you play another Shapeshifter card". Radagast wears exactly one shape at
 * a time, and the displaced shape is re-playable rather than spent, so it goes
 * to hand and not to the discard pile.
 *
 * A permanent-event placed on a character is stored in that character's `items`
 * (there is no `attachedToCharacter` zone), so that is the array this scans.
 * Placement appends, which makes array order the arrival order: the **last**
 * carrier of the keyword is the one just played and the one that stays.
 *
 * Runs in `postReduce`, after the chain has resolved the incoming card into
 * play. It is idempotent — once the older forms have gone to hand a character
 * holds at most one carrier per keyword, and the sweep is a no-op.
 */

import type { GameState } from '../types/state.js';
import type { PlayerState } from '../types/state.js';
import type { CardInstanceId } from '../types/common.js';
import type { CardEffect } from '../types/effects.js';
import { defById, getCardEffects, toCardInstance } from './reducer-utils.js';
import { logDetail } from './legal-actions/log.js';

/**
 * The `replaced-by-keyword` keywords a card's `return-to-hand` effects declare
 * (empty when it declares none).
 */
function replacedByKeywords(effects: readonly CardEffect[]): readonly string[] {
  const keywords: string[] = [];
  for (const e of effects) {
    if (e.type !== 'return-to-hand') continue;
    if (!e.during.includes('replaced-by-keyword')) continue;
    if (e.replacedByKeyword) keywords.push(e.replacedByKeyword);
  }
  return keywords;
}

/** True when the card definition declares `keyword` in its `keywords` list. */
function hasKeyword(state: GameState, definitionId: string, keyword: string): boolean {
  const def = defById(state, definitionId as never);
  const keywords = (def as { keywords?: readonly string[] } | undefined)?.keywords ?? [];
  return keywords.includes(keyword);
}

/**
 * Returns every attached card displaced by a later card with the same
 * `replaced-by-keyword` keyword on the same character to its owner's hand.
 *
 * @param state - The state to sweep.
 * @returns The state with displaced cards moved from their bearer to hand.
 */
export function sweepKeywordReplaced(state: GameState): GameState {
  let changed = false;
  const players = state.players.map((player: PlayerState) => {
    const returnedToHand: ReturnType<typeof toCardInstance>[] = [];
    const characters = { ...player.characters };

    for (const [charId, char] of Object.entries(player.characters)) {
      // For each keyword, the index of its last (most recently placed) carrier
      // on this character — the arrival that displaces the earlier ones.
      const lastIndexByKeyword = new Map<string, number>();
      char.items.forEach((attached, index) => {
        for (const keyword of replacedByKeywords(getCardEffects(defById(state, attached.definitionId)))) {
          if (hasKeyword(state, attached.definitionId as string, keyword)) {
            lastIndexByKeyword.set(keyword, index);
          }
        }
      });
      if (lastIndexByKeyword.size === 0) continue;

      const keptItems = char.items.filter((attached, index) => {
        for (const keyword of replacedByKeywords(getCardEffects(defById(state, attached.definitionId)))) {
          if (!hasKeyword(state, attached.definitionId as string, keyword)) continue;
          if (lastIndexByKeyword.get(keyword) === index) continue;
          const def = defById(state, attached.definitionId);
          logDetail(`Keyword-replaced: "${def?.name ?? (attached.definitionId as string)}" displaced by a later "${keyword}" card on the same character — returning to hand`);
          returnedToHand.push(toCardInstance(attached));
          return false;
        }
        return true;
      });

      if (keptItems.length !== char.items.length) {
        characters[charId as CardInstanceId] = { ...char, items: keptItems };
      }
    }

    if (returnedToHand.length === 0) return player;
    changed = true;
    return { ...player, characters, hand: [...player.hand, ...returnedToHand] };
  });

  return changed ? { ...state, players: players as unknown as GameState['players'] } : state;
}
