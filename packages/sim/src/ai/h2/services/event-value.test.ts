/**
 * @module ai/h2/services/event-value.test
 *
 * A permanent event's printed points, when the card leaves play the moment its
 * company moves (Align Palantír, Choice of Lúthien).
 */

import { describe, expect, test } from 'vitest';
import type { CardDefinition, GameAction, PlayerView } from '@meccg/shared';
import type { ModuleContext } from '../core/types.js';
import { DEFAULT_TUNABLES } from '../core/tunables.js';
import { testMarshallingPoints, testWinProbModel } from '../test-support.js';
import { computeStanding } from './standing.js';
import { declaredEventEvaluation } from './event-value.js';

const FRAGILE = 'ev-fragile';
const STURDY = 'ev-sturdy';

const POOL = {
  [FRAGILE]: {
    name: 'Align Palantír', cardType: 'hero-resource-event', eventType: 'permanent',
    marshallingPoints: 2, marshallingCategory: 'misc',
    effects: [{
      type: 'on-event', event: 'bearer-company-moves',
      apply: { type: 'move', select: 'self', from: 'self-location', to: 'discard' },
    }],
  },
  [STURDY]: {
    name: 'A Sturdy Event', cardType: 'hero-resource-event', eventType: 'permanent',
    marshallingPoints: 2, marshallingCategory: 'misc', effects: [],
  },
} as unknown as Readonly<Record<string, CardDefinition>>;

function contextIn(phase: string): ModuleContext {
  const view = {
    self: {
      id: 'p1',
      marshallingPoints: testMarshallingPoints({ character: 3, item: 3, faction: 3, ally: 3 }),
      hand: [FRAGILE, STURDY].map(d => ({ instanceId: `c-${d}`, definitionId: d })),
      playDeck: [], characters: {}, companies: [], cardsInPlay: [],
    },
    opponent: {
      marshallingPoints: testMarshallingPoints({ character: 3, item: 3, faction: 3, ally: 3 }),
      characters: {}, cardsInPlay: [], companies: [], hand: [],
    },
    activePlayer: 'p1',
    turnNumber: 10,
    phaseState: { phase },
  } as unknown as PlayerView;
  return {
    view, cardPool: POOL, legalActions: [], tunables: DEFAULT_TUNABLES,
    standing: computeStanding(view, testWinProbModel(), DEFAULT_TUNABLES),
  };
}

const play = (definitionId: string): GameAction =>
  ({ type: 'play-permanent-event', player: 'p1', cardInstanceId: `c-${definitionId}` } as unknown as GameAction);

describe('a permanent event that leaves play when its company moves', () => {
  test('keeps nothing when played before this turn\'s movement', () => {
    const evaluation = declaredEventEvaluation(play(FRAGILE), contextIn('organization'), 'stage', { creditPoints: true })!;
    expect(evaluation.expectedTsd).toBeCloseTo(-DEFAULT_TUNABLES.provisionalCardPrice, 9);
  });

  test('keeps its points as potential after the movement', () => {
    const context = contextIn('site');
    const fragile = declaredEventEvaluation(play(FRAGILE), context, 'stage', { creditPoints: true })!;
    const sturdy = declaredEventEvaluation(play(STURDY), context, 'stage', { creditPoints: true })!;
    const worth = context.standing.tsdAfter({ misc: 2 }) - context.standing.tsd;
    expect(fragile.expectedTsd).toBeCloseTo(
      DEFAULT_TUNABLES.potentialDiscount * worth - DEFAULT_TUNABLES.provisionalCardPrice, 9,
    );
    // A card that stays in play banks the same points in full.
    expect(sturdy.expectedTsd).toBeCloseTo(worth - DEFAULT_TUNABLES.provisionalCardPrice, 9);
  });
});
