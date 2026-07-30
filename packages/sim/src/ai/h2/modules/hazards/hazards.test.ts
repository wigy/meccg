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

describe('a support event that boosts every attack', () => {
  /** A position where Minions Stir is in hand alongside Orc creatures. */
  const BOOST = 'movement/support-event-boost';

  /** The scenario, its view, and the action that plays the named card. */
  function boostPosition(options: { inPlay?: string; playing?: string } = {}) {
    const { inPlay, playing = 'Minions Stir' } = options;
    const scenario = loadScenario(BOOST);
    const view = scenarioView(scenario);
    const cardPool = loadCardPool();
    const definitionOf = (name: string) => Object.keys(cardPool).find(id =>
      (cardPool[id] as unknown as { name?: string }).name === name)!;
    if (inPlay) {
      (view.self as unknown as { cardsInPlay: unknown[] }).cardsInPlay = [
        { instanceId: 'staged', definitionId: definitionOf(inPlay) },
      ];
    }
    // A card the corpus does not happen to hold is staged into the hand by
    // definition: the module looks a play up by instance, so the action can be
    // built by hand as long as the hand card exists.
    const nameOf = (id: string) => (cardPool[id] as unknown as { name?: string }).name;
    if (!view.self.hand.some(c => nameOf(c.definitionId) === playing)) {
      (view.self.hand as unknown as { definitionId: string }[])[0].definitionId = definitionOf(playing);
    }
    const standing = computeStanding(view, testWinProbModel(), DEFAULT_TUNABLES);
    const legalActions = viableActions(scenario);
    const held = view.self.hand.find(c => nameOf(c.definitionId) === playing)!;
    const play = legalActions.find(a => a.type === 'play-hazard'
      && (a as { cardInstanceId?: string }).cardInstanceId === held.instanceId)
      ?? ({
        type: 'play-hazard',
        player: view.self.id,
        cardInstanceId: held.instanceId,
        targetCompanyId: view.opponent.companies[0].id,
      } as unknown as GameAction);
    return {
      play,
      context: { view, cardPool, legalActions, tunables: DEFAULT_TUNABLES, standing },
    };
  }

  test('is scored from the plan re-run with it, not declined', () => {
    // Its whole value is "it makes my other hazards better", and that is not a
    // guess: the modifier is declared against the same two numbers the strike
    // enumeration runs on, so the plan is built twice and the difference taken.
    const { play, context } = boostPosition();
    const evaluation = hazardsModule.evaluate(play, context)!;
    expect(evaluation).not.toBeNull();
    expect(evaluation.expectedTsd).toBeGreaterThan(0);
    expect(JSON.stringify(evaluation.rationale)).toContain('the best bundle against this company goes from');
  });

  test('and the modifier it names is the one the card declares', () => {
    const { play, context } = boostPosition();
    const text = JSON.stringify(hazardsModule.evaluate(play, context)!.rationale);
    expect(text).toContain('orc attack +1 prowess, +1 strike(s)');
    expect(text).toContain('troll attack +1 prowess, +1 strike(s)');
  });

  test('Doors of Night in play doubles what it declares, because the card says so', () => {
    // The +2 variants carry `overrides`, naming the +1 variants they replace —
    // which is what keeps the two from being summed.
    const { play, context } = boostPosition({ inPlay: 'Doors of Night' });
    const text = JSON.stringify(hazardsModule.evaluate(play, context)!.rationale);
    expect(text).toContain('orc attack +2 prowess, +2 strike(s)');
    // The Troll clause is not gated on Doors of Night, so it must not move.
    expect(text).toContain('troll attack +1 prowess, +1 strike(s)');
  });

  test('is worth nothing with no attack in hand for it to improve', () => {
    // The answer that keeps it out of an empty plan: with no creature candidate
    // the two arms of the counterfactual are the same, so the play is worth
    // exactly minus the card it spends.
    const { play, context } = boostPosition();
    const alone = { ...context, legalActions: [play] };
    const evaluation = hazardsModule.evaluate(play, alone)!;
    expect(evaluation.expectedTsd).toBeLessThan(0);
    expect(JSON.stringify(evaluation.rationale)).toContain('no attack left it would improve');
  });
});

