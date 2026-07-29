/**
 * @module ai/h2/modules/combat/combat.test
 *
 * The module end to end, on the checked-in positions it is meant to handle.
 *
 * The dice mathematics is pinned in `strike-model.test.ts` and re-checked
 * against the real reducer by `npm run calibrate`; what is tested here is the
 * part a calibration run cannot see — that the module claims the right
 * decisions, prices the outcomes into one comparable currency, and explains
 * where every hand-chosen number came from.
 */

import { describe, test, expect } from 'vitest';
import { computeLegalActions, loadCardPool } from '@meccg/shared';
import type { GameAction } from '@meccg/shared';
import type { Evaluation, ModuleContext } from '../../core/types.js';
import { DEFAULT_TUNABLES } from '../../core/tunables.js';
import { collectTunables } from '../../core/rationale.js';
import { computeStanding } from '../../services/standing.js';
import { evaluateDecision } from '../../core/registry.js';
import { loadScenario, scenarioView } from '../../scenario-store.js';
import { testWinProbModel } from '../../test-support.js';
import { combatModule } from './combat.js';

const CARD_POOL = loadCardPool();
const MODEL = testWinProbModel();

/** The module context for a checked-in scenario. */
function contextFor(scenarioId: string): ModuleContext {
  const scenario = loadScenario(scenarioId);
  const view = scenarioView(scenario);
  const legalActions = view.legalActions.filter(e => e.viable).map(e => e.action);
  return {
    view,
    cardPool: CARD_POOL,
    legalActions,
    tunables: DEFAULT_TUNABLES,
    standing: computeStanding(view, MODEL, DEFAULT_TUNABLES),
  };
}

/** Evaluations for a scenario, ranked best first. */
function rank(scenarioId: string): readonly Evaluation[] {
  return evaluateDecision([combatModule], contextFor(scenarioId)).evaluations;
}

/** The evaluation of the first action matching a predicate. */
function find(evaluations: readonly Evaluation[], predicate: (a: GameAction) => boolean): Evaluation | undefined {
  return evaluations.find(e => predicate(e.action));
}

/** Whether an action is `resolve-strike` with the given tap mode. */
function isResolve(tapToFight: boolean) {
  return (action: GameAction): boolean =>
    action.type === 'resolve-strike'
    && (action as unknown as { tapToFight?: boolean }).tapToFight === tapToFight;
}

const STRIKE_SCENARIOS = [
  'combat/first-strike-resolution',
  'combat/creature-with-body',
  'combat/strike-event-in-hand',
  'combat/two-strike-attack',
];

describe('claiming decisions', () => {
  test.each(STRIKE_SCENARIOS)('claims the strike window in %s', scenarioId => {
    expect(combatModule.claims!(contextFor(scenarioId))).toBe(true);
  });

  test('declines a decision with no combat in progress', () => {
    // Combat is a phase-independent sub-state, so the phase alone would not
    // identify it — the module checks the combat itself.
    expect(combatModule.claims!(contextFor('organization/turn14-company-planning'))).toBe(false);
  });

  test('scores every candidate it claims, so the ranking is in one currency', () => {
    for (const scenarioId of STRIKE_SCENARIOS) {
      const context = contextFor(scenarioId);
      const { modules, evaluations } = evaluateDecision([combatModule], context);
      expect(modules).toEqual(['combat']);
      expect(evaluations).toHaveLength(context.legalActions.length);
      for (const evaluation of evaluations) {
        expect(evaluation.outcomes.reduce((sum, o) => sum + o.p, 0)).toBeCloseTo(1, 9);
        expect(Number.isFinite(evaluation.utility)).toBe(true);
      }
    }
  });

  test('ranks best first', () => {
    for (const scenarioId of STRIKE_SCENARIOS) {
      const evaluations = rank(scenarioId);
      for (let i = 1; i < evaluations.length; i++) {
        expect(evaluations[i - 1].utility).toBeGreaterThanOrEqual(evaluations[i].utility);
      }
    }
  });
});

describe('facing a dangerous strike', () => {
  // first-strike-resolution: tapping needs 4, staying untapped needs 7 — a
  // 2.8% chance of being struck against 25%.
  const evaluations = rank('combat/first-strike-resolution');

  test('tapping to fight beats staying untapped when the strike can wound', () => {
    const tap = find(evaluations, isResolve(true))!;
    const untap = find(evaluations, isResolve(false));
    if (untap) expect(tap.utility).toBeGreaterThan(untap.utility);
  });

  test('the safer option is also the one with less spread', () => {
    const tap = find(evaluations, isResolve(true))!;
    const untap = find(evaluations, isResolve(false));
    if (untap) expect(tap.sigmaTsd).toBeLessThan(untap.sigmaTsd);
  });
});

