/**
 * @module ai/h2/modules/hand/hand.test
 *
 * The module's job today is to be honest about a price it cannot compute. So
 * the tests check that a sideboard exchange is scored as the neutral action it
 * is, that the inputs a real price would need are reported, and that the
 * placeholder every other module charges is named where a reader can see it.
 */

import { describe, test, expect } from 'vitest';
import type { GameAction, PlayerView } from '@meccg/shared';
import type { ModuleContext } from '../../core/types.js';
import { DEFAULT_TUNABLES } from '../../core/tunables.js';
import { collectTunables } from '../../core/rationale.js';
import { computeStanding } from '../../services/standing.js';
import { testMarshallingPoints, testWinProbModel } from '../../test-support.js';
import { handModule } from './hand.js';

const TO_DECK = { type: 'start-sideboard-to-deck' } as unknown as GameAction;
const TO_DISCARD = { type: 'start-sideboard-to-discard' } as unknown as GameAction;

/** A context with a deck and sideboard of the given sizes. */
function contextWith(deck: number, sideboard: number): ModuleContext {
  const view = {
    self: {
      id: 'p1',
      marshallingPoints: testMarshallingPoints({ character: 3, item: 3 }),
      hand: [],
      playDeck: new Array(deck).fill({ instanceId: 'x', definitionId: 'unknown' }),
      sideboard: new Array(sideboard).fill({ instanceId: 'y', definitionId: 'unknown' }),
      characters: {},
      companies: [],
      cardsInPlay: [],
      generalInfluence: 20,
      generalInfluenceUsed: 0,
    },
    opponent: { marshallingPoints: testMarshallingPoints({ character: 3, item: 3 }), characters: {}, cardsInPlay: [] },
    turnNumber: 20,
  } as unknown as PlayerView;
  return {
    view,
    cardPool: {},
    legalActions: [TO_DECK, TO_DISCARD],
    tunables: DEFAULT_TUNABLES,
    standing: computeStanding(view, testWinProbModel(), DEFAULT_TUNABLES),
  };
}

describe('the sideboard exchange', () => {
  test('moves no marshalling points, in either direction', () => {
    for (const action of [TO_DECK, TO_DISCARD]) {
      const evaluation = handModule.evaluate(action, contextWith(40, 12))!;
      expect(evaluation.expectedTsd).toBe(0);
      expect(evaluation.outcomes).toHaveLength(1);
    }
  });

  test('distinguishes the two directions in what it says happened', () => {
    expect(handModule.evaluate(TO_DECK, contextWith(40, 12))!.outcomes[0].label).toContain('into the deck');
    expect(handModule.evaluate(TO_DISCARD, contextWith(40, 12))!.outcomes[0].label).toContain('to the discard');
  });

  test('reports the inputs a real card price would need', () => {
    const text = JSON.stringify(handModule.evaluate(TO_DECK, contextWith(37, 9))!.rationale);
    expect(text).toContain('37');
    expect(text).toContain('9');
  });
});

describe('the price it cannot compute', () => {
  test('names the placeholder every other module charges', () => {
    const evaluation = handModule.evaluate(TO_DECK, contextWith(40, 12))!;
    expect(collectTunables(evaluation.rationale).has('provisionalCardPrice')).toBe(true);
  });

  test('says why there is no real price yet, and what it depends on', () => {
    const evaluation = handModule.evaluate(TO_DECK, contextWith(40, 12))!;
    expect(evaluation.assumptions.some(a => a.includes('hazards'))).toBe(true);
  });

  test('declines an action that is not its own', () => {
    const other = { type: 'pass' } as unknown as GameAction;
    expect(handModule.evaluate(other, contextWith(40, 12))).toBeNull();
  });
});
