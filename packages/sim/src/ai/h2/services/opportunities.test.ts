/**
 * @module ai/h2/services/opportunities.test
 *
 * The refactor contract of the shared enumeration: `resources` and `factions`
 * moved their private (card × site) arithmetic onto `opportunities`, and their
 * proposals must not have moved. The golden file was generated from the
 * proposers *before* the extraction (the whole scenario corpus, both
 * proposers, plans as JSON), so equality here is equality with the code that
 * shipped — not with a re-derivation that could share a bug with the service
 * it is checking.
 *
 * The golden pins the scenarios it holds; a scenario added later is simply
 * not covered by it, which keeps the corpus growable without regenerating
 * history.
 */

import { describe, test, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { loadCardPool } from '@meccg/shared';
import type { ModuleContext } from '../core/types.js';
import { DEFAULT_TUNABLES } from '../core/tunables.js';
import { computeStanding } from './standing.js';
import { testWinProbModel } from '../test-support.js';
import { loadScenario, scenarioView } from '../scenario-store.js';
import { loadWinProbModel } from '../core/winprob.js';
import { ALL_MODULES, proposePlans } from '../core/registry.js';
import { enumerateOpportunities, routeProbabilityFor } from './opportunities.js';
import { computeReach } from './reach.js';

const GOLDEN = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'opportunities.golden.json'), 'utf-8',
)) as Record<string, unknown[]>;

describe('proposal identity across the refactor', () => {
  const cardPool = loadCardPool();
  // The shipped model, because the golden was generated with it: proposals
  // price payoffs through `standing`, and a test model would price a
  // different game.
  const model = loadWinProbModel();

  test.each(Object.keys(GOLDEN))('%s proposes byte-identically', id => {
    const scenario = loadScenario(id);
    const view = scenarioView(scenario);
    const legalActions = view.legalActions.filter(e => e.viable).map(e => e.action);
    const standing = computeStanding(view, model, DEFAULT_TUNABLES);
    const context: ModuleContext = { view, cardPool, legalActions, tunables: DEFAULT_TUNABLES, standing };
    const plans = proposePlans(ALL_MODULES, context);
    expect(JSON.parse(JSON.stringify(plans))).toEqual(GOLDEN[id]);
  });
});

describe('the enumeration itself', () => {
  const cardPool = loadCardPool();

  test('is memoized per view', () => {
    const scenario = loadScenario('organization/turn14-company-planning');
    const view = scenarioView(scenario);
    const standing = computeStanding(view, testWinProbModel(), DEFAULT_TUNABLES);
    const first = enumerateOpportunities(view, cardPool, standing, DEFAULT_TUNABLES);
    const second = enumerateOpportunities(view, cardPool, standing, DEFAULT_TUNABLES);
    expect(second).toBe(first);
  });

  test('every opportunity is playable, positive and routed', () => {
    const scenario = loadScenario('organization/turn14-company-planning');
    const view = scenarioView(scenario);
    const standing = computeStanding(view, testWinProbModel(), DEFAULT_TUNABLES);
    const opportunities = enumerateOpportunities(view, cardPool, standing, DEFAULT_TUNABLES);
    for (const opportunity of opportunities) {
      expect(opportunity.mp).toBeGreaterThan(0);
      expect(opportunity.grossPayoffTsd).toBeGreaterThan(0);
      expect(opportunity.netPayoffTsd).toBeGreaterThan(0);
      expect(opportunity.netPayoffTsd).toBeCloseTo(
        opportunity.grossPayoffTsd - opportunity.harmTsd, 9);
      expect(opportunity.route.routeProbability).toBeGreaterThan(0);
      expect(opportunity.route.routeProbability).toBeLessThanOrEqual(1);
    }
  });
});

describe('routeProbabilityFor', () => {
  const cardPool = loadCardPool();
  const reach = computeReach(cardPool);

  test('standing on the site or heading there is certainty', () => {
    const site = { definitionId: 'any-site' };
    expect(routeProbabilityFor(
      { currentSite: site }, 'any-site', reach, DEFAULT_TUNABLES,
    )).toMatchObject({ here: true, routeProbability: 1 });
    expect(routeProbabilityFor(
      { currentSite: { definitionId: 'elsewhere' }, destinationSite: site },
      'any-site', reach, DEFAULT_TUNABLES,
    )).toMatchObject({ heading: true, routeProbability: 1 });
  });

  test('an unmapped pair falls back to the flat prior, not to zero', () => {
    const estimate = routeProbabilityFor(
      { currentSite: { definitionId: 'not-a-real-site' } },
      'also-not-real', reach, DEFAULT_TUNABLES,
    );
    expect(estimate.distance).toBeNull();
    expect(estimate.routeProbability).toBe(DEFAULT_TUNABLES.planUnroutedReachProbability);
  });
});
