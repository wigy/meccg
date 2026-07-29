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
 * That price now exists. It was blocked on `hazards`, exactly as §3.5 said it
 * would be — a card's reservation value depends on what the hazard side expects
 * to need, and nothing could estimate that until the denial model did. The
 * `card-price` service prices a resource by the points it would score in this
 * standing, a character by whether its mind even fits the influence free, and a
 * creature by what it would deny against the opponent's largest company.
 *
 * The difference that makes to *this* module is the whole reason to care.
 * Before it, every `discard-card` action scored identically, so the module had
 * no opinion about which card to throw — and the horizon test said so, with a
 * correlation of -0.02 over a thousand predictions. A module whose predictions
 * do not vary cannot be right about anything.
 *
 * This module also owns the sideboard exchange, which is a real decision with a
 * real shape: cards move between the sideboard and the deck or discard,
 * changing what the deck will offer later without moving a single marshalling
 * point now. That is scored as the point-neutral action it is, with the deck's
 * size reported, rather than given an invented preference.
 */

import type { CardInstanceId, GameAction } from '@meccg/shared';
import type { Evaluation, H2Module, ModuleContext, Outcome } from '../../core/types.js';
import { leaf, node } from '../../core/rationale.js';
import { computeCardPrices } from '../../services/card-price.js';

/** Action types this module scores. */
const OWNED_ACTION_TYPES = [
  'start-sideboard-to-deck',
  'start-sideboard-to-discard',
  // The Nazgûl variants (CoE 5.24): the same exchange, moving hazards rather
  // than resources. Both went unowned purely because the action types have
  // different names — the `-to-discard` one for 46 decisions in three games and
  // the `-to-deck` one for 41, and the second was missed when the first was
  // fixed because the report lists them separately.
  'start-hazard-sideboard-to-discard',
  'start-hazard-sideboard-to-deck',
  // §3.5 names these as the module's own: the end-of-turn discard and the
  // draw that refills the hand. They are also the most common candidates in
  // the game with no owner — `discard-card` alone appears in more contested
  // decisions than any action but `pass`.
  'discard-card',
  'draw-cards',
] as const;

/** Assumptions every hand evaluation rests on. */
const ASSUMPTIONS: readonly string[] = [
  'a sideboard exchange is scored as marshalling-point neutral, which it is — what the deck will '
  + 'be worth holding is a question about cards not yet drawn, which the card price cannot answer',
  'the card price values a creature by what it would deny against their *largest* company, which '
  + 'is a stand-in for the company it would actually be keyed to',
  'other consumers still charge the flat `provisionalCardPrice` when they spend a card: `combat` '
  + 'and `factions` have not been moved onto the priced service yet',
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

    if (action.type === 'discard-card' || action.type === 'draw-cards') {
      // A card leaving the hand costs what holding it was worth; a card drawn
      // gains it. Both use the same price, which is the point of §3.5 — one
      // number, one owner — even while that number is still the flat
      // placeholder rather than a real reservation value.
      const discarding = action.type === 'discard-card';
      // Priced only when discarding: a draw has nothing in particular to
      // value, and the creature valuation resolves whole attacks.
      const discarded = discarding
        ? computeCardPrices(view, context.cardPool, standing, tunables)
          .worth((action as unknown as { cardInstanceId: CardInstanceId }).cardInstanceId)
        : null;
      // What a discard costs is what *that card* was worth, not what a card is
      // worth on average. This is the whole point of the shadow price: the
      // module can now prefer throwing the faction it can never score over the
      // creature that would tap their company.
      const dtsd = discarding
        ? -(discarded?.tsd ?? tunables.provisionalCardPrice)
        : tunables.resourceDrawValue;
      const outcomes: Outcome[] = [{
        p: 1,
        label: discarding
          ? `discard ${discarded?.name ?? 'a card'} — ${discarded?.reason ?? 'the flat price'}`
          : 'draw to refill the hand',
        dtsd,
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
        rationale: node(discarding ? 'discard' : 'draw', scored.utility, [
          node('hand economy', dtsd, [
            leaf(discarding ? `${discarded?.name ?? 'card'} given up` : 'card gained', Math.abs(dtsd), {
              unit: 'tsd',
              tunable: discarding ? 'potentialDiscount' : 'resourceDrawValue',
              note: discarding ? discarded?.reason : undefined,
            }),
            leaf('hand size', view.self.hand.length),
            leaf('deck remaining', view.self.playDeck.length),
          ]),
          scored.rationale,
        ], { unit: 'winprob' }),
        assumptions: [
          discarding
            ? 'a card is priced by what it would be worth if it could be played, discounted by '
              + '`potentialDiscount`; whether it is *reachable* — the right site, the right '
              + 'company, the influence to spare — is not modelled'
            : 'a drawn card is priced at the average worth of a draw, not at what is actually drawn',
          ...ASSUMPTIONS,
        ],
      };
    }

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
