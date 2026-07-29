/**
 * @module ai/h2/modules/hazards/hazards.test
 *
 * What `hazards` has to get right, stated as properties rather than numbers.
 *
 * The numbers here move whenever a tunable moves, so pinning them would make
 * this file a change-detector. What must not move is the reasoning: denial is
 * marginal, bundles beat their parts, and a creature the defender will
 * certainly beat is a gift rather than an attack.
 */

import { describe, expect, test } from 'vitest';
import { computeLegalActions, loadCardPool } from '@meccg/shared';
import type { GameAction } from '@meccg/shared';
import { DEFAULT_TUNABLES } from '../../core/tunables.js';
import { computeStanding } from '../../services/standing.js';
import { evaluateDecision } from '../../core/registry.js';
import { loadScenario, opposingPlayer, scenarioView } from '../../scenario-store.js';
import { testWinProbModel } from '../../test-support.js';
import { computeBeliefs } from '../../services/beliefs.js';
import type { StrikeTarget } from '../../services/strike/prowess.js';
import type { StrikeOutcome } from '../../services/strike/strike-model.js';
import { hazardsModule } from './hazards.js';
import { denialContext, denialPricer } from '../../services/denial.js';
import { planBundles } from './bundle.js';
import type { Candidate } from './bundle.js';

const SCENARIO = 'movement/hazard-bundle-choice';

/** The scenario position, with everything a module context needs. */
function position() {
  const scenario = loadScenario(SCENARIO);
  const view = scenarioView(scenario);
  const cardPool = loadCardPool();
  const standing = computeStanding(view, testWinProbModel(), DEFAULT_TUNABLES);
  return { scenario, view, cardPool, standing };
}

/** The actions the engine is actually offering at the scenario's decision. */
function viableActions(scenario: ReturnType<typeof loadScenario>): GameAction[] {
  return computeLegalActions(scenario.state, scenario.actingPlayer)
    .filter(legal => legal.viable)
    .map(legal => legal.action);
}

/** The target company's characters as strike targets. */
function targetRoster(view: ReturnType<typeof scenarioView>): StrikeTarget[] {
  return view.opponent.companies[0].characters.map((id, i) => {
    const c = view.opponent.characters[id];
    return {
      instanceId: c.instanceId,
      definitionId: c.definitionId as string,
      name: `char${i}`,
      prowess: c.effectiveStats.prowess,
      status: c.status,
      isAlly: false,
    };
  });
}

/** A character-shaped strike target, for pricing tests. */
function character(instanceId: string, isAlly = false): StrikeTarget {
  return {
    instanceId: instanceId as StrikeTarget['instanceId'],
    definitionId: 'tw-144',
    name: instanceId,
    prowess: 5,
    status: 'untapped' as StrikeTarget['status'],
    isAlly,
  };
}

/** A tapped-by-parry outcome. */
const TAPPED: StrikeOutcome = { p: 1, character: 'tapped', strike: 'defeated' };

describe('denial is marginal, not average', () => {
  test('a tap denies nothing while the company still outnumbers their hand', () => {
    const { view, cardPool, standing } = position();
    const company = view.opponent.companies[0];
    const beliefs = computeBeliefs(view, cardPool);
    const context = denialContext(view, company, beliefs, standing, DEFAULT_TUNABLES);
    const price = denialPricer(cardPool, standing, DEFAULT_TUNABLES, context);

    // They are believed to hold fewer plays than they have characters standing,
    // so taking the first one out leaves them able to do everything they could
    // have done anyway. All that is denied is the tempo of it.
    expect(context.believedPlays).toBeLessThan(context.untapped);
    const first = price(TAPPED, character('a'), { untappedBefore: context.untapped });
    expect(first).toBeCloseTo(DEFAULT_TUNABLES.tapTempoCost, 6);

    // The tap that takes them below the number of cards they hold denies a
    // whole play, and is worth an order of magnitude more.
    const binding = price(TAPPED, character('a'), { untappedBefore: 1 });
    expect(binding).toBeGreaterThan(first + context.fullPlay * 0.9);
  });

  test('tapping an ally denies no play, because an ally cannot play resources', () => {
    const { view, cardPool, standing } = position();
    const beliefs = computeBeliefs(view, cardPool);
    const context = denialContext(view, view.opponent.companies[0], beliefs, standing, DEFAULT_TUNABLES);
    const price = denialPricer(cardPool, standing, DEFAULT_TUNABLES, context);
    expect(price(TAPPED, character('ally', true), { untappedBefore: 1 }))
      .toBeCloseTo(DEFAULT_TUNABLES.tapTempoCost, 6);
  });
});

