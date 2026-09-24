/**
 * @module ai/h2/services/named-target.test
 *
 * What a resource needs besides the right site, read from its declared
 * effects — against the recorded position where the agent would have entered
 * Minas Tirith with Bergil alone for Return of the King, "Aragorn II only",
 * while Aragorn stood at Rivendell in the other company.
 */

import { describe, expect, test } from 'vitest';
import { computeLegalActions, loadCardPool } from '@meccg/shared';
import type { CardInstanceId, CompanyId } from '@meccg/shared';
import type { AgentContext } from '../../../types.js';
import { createHeuristic2Agent } from '../agent.js';
import { loadScenario, scenarioView } from '../scenario-store.js';
import { companyMayPlay } from './named-target.js';

const SCENARIO = 'movement/card-restricted-to-absent-character';
const pool = loadCardPool();

function position() {
  const scenario = loadScenario(SCENARIO);
  const view = scenarioView(scenario);
  const company = (id: string) => view.self.companies.find(c => (c.id as string) === id)!;
  return { scenario, view, aragorns: company('company-p1-0'), bergils: company('company-p1-1') };
}

describe('a card restricted to a named character', () => {
  test('is playable by the company holding him and not by another', () => {
    const { view, aragorns, bergils } = position();
    const returnOfTheKing = pool['tw-316'];
    expect(companyMayPlay(returnOfTheKing, aragorns.characters, aragorns.id, view, pool)).toBe(true);
    expect(companyMayPlay(returnOfTheKing, bergils.characters, bergils.id, view, pool)).toBe(false);
    // Asked of every character in play, for a goal not yet given a company.
    const everyone = Object.keys(view.self.characters) as CardInstanceId[];
    expect(companyMayPlay(returnOfTheKing, everyone, null, view, pool)).toBe(true);
  });

  test('needs the card it discards, not only the right character', () => {
    // The White Tree: "Sage only", and only by discarding a Sapling of the
    // White Tree. Aragorn's company has sages and no Sapling.
    const { view, aragorns } = position();
    expect(companyMayPlay(pool['tw-348'], aragorns.characters, aragorns.id, view, pool)).toBe(false);
  });

  test('restricts nothing when the filter reads what a view cannot supply', () => {
    // Paths of the Dead names Aragorn *and* the company's site; the engine
    // builds that from the game state, so it is not decided here.
    const { view, bergils } = position();
    expect(companyMayPlay(pool['tw-302'], bergils.characters, bergils.id, view, pool)).toBe(true);
  });

  test('restricts nothing for a card with no such requirement', () => {
    const { view, bergils } = position();
    expect(companyMayPlay(pool['tw-196'], bergils.characters, 'x' as CompanyId, view, pool)).toBe(true);
  });

  test('keeps the agent out of a site it has nothing to play at', () => {
    const { scenario, view } = position();
    const legalActions = computeLegalActions(scenario.state, scenario.actingPlayer)
      .filter(legal => legal.viable)
      .map(legal => legal.action);
    expect(legalActions.some(a => a.type === 'enter-site')).toBe(true);
    const decision = createHeuristic2Agent().chooseAction({
      view, cardPool: pool, legalActions, evaluated: view.legalActions, random: () => 0.5,
    } as unknown as AgentContext);
    expect(decision.action.type).toBe('pass');
  });
});
