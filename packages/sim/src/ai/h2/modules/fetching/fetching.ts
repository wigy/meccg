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
 * **The exchange is the same question asked twice.** When a play deck runs out
 * the discard pile is shuffled into a new one (`completeDeckExhaust`), and
 * before that happens the player may swap up to five cards between the discard
 * pile and the sideboard. So one `exchange-sideboard` moves a card *out* of the
 * deck about to be built and another *in*, and it is worth the difference
 * between the two prices — the same `quote` a fetch uses, on both legs.
 *
 * It was the largest action type with no owner at all: the engine offers every
 * (discard, sideboard) pair as its own candidate, 20150 of them in three games,
 * and every one of those decisions went to Heuristics 1, which has no evaluator
 * for the type either. A swap chosen at random is not neutral — it is as likely
 * to send the deck's best remaining card to the sideboard as to fetch one back.
 * `pass` is the do-nothing baseline here, so a swap is taken only when the
 * difference is positive, which is exactly the rule the decision wants.
 *
 * What it does not do: the *strategic* half. Which sources are worth chasing
 * across a game, and therefore which card completes a plan rather than merely
 * scoring, is the acquisition layer's, and it does not exist. So a fetch is
 * priced by what the card is worth on its own terms in this standing.
 */

import type { CardInstanceId, GameAction } from '@meccg/shared';
import type { Evaluation, H2Module, ModuleContext, Outcome, Rationale } from '../../core/types.js';
import { leaf, node } from '../../core/rationale.js';
import { namedCard, namedCharacter, namedGivenUpCard } from '../../core/action-fields.js';
import { computeCardPrices } from '../../services/card-price.js';

/** Action types this module scores. */
const OWNED_ACTION_TYPES = [
  'draft-pick',
  'add-character-to-deck',
  'assign-starting-item',
  'fetch-from-pile',
  'fetch-from-sideboard',
  'fetch-hazard-from-sideboard',
  'exchange-sideboard',
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
  'where a card goes is not priced, only which card it is — so every way of assigning the same '
  + 'starting item to a different character ties, and the choice of bearer falls to Heuristics 1',
  'a favourite mark is taken at face value: the deck author is assumed to have meant it, and no '
  + 'check is made that the marked characters can actually form a legal starting company together '
  + '(the mind limit is enforced by the engine, not weighed here)',
  'a deck-exhaust exchange is priced as though both cards were equally likely to be drawn again; '
  + 'the discard pile becomes the whole new play deck, so that is close, but a five-card swap is '
  + 'scored one pair at a time and the fifth is priced against the same standing as the first',
];

/** A card sitting in a setup pool, wherever that pool keeps it. */
interface PoolCard {
  readonly instanceId: CardInstanceId;
  readonly definitionId: string;
}

/**
 * The setup pools still on offer, as searchable zones.
 *
 * Neither of these is a zone on the player: they live on the setup step,
 * because they exist only while that step runs. There are two, with different
 * field names — `draftState[].pool` for the starting-character draft and
 * `deckDraftState[].remainingPool` for choosing which characters go into the
 * play deck — and handling only the first left `add-character-to-deck` unowned
 * even after the module had nominally taken it.
 */
function setupPools(view: ModuleContext['view']): {
  cards: readonly PoolCard[];
  where: string;
}[] {
  const setup = (view.phaseState as unknown as {
    setupStep?: {
      draftState?: readonly { pool?: readonly PoolCard[] }[];
      deckDraftState?: readonly { remainingPool?: readonly PoolCard[] }[];
    };
  }).setupStep;
  return [
    ...(setup?.draftState ?? []).map(round => ({ cards: round.pool ?? [], where: 'draft pool' })),
    ...(setup?.deckDraftState ?? [])
      .map(round => ({ cards: round.remainingPool ?? [], where: 'deck-draft pool' })),
  ];
}

/** Where the card being chosen lives, by action type. */
function chosenCard(action: GameAction, context: ModuleContext): { definitionId: string; where: string } | null {
  const { view } = context;
  const record = action as unknown as {
    cardInstanceId?: CardInstanceId;
    sideboardCardInstanceId?: CardInstanceId;
    characterInstanceId?: CardInstanceId;
    // `assign-starting-item` names the card by *definition*, because at setup
    // there is no instance yet — the item is being minted onto a character.
    itemDefId?: string;
    source?: string;
  };
  if (record.itemDefId) return { definitionId: record.itemDefId, where: 'starting items' };

  // Each action names the card in its own field, and reading only one of them
  // is the recurring bug in this project. The spellings live in
  // `core/action-fields`; a fetch may name either a card or a character, and
  // both mean "the thing being chosen" here.
  const instanceId = namedCard(action) ?? namedCharacter(action);
  if (!instanceId) return null;

  const zones: { cards: readonly { instanceId: CardInstanceId; definitionId: string }[]; where: string }[] = [
    { cards: view.self.sideboard ?? [], where: 'sideboard' },
    { cards: view.self.discardPile ?? [], where: 'discard pile' },
    { cards: view.self.hand ?? [], where: 'hand' },
    { cards: view.self.playDeck ?? [], where: 'play deck' },
    // The setup pools are not zones on the player: they live on the setup step,
    // because they exist only while it runs. Looking only at the player's zones
    // found nothing, and the module declined every pick.
    ...setupPools(view),
  ];
  for (const zone of zones) {
    const card = zone.cards.find(c => c.instanceId === instanceId);
    if (card) return { definitionId: card.definitionId, where: record.source ?? zone.where };
  }
  return null;
}