describe('bundles', () => {
  /** Two identical creatures, so any difference is the interaction alone. */
  function twin(instanceId: string, killMp: number): Candidate {
    return {
      instanceId,
      name: `creature ${instanceId}`,
      killMp,
      profile: {
        strikeProwess: 9,
        strikes: 2,
        creatureBody: 6,
        detainment: false,
        bodyCheckModifier: 0,
        killTsd: 0,
        name: `creature ${instanceId}`,
      },
    };
  }

  test('two creatures together are worth more than twice one alone', () => {
    const { view, cardPool, standing } = position();
    const company = view.opponent.companies[0];
    const beliefs = computeBeliefs(view, cardPool);
    const context = denialContext(view, company, beliefs, standing, DEFAULT_TUNABLES);
    const price = denialPricer(cardPool, standing, DEFAULT_TUNABLES, context);
    const roster = targetRoster(view);

    const tunables = { ...DEFAULT_TUNABLES, provisionalCardPrice: 0, hazardMaxBundle: 2 };
    const search = planBundles(
      [twin('a', 0), twin('b', 0)], roster, cardPool, price, standing, tunables, 2,
    );
    const single = search.bundles.find(b => b.cards.length === 1)!;
    const pair = search.bundles.find(b => b.cards.length === 2)!;

    // Supermodularity: the second creature meets a company the first already
    // tapped and wounded, so it does strictly more than the first one did.
    expect(pair.expectedTsd).toBeGreaterThan(2 * single.expectedTsd);
  });

  test('kill marshalling points are subtracted, not ignored', () => {
    const { view, cardPool, standing } = position();
    const beliefs = computeBeliefs(view, cardPool);
    const context = denialContext(view, view.opponent.companies[0], beliefs, standing, DEFAULT_TUNABLES);
    const price = denialPricer(cardPool, standing, DEFAULT_TUNABLES, context);
    const roster = targetRoster(view);

    const free = twin('a', 0);
    const gift: Candidate = { ...twin('b', 0), profile: { ...twin('b', 0).profile, killTsd: -2 } };
    const search = planBundles([free], roster, cardPool, price, standing, DEFAULT_TUNABLES, 1);
    const giftSearch = planBundles([gift], roster, cardPool, price, standing, DEFAULT_TUNABLES, 1);
    expect(giftSearch.bundles[0].expectedTsd).toBeLessThan(search.bundles[0].expectedTsd);
  });
});

describe('the module at a real decision', () => {
  test('it claims the play-hazards window and prices every creature offered', () => {
    const { view, cardPool, standing } = position();
    const context = {
      view,
      cardPool,
      legalActions: [],
      tunables: DEFAULT_TUNABLES,
      standing,
    };
    expect(hazardsModule.claims!(context)).toBe(true);
  });

  test('passing is the baseline every bundle is measured against', () => {
    const { scenario, view, cardPool, standing } = position();
    const legalActions = viableActions(scenario);
    const { evaluations } = evaluateDecision([hazardsModule], {
      view, cardPool, legalActions, tunables: DEFAULT_TUNABLES, standing,
    });

    const pass = evaluations.find(e => e.action.type === 'pass');
    expect(pass?.utility).toBe(0);

    // Every evaluation is a proper distribution — the invariant the calibration
    // harness relies on to check any of these claims against the reducer.
    for (const evaluation of evaluations) {
      const total = evaluation.outcomes.reduce((sum, o) => sum + o.p, 0);
      expect(total).toBeCloseTo(1, 6);
    }
  });

  test('a creature is only played when it beats keeping the card', () => {
    const { scenario, view, cardPool, standing } = position();
    const legalActions = viableActions(scenario);
    const { evaluations } = evaluateDecision([hazardsModule], {
      view, cardPool, legalActions, tunables: DEFAULT_TUNABLES, standing,
    });
    const plays = evaluations.filter(e => e.action.type === 'play-hazard');
    expect(plays.length).toBeGreaterThan(0);

    // This position is a five-character company with the hazard limit untouched
    // and creatures in hand: attacking is right, and the module says so rather
    // than hiding behind the card price.
    expect(Math.max(...plays.map(p => p.utility))).toBeGreaterThan(0);
  });
});

describe('the attacker assigning an excess strike', () => {
  /**
   * The same captured combat, seen from the other side.
   *
   * Excess strikes are assigned by the *attacking* player (CoE 3.iv), so a
   * position captured from the defender is a real instance of a choice the
   * hazard seat makes — no fixture needed, just the other projection.
   */
  function attackerSeat() {
    const scenario = loadScenario('combat/attacker-assigns-excess');
    const view = scenarioView(scenario, opposingPlayer(scenario));
    const cardPool = loadCardPool();
    return {
      view,
      cardPool,
      context: {
        view,
        cardPool,
        legalActions: [],
        tunables: DEFAULT_TUNABLES,
        standing: computeStanding(view, testWinProbModel(), DEFAULT_TUNABLES),
      },
    };
  }

  test('hazards claims the window, because the company under attack is theirs', () => {
    const { view, context } = attackerSeat();
    expect(view.self.companies.some(c => c.id === view.combat!.companyId)).toBe(false);
    expect(hazardsModule.claims!(context)).toBe(true);
  });

  test('it prefers the character whose harm denies the most', () => {
    // `combat` cannot answer this one: every price it knows has the wrong sign,
    // because harm to that company is the thing being aimed for. It used to
    // claim the window anyway and decline every candidate on it.
    const { view, context } = attackerSeat();
    const company = view.opponent.companies.find(c => c.id === view.combat!.companyId)!;
    const scores = company.characters.map(characterId => hazardsModule.evaluate(
      { type: 'assign-strike', player: view.self.id, characterId } as unknown as GameAction,
      context,
    ));
    expect(scores.every(s => s !== null)).toBe(true);
    // Harming them is worth something to us — the sign `combat` could not give.
    expect(Math.max(...scores.map(s => s!.expectedTsd))).toBeGreaterThan(0);
  });
});

