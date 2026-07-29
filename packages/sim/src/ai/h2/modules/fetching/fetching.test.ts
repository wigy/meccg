/**
 * @module ai/h2/modules/fetching/fetching.test
 *
 * The module is almost entirely a lookup into the shadow price, so what the
 * tests pin is the wiring — that each action type's card is found where that
 * action keeps it — and the one property worth stating out loud: at the opening
 * draft every candidate prices at zero, and that is the tournament scorer
 * talking, not a bug here.
 */

import { describe, expect, test } from 'vitest';
import { computeLegalActions, loadCardPool, computeTournamentScore } from '@meccg/shared';
import type { MarshallingPointTotals } from '@meccg/shared';
import { DEFAULT_TUNABLES } from '../../core/tunables.js';
import type { ModuleContext } from '../../core/types.js';
import { computeStanding } from '../../services/standing.js';
import { loadScenario, scenarioView } from '../../scenario-store.js';
import { testWinProbModel } from '../../test-support.js';
import { fetchingModule } from './fetching.js';

/** The opening draft, where the offered characters live on the setup step. */
const DRAFT = 'setup/draft-pick';

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

describe('why the opening draft scores flat', () => {
  test('a score made of one source is worth nothing, and two sources are worth plenty', () => {
    // Not a limitation of this module: the tournament scorer caps every source
    // at half the player's total, so points in a single source cancel
    // themselves. At the draft nobody has scored anything yet, so *every*
    // candidate is worth zero and the decision goes to Heuristics 1 — which is
    // the honest outcome, but it means H2 has no opinion about the opening.
    const zero: MarshallingPointTotals = {
      character: 0, item: 0, faction: 0, ally: 0, kill: 0, misc: 0,
    };
    expect(computeTournamentScore({ ...zero, character: 3 }, zero)).toBe(0);
    expect(computeTournamentScore({ ...zero, item: 2 }, zero)).toBe(0);
    expect(computeTournamentScore({ ...zero, character: 3, item: 2 }, zero)).toBeGreaterThan(0);
  });

  test('so the module covers the draft without discriminating on it', () => {
    const { context, legalActions } = position(DRAFT);
    const scores = legalActions
      .filter(a => a.type === 'draft-pick')
      .map(a => fetchingModule.evaluate(a, context)!.expectedTsd);
    expect(Math.max(...scores)).toBe(Math.min(...scores));
  });
});
