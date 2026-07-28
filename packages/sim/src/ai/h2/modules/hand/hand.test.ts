/**
 * @module ai/h2/modules/hand/hand.test
 *
 * The module's job is to price what leaves and enters the hand. So the tests
 * check that a sideboard exchange is scored as the neutral action it is, and —
 * the property that matters most, because its absence is what the horizon test
 * caught — that two different cards get two different prices.
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

/** Three cards that a real price has to separate, for the discard tests. */
const HAND = [
  { instanceId: 'c-faction', definitionId: 'faction' },
  { instanceId: 'c-capped', definitionId: 'capped' },
  { instanceId: 'c-blank', definitionId: 'blank' },
];

/**
 * A pool spanning the three cases: points in a source with room, points in a
 * source already at the diversity cap, and no points at all.
 */
const POOL = {
  faction: {
    cardType: 'hero-resource-faction', name: 'Faction', marshallingPoints: 2, marshallingCategory: 'faction',
  },
  capped: {
    cardType: 'hero-resource-item', name: 'Capped Item', marshallingPoints: 4, marshallingCategory: 'item',
  },
  blank: { cardType: 'hero-resource-item', name: 'Blank', marshallingPoints: 0 },
} as unknown as ModuleContext['cardPool'];

/** A context with a deck and sideboard of the given sizes. */
function contextWith(deck: number, sideboard: number): ModuleContext {
  const view = {
    self: {
      id: 'p1',
      marshallingPoints: testMarshallingPoints({ character: 3, item: 3 }),
      hand: HAND,
      playDeck: new Array(deck).fill({ instanceId: 'x', definitionId: 'unknown' }),
      sideboard: new Array(sideboard).fill({ instanceId: 'y', definitionId: 'unknown' }),
      characters: {},
      companies: [],
      cardsInPlay: [],
      generalInfluence: 20,
      generalInfluenceUsed: 0,
    },
    opponent: {
      marshallingPoints: testMarshallingPoints({ character: 3, item: 3 }),
      characters: {},
      cardsInPlay: [],
      companies: [],
      hand: [],
      discardPile: [],
      killPile: [],
      outOfPlayPile: [],
    },
    turnNumber: 20,
  } as unknown as PlayerView;
  return {
    view,
    cardPool: POOL,
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

describe('the card price', () => {
  test('names the price still charged by consumers that have not moved to the service', () => {
    const evaluation = handModule.evaluate(TO_DECK, contextWith(40, 12))!;
    expect(collectTunables(evaluation.rationale).has('provisionalCardPrice')).toBe(true);
  });

  test('declines an action that is not its own', () => {
    const other = { type: 'pass' } as unknown as GameAction;
    expect(handModule.evaluate(other, contextWith(40, 12))).toBeNull();
  });
});

describe('the end-of-turn hand', () => {
  const context = contextWith(40, 12);
  const discardFaction = { type: 'discard-card', cardInstanceId: 'c-faction' } as unknown as GameAction;
  const discardCapped = { type: 'discard-card', cardInstanceId: 'c-capped' } as unknown as GameAction;
  const discardBlank = { type: 'discard-card', cardInstanceId: 'c-blank' } as unknown as GameAction;
  const draw = { type: 'draw-cards' } as unknown as GameAction;

  test('drawing gains the draw value', () => {
    expect(handModule.evaluate(draw, context)!.expectedTsd)
      .toBeCloseTo(DEFAULT_TUNABLES.resourceDrawValue, 9);
  });

  test('two different cards are two different prices', () => {
    // The property whose absence the horizon test caught: with every discard
    // scored identically the module had no opinion to be right or wrong about.
    const faction = handModule.evaluate(discardFaction, context)!;
    const blank = handModule.evaluate(discardBlank, context)!;
    expect(faction.expectedTsd).toBeLessThan(blank.expectedTsd);
    expect(faction.utility).toBeLessThan(blank.utility);
  });

  test('points in a capped source are worth nothing to keep', () => {
    // Four marshalling points the diversity cap will never let them score are
    // worth less than a card whose use is merely unknown — which no flat price
    // can express, and which is the whole argument of §10.3.
    const capped = handModule.evaluate(discardCapped, context)!;
    expect(capped.expectedTsd).toBe(0);
    expect(handModule.evaluate(discardBlank, context)!.expectedTsd).toBeLessThan(0);
  });

  test('says which card it is throwing and why', () => {
    const evaluation = handModule.evaluate(discardFaction, context)!;
    expect(evaluation.outcomes[0].label).toContain('Faction');
    expect(evaluation.outcomes[0].label).toContain('faction MP');
  });

  test('reports the hand and deck the price was computed from', () => {
    const text = JSON.stringify(handModule.evaluate(discardFaction, contextWith(31, 4))!.rationale);
    expect(text).toContain('31');
  });
});
