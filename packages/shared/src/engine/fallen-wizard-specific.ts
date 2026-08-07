/**
 * @module fallen-wizard-specific
 *
 * CoE rule 2.2.F1 — "If a Fallen-wizard player's avatar leaves play": if a
 * Fallen-wizard avatar leaves play, all of that player's in-play stage
 * resource permanent-events that are *specific* to their wizard are discarded.
 *
 * Wizard-specific stage cards carry the `fallen-wizard-specific` keyword (added
 * to the WH card data). Because a Fallen-wizard's deck may only contain stage
 * cards specific to their *own* declared wizard, every such card in play belongs
 * to that player's wizard — so when the avatar is gone, all of them are
 * discarded. The sweep is idempotent: once they are discarded, later passes find
 * nothing to do.
 *
 * "Leaves play" is gated on *elimination* (avatar in `outOfPlayPile`), not
 * merely "not currently in play": the engine's only path for an avatar to
 * leave play is {@link eliminateAvatar} in `reducer-win-conditions.ts`, which
 * always routes the avatar to `outOfPlayPile`. A Fallen-wizard whose avatar
 * simply hasn't been played yet (declared but still in hand/deck/sideboard,
 * per CoE 2.2.F2 / {@link findFallenWizardAvatarName}) has an avatar that has
 * never been in play, so it cannot have "left" it — using the stricter
 * "currently in play" check here wrongly discarded a Stage card the instant it
 * was legally played, before the avatar was ever fielded.
 */
import type { GameState } from '../index.js';
import { WIZARD_SPECIFIC_KEYWORD_NAMES } from '../types/common.js';
import { Phase } from '../types/state-phases.js';
import { getPlayerIndex } from '../state-utils.js';
import { logDetail } from './legal-actions/log.js';
import { defById, hasEliminatedAvatar, discardCardsInPlayWhere } from './reducer-utils.js';

/** Whether a card definition carries any wizard-specific keyword. */
function isFallenWizardSpecific(def: ReturnType<typeof defById>): boolean {
  if (!def || !('keywords' in def)) return false;
  return ((def as { keywords?: readonly string[] }).keywords ?? [])
    .some(k => k in WIZARD_SPECIFIC_KEYWORD_NAMES);
}

/**
 * The name of the single Fallen-wizard a card is specific to (e.g. "Saruman"
 * for a card carrying `saruman-specific`), or `null` if the card is not
 * wizard-specific. Used to gate playability: a `<wizard>-specific` card is
 * playable only by the player whose revealed avatar is that wizard.
 */
export function wizardSpecificName(def: ReturnType<typeof defById>): string | null {
  if (!def || !('keywords' in def)) return null;
  for (const k of (def as { keywords?: readonly string[] }).keywords ?? []) {
    if (k in WIZARD_SPECIFIC_KEYWORD_NAMES) return WIZARD_SPECIFIC_KEYWORD_NAMES[k];
  }
  return null;
}

/**
 * Discards a Fallen-wizard player's in-play `fallen-wizard-specific` stage
 * permanent-events once their avatar has been eliminated (CoE 2.2.F1).
 *
 * Runs in `postReduce`. Skipped during the setup phase so that any
 * starting-stage cards are never swept before the avatar is first placed.
 */
export function sweepFallenWizardSpecific(state: GameState): GameState {
  if (state.phaseState.phase === Phase.Setup) return state;

  // A wizard-specific stage card is swept only for a Fallen-wizard player whose
  // avatar has left play — i.e. been eliminated (CoE 2.2), the only way an
  // avatar leaves play in this engine. The per-player gate runs inside the
  // predicate (cheap: non-Fallen-wizard players short-circuit before the
  // elimination lookup).
  return discardCardsInPlayWhere(
    state,
    (card, player) =>
      player.alignment === 'fallen-wizard'
      && hasEliminatedAvatar(state, getPlayerIndex(state, player.id))
      && isFallenWizardSpecific(defById(state, card.definitionId)),
    card => {
      const def = defById(state, card.definitionId);
      logDetail(`CoE 2.2.F1: Fallen-wizard avatar eliminated — discarding wizard-specific stage card ${def?.name ?? (card.definitionId as string)}`);
    },
  ).state;
}
