/**
 * @module ai/h2/modules/hand/hand
 *
 * The `hand` module — the sideboard exchange, and the card price it does not
 * yet compute.
 *
 * Plan §3.5 makes the case for this module at length, and the case is about a
 * *price*: one deck holds both hazards and resources, so every card kept as a
 * hazard is a resource not played. Every other module already faces the
 * question "is this card worth spending?" — `combat` when it decides whether
 * to cancel an attack, `factions` when an attempt discards the card on a
 * failure — and if each answers privately they will answer inconsistently.
 * That inconsistency is how the weight soup came about.
 *
 * The price cannot be computed yet. A card's reservation value depends on what
 * the hazard side expects to need next turn, and `hazards` (P6) is what
 * estimates that. Until then every consumer charges the flat
 * `provisionalCardPrice`, named in each rationale that uses it so no
 * explanation can hide which number produced a decision.
 *
 * What this module owns today is the sideboard exchange, which is a real
 * decision with a real shape: cards move between the sideboard and the deck or
 * discard, changing what the deck will offer later without moving a single
 * marshalling point now. That is scored as the point-neutral action it is,
 * with the deck's size reported, rather than given an invented preference.
 */

import type { GameAction } from '@meccg/shared';
import type { Evaluation, H2Module, ModuleContext, Outcome } from '../../core/types.js';
import { leaf, node } from '../../core/rationale.js';

/** Action types this module scores. */
const OWNED_ACTION_TYPES = [
  'start-sideboard-to-deck',
  'start-sideboard-to-discard',
] as const;

/** Assumptions every hand evaluation rests on. */
const ASSUMPTIONS: readonly string[] = [
  'a sideboard exchange is scored as marshalling-point neutral, which it is — what the deck will '
  + 'be worth holding is the card shadow price of §3.5, and that needs `hazards` (P6) to estimate '
  + 'what the hazard side will want',
  'no consumer has a real card price yet: `combat` and `factions` both charge the flat '
  + '`provisionalCardPrice`, which is one number where there should be a function of the standing, '
  + 'the deck remaining and the hazard demand',
];

/**
 * The hand module. No context gate: a sideboard action is always its own.
 */
export const handModule: H2Module = {
  name: 'hand',
  ownedActionTypes: OWNED_ACTION_TYPES,

  evaluate(action: GameAction, context: ModuleContext): Evaluation | null {
    const owned = new Set<string>(OWNED_ACTION_TYPES);
    if (!owned.has(action.type)) return null;
    const { standing, view, tunables } = context;

    const toDeck = action.type === 'start-sideboard-to-deck';
    const outcomes: Outcome[] = [{
      p: 1,
      label: toDeck
        ? 'move a card from the sideboard into the deck — no marshalling points move'
        : 'move a card from the sideboard to the discard — no marshalling points move',
      dtsd: 0,
    }];
    const scored = standing.score(outcomes);

    return {
      action,
      module: 'hand',
      outcomes,
      expectedTsd: scored.expectedTsd,
      sigmaTsd: scored.sigmaTsd,
      utility: scored.utility,
      method: scored.method,
      rationale: node('sideboard exchange', scored.utility, [
        node('hand economy', 0, [
          leaf('marshalling points moved', 0, { unit: 'mp', note: 'the deck changes, the score does not' }),
          leaf('deck remaining', view.self.playDeck.length, {
            note: 'how much is left to draw — an input to the card price once one exists',
          }),
          leaf('sideboard remaining', view.self.sideboard.length),
          leaf('card price in use elsewhere', tunables.provisionalCardPrice, {
            unit: 'tsd',
            tunable: 'provisionalCardPrice',
            note: 'the flat placeholder every consumer charges until §3.5\'s shadow price exists',
          }),
        ]),
        scored.rationale,
      ], { unit: 'winprob' }),
      assumptions: ASSUMPTIONS,
    };
  },
};