describe('facing a harmless strike', () => {
  // creature-with-body: the character out-prowesses the attack, so tapping is
  // a certain parry — but staying untapped costs almost nothing and keeps the
  // character available for the site phase, which is what the tap tempo term
  // exists to notice.
  const evaluations = rank('combat/creature-with-body');

  test('staying untapped is preferred when the strike is unlikely to land', () => {
    const tap = find(evaluations, isResolve(true))!;
    const untap = find(evaluations, isResolve(false))!;
    expect(untap.utility).toBeGreaterThan(tap.utility);
  });
});

describe('spending a card', () => {
  const evaluations = rank('combat/strike-event-in-hand');

  test('charges the card against every outcome, not only the good ones', () => {
    const card = find(evaluations, a => a.type === 'play-strike-event');
    if (!card) return;
    // Comparing the card option against a *different* option would conflate
    // the price with everything else that differs. Re-evaluating the same
    // option with the price set to zero isolates it exactly: the card is paid
    // for whether or not the dice cooperate, so the whole expectation moves by
    // the full price.
    const free = { ...contextFor('combat/strike-event-in-hand'), tunables: { ...DEFAULT_TUNABLES, provisionalCardPrice: 0 } };
    const unpriced = combatModule.evaluate(card.action, free)!;
    expect(unpriced.expectedTsd - card.expectedTsd).toBeCloseTo(DEFAULT_TUNABLES.provisionalCardPrice, 9);
    expect(collectTunables(card.rationale).has('provisionalCardPrice')).toBe(true);
  });
});

describe('explanations', () => {
  test('name every constant they used', () => {
    for (const evaluation of rank('combat/first-strike-resolution')) {
      const named = collectTunables(evaluation.rationale);
      expect(named.has('tapTempoCost')).toBe(true);
      expect(named.has('woundTempoCost')).toBe(true);
      expect(named.has('eliminationTempoCost')).toBe(true);
    }
  });

  test('declare what the module does not model', () => {
    for (const evaluation of rank('combat/first-strike-resolution')) {
      expect(evaluation.assumptions).toContain('the attacker plays no cards into this combat');
    }
  });

  test('report the outcome distribution the calibration harness checks', () => {
    const tap = find(rank('combat/two-strike-attack'), isResolve(true))!;
    expect(tap.outcomes.length).toBeGreaterThan(0);
    for (const outcome of tap.outcomes) {
      expect(outcome.p).toBeGreaterThan(0);
      expect(outcome.label.length).toBeGreaterThan(0);
    }
  });
});

describe('kill marshalling points', () => {
  test('are discounted while other strikes are still unresolved', () => {
    // two-strike-attack: defeating this strike unlocks the points but does not
    // bank them, which is what stops a single parry reading as income.
    const evaluation = find(rank('combat/two-strike-attack'), isResolve(true))!;
    const defeated = evaluation.outcomes.find(o => o.label.includes('strike defeated'));
    expect(defeated?.label).not.toContain('attack beaten');
  });
});

describe('choosing which strike resolves next', () => {
  test('every candidate is scored — the decision is claimed, not just owned', () => {
    // At this step there is deliberately no *current* strike: picking one is
    // the decision. The module used to handle ordering only inside the
    // strike-window switch, which that branch never reaches, so it claimed the
    // decision and then declined every candidate on it — 124 times in three
    // self-play games, and indistinguishable in `coverage` from an action type
    // nobody owns.
    const scenario = loadScenario('combat/choose-strike-order');
    const view = scenarioView(scenario);
    const cardPool = loadCardPool();
    const legalActions = computeLegalActions(scenario.state, scenario.actingPlayer)
      .filter(legal => legal.viable)
      .map(legal => legal.action);
    const ordering = legalActions.filter(a => a.type === 'choose-strike-order');
    expect(ordering.length).toBeGreaterThan(1);

    const context: ModuleContext = {
      view,
      cardPool,
      legalActions,
      tunables: DEFAULT_TUNABLES,
      standing: computeStanding(view, testWinProbModel(), DEFAULT_TUNABLES),
    };
    expect(combatModule.claims!(context)).toBe(true);
    for (const action of ordering) {
      expect(combatModule.evaluate(action, context)).not.toBeNull();
    }
  });

  test('it names the character facing each strike, not the strike index', () => {
    const scenario = loadScenario('combat/choose-strike-order');
    const view = scenarioView(scenario);
    const cardPool = loadCardPool();
    const legalActions = computeLegalActions(scenario.state, scenario.actingPlayer)
      .filter(legal => legal.viable)
      .map(legal => legal.action);
    const context: ModuleContext = {
      view,
      cardPool,
      legalActions,
      tunables: DEFAULT_TUNABLES,
      standing: computeStanding(view, testWinProbModel(), DEFAULT_TUNABLES),
    };
    const first = legalActions.find(a => a.type === 'choose-strike-order')!;
    const evaluation = combatModule.evaluate(first, context)!;
    // The action's own `characterId` is documented as informational and the
    // engine may omit it; the authority is `strikeIndex` into the assignments.
    expect(evaluation.outcomes[0].label).not.toMatch(/^p\d+-\d+/);
  });
});
