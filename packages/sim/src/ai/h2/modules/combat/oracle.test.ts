/**
 * @module ai/h2/modules/combat/oracle.test
 *
 * The combat module against exact lookahead.
 *
 * `ai/h2/oracle` solves the rest of a small combat exactly over the real
 * reducer and prices the leaves with the module's own services, so at every
 * defender decision the H2 agent reaches — its own choice, every dice
 * outcome, every attacker reply — the module's pick can be compared with
 * the candidate that is actually best under its own values. A disagreement
 * is a defect in the module's one-step model, which is how the three rule
 * errors this test was written against were found: a tie taxing the −3
 * option with a tap, excess strikes resolved as extra strikes, and a
 * cancelled attack banking its kill MP.
 *
 * The positions are the checked-in `combat-oracle/*` scenarios: one or two
 * heroes, a chosen hand, one creature — small enough to solve in full, and
 * covering the tap-or-not, dodge-or-not, cancel-or-fight and assignment
 * decisions.
 */

import { describe, test, expect } from 'vitest';
import { loadCardPool, setEngineConsoleLog } from '@meccg/shared';
import { createHeuristic2Agent } from '../../agent.js';
import { DEFAULT_TUNABLES } from '../../core/tunables.js';
import { loadWinProbModel } from '../../core/winprob.js';
import { listScenarioIds, loadScenario, withStandardCardPool } from '../../scenario-store.js';
import { checkAgainstAgent, describeAction, expectedTsd } from '../../oracle.js';
import type { AgreementRecord } from '../../oracle.js';
import { projectPlayerView } from '@meccg/game-server';

setEngineConsoleLog(false);

const CARD_POOL = loadCardPool();
const MODEL = loadWinProbModel();

/**
 * Utility the agent may give up before a pick counts as a disagreement.
 * The module and the oracle share every price, so a genuine disagreement
 * shows up at the second decimal; this only absorbs floating-point noise in
 * candidates that are exact ties.
 */
const TOLERANCE = 1e-4;

/** Per-position wall-clock budget. The positions solve in well under it. */
const BUDGET_MS = 120_000;

function explain(record: AgreementRecord): string {
  const view = projectPlayerView(record.state, record.state.combat!.defendingPlayerId);
  const combat = record.state.combat!;
  const lines = [`${combat.phase}/${combat.assignmentPhase}, strike ${combat.currentStrikeIndex + 1} of ${combat.strikesTotal}, regret ${record.regret.toFixed(4)}:`];
  record.decision.actions.forEach((action, i) => {
    const mark = i === record.chosen ? 'H2>' : i === record.decision.best ? 'OPT' : '   ';
    lines.push(`  ${mark} ${describeAction(action, view, CARD_POOL).padEnd(44)} u=${record.decision.utilities[i].toFixed(4)} E=${expectedTsd(record.decision.distributions[i]).toFixed(3)}`);
  });
  return lines.join('\n');
}

describe('the combat module agrees with exact lookahead', () => {
  const ids = listScenarioIds().filter(id => id.startsWith('combat-oracle/'));

  test('the corpus is present', () => {
    expect(ids.length).toBeGreaterThan(10);
  });

  test.each(ids)('%s', id => {
    const scenario = loadScenario(id);
    const state = withStandardCardPool(scenario.state);
    expect(state.combat).not.toBeNull();
    const agent = createHeuristic2Agent({ model: MODEL });
    const report = checkAgainstAgent(state, agent, {
      cardPool: CARD_POOL,
      tunables: DEFAULT_TUNABLES,
      model: MODEL,
      budgetMs: BUDGET_MS,
    });
    expect(report.stoppedEarly, report.stoppedEarly).toBeUndefined();
    expect(report.records.length).toBeGreaterThan(0);
    const disagreements = report.records.filter(record => record.regret > TOLERANCE);
    expect(disagreements.map(explain).join('\n\n')).toBe('');
  }, BUDGET_MS + 30_000);
});
