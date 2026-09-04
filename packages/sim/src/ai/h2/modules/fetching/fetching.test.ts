/**
 * @module ai/h2/modules/fetching/fetching.test
 *
 * The module is almost entirely a lookup into the shadow price, so what the
 * tests pin is the wiring — that each action type's card is found where that
 * action keeps it — and the one property worth stating out loud: at the opening
 * draft every *unmarked* candidate prices at zero, and that is the tournament
 * scorer talking, not a bug here.
 *
 * Which is why the favourite mark gets tests of its own. It is the only thing
 * that separates two draft candidates before anyone has scored a point, so the
 * pair of cases that matter is the same character with and without it: the card
 * does not change, the deck's declaration does.
 *
 * The exchange gets more than wiring, because it is the one action here with
 * two legs and the failure mode is silent: read only the card it names and a
 * swap prices as a gift, so every candidate looks like an improvement and the
 * module cheerfully trades the deck's best card away.
 */

import { describe, expect, test } from 'vitest';
import { computeLegalActions, loadCardPool, computeTournamentScore, printedMind } from '@meccg/shared';
import type { MarshallingPointTotals } from '@meccg/shared';
import { DEFAULT_TUNABLES } from '../../core/tunables.js';
import type { ModuleContext } from '../../core/types.js';
import { computeStanding } from '../../services/standing.js';
import { computeCardPrices } from '../../services/card-price.js';
import { loadScenario, scenarioView } from '../../scenario-store.js';
import { testWinProbModel } from '../../test-support.js';
import { fetchingModule } from './fetching.js';

/** The opening draft, where the offered characters live on the setup step. */
const DRAFT = 'setup/draft-pick';

/** A deck run out, with the discard pile about to be shuffled into a new one. */
const EXCHANGE = 'fetching/deck-exhaust-exchange';

/** A scenario as a module context, with the actions the engine offers. */
function position(id: string) {
  const scenario = loadScenario(id);
  const view = scenarioView(scenario);
  const cardPool = loadCardPool();
  const legalActions = computeLegalActions(scenario.state, scenario.actingPlayer)
    .filter(legal => legal.viable)
    .map(legal => legal.action);
  return {
    legalActions,
    context: {
      view,
      cardPool,
      legalActions,
      tunables: DEFAULT_TUNABLES,
      standing: computeStanding(view, testWinProbModel(), DEFAULT_TUNABLES),
    } as ModuleContext,
  };
}

describe('choosing a card', () => {
  test('finds the card a draft pick names, which is not in any player zone', () => {
    // The draft pool lives on the setup step, because it exists only while the
    // draft runs. Looking only at the player's zones found nothing and the
    // module declined every pick — the same shape of bug as reading the wrong
    // field off an action.
    const { context, legalActions } = position(DRAFT);
    const picks = legalActions.filter(a => a.type === 'draft-pick');
    expect(picks.length).toBeGreaterThan(1);
    for (const pick of picks) {
      const evaluation = fetchingModule.evaluate(pick, context);
      expect(evaluation).not.toBeNull();
      expect(evaluation!.outcomes[0].label).toContain('draft pool');
    }
  });

  test('names the card rather than its instance id', () => {
    const { context, legalActions } = position(DRAFT);
    const pick = legalActions.find(a => a.type === 'draft-pick')!;
    expect(fetchingModule.evaluate(pick, context)!.outcomes[0].label).not.toMatch(/p\d+-\d+/);
  });

  test('declines an action whose card it cannot find', () => {
    const { context } = position(DRAFT);
    expect(fetchingModule.evaluate(
      { type: 'draft-pick', player: 'p1', characterInstanceId: 'nobody' } as never,
      context,
    )).toBeNull();
  });
});

/**
 * The same draft position, with the deck author's favourite marks supplied on
 * the pool the candidates come from.
 *
 * The captured scenario predates the field, which is exactly the state of an
 * unmarked deck — so marking here is what distinguishes the two cases.
 */
