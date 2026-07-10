/**
 * @module discard-self-when
 *
 * Post-action housekeeping for the `discard-self-when` card effect: an in-play
 * card that must be discarded the moment a player-state condition holds. The
 * condition is evaluated against the card controller's player-state context (the
 * same `player.avatar` / `player.stagePoints` / `player.factionCount` context
 * used by the `play-condition` `requires: "player-state"` gate), so an effect
 * can express "stays in play only while …".
 *
 * Used by Prophet of Doom (wh-106): "Discard if you have fewer than 5 factions
 * in play." — a `discard-self-when` whose condition is
 * `{ "player.factionCount": { "$lt": 5 } }`.
 *
 * Distinct from the play-condition (which gates *entry* to play); this gates
 * *remaining* in play and runs as a `postReduce` sweep after every action.
 */
import type { GameState } from '../index.js';
import { Phase } from '../types/state-phases.js';
import { matchesCondition } from '../effects/index.js';
import { logDetail } from './legal-actions/log.js';
import { defById, getCardEffects, discardCardsInPlayWhere } from './reducer-utils.js';
import { buildPlayerStateContext } from './legal-actions/organization.js';

/**
 * Discards any in-play card carrying a `discard-self-when` effect whose
 * condition currently holds against its controller's player-state context.
 * Skipped during setup (starting-stage cards must never be swept before the
 * game proper begins).
 */
export function sweepDiscardSelfWhen(state: GameState): GameState {
  if (state.phaseState.phase === Phase.Setup) return state;

  return discardCardsInPlayWhere(
    state,
    (card, player) => {
      const def = defById(state, card.definitionId);
      const effect = getCardEffects(def).find(e => e.type === 'discard-self-when');
      if (!effect || effect.type !== 'discard-self-when') return false;
      const ctx = buildPlayerStateContext(state, player, player.id);
      return matchesCondition(effect.condition, ctx);
    },
    card => {
      const def = defById(state, card.definitionId);
      logDetail(`discard-self-when: discarding "${def?.name ?? (card.definitionId as string)}" — condition holds`);
    },
  ).state;
}
