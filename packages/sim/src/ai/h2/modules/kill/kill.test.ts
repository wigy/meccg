/**
 * @module ai/h2/modules/kill/kill.test
 *
 * The module exists to make a cancel come out *negative* when the attack was
 * income. So the tests are about the sign, and about the standing deciding it:
 * the same creature is a gift when kill points double and worthless when the
 * kill source is capped.
 */

import { describe, test, expect } from 'vitest';
import type { CardDefinition, GameAction, PlayerView } from '@meccg/shared';
import type { ModuleContext } from '../../core/types.js';
import { DEFAULT_TUNABLES } from '../../core/tunables.js';
import { computeStanding } from '../../services/standing.js';
import { testMarshallingPoints, testWinProbModel } from '../../test-support.js';
import { killModule } from './kill.js';

const CREATURE = 'tw-creature';
const POOL = {
  [CREATURE]: { name: 'A Troll', killMarshallingPoints: 4 },
} as unknown as Readonly<Record<string, CardDefinition>>;

const CANCEL = { type: 'cancel-attack', cardInstanceId: 'c1' } as unknown as GameAction;

/** A pre-assignment combat with a creature worth kill points. */
function contextWith(self: Record<string, number>, opponent: Record<string, number>): ModuleContext {
  const view = {
    self: { id: 'p1', marshallingPoints: testMarshallingPoints(self), hand: [], characters: {}, companies: [], cardsInPlay: [] },
    opponent: {
      marshallingPoints: testMarshallingPoints(opponent),
      characters: {},
      cardsInPlay: [{ instanceId: 'creature-1', definitionId: CREATURE }],
    },
    combat: {
      attackSource: { type: 'creature', instanceId: 'creature-1' },
      defendingPlayerId: 'p1',
      phase: 'assign-strikes',
      strikeAssignments: [],
      detainment: false,
    },
    turnNumber: 20,
  } as unknown as PlayerView;
  return {
    view,
    cardPool: POOL,
    legalActions: [CANCEL],
    tunables: DEFAULT_TUNABLES,
    standing: computeStanding(view, testWinProbModel(), DEFAULT_TUNABLES),
  };
}

const BALANCED = { character: 3, item: 3, faction: 3, ally: 3, kill: 3 };

describe('when the attack is income', () => {
  test('refusing it comes out negative', () => {
    // The opponent has no kill points, so ours double: the creature is worth
    // more than the card spent refusing it.
    const context = contextWith(BALANCED, { character: 3, item: 3, faction: 3, ally: 3 });
    expect(context.standing.marginal.kill).toBeGreaterThan(0);
    expect(killModule.evaluate(CANCEL, context)!.expectedTsd).toBeLessThan(0);
  });

  test('refusing costs the card alone — the points on offer are priced by facing, not charged twice', () => {
    // The fight candidates are credited with the kill MP on the branches
    // that beat the attack, so charging the refusal with the same points
    // would count them twice and make every refusal look worse than it is.
    // Halving and cancelling therefore cost the same card; what differs is
    // what remains to be faced, which is the combat module's question.
    const context = contextWith(BALANCED, { character: 3, item: 3, faction: 3, ally: 3 });
    const halve = { type: 'halve-strikes', cardInstanceId: 'c1' } as unknown as GameAction;
    expect(killModule.evaluate(CANCEL, context)!.expectedTsd)
      .toBeCloseTo(-DEFAULT_TUNABLES.provisionalCardPrice, 9);
    expect(killModule.evaluate(halve, context)!.expectedTsd)
      .toBeCloseTo(-DEFAULT_TUNABLES.provisionalCardPrice, 9);
    expect(JSON.stringify(killModule.evaluate(CANCEL, context)!.rationale)).toContain('left on the table');
  });
});

describe('when the points are worthless', () => {
  test('a capped kill source makes the attack no gift, and the module says so', () => {
    const capped = contextWith({ character: 2, item: 2, faction: 2, ally: 2, kill: 8 }, BALANCED);
    expect(capped.standing.marginal.kill).toBe(0);
    const evaluation = killModule.evaluate(CANCEL, capped)!;
    // Nothing is forfeited, so only the card price remains.
    expect(evaluation.expectedTsd).toBeCloseTo(-DEFAULT_TUNABLES.provisionalCardPrice, 9);
    expect(JSON.stringify(evaluation.rationale)).toContain('not income at all');
  });
});

describe('what it claims', () => {
  test('only the window where the whole attack can still be refused', () => {
    expect(killModule.claims!(contextWith(BALANCED, { character: 3, item: 3, faction: 3, ally: 3 }))).toBe(true);
  });

  test('declines once strikes are assigned — that is combat\'s question', () => {
    const context = contextWith(BALANCED, { character: 3, item: 3, faction: 3, ally: 3 });
    const assigned = {
      ...context,
      view: {
        ...context.view,
        combat: { ...context.view.combat!, strikeAssignments: [{ characterId: 'x' }] },
      },
    } as unknown as ModuleContext;
    expect(killModule.claims!(assigned)).toBe(false);
  });

  test('declines an attack carrying no kill points', () => {
    const noPoints = { ...contextWith(BALANCED, BALANCED), cardPool: {} } as ModuleContext;
    expect(killModule.claims!(noPoints)).toBe(false);
  });
});
