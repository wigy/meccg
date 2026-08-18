/**
 * @module balrog-banned-swap
 *
 * CoE 1.8.2 (rule 1.36) — the escape hatch for a hand card that a Balrog
 * opponent has made unplayable.
 *
 * Five cards (The Balrog ally as-71, The Black Council wh-41, Durin's Bane
 * dm-107, Balrog of Moria tw-12, Reluctant Final Parting dm-84) cannot be
 * played against a Balrog player. Each declares that ban itself, as a
 * `play-restriction` / `unplayable-when` keyed on the opponent's alignment,
 * and `applyDeclaredPlayRestrictions` rewrites their play actions into
 * not-playable entries.
 *
 * Drawing one against a Balrog would otherwise be a dead card for the rest of
 * the game, so the rule lets the holder trade it away at any time: remove it
 * and bring one card of *any* type from the sideboard into the play deck,
 * then shuffle. CRF 22 settles where the traded card goes — "he may remove it
 * from the game" — so it leaves for the out-of-play pile rather than the
 * discard pile, where a fetch could bring it back.
 *
 * A card qualifies only when the Balrog opponent is the *reason* it cannot be
 * played: the other `unplayable-when` family in the pool (CoE 1.35's cards
 * with no effect against a Ringwraith) grants no such trade, and neither
 * would a future ban keyed on something else. {@link bannedVsBalrogHandCards}
 * therefore checks the restriction against a counterfactual opponent of each
 * other alignment and keeps the card only if the ban is Balrog-specific.
 */

import type { GameState, PlayerId, CardInstanceId, CardInstance } from '../index.js';
import type { PlayRestrictionEffect } from '../types/effects.js';
import { Alignment } from '../types/common.js';
import { matchesContext } from '../effects/condition-matcher.js';
import { getPlayerIndex } from '../state-utils.js';
import { shuffle } from '../rng.js';
import { defById, findById, getCardEffects, removeById, updatePlayer } from './reducer-utils.js';
import { logDetail } from './legal-actions/log.js';

/** Every alignment an opponent could hold other than Balrog. */
const NON_BALROG_ALIGNMENTS: readonly Alignment[] = Object.values(Alignment)
  .filter(a => a !== Alignment.Balrog);

/**
 * Whether the card's declared play restrictions bar it specifically because
 * the opponent is a Balrog player: at least one `unplayable-when` matches the
 * real context and matches for no other opponent alignment.
 */
function bannedByBalrogOpponent(
  effects: readonly { readonly type: string }[],
  actorAlignment: Alignment,
): boolean {
  const restrictions = effects.filter(
    (e): e is PlayRestrictionEffect => e.type === 'play-restriction'
      && (e as PlayRestrictionEffect).rule === 'unplayable-when'
      && (e as PlayRestrictionEffect).when !== undefined,
  );
  return restrictions.some(r => {
    const when = r.when!;
    const actor = { alignment: actorAlignment };
    if (!matchesContext(when, { actor, opponent: { alignment: Alignment.Balrog } })) return false;
    return NON_BALROG_ALIGNMENTS.every(
      alignment => !matchesContext(when, { actor, opponent: { alignment } }),
    );
  });
}

/**
 * The player's hand cards eligible for the CoE 1.8.2 trade, or an empty list
 * when the opponent is not a Balrog player.
 */
export function bannedVsBalrogHandCards(state: GameState, playerId: PlayerId): readonly CardInstance[] {
  const actor = state.players.find(p => p.id === playerId);
  const opponent = state.players.find(p => p.id !== playerId);
  if (!actor || !opponent || opponent.alignment !== Alignment.Balrog) return [];
  return actor.hand.filter(card => {
    const def = defById(state, card.definitionId);
    return def !== undefined && bannedByBalrogOpponent(getCardEffects(def), actor.alignment);
  });
}

/**
 * Applies the CoE 1.8.2 trade: the banned hand card leaves the game, the
 * chosen sideboard card joins the play deck, and the deck is shuffled.
 *
 * Re-checks eligibility rather than trusting the caller, since the action is
 * offered in every strategy window and a state may have moved on since.
 */
export function applyBannedVsBalrogSwap(
  state: GameState,
  playerId: PlayerId,
  cardInstanceId: CardInstanceId,
  sideboardCardInstanceId: CardInstanceId,
): { readonly state: GameState; readonly error?: string } {
  const playerIndex = getPlayerIndex(state, playerId);
  const player = state.players[playerIndex];

  const banned = bannedVsBalrogHandCards(state, playerId)
    .find(c => c.instanceId === cardInstanceId);
  if (!banned) {
    return { state, error: `Card ${cardInstanceId as string} is not a card banned by a Balrog opponent in ${playerId as string}'s hand` };
  }
  const sideboardCard = findById(player.sideboard, sideboardCardInstanceId);
  if (!sideboardCard) {
    return { state, error: `Card ${sideboardCardInstanceId as string} not found in ${playerId as string}'s sideboard` };
  }

  const bannedDef = defById(state, banned.definitionId);
  const fetchedDef = defById(state, sideboardCard.definitionId);
  logDetail(`Rule 1.36: ${player.name} removes ${bannedDef?.name ?? (banned.definitionId as string)} from the game (Balrog opponent) and brings ${fetchedDef?.name ?? (sideboardCard.definitionId as string)} from the sideboard into the play deck`);

  const [shuffled, rng] = shuffle([...player.playDeck, sideboardCard], state.rng);
  return {
    state: {
      ...updatePlayer(state, playerIndex, p => ({
        ...p,
        hand: removeById(p.hand, cardInstanceId),
        outOfPlayPile: [...p.outOfPlayPile, banned],
        sideboard: removeById(p.sideboard, sideboardCardInstanceId),
        playDeck: shuffled,
      })),
      rng,
    },
  };
}
