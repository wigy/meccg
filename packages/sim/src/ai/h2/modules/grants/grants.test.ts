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
