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
import type { GameState } from '../index.js';
import { Phase } from '../types/state-phases.js';
import { logDetail } from './legal-actions/log.js';
import { defById, findPlayerAvatar, discardCardsInPlayWhere } from './reducer-utils.js';

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

/** Maps each `<wizard>-specific` keyword to the wizard's avatar name. */
const WIZARD_SPECIFIC_NAME: Readonly<Record<string, string>> = {
  'alatar-specific': 'Alatar',
  'gandalf-specific': 'Gandalf',
  'pallando-specific': 'Pallando',
  'radagast-specific': 'Radagast',
  'saruman-specific': 'Saruman',
};

/**
 * The name of the single Fallen-wizard a card is specific to (e.g. "Saruman"
 * for a card carrying `saruman-specific`), or `null` if the card is not
 * wizard-specific. Used to gate playability: a `<wizard>-specific` card is
 * playable only by the player whose revealed avatar is that wizard.
 */
export function wizardSpecificName(def: ReturnType<typeof defById>): string | null {
  if (!def || !('keywords' in def)) return null;
  for (const k of (def as { keywords?: readonly string[] }).keywords ?? []) {
    if (k in WIZARD_SPECIFIC_NAME) return WIZARD_SPECIFIC_NAME[k];
  }
  return null;
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

  // A wizard-specific stage card is swept only for a Fallen-wizard player whose
  // avatar is no longer in play. The per-player gate runs inside the predicate
  // (cheap: non-Fallen-wizard players short-circuit before the avatar lookup).
  return discardCardsInPlayWhere(
    state,
    (card, player) =>
      player.alignment === 'fallen-wizard'
      && !findPlayerAvatar(state, player)
      && isFallenWizardSpecific(defById(state, card.definitionId)),
    card => {
      const def = defById(state, card.definitionId);
      logDetail(`MEWH §12: Fallen-wizard avatar has left play — discarding wizard-specific stage card ${def?.name ?? (card.definitionId as string)}`);
    },
  ).state;
}