function draftMarking(favourites: string[]) {
  const base = position(DRAFT);
  const picks = base.legalActions.filter(a => a.type === 'draft-pick');
  const named = (a: typeof picks[number]): string =>
    String((a as unknown as { characterInstanceId: string }).characterInstanceId);
  const setup = (base.context.view.phaseState as unknown as {
    setupStep: { draftState: { pool?: { instanceId: string; definitionId: string }[] }[] };
  }).setupStep;
  const mine = setup.draftState.findIndex(d => d.pool?.some(c => c.instanceId === named(picks[0])));
  const draftState = setup.draftState.map((d, i) => (i === mine ? { ...d, favourites } : d));
  const view = {
    ...base.context.view,
    phaseState: { ...base.context.view.phaseState, setupStep: { ...setup, draftState } },
  };
  const pool = setup.draftState[mine].pool ?? [];
  return {
    picks,
    pool,
    definitionOf: (a: typeof picks[number]): string =>
      pool.find(c => c.instanceId === named(a))!.definitionId,
    context: { ...base.context, view } as ModuleContext,
  };
}

describe('a character the deck asked for', () => {
  test('a marked character outscores every unmarked one', () => {
    // The measurement behind this: replaying the live corpus, H2 drafted a
    // favourite 11% of the time on decks whose human owners drafted one 75% of
    // the time — worse than the 41% a coin would have managed, because a flat
    // zero leaves the pick to tie-break order.
    const unmarked = draftMarking([]);
    const favourite = unmarked.definitionOf(unmarked.picks[0]);
    const { picks, context, definitionOf } = draftMarking([favourite]);

    const scored = picks.map(a => ({
      marked: definitionOf(a) === favourite,
      tsd: fetchingModule.evaluate(a, context)!.expectedTsd,
    }));
    const best = Math.max(...scored.filter(s => !s.marked).map(s => s.tsd));
    for (const pick of scored.filter(s => s.marked)) expect(pick.tsd).toBeGreaterThan(best);
  });

  test('the mark is named in the rationale, like every other number', () => {
    const unmarked = draftMarking([]);
    const favourite = unmarked.definitionOf(unmarked.picks[0]);
    const { picks, context, definitionOf } = draftMarking([favourite]);
    const marked = picks.find(a => definitionOf(a) === favourite)!;

    const detail = fetchingModule.evaluate(marked, context)!.rationale.children![0].children!;
    expect(detail.map(child => child.tunable)).toContain('favouriteCharacterTsd');
  });

  test('it is the deck talking, not the card: the mark is worth the same to any character', () => {
    // Nothing printed on the character changes between the two evaluations of
    // each pick — only whether the deck that brought it said it wanted it. So
    // the mark must move every character by the same amount, whatever it costs
    // or scores. If it did not, the mark would be smuggling a valuation.
    const unmarked = draftMarking([]);
    const defs = [...new Set(unmarked.picks.map(unmarked.definitionOf))];
    const lift = (definitionId: string): number => {
      const marked = draftMarking([definitionId]);
      const pick = marked.picks.find(a => marked.definitionOf(a) === definitionId)!;
      const before = unmarked.picks.find(a => unmarked.definitionOf(a) === definitionId)!;
      return fetchingModule.evaluate(pick, marked.context)!.expectedTsd
        - fetchingModule.evaluate(before, unmarked.context)!.expectedTsd;
    };
    const lifts = defs.map(lift);
    expect(Math.min(...lifts)).toBeGreaterThan(0);
    expect(Math.max(...lifts)).toBeCloseTo(Math.min(...lifts), 10);
  });

  test('among marked characters, the expensive one goes first', () => {
    // The starting company is a knapsack against GENERAL_INFLUENCE, so the big
    // characters are the ones that stop fitting. Humans play it that way: the
    // mean mind of the character taken falls monotonically by draft round.
    const unmarked = draftMarking([]);
    const defs = [...new Set(unmarked.picks.map(unmarked.definitionOf))];
    const cardPool = loadCardPool();
    const minds = defs.map(d => printedMind(cardPool[d]));
    const dearest = defs[minds.indexOf(Math.max(...minds))];
    const cheapest = defs[minds.indexOf(Math.min(...minds))];
    expect(printedMind(cardPool[dearest])).toBeGreaterThan(printedMind(cardPool[cheapest]));

    const { picks, context, definitionOf } = draftMarking([dearest, cheapest]);
    const worth = (definitionId: string): number => fetchingModule.evaluate(
      picks.find(a => definitionOf(a) === definitionId)!, context,
    )!.expectedTsd;
    expect(worth(dearest)).toBeGreaterThan(worth(cheapest));
  });

  test('but the cheapest marked character still beats the dearest unmarked one', () => {
    // The ordering term is capped below the mark, so it can never reorder
    // across it — otherwise a big character the deck does not want would
    // outrank a small one it does.
    const unmarked = draftMarking([]);
    const defs = [...new Set(unmarked.picks.map(unmarked.definitionOf))];
    const cardPool = loadCardPool();
    const minds = defs.map(d => printedMind(cardPool[d]));
    const cheapest = defs[minds.indexOf(Math.min(...minds))];

    const { picks, context, definitionOf } = draftMarking([cheapest]);
    const scored = picks.map(a => ({
      marked: definitionOf(a) === cheapest,
      tsd: fetchingModule.evaluate(a, context)!.expectedTsd,
    }));
    expect(Math.min(...scored.filter(s => s.marked).map(s => s.tsd)))
      .toBeGreaterThan(Math.max(...scored.filter(s => !s.marked).map(s => s.tsd)));
  });

  test('a mark on the other seat\'s pool moves nothing here', () => {
    // The projection strips the opponent's favourites along with their pool, so
    // this cannot happen in a real view — but reading the wrong seat's marks is
    // the failure this shape of lookup invites.
    const { picks, context, definitionOf } = draftMarking([]);
    const setup = (context.view.phaseState as unknown as {
      setupStep: { draftState: { pool?: { instanceId: string }[] }[] };
    }).setupStep;
    const named = String((picks[0] as unknown as { characterInstanceId: string }).characterInstanceId);
    const theirs = setup.draftState.findIndex(d => !d.pool?.some(c => c.instanceId === named));
    const draftState = setup.draftState.map((d, i) =>
      (i === theirs ? { ...d, favourites: [definitionOf(picks[0])] } : d));
    const view = {
      ...context.view,
      phaseState: { ...context.view.phaseState, setupStep: { ...setup, draftState } },
    };

    expect(fetchingModule.evaluate(picks[0], { ...context, view } as ModuleContext)!.expectedTsd)
      .toBe(fetchingModule.evaluate(picks[0], context)!.expectedTsd);
  });
});

