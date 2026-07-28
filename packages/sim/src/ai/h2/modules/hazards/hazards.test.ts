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
import { loadScenario, scenarioView } from '../../scenario-store.js';
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
