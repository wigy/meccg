/**
 * @module ai/h2/modules/fetching/fetching
 *
 * The `fetching` module — every decision that is "choose a card".
 *
 * Four action types, one question. Drafting a starting character, pulling a
 * resource out of the sideboard between games, recovering something from the
 * discard pile, taking a hazard from the sideboard: each offers a set of cards
 * and asks which one to have. That is exactly the question §3.5's shadow price
 * answers, so this module is almost entirely a lookup — which is the point.
 * Writing a second opinion about what a card is worth is how the weight soup
 * came about, and there is now one place that says so.
 *
 * The one part that needed building is that `card-price` priced cards *in
 * hand*, and a fetch is about a card that is not. Its `quote` prices a
 * definition instead, and the branch that genuinely differs is the hazards: a
 * creature already held is worth its contribution to the standing plan, and one
 * on offer is worth what it *would* add to it. A creature that duplicates what
 * the plan already does is correctly worth less than one that opens a company
 * nothing is aimed at.
 *
 * These are not frequent decisions — 61 in three self-play games — but they are
 * consequential ones. A draft pick is a character for the whole game, and the
 * sideboard fetches are the only points where a deck is reshaped against what
 * the opponent has turned out to be playing.
 *
 * What it does not do: the *strategic* half. Which sources are worth chasing
 * across a game, and therefore which card completes a plan rather than merely
 * scoring, is the acquisition layer's, and it does not exist. So a fetch is
 * priced by what the card is worth on its own terms in this standing.
 */

import type { CardInstanceId, GameAction } from '@meccg/shared';
import type { Evaluation, H2Module, ModuleContext, Outcome, Rationale } from '../../core/types.js';
import { leaf, node } from '../../core/rationale.js';
import { computeCardPrices } from '../../services/card-price.js';

/** Action types this module scores. */
const OWNED_ACTION_TYPES = [
  'draft-pick',
  'add-character-to-deck',
  'fetch-from-pile',
  'fetch-from-sideboard',
  'fetch-hazard-from-sideboard',
] as const;

/** Assumptions every fetch evaluation rests on. */
const ASSUMPTIONS: readonly string[] = [
  'a card is priced by what it is worth in this standing, not by what it completes: which sources '
  + 'are worth chasing across a game is the acquisition layer\'s strategic half, which does not exist',
  'the card is priced as though it will be playable — `potentialDiscount` is the only allowance '
  + 'for its never becoming so, and nothing here checks whether the site, company or influence to '
  + 'play it will ever exist',
  'taking a card out of a pile changes what is left in it, and that is not modelled: a deck thinned '
  + 'of its best resource is worse to draw from afterwards',
];

/** The rounds of a character draft still on offer, as searchable zones. */
function draftPools(view: ModuleContext['view']): {
  cards: readonly { instanceId: CardInstanceId; definitionId: string }[];
  where: string;
}[] {
  const setup = (view.phaseState as unknown as {
    setupStep?: { draftState?: readonly { pool?: readonly { instanceId: CardInstanceId; definitionId: string }[] }[] };
  }).setupStep;
  return (setup?.draftState ?? [])
    .map(round => ({ cards: round.pool ?? [], where: 'draft pool' }));
}

/** Where the card being chosen lives, by action type. */
function chosenCard(action: GameAction, context: ModuleContext): { definitionId: string; where: string } | null {
  const { view } = context;
  const record = action as unknown as {
    cardInstanceId?: CardInstanceId;
    sideboardCardInstanceId?: CardInstanceId;
    characterInstanceId?: CardInstanceId;
    source?: string;
  };

  // Each action names the card in its own field, and reading only one of them
  // is the recurring bug in this project — `characters` on `move-to-influence`,
  // `combat` on `choose-strike-order`. All three are read here.
  const instanceId = record.cardInstanceId ?? record.sideboardCardInstanceId ?? record.characterInstanceId;
  if (!instanceId) return null;

  const zones: { cards: readonly { instanceId: CardInstanceId; definitionId: string }[]; where: string }[] = [
    { cards: view.self.sideboard ?? [], where: 'sideboard' },
    { cards: view.self.discardPile ?? [], where: 'discard pile' },
    { cards: view.self.hand ?? [], where: 'hand' },
    { cards: view.self.playDeck ?? [], where: 'play deck' },
    // The draft pool is not a zone on the player: it lives on the setup step,
    // because it exists only while the draft is running. Looking only at the
    // player's zones found nothing, and the module declined every pick.
    ...draftPools(view),
  ];
  for (const zone of zones) {
    const card = zone.cards.find(c => c.instanceId === instanceId);
    if (card) return { definitionId: card.definitionId as string, where: record.source ?? zone.where };
  }
  return null;
}

/**
 * The fetching module. No context gate: every one of these action types is a
 * choice between cards wherever it appears.
 */
export const fetchingModule: H2Module = {
  name: 'fetching',
  ownedActionTypes: OWNED_ACTION_TYPES,

  evaluate(action: GameAction, context: ModuleContext): Evaluation | null {
    if (!OWNED_ACTION_TYPES.includes(action.type as typeof OWNED_ACTION_TYPES[number])) return null;
    const chosen = chosenCard(action, context);
    if (!chosen) return null;

    const { standing, view, cardPool, tunables } = context;
    const quote = computeCardPrices(view, cardPool, standing, tunables).quote(chosen.definitionId);

    const outcomes: Outcome[] = [{
      p: 1,
      label: `take ${quote.name} from the ${chosen.where} — ${quote.reason}`,
      dtsd: quote.tsd,
    }];
    const scored = standing.score(outcomes);

    const detail: Rationale[] = [
      leaf('card', quote.name),
      leaf('from', chosen.where),
      leaf('what it is worth here', quote.tsd, {
        unit: 'tsd',
        tunable: 'potentialDiscount',
        note: quote.reason,
      }),
    ];

    return {
      action,
      module: 'fetching',
      outcomes,
      expectedTsd: scored.expectedTsd,
      sigmaTsd: scored.sigmaTsd,
      utility: scored.utility,
      method: scored.method,
      rationale: node(`take ${quote.name}`, scored.utility, [
        node('the card', quote.tsd, detail),
        scored.rationale,
      ], { unit: 'winprob' }),
      assumptions: ASSUMPTIONS,
    };
  },
};