describe('why the opening draft cannot be priced in marshalling points', () => {
  test('a score made of one source is worth nothing, and two sources are worth plenty', () => {
    // Not a limitation of this module: the tournament scorer caps every source
    // at half the player's total, so points in a single source cancel
    // themselves. At the draft nobody has scored anything yet, so every
    // candidate's *marshalling-point* half is worth exactly zero — which is why
    // the draft has to be decided by the deck's plan and the mind budget
    // instead, and why pricing characters better could never have helped.
    const zero: MarshallingPointTotals = {
      character: 0, item: 0, faction: 0, ally: 0, kill: 0, misc: 0,
    };
    expect(computeTournamentScore({ ...zero, character: 3 }, zero)).toBe(0);
    expect(computeTournamentScore({ ...zero, item: 2 }, zero)).toBe(0);
    expect(computeTournamentScore({ ...zero, character: 3, item: 2 }, zero)).toBeGreaterThan(0);
  });

  test('so what separates two unmarked candidates is the mind budget, and nothing else', () => {
    // Equal mind, equal score — however differently the two characters are
    // printed. The marshalling-point term contributes nothing to either.
    const { context, legalActions } = position(DRAFT);
    const cardPool = loadCardPool();
    const setup = (context.view.phaseState as unknown as {
      setupStep: { draftState: { pool?: { instanceId: string; definitionId: string }[] }[] };
    }).setupStep;
    const pool = setup.draftState.flatMap(d => d.pool ?? []);
    const byMind = new Map<number, number[]>();
    for (const action of legalActions.filter(a => a.type === 'draft-pick')) {
      const id = String((action as unknown as { characterInstanceId: string }).characterInstanceId);
      const mind = printedMind(cardPool[pool.find(c => c.instanceId === id)!.definitionId]);
      const scored = fetchingModule.evaluate(action, context)!.expectedTsd;
      byMind.set(mind, [...(byMind.get(mind) ?? []), scored]);
    }
    expect(byMind.size).toBeGreaterThan(1);
    for (const scores of byMind.values()) {
      expect(Math.max(...scores)).toBe(Math.min(...scores));
    }
  });
});