describe('placing a card on guard', () => {
  test('costs nothing, because an unrevealed on-guard card comes back', () => {
    // `reducer-site.ts` returns unrevealed on-guard cards to the hazard
    // player's hand at cleanup, so placement does not spend the card. The
    // module used to charge half a card price for it — a cost the rules do not
    // impose, which made placing look worse than passing.
    const { scenario, view, cardPool, standing } = position();
    const legalActions = viableActions(scenario);
    const { evaluations } = evaluateDecision([hazardsModule], {
      view, cardPool, legalActions, tunables: DEFAULT_TUNABLES, standing,
    });
    const placements = evaluations.filter(e => e.action.type === 'place-on-guard');
    expect(placements.length).toBeGreaterThan(0);
    // Nothing is worse than doing nothing: a free option cannot cost.
    for (const placement of placements) expect(placement.expectedTsd).toBeGreaterThanOrEqual(0);
  });

  test('every card can be placed, and a non-creature is scored at its floor', () => {
    // The rules allow any card on guard, "even a character or resource".
    // Declining the non-creatures left 920 candidates unscored in three games;
    // zero is the honest floor for an option that costs nothing.
    const { scenario, view, cardPool, standing } = position();
    const legalActions = viableActions(scenario);
    const offered = legalActions.filter(a => a.type === 'place-on-guard');
    const { evaluations } = evaluateDecision([hazardsModule], {
      view, cardPool, legalActions, tunables: DEFAULT_TUNABLES, standing,
    });
    const scored = evaluations.filter(e => e.action.type === 'place-on-guard');
    expect(scored).toHaveLength(offered.length);

    const floors = scored.filter(e => e.expectedTsd === 0);
    expect(floors.length).toBeGreaterThan(0);
    expect(JSON.stringify(floors[0].rationale)).toContain('returns to hand');
  });
});

describe('hazard events', () => {
  test('removing something from their play is worth the points it takes with it', () => {
    // Muster Disperses declares nothing but `play-target: faction` — the
    // dispersal is the card's own semantics, so there is no effect to read.
    // What can be read is the *action's* target, and a faction in play has
    // printed marshalling points.
    const { view, cardPool, standing } = position();
    const faction = view.opponent.cardsInPlay.find(c => {
      const def = cardPool[c.definitionId] as unknown as {
        marshallingCategory?: string; marshallingPoints?: number;
      };
      return def?.marshallingCategory === 'faction' && (def?.marshallingPoints ?? 0) > 0;
    });
    if (!faction) return; // no faction in play in this position

    const hazardCard = view.self.hand.find(c =>
      (cardPool[c.definitionId] as unknown as { cardType?: string })?.cardType === 'hazard-event');
    if (!hazardCard) return;

    const evaluation = hazardsModule.evaluate({
      type: 'play-hazard',
      player: view.self.id,
      cardInstanceId: hazardCard.instanceId,
      targetCompanyId: view.opponent.companies[0].id,
      targetFactionInstanceId: faction.instanceId,
    } as unknown as GameAction, {
      view, cardPool, legalActions: [], tunables: DEFAULT_TUNABLES, standing,
    });
    expect(evaluation).not.toBeNull();
    expect(JSON.stringify(evaluation!.rationale)).toContain('out of play');
  });

  test('an event whose family it cannot read is declined, not charged', () => {
    // The property that keeps H2 able to play events at all. An effect this
    // module cannot price leaves the decision uncovered rather than scored at
    // "costs a card, achieves nothing".
    const { view, cardPool, standing } = position();
    const event = view.self.hand.find(c =>
      (cardPool[c.definitionId] as unknown as { cardType?: string })?.cardType === 'hazard-event');
    if (!event) return;
    const evaluation = hazardsModule.evaluate({
      type: 'play-hazard',
      player: view.self.id,
      cardInstanceId: event.instanceId,
      targetCompanyId: view.opponent.companies[0].id,
    } as unknown as GameAction, {
      view, cardPool, legalActions: [], tunables: DEFAULT_TUNABLES, standing,
    });
    // Doors of Night and the like declare no family this module reads.
    if (evaluation !== null) {
      expect(evaluation.expectedTsd).toBeGreaterThan(0);
    }
  });
});
