/**
 * @module ai/h2/modules/events/events.test
 *
 * The module reads a card's declared effects and prices the families it
 * recognises, so the tests are about the boundary: a recognised family is
 * scored from what the card says, and an unrecognised one is *declined* rather
 * than charged for the card it would spend.
 *
 * That second property is the one worth guarding. Charging for the card and
 * crediting nothing would make H2 refuse to play any event in the game, which
 * is worse than having no opinion — and it is exactly the trap the on-guard
 * pricing fell into until the rules were checked.
 */

import { describe, expect, test } from 'vitest';
import type { GameAction, PlayerView } from '@meccg/shared';
import type { ModuleContext } from '../../core/types.js';
import { DEFAULT_TUNABLES } from '../../core/tunables.js';
import { computeStanding } from '../../services/standing.js';
import { testMarshallingPoints, testWinProbModel } from '../../test-support.js';
import { eventsModule } from './events.js';

/** A recovery event: brings a card back from the discard pile. */
const RECOVERY = 'ev-recovery';
/** An event whose effect this module has no family for. */
const OPAQUE = 'ev-opaque';

const POOL = {
  [RECOVERY]: {
    cardType: 'hero-resource-event',
    name: 'Smoke Rings',
    effects: [{ type: 'move', select: 'target', from: ['sideboard', 'discard'], to: 'deck', count: 1 }],
  },
  [OPAQUE]: {
    cardType: 'hero-resource-event',
    name: 'Stealth',
    effects: [
      { type: 'play-window', phase: 'organization' },
      { type: 'on-event', event: 'something-specific' },
    ],
  },
} as unknown as ModuleContext['cardPool'];

/** A context holding both events in hand. */
function context(): ModuleContext {
  const view = {
    self: {
      id: 'p1',
      marshallingPoints: testMarshallingPoints({ character: 3, item: 3 }),
      hand: [
        { instanceId: 'c-recovery', definitionId: RECOVERY },
        { instanceId: 'c-opaque', definitionId: OPAQUE },
      ],
      playDeck: [],
      sideboard: [],
      discardPile: [],
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
    turnNumber: 12,
  } as unknown as PlayerView;
  return {
    view,
    cardPool: POOL,
    legalActions: [],
    tunables: DEFAULT_TUNABLES,
    standing: computeStanding(view, testWinProbModel(), DEFAULT_TUNABLES),
  };
}

/** Playing one of the two events in hand. */
const play = (instanceId: string): GameAction =>
  ({ type: 'play-short-event', player: 'p1', cardInstanceId: instanceId } as unknown as GameAction);

describe('a family it recognises', () => {
  test('a card recovered is worth what a draw is worth, and says it is a floor', () => {
    const evaluation = eventsModule.evaluate(play('c-recovery'), context())!;
    expect(evaluation).not.toBeNull();
    const text = JSON.stringify(evaluation.rationale);
    expect(text).toContain('back to deck');
    // Priced as a floor, because the card is chosen rather than drawn.
    expect(text).toContain('a floor');
  });

  test('the card it spends is charged at the shadow price', () => {
    const evaluation = eventsModule.evaluate(play('c-recovery'), context())!;
    expect(JSON.stringify(evaluation.rationale)).toContain('the card it spends');
  });
});

describe('a family it does not', () => {
  test('is declined, not charged', () => {
    // The property that keeps H2 able to play events at all: an effect this
    // module cannot read leaves the decision uncovered rather than scored at
    // "costs a card, achieves nothing".
    expect(eventsModule.evaluate(play('c-opaque'), context())).toBeNull();
  });

  test('and so is an action naming a card that is not in hand', () => {
    expect(eventsModule.evaluate(play('not-held'), context())).toBeNull();
  });
});
