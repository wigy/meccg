/**
 * @module fallen-wizard-specific
 *
 * MEWH §12 — "When your Fallen-wizard leaves play": if a Fallen-wizard avatar
 * leaves play, all of that player's in-play stage resource permanent-events that
 * are *specific* to their wizard are discarded.
 *
 * Wizard-specific stage cards carry the `fallen-wizard-specific` keyword (added
 * to the WH card data). Because a Fallen-wizard's deck may only contain stage
 * cards specific to their *own* declared wizard, every such card in play belongs
 * to that player's wizard — so when the avatar is gone, all of them are
 * discarded. The sweep is idempotent: once they are discarded, later passes find
 * nothing to do.
 */
import type { GameState, PlayerState } from '../index.js';
import { Phase } from '../index.js';
import { logDetail } from './legal-actions/log.js';
import { defById, findPlayerAvatar, toCardInstance } from './reducer-utils.js';

/**
 * The per-wizard "X-specific" keywords carried by wizard-specific stage cards.
 * Each names the single Fallen-wizard the card is bound to. A Fallen-wizard deck
 * may only contain cards specific to its own declared wizard (deck rule), so
 * every such card a player has in play belongs to that player's wizard.
 */
const WIZARD_SPECIFIC_KEYWORDS: ReadonlySet<string> = new Set([
  'alatar-specific',
  'gandalf-specific',
  'pallando-specific',
  'radagast-specific',
  'saruman-specific',
]);

/** Whether a card definition carries any wizard-specific keyword. */
function isFallenWizardSpecific(def: ReturnType<typeof defById>): boolean {
  if (!def || !('keywords' in def)) return false;
  return ((def as { keywords?: readonly string[] }).keywords ?? [])
    .some(k => WIZARD_SPECIFIC_KEYWORDS.has(k));
}

/**
 * Discards a Fallen-wizard player's in-play `fallen-wizard-specific` stage
 * permanent-events once their avatar is no longer in play (MEWH §12).
 *
 * Runs in `postReduce`. Skipped during the setup phase so that any
 * starting-stage cards are never swept before the avatar is first placed.
 */
export function sweepFallenWizardSpecific(state: GameState): GameState {
  if (state.phaseState.phase === Phase.Setup) return state;

  let players: PlayerState[] | null = null;
  state.players.forEach((player, idx) => {
    if (player.alignment !== 'fallen-wizard') return;
    // Avatar still in play → nothing to do.
    if (findPlayerAvatar(state, player)) return;

    const specific = player.cardsInPlay.filter(card => isFallenWizardSpecific(defById(state, card.definitionId)));
    if (specific.length === 0) return;

    const specificIds = new Set(specific.map(c => c.instanceId as string));
    for (const card of specific) {
      const def = defById(state, card.definitionId);
      logDetail(`MEWH §12: Fallen-wizard avatar has left play — discarding wizard-specific stage card ${def && 'name' in def ? (def as { name: string }).name : (card.definitionId as string)}`);
    }

    if (!players) players = [...state.players];
    players[idx] = {
      ...player,
      cardsInPlay: player.cardsInPlay.filter(c => !specificIds.has(c.instanceId as string)),
      discardPile: [...player.discardPile, ...specific.map(toCardInstance)],
    };
  });

  if (!players) return state;
  return { ...state, players: players as unknown as readonly [PlayerState, PlayerState] };
}
