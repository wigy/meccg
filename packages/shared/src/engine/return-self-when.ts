/**
 * @module return-self-when
 *
 * Post-action housekeeping for the `return-self-to-hand-when` card effect: an
 * in-play card that goes back to its controller's **hand** the moment a
 * player-state condition holds. The discard-pile sibling of this sweep lives in
 * `discard-self-when.ts`; the two are deliberately separate rather than one
 * sweep with a destination flag, because they leave a card in different places
 * and a card carrying both would be ambiguous.
 *
 * Used by Last Child of Ungoliant (le-153): "Return her to your hand if Shelob
 * is played." Last Child is a manifestation of Shelob (`manifestId: tw-86`), so
 * g.man.1 has the two competing for a single slot; the card's own text settles
 * it by handing the ally back instead of discarding her.
 *
 * The sweep covers both `cardsInPlay` and **allies attached to a character** —
 * `discardCardsInPlayWhere` only reaches the former, and the manifestation
 * cards that need this are allies.
 */
import type { GameState, CardInstance, PlayerState } from '../index.js';
import type { ReturnSelfToHandWhenEffect } from '../types/effects.js';
import { Phase } from '../types/state-phases.js';
import { matchesCondition } from '../effects/index.js';
import { logDetail } from './legal-actions/log.js';
import { defById, getCardEffects, toCardInstance } from './reducer-utils.js';
import { buildPlayerStateContext } from './legal-actions/organization.js';

/**
 * Whether the given card definition wants to leave play for its owner's hand
 * in the supplied player-state context.
 */
function returnsToHandNow(
  state: GameState,
  definitionId: CardInstance['definitionId'],
  ctx: Record<string, unknown>,
): boolean {
  const def = defById(state, definitionId);
  const effect = getCardEffects(def).find(
    (e): e is ReturnSelfToHandWhenEffect => e.type === 'return-self-to-hand-when',
  );
  return effect !== undefined && matchesCondition(effect.condition, ctx);
}

/** Logs one return, naming the card. */
function logReturn(state: GameState, card: CardInstance, playerName: string): void {
  const def = defById(state, card.definitionId);
  logDetail(`return-self-to-hand-when: returning "${def?.name ?? (card.definitionId as string)}" to ${playerName}'s hand — condition holds`);
}

/**
 * Returns any in-play card carrying a `return-self-to-hand-when` effect whose
 * condition currently holds to its controller's hand. Skipped during setup, as
 * the discard sibling is.
 */
export function sweepReturnSelfToHandWhen(state: GameState): GameState {
  if (state.phaseState.phase === Phase.Setup) return state;

  let changed = false;
  const players = state.players.map((player): PlayerState => {
    const ctx = buildPlayerStateContext(state, player, player.id) as unknown as Record<string, unknown>;
    const returned: CardInstance[] = [];

    const cardsInPlay = player.cardsInPlay.filter(card => {
      if (!returnsToHandNow(state, card.definitionId, ctx)) return true;
      logReturn(state, toCardInstance(card), player.name);
      returned.push(toCardInstance(card));
      return false;
    });

    const characters = { ...player.characters };
    for (const charId of Object.keys(characters) as (keyof typeof characters)[]) {
      const char = characters[charId];
      const keptAllies = char.allies.filter(ally => {
        if (!returnsToHandNow(state, ally.definitionId, ctx)) return true;
        logReturn(state, toCardInstance(ally), player.name);
        returned.push(toCardInstance(ally));
        return false;
      });
      if (keptAllies.length !== char.allies.length) {
        characters[charId] = { ...char, allies: keptAllies };
      }
    }

    if (returned.length === 0) return player;
    changed = true;
    return { ...player, cardsInPlay, characters, hand: [...player.hand, ...returned] };
  }) as unknown as GameState['players'];

  return changed ? { ...state, players } : state;
}