describe('swapping a card between the discard pile and the sideboard', () => {
  /** The exchange candidates of the captured position, with their scores. */
  function exchanges() {
    const { context, legalActions } = position(EXCHANGE);
    const actions = legalActions.filter(a => a.type === 'exchange-sideboard');
    return {
      context,
      actions,
      scored: actions.map(action => ({
        action: action as unknown as {
          discardCardInstanceId: string;
          sideboardCardInstanceId: string;
        },
        tsd: fetchingModule.evaluate(action, context)!.expectedTsd,
      })),
    };
  }

  test('the engine offers every pair, and every one of them is scored', () => {
    // One decision, a thousand candidates: the engine emits the full cross
    // product of discard pile and sideboard. It was the largest action type
    // with no owner at all, and a module that declined a single pair would
    // leave the whole decision partly covered.
    const { context, actions } = exchanges();
    expect(actions.length).toBeGreaterThan(100);
    for (const action of actions) {
      expect(fetchingModule.evaluate(action, context)).not.toBeNull();
    }
  });

  test('a swap is a difference, so it can be worth less than doing nothing', () => {
    // The failure this pins: priced as a gain rather than a difference, every
    // candidate would score at or above zero and the module would trade away
    // whatever the deck's best remaining card happened to be.
    const { scored } = exchanges();
    expect(Math.min(...scored.map(s => s.tsd))).toBeLessThan(0);
    expect(Math.max(...scored.map(s => s.tsd))).toBeGreaterThan(0);
  });

  test('the card leaving counts against the swap as much as the one arriving', () => {
    // The two legs enter with opposite signs, so with the incoming card held
    // fixed the ranking over the outgoing ones is the *reverse* of the price
    // ranking: the better the card being sent to the sideboard, the worse the
    // swap. Priced as a gain, this correlation would be flat.
    const { context, scored } = exchanges();
    const incoming = scored[0].action.sideboardCardInstanceId;
    const sameIncoming = scored.filter(s => s.action.sideboardCardInstanceId === incoming);
    const prices = computeCardPrices(
      context.view, context.cardPool, context.standing, context.tunables,
    );
    const outgoingWorth = (instanceId: string) => prices.quote(
      context.view.self.discardPile.find(c => c.instanceId === instanceId)!.definitionId,
    ).tsd;

    const dearest = sameIncoming.reduce((a, b) =>
      (outgoingWorth(b.action.discardCardInstanceId) > outgoingWorth(a.action.discardCardInstanceId) ? b : a));
    const cheapest = sameIncoming.reduce((a, b) =>
      (outgoingWorth(b.action.discardCardInstanceId) < outgoingWorth(a.action.discardCardInstanceId) ? b : a));
    expect(outgoingWorth(dearest.action.discardCardInstanceId))
      .toBeGreaterThan(outgoingWorth(cheapest.action.discardCardInstanceId));
    expect(dearest.tsd).toBeLessThan(cheapest.tsd);
  });

  test('the rationale names both cards, not only the one arriving', () => {
    const { context, scored } = exchanges();
    const best = scored.reduce((a, b) => (b.tsd > a.tsd ? b : a));
    const evaluation = fetchingModule.evaluate({
      type: 'exchange-sideboard',
      player: context.view.self.id,
      discardCardInstanceId: best.action.discardCardInstanceId,
      sideboardCardInstanceId: best.action.sideboardCardInstanceId,
    } as never, context)!;
    const detail = evaluation.rationale.children![0].children!;
    expect(detail.map(child => child.label)).toEqual([
      'into the new deck', 'out to the sideboard',
    ]);
    expect(evaluation.outcomes[0].label).not.toMatch(/p\d+-\d+/);
  });

  test('declines a swap whose cards are not where the action says they are', () => {
    const { context } = exchanges();
    expect(fetchingModule.evaluate({
      type: 'exchange-sideboard',
      player: context.view.self.id,
      discardCardInstanceId: 'nowhere',
      sideboardCardInstanceId: 'nowhere-either',
    } as never, context)).toBeNull();
  });
});