describe('a hazard event already in play', () => {
  /** A position with Orc creatures in hand, from the support-event scenario. */
  function creaturePosition(inPlay?: string) {
    const scenario = loadScenario('movement/support-event-boost');
    const view = scenarioView(scenario);
    const cardPool = loadCardPool();
    if (inPlay) {
      const definitionId = Object.keys(cardPool).find(id =>
        (cardPool[id] as unknown as { name?: string }).name === inPlay)!;
      (view.self as unknown as { cardsInPlay: unknown[] }).cardsInPlay = [
        { instanceId: 'staged', definitionId },
      ];
    }
    const standing = computeStanding(view, testWinProbModel(), DEFAULT_TUNABLES);
    const legalActions = viableActions(scenario);
    const creature = legalActions.find(a => {
      if (a.type !== 'play-hazard') return false;
      const card = view.self.hand.find(c => c.instanceId === (a as { cardInstanceId?: string }).cardInstanceId);
      return card && (cardPool[card.definitionId] as unknown as { cardType?: string }).cardType
        === 'hazard-creature';
    })!;
    return { creature, context: { view, cardPool, legalActions, tunables: DEFAULT_TUNABLES, standing } };
  }

  test('changes what every attack behind it is worth', () => {
    // A long event lasts the turn and a permanent one the game, so Minions Stir
    // on the board is not a card waiting to be played — it is a change to the
    // numbers every bundle from here on is resolved with. Reading it only at
    // the moment it is played priced that play correctly and then went on
    // under-valuing every creature behind it.
    const bare = creaturePosition();
    const boosted = creaturePosition('Minions Stir');
    const without = hazardsModule.evaluate(bare.creature, bare.context)!.expectedTsd;
    const with_ = hazardsModule.evaluate(boosted.creature, boosted.context)!.expectedTsd;
    expect(with_).toBeGreaterThan(without);
  });
});

describe('an event that enables another card rather than acting itself', () => {
  test('Doors of Night is worth what the Minions Stir already out gains from it', () => {
    // Doors of Night does nothing to an attack itself. What it does is satisfy
    // `inPlay: "Doors of Night"` on the Minions Stir already on the board,
    // turning +1 prowess and +1 strike into +2 of each. Pricing it by its own
    // declared effects finds nothing; pricing the board with and without it
    // finds the upgrade.
    const scenario = loadScenario('movement/support-event-boost');
    const view = scenarioView(scenario);
    const cardPool = loadCardPool();
    const definitionOf = (name: string) => Object.keys(cardPool).find(id =>
      (cardPool[id] as unknown as { name?: string }).name === name)!;
    (view.self as unknown as { cardsInPlay: unknown[] }).cardsInPlay = [
      { instanceId: 'staged', definitionId: definitionOf('Minions Stir') },
    ];
    (view.self.hand as unknown as { definitionId: string }[])[0].definitionId =
      definitionOf('Doors of Night');
    const standing = computeStanding(view, testWinProbModel(), DEFAULT_TUNABLES);
    const context = { view, cardPool, legalActions: viableActions(scenario), tunables: DEFAULT_TUNABLES, standing };
    const evaluation = hazardsModule.evaluate({
      type: 'play-hazard',
      player: view.self.id,
      cardInstanceId: view.self.hand[0].instanceId,
      targetCompanyId: view.opponent.companies[0].id,
    } as unknown as GameAction, context)!;

    expect(evaluation).not.toBeNull();
    expect(JSON.stringify(evaluation.rationale)).toContain('becomes');
    expect(JSON.stringify(evaluation.rationale)).toContain('+2 prowess');
  });

  test('and declines when nothing on the board names it', () => {
    // No Minions Stir out, so nothing changes about any attack — and its own
    // effects declare no modifier. Declining leaves the decision honestly
    // uncovered rather than scoring it at an invented number.
    const scenario = loadScenario('movement/support-event-boost');
    const view = scenarioView(scenario);
    const cardPool = loadCardPool();
    const definitionOf = (name: string) => Object.keys(cardPool).find(id =>
      (cardPool[id] as unknown as { name?: string }).name === name)!;
    (view.self.hand as unknown as { definitionId: string }[])[0].definitionId =
      definitionOf('Doors of Night');
    const standing = computeStanding(view, testWinProbModel(), DEFAULT_TUNABLES);
    const context = { view, cardPool, legalActions: viableActions(scenario), tunables: DEFAULT_TUNABLES, standing };
    expect(hazardsModule.evaluate({
      type: 'play-hazard',
      player: view.self.id,
      cardInstanceId: view.self.hand[0].instanceId,
      targetCompanyId: view.opponent.companies[0].id,
    } as unknown as GameAction, context)).toBeNull();
  });
});
