/**
 * @module ai/h2/services/denial
 *
 * What harming an opposing company is actually worth.
 *
 * A service rather than a part of `hazards`, because two callers need the same
 * answer: the module deciding what to play now, and `card-price` deciding what
 * a creature still in hand is worth keeping. Two private copies of this would
 * be two different opinions about the value of the same card.
 *
 * §3.4 is emphatic that the objective is **denial, not damage**, and the
 * distinction has teeth. The opponent's marshalling points this turn come
 * almost entirely from resource plays during their site phase, and those plays
 * need untapped characters to tap. A company that arrives tapped scores
 * nothing whether or not anyone died; a company that arrives with three
 * untapped characters and one resource card left in hand loses nothing by
 * having two of them tapped.
 *
 * So this module prices a strike outcome by what it *denies*, and the denial is
 * capped by what the opponent could have done with the character anyway. The
 * cap is where the belief service earns its place: the number of resource
 * plays available is bounded by the resource cards they are believed to hold,
 * not by the number of characters standing.
 *
 * A tap is therefore priced the way `character-value` prices one from the other
 * side of the table — the tempo it costs, *plus what it forfeits* — and here
 * what it forfeits is a resource play, converted through `standing` so it picks
 * up the doubling and the cap. Pricing the tap as bare `tapTempoCost` was the
 * first attempt and it was badly wrong: it valued an entire denied site phase
 * at a third of a point, against a kill-MP gift of two, so the module concluded
 * that no hazard in the game was ever worth playing.
 *
 * The denial is **marginal, not average**. Tapping two characters of a company
 * of five denies nothing at all if the opponent holds only two resources to
 * play — they still have three hands free. So each tap is credited with the
 * plays it actually removes, `min(standing, held) - min(standing - 1, held)`,
 * which is one while the company is the binding constraint, zero while the hand
 * is, and a fraction across the boundary. Crediting every tap with an average
 * share instead makes a single-strike creature look like a third of a site
 * phase when it is worth nothing.
 *
 * Two things are priced beyond the tap:
 *
 * - **A wound outlasts the turn.** A wounded character does not untap at the
 *   end of it, so it forfeits the next turn's play as well — two, not one, and
 *   that is a rule rather than a parameter. It is conservative: a wound is
 *   healed at a haven, which is usually further off than one turn.
 * - **An elimination takes its marshalling points with it.** Those are on the
 *   board today, so the loss goes through `standing` at the opponent's own
 *   marginal rate — which correctly reports zero when their character source
 *   is already capped.
 *
 * The tempo terms are the *same tunables* `combat` spends when it is the
 * defender. That is deliberate: what an event costs the player who suffers it
 * and what it is worth to the player who inflicts it are one number, and giving
 * `hazards` its own copy would let the two drift into disagreeing about the
 * same event.
 */

import type { CardDefinition, PlayerView } from '@meccg/shared';
import { CardStatus } from '@meccg/shared';
import type { OpponentCompanyView } from '@meccg/shared';
import type { Tunables } from '../core/tunables.js';
import type { Standing } from './standing.js';
import type { Beliefs } from './beliefs.js';
import type { StrikeOutcome } from './strike/strike-model.js';
import type { StrikeTarget } from './strike/prowess.js';
import type { SequencePricer, StrikeContext } from './strike/sequence.js';

/** How much of the company's standing roster is worth anything to deny. */
export interface DenialContext {
  /** Untapped characters in the target company right now. */
  readonly untapped: number;
  /** Resource plays the opponent is believed able to make with them. */
  readonly believedPlays: number;
  /**
   * Fraction of a tap that is worth denying, in [0, 1].
   *
   * One if they hold at least as many resources as they have hands to play
   * them with; less when the characters outnumber the cards, because tapping
   * the fourth character of a company holding one resource denies nothing.
   */
  readonly tapUtilisation: number;
  /** TSD gained by denying one whole resource play, before the cap. */
  readonly fullPlay: number;
}

/** Read the denial context for a company off the view and the beliefs. */
export function denialContext(
  view: PlayerView,
  company: OpponentCompanyView,
  beliefs: Beliefs,
  standing: Standing,
  tunables: Tunables,
): DenialContext {
  let untapped = 0;
  for (const characterId of company.characters) {
    const character = view.opponent.characters[characterId];
    if (character && character.status === CardStatus.Untapped) untapped++;
  }
  const believedPlays = beliefs.expectedInHand('resource');
  const tapUtilisation = untapped <= 0 ? 0 : Math.min(1, believedPlays / untapped);
  // One fewer play for them is `deniedPlayMp` fewer marshalling points, and
  // `standing` says what those are worth in this position rather than assuming.
  const fullPlay = standing.tsdAfter({}, { item: -tunables.deniedPlayMp }) - standing.tsd;
  return { untapped, believedPlays, tapUtilisation, fullPlay };
}

/** Marshalling points an opposing character carries, from its printed card. */
export function characterMp(
  cardPool: Readonly<Record<string, CardDefinition>>,
  target: StrikeTarget,
): number {
  const mp = (cardPool[target.definitionId] as unknown as { marshallingPoints?: number } | undefined)
    ?.marshallingPoints;
  return typeof mp === 'number' ? mp : 0;
}

/**
 * The pricer handed to the strike enumeration, from the attacking seat.
 *
 * Signs are the mirror of `combat`'s: every outcome that costs the defender
 * something is worth that much to us. What is *not* mirrored is the kill
 * marshalling points — those are banked by the enumeration itself, once per
 * attack, on the branch where every strike was defeated.
 */
export function denialPricer(
  cardPool: Readonly<Record<string, CardDefinition>>,
  standing: Standing,
  tunables: Tunables,
  context: DenialContext,
): SequencePricer {
  /** Plays removed by taking one more character out of the standing count. */
  const playsDenied = (untappedBefore: number): number => {
    const held = context.believedPlays;
    return Math.max(0, Math.min(untappedBefore, held) - Math.min(untappedBefore - 1, held));
  };

  return (outcome: StrikeOutcome, target: StrikeTarget, strike: StrikeContext): number => {
    // Allies cannot be tapped to play resources, so removing one denies nothing
    // but the tempo of it.
    const denied = target.isAlly ? 0 : playsDenied(strike.untappedBefore) * context.fullPlay;
    switch (outcome.character) {
      case 'tapped':
        return tunables.tapTempoCost + denied;
      case 'wounded':
        // Two plays, not one: a wounded character does not untap at the end of
        // the turn, so next turn's play goes with this one.
        return tunables.woundTempoCost + 2 * denied;
      case 'eliminated': {
        const mp = characterMp(cardPool, target);
        // An ally's points sit in the ally source, a character's in the
        // character source, and the two have different marginal values — the
        // whole reason `standing` is asked rather than a rate assumed.
        const source = target.isAlly ? 'ally' : 'character';
        const mpLoss = mp > 0 ? standing.tsdAfter({}, { [source]: -mp }) - standing.tsd : 0;
        // Its plays are gone for good, but crediting more than the two turns a
        // wound already costs would need a horizon model this does not have.
        return tunables.eliminationTempoCost + mpLoss + 2 * denied;
      }
      default:
        return 0;
    }
  };
}
