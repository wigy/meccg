/**
 * @module ai/h2/modules/combat/prowess.test
 *
 * The attack window has to predict the 2d6 target that the strike window
 * simply reads. That prediction is the module's most fragile claim — it
 * mirrors a formula that lives in the engine — so it is checked against the
 * engine's own published number on every position in the corpus rather than
 * against a hand-computed expectation.
 */

import { describe, test, expect } from 'vitest';
import { CardStatus, loadCardPool } from '@meccg/shared';
import type { CombatState } from '@meccg/shared';
import { listScenarioIds, loadScenario, scenarioView } from '../../scenario-store.js';
import { availableDefenders, predictedNeed, strikeTargets } from './prowess.js';
import type { StrikeTarget } from './prowess.js';

const CARD_POOL = loadCardPool();

/** Every scenario whose position is a strike awaiting resolution. */
function strikeWindowScenarios(): { id: string; combat: CombatState; view: ReturnType<typeof scenarioView> }[] {
  const found = [];
  for (const id of listScenarioIds()) {
    const scenario = loadScenario(id);
    const view = scenarioView(scenario);
    if (view.combat?.phase === 'resolve-strike' && view.combat.defendingPlayerId === view.self.id) {
      found.push({ id, combat: view.combat, view });
    }
  }
  return found;
}

describe('predicting the engine', () => {
  const positions = strikeWindowScenarios();

  test('the corpus contains strike positions to check against', () => {
    expect(positions.length).toBeGreaterThan(0);
  });

  /** Predicted vs published targets for one position's resolve-strike options. */
  function comparisons(id: string): { predicted: number; published: number }[] {
    const { view, combat } = positions.find(p => p.id === id)!;
    const assignment = combat.strikeAssignments[combat.currentStrikeIndex];
    const target = strikeTargets(view, CARD_POOL, combat).find(t => t.instanceId === assignment.characterId);
    if (!target) return [];
    const out = [];
    for (const evaluated of view.legalActions) {
      if (!evaluated.viable || evaluated.action.type !== 'resolve-strike') continue;
      const action = evaluated.action as unknown as { tapToFight: boolean; need: number };
      out.push({
        predicted: predictedNeed(target, CARD_POOL, combat, {
          excessStrikes: assignment.excessStrikes,
          supportCount: assignment.supportCount,
          strikeProwessBonus: assignment.strikeProwessBonus,
          stayUntapped: !action.tapToFight,
        }),
        published: action.need,
      });
    }
    return out;
  }

  test.each(positions.map(p => p.id))('%s: the projection tracks the published target', id => {
    const compared = comparisons(id);
    expect(compared.length).toBeGreaterThan(0);
    // Not equality: the projection is built on `effectiveStats.prowess`, which
    // does not carry modifiers keyed to the *attacker's* race — a weapon that
    // is sharper against Orcs, a creature that hits Hobbits harder. Those are
    // resolved by `computeCombatProwess` against server state the view does
    // not expose. One point is the observed size of that gap; a drift beyond
    // it means the mirrored formula has diverged from the engine's and is a
    // real regression, not a known limitation.
    for (const { predicted, published } of compared) {
      expect(Math.abs(predicted - published)).toBeLessThanOrEqual(1);
    }
  });

  test('most positions have no race-keyed modifier, and there the projection is exact', () => {
    const all = positions.flatMap(p => comparisons(p.id));
    const exact = all.filter(c => c.predicted === c.published).length;
    expect(all.length).toBeGreaterThan(0);
    expect(exact / all.length).toBeGreaterThan(0.5);
  });
});

describe('choosing who faces a strike', () => {
  test('offers only untapped, unassigned targets, best parrier first', () => {
    for (const { view, combat } of strikeWindowScenarios()) {
      const assigned = new Set(combat.strikeAssignments.map(a => a.characterId as string));
      const defenders = availableDefenders(view, CARD_POOL, combat);
      for (const defender of defenders) {
        expect(defender.status).toBe(CardStatus.Untapped);
        expect(assigned.has(defender.instanceId as string)).toBe(false);
      }
      const needs = defenders.map((d: StrikeTarget) => predictedNeed(d, CARD_POOL, combat));
      expect([...needs].sort((a, b) => a - b)).toEqual(needs);
    }
  });
});