/**
 * Whether a starting-character pick takes one of the characters this deck's
 * author marked as a favourite.
 *
 * At 0–0 every source's marginal contribution is zero — CoE 10.3 step 4's
 * half-total diversity cap is degenerate on an empty board — so `card-price`
 * quotes every draft candidate at exactly 0 and the pick falls to whatever order
 * ties happen to break in. Against the live corpus that made H2 draft a
 * favourite 11% of the time on decks whose human owners drafted one 75% of the
 * time, where picking uniformly at random would have got 41%: the one decision
 * every later decision is conditioned on, decided by nothing, and decided worse
 * than a coin.
 *
 * Nothing printed on a character says a deck is built around it. Whether its
 * race matches the deck's factions, whether its influence carries the allies,
 * whether its home site is on the intended route — all of that lives in the
 * deck's construction, not on the card. So the only honest signal is the
 * author's own declaration, which the deck file has been carrying all along and
 * which now reaches the draft state.
 *
 * The pool holding the picked card identifies the seat: a player may only pick
 * from their own pool, and the projection hides the opponent's pool — and their
 * favourites with it, that being a statement of their plan.
 */
function isFavouritePick(action: GameAction, context: ModuleContext): boolean {
  if (action.type !== 'draft-pick') return false;
  const instanceId = namedCharacter(action) ?? namedCard(action);
  if (!instanceId) return false;
  const setup = (context.view.phaseState as unknown as {
    setupStep?: {
      draftState?: readonly { pool?: readonly PoolCard[]; favourites?: readonly string[] }[];
    };
  }).setupStep;
  for (const round of setup?.draftState ?? []) {
    const card = (round.pool ?? []).find(c => c.instanceId === instanceId);
    if (card) return (round.favourites ?? []).includes(card.definitionId);
  }
  return false;
}

/**
 * The deck-exhaust exchange: one card out of the new play deck, one in.
 *
 * The discard pile *is* the next play deck (`completeDeckExhaust` shuffles it
 * whole), so the swap is a difference of two reservation values and nothing
 * else. Both legs go through the same `quote` a fetch uses, which is the point:
 * a second opinion about what a card is worth is how the weight soup came about.
 */
function evaluateExchange(action: GameAction, context: ModuleContext): Evaluation | null {
  const { standing, view, cardPool, tunables } = context;
  const gainedId = namedCard(action);
  const givenUpId = namedGivenUpCard(action);
  const gained = view.self.sideboard.find(c => c.instanceId === gainedId);
  const givenUp = view.self.discardPile.find(c => c.instanceId === givenUpId);
  if (!gained || !givenUp) return null;

  const prices = computeCardPrices(view, cardPool, standing, tunables);
  const incoming = prices.quote(gained.definitionId);
  const outgoing = prices.quote(givenUp.definitionId);
  const dtsd = incoming.tsd - outgoing.tsd;

  const outcomes: Outcome[] = [{
    p: 1,
    label: `swap ${outgoing.name} out of the new deck for ${incoming.name}`,
    dtsd,
  }];
  const scored = standing.score(outcomes);

  const detail: Rationale[] = [
    leaf('into the new deck', incoming.tsd, {
      unit: 'tsd',
      tunable: 'potentialDiscount',
      note: `${incoming.name} — ${incoming.reason}`,
    }),
    leaf('out to the sideboard', outgoing.tsd, {
      unit: 'tsd',
      tunable: 'potentialDiscount',
      note: `${outgoing.name} — ${outgoing.reason}`,
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
    rationale: node(`swap ${outgoing.name} for ${incoming.name}`, scored.utility, [
      node('the exchange', dtsd, detail, { unit: 'tsd' }),
      scored.rationale,
    ], { unit: 'winprob' }),
    assumptions: ASSUMPTIONS,
  };
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
    // The one two-legged action here: a swap is a difference of prices, not a
    // gain. Reading only the card it names would score it as a gift.
    if (action.type === 'exchange-sideboard') return evaluateExchange(action, context);
    const chosen = chosenCard(action, context);
    if (!chosen) return null;

    const { standing, view, cardPool, tunables } = context;
    const quote = computeCardPrices(view, cardPool, standing, tunables).quote(chosen.definitionId);
    const favourite = isFavouritePick(action, context) ? tunables.favouriteCharacterTsd : 0;
    const total = quote.tsd + favourite;

    const outcomes: Outcome[] = [{
      p: 1,
      label: favourite > 0
        ? `take ${quote.name} from the ${chosen.where} — the deck asked for it`
        : `take ${quote.name} from the ${chosen.where} — ${quote.reason}`,
      dtsd: total,
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
    if (favourite > 0) {
      detail.push(leaf('the deck wants it in the starting company', favourite, {
        unit: 'tsd',
        tunable: 'favouriteCharacterTsd',
        note: 'marked a favourite by the deck author',
      }));
    }

    return {
      action,
      module: 'fetching',
      outcomes,
      expectedTsd: scored.expectedTsd,
      sigmaTsd: scored.sigmaTsd,
      utility: scored.utility,
      method: scored.method,
      rationale: node(`take ${quote.name}`, scored.utility, [
        node('the card', total, detail),
        scored.rationale,
      ], { unit: 'winprob' }),
      assumptions: ASSUMPTIONS,
    };
  },
};