describe('the character deck draft, where declining destroys the card', () => {
  // `handleCharacterDeckDraftPass`: "passes — n undrafted pool character(s)
  // removed from the game". Every other acquisition in this module can be
  // declined and revisited; this one cannot, and the module has to say so.
  const DECK_DRAFT = 'setup/character-deck-draft';

  test('every candidate quoted exactly zero before the floor reached them', () => {
    // Two independent reasons, both of them true and neither of them "this
    // character is worthless": a mind that cannot fit the free general
    // influence of a player who has just spent all 20 of it, and a character
    // marshalling point worth 0.0 at 0–0 under the diversity cap.
    const { context, legalActions } = position(DECK_DRAFT);
    const prices = computeCardPrices(
      context.view, context.cardPool, context.standing, context.tunables);
    const adds = legalActions.filter(a => a.type === 'add-character-to-deck');
    expect(adds.length).toBeGreaterThan(1);
    const pool = (context.view.phaseState as unknown as {
      setupStep?: { deckDraftState?: readonly { remainingPool?: readonly { definitionId: string }[] }[] };
    }).setupStep?.deckDraftState?.[0]?.remainingPool ?? [];
    expect(pool.length).toBe(adds.length);
    for (const card of pool) expect(prices.quote(card.definitionId).tsd).toBe(0);
  });

  test('taking a character is worth strictly more than doing nothing', () => {
    // Which is the whole decision: at a flat zero the agent's tie clause
    // passes, and passing here is not "decline to act" — it is "remove the
    // rest of the pool from the game".
    const { context, legalActions } = position(DECK_DRAFT);
    for (const action of legalActions.filter(a => a.type === 'add-character-to-deck')) {
      const evaluation = fetchingModule.evaluate(action, context)!;
      expect(evaluation).not.toBeNull();
      expect(evaluation.expectedTsd).toBeGreaterThan(0);
    }
  });

  test('the price it uses is the floor, and it says which one and why', () => {
    const { context, legalActions } = position(DECK_DRAFT);
    const prices = computeCardPrices(
      context.view, context.cardPool, context.standing, context.tunables);
    const evaluation = fetchingModule.evaluate(
      legalActions.find(a => a.type === 'add-character-to-deck')!, context)!;
    expect(evaluation.expectedTsd).toBeCloseTo(prices.floor, 9);
    expect(JSON.stringify(evaluation.rationale)).toMatch(/removes it from the game/);
  });

  test('it reaches no other acquisition: a draft pick keeps its own price', () => {
    // The opening draft's leftovers become this pool, so nothing is destroyed
    // there and the floor has no business in it — the favourite mark is what
    // separates those candidates, and it still is.
    const { context, legalActions } = position(DRAFT);
    const prices = computeCardPrices(
      context.view, context.cardPool, context.standing, context.tunables);
    for (const action of legalActions.filter(a => a.type === 'draft-pick')) {
      const evaluation = fetchingModule.evaluate(action, context)!;
      const named = (action as unknown as { characterInstanceId?: string }).characterInstanceId;
      const pool = (context.view.phaseState as unknown as {
        setupStep?: { draftState?: readonly { pool?: readonly { instanceId: string; definitionId: string }[] }[] };
      }).setupStep?.draftState?.flatMap(r => r.pool ?? []) ?? [];
      const card = pool.find(c => c.instanceId === named);
      if (!card) continue;
      const quote = prices.quote(card.definitionId).tsd;
      // Whatever the mark and the mind priority add, none of it is the floor.
      expect(evaluation.expectedTsd).toBeGreaterThanOrEqual(quote);
      if (evaluation.expectedTsd === quote) expect(quote).toBeLessThan(prices.floor);
    }
  });
});
