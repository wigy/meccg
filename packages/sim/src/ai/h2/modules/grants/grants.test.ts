/**
 * @module ai/h2/modules/grants/grants.test
 *
 * The module prices *families of declared effect*, not cards, so the tests are
 * about the families: a grant whose effect is in the list is scored from what
 * the card declares, and one whose effect is not is declined rather than given
 * an invented number.
 */

import { describe, expect, test } from 'vitest';
import { computeLegalActions, loadCardPool } from '@meccg/shared';
import type { GameAction } from '@meccg/shared';
import type { ModuleContext } from '../../core/types.js';
import { DEFAULT_TUNABLES } from '../../core/tunables.js';
import { computeStanding } from '../../services/standing.js';
import { loadScenario, scenarioView } from '../../scenario-store.js';
import { testWinProbModel } from '../../test-support.js';
import { grantsModule } from './grants.js';

/** A position where a bearer is offered the roll to shake a Lure off. */
function position() {
  const scenario = loadScenario('organization/shed-corruption');
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

describe('shedding an attached card', () => {
  test('prices it from the published threshold and the corruption the card declares', () => {
    const { context, legalActions } = position();
    const shed = legalActions.find(a => a.type === 'activate-granted-action'
      && (a as unknown as { actionId?: string }).actionId === 'remove-self-on-roll');
    expect(shed).toBeDefined();

    const evaluation = grantsModule.evaluate(shed!, context)!;
    expect(evaluation).not.toBeNull();
    // Two branches: it comes off, or the cost is spent for nothing.
    expect(evaluation.outcomes).toHaveLength(2);
    expect(evaluation.outcomes.reduce((sum, o) => sum + o.p, 0)).toBeCloseTo(1, 9);

    const text = JSON.stringify(evaluation.rationale);
    // The corruption is a standing `stat-modifier` effect, not the top-level
    // number resource cards print — reading only the number found zero on every
    // attached hazard in the game.
    expect(text).toContain('narrows the failing band');
    // Names, not instance or definition IDs.
    expect(text).not.toMatch(/"value":"?(tw|le|as|dm|wh|ba|td)-\d+/);
  });

  test('charges the cost the grant declares', () => {
    const { context, legalActions } = position();
    const shed = legalActions.find(a => a.type === 'activate-granted-action'
      && (a as unknown as { actionId?: string }).actionId === 'remove-self-on-roll')!;
    const text = JSON.stringify(grantsModule.evaluate(shed, context)!.rationale);
    expect(text).toContain('taps bearer');
  });
});

describe('what it will not price', () => {
  test('declines a grant whose effect is not a family it models', () => {
    // An extra region of movement, a company buff: nothing here can say what
    // those are worth, and declining leaves the decision honestly uncovered.
    const { context, legalActions } = position();
    const known = legalActions.find(a => a.type === 'activate-granted-action'
      && (a as unknown as { actionId?: string }).actionId === 'remove-self-on-roll')!;
    const unknown = {
      ...(known as unknown as Record<string, unknown>),
      actionId: 'extra-region-movement',
    } as unknown as GameAction;
    expect(grantsModule.evaluate(unknown, context)).toBeNull();
  });

  test('declines an action that names a card with no such grant', () => {
    const { context, legalActions } = position();
    const known = legalActions.find(a => a.type === 'activate-granted-action')!;
    const bogus = {
      ...(known as unknown as Record<string, unknown>),
      sourceCardDefinitionId: 'tw-1',
    } as unknown as GameAction;
    expect(grantsModule.evaluate(bogus, context)).toBeNull();
  });
});

describe('the no-tap roll is not free', () => {
  /** Both variants of the shed, as the engine offers them side by side. */
  function variants() {
    const { context, legalActions } = position();
    const shed = (noTap: boolean) => legalActions.find(a => a.type === 'activate-granted-action'
      && (a as unknown as { actionId?: string }).actionId === 'remove-self-on-roll'
      && ((a as unknown as { noTap?: true }).noTap === true) === noTap)!;
    return { context, tapping: shed(false), free: shed(true) };
  }

  test('the engine offers both variants on the same decision', () => {
    const { tapping, free } = variants();
    expect(tapping).toBeDefined();
    expect(free).toBeDefined();
  });

  test('a failed no-tap roll is charged the tapping attempt it locks out', () => {
    // `grant-action-apply.ts` adds the `corruption-removal-locked` constraint
    // "regardless of roll outcome", so the free roll spends the turn's only
    // attempt. Priced at nothing, it could never lose and so always outranked
    // passing.
    const { context, free } = variants();
    const evaluation = grantsModule.evaluate(free, context)!;

    const failure = evaluation.outcomes.find(o => o.label.includes('the roll fails'))!;
    expect(failure.dtsd).toBeLessThan(0);
    expect(JSON.stringify(evaluation.rationale)).toContain('forfeits the tapping variant');
  });

  test('the tapping variant it forfeits is the better roll', () => {
    // The whole reason the free roll is a trap: 5 on 2d6 against 5+3.
    const { context, tapping, free } = variants();
    const odds = (a: typeof tapping) => grantsModule.evaluate(a, context)!
      .outcomes.find(o => !o.label.includes('the roll fails'))!.p;
    expect(odds(tapping)).toBeGreaterThan(odds(free));
  });

  test('nothing is forfeited when the bearer is tapped and no variant was offered', () => {
    // Then the free roll really is free, and the module must not invent a cost.
    const { context, free } = variants();
    const alone = { ...context, legalActions: [free] };
    const evaluation = grantsModule.evaluate(free, alone)!;

    const failure = evaluation.outcomes.find(o => o.label.includes('the roll fails'))!;
    expect(failure.dtsd).toBe(0);
    expect(JSON.stringify(evaluation.rationale)).toContain('no tapping variant was on offer');
  });
});
