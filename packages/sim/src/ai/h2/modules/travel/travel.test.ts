/**
 * @module ai/h2/modules/travel/travel.test
 *
 * `travel` had no test file until it owned four action types, which is longer
 * than it should have gone. These pin the properties that make its four answers
 * one model rather than four: cancelling costs exactly what travelling was
 * worth, a longer path costs more than a shorter one, and staying put is the
 * zero everything else is measured against.
 */

import { describe, expect, test } from 'vitest';
import { computeLegalActions, loadCardPool } from '@meccg/shared';
import type { GameAction } from '@meccg/shared';
import { DEFAULT_TUNABLES } from '../../core/tunables.js';
import type { ModuleContext } from '../../core/types.js';
import { computeStanding } from '../../services/standing.js';
import { loadScenario, scenarioView } from '../../scenario-store.js';
import { testWinProbModel } from '../../test-support.js';
import { travelModule } from './travel.js';

/** An organization phase with companies, destinations and cards to play. */
const SCENARIO = 'organization/turn14-company-planning';

/** An organization phase where a company has already declared a destination. */
const REPLAN = 'organization/replanned-movement';

/** A site phase where a company must decide whether to enter its site. */
const ENTER = 'site/enter-or-pass';

/** The scenario as a module context. */
function position(id: string = SCENARIO): { context: ModuleContext; actions: GameAction[] } {
  const scenario = loadScenario(id);
  const view = scenarioView(scenario);
  const cardPool = loadCardPool();
  const actions = computeLegalActions(scenario.state, scenario.actingPlayer)
    .filter(legal => legal.viable)
    .map(legal => legal.action);
  return {
    actions,
    context: {
      view,
      cardPool,
      legalActions: actions,
      tunables: DEFAULT_TUNABLES,
      standing: computeStanding(view, testWinProbModel(), DEFAULT_TUNABLES),
    },
  };
}

describe('where a company should go', () => {
  test('it claims the movement window and scores the destinations offered', () => {
    const { context, actions } = position();
    expect(travelModule.claims!(context)).toBe(true);
    const plans = actions.filter(a => a.type === 'plan-movement');
    expect(plans.length).toBeGreaterThan(0);
    for (const plan of plans) expect(travelModule.evaluate(plan, context)).not.toBeNull();
  });

  test('staying put is the zero every destination is measured against', () => {
    const { context } = position();
    const pass = travelModule.evaluate({ type: 'pass' } as unknown as GameAction, context)!;
    expect(pass.expectedTsd).toBe(0);
  });

  test('destinations differ — a module that ranked them all alike would hand over', () => {
    const { context, actions } = position();
    const scores = actions
      .filter(a => a.type === 'plan-movement')
      .map(a => travelModule.evaluate(a, context)!.expectedTsd);
    expect(Math.max(...scores)).toBeGreaterThan(Math.min(...scores));
  });
});

describe('cancelling a move', () => {
  test('costs exactly what travelling there was worth', () => {
    // The property that keeps the two answers one model. If cancelling had its
    // own notion of staying put, the pair would eventually disagree about the
    // same choice — and nothing in the output would say which was wrong.
    const { context, actions } = position(REPLAN);
    const cancel = actions.find(a => a.type === 'cancel-movement');
    expect(cancel).toBeDefined();

    const companyId = (cancel as unknown as { companyId: string }).companyId;
    const company = context.view.self.companies.find(c => (c.id as string) === companyId)!;
    const planned = company.destinationSite!;
    const plan = {
      type: 'plan-movement', companyId, destinationSite: planned.instanceId,
    } as unknown as GameAction;

    const cancelled = travelModule.evaluate(cancel!, context)!;
    const travelled = travelModule.evaluate(plan, context)!;
    expect(cancelled.expectedTsd).toBeCloseTo(-travelled.expectedTsd, 9);
    expect(cancelled.expectedTsd).not.toBe(0);
  });

  test('declines a company with nothing planned', () => {
    const { context } = position(REPLAN);
    const company = context.view.self.companies.find(c => !c.destinationSite);
    if (!company) return;
    const action = { type: 'cancel-movement', companyId: company.id } as unknown as GameAction;
    expect(travelModule.evaluate(action, context)).toBeNull();
  });
});

describe('declaring a path', () => {
  const path = (regions: string[]): GameAction =>
    ({ type: 'declare-path', movementType: 'region', regionPath: regions } as unknown as GameAction);

  test('a longer route costs more than a shorter one', () => {
    const { context } = position();
    const short = travelModule.evaluate(path(['a']), context)!;
    const long = travelModule.evaluate(path(['a', 'b', 'c']), context)!;
    expect(long.expectedTsd).toBeLessThan(short.expectedTsd);
  });

  test('crossing nothing costs nothing', () => {
    const { context } = position();
    expect(travelModule.evaluate(path([]), context)!.expectedTsd).toBe(0);
  });

  test('the cost is scaled by what the opponent is believed to hold', () => {
    // Not by a hand-tuned region-danger table, which is what H1 carries and
    // what `exposure` deliberately refuses to provide.
    const { context } = position();
    const text = JSON.stringify(travelModule.evaluate(path(['a', 'b']), context)!.rationale);
    expect(text).toContain('holds a creature');
  });
});

describe('entering a site', () => {
  test('prices the attacks the site prints, against this company', () => {
    // The one decision where both halves are published: the site card carries
    // its automatic attacks, so this is `defence` run against the real thing
    // rather than against a median creature.
    const { context, actions } = position(ENTER);
    const enter = actions.find(a => a.type === 'enter-site');
    expect(enter).toBeDefined();
    const evaluation = travelModule.evaluate(enter!, context)!;
    expect(evaluation).not.toBeNull();
    const text = JSON.stringify(evaluation.rationale);
    expect(text).toContain('automatic attacks');
    expect(text).toContain('on-guard cards');
  });

  test('will not enter for nothing — a company with no taps left has nothing to gain', () => {
    // Entering commits the company to the site's attacks before a single
    // resource can be played (CoE 341-343). With every character tapped there
    // is no resource play to be had, so the attacks buy nothing at all.
    const { context, actions } = position(ENTER);
    const enter = actions.find(a => a.type === 'enter-site')!;
    const stay = travelModule.evaluate({ type: 'pass' } as unknown as GameAction, context)!;
    const entering = travelModule.evaluate(enter, context)!;
    expect(entering.expectedTsd).toBeLessThan(stay.expectedTsd);
  });
});
