/**
 * @module ai/h2/services/deck-plan.test
 *
 * What a seat may conclude from winners' counts, and when it must say nothing.
 */

import { describe, expect, test } from 'vitest';
import { ALL_DECKS, adviceFrom, recognizeDeck, windowOf } from './deck-plan.js';
import type { CardPlan, DeckPlans } from './deck-plan.js';

const SITE = windowOf({ phaseState: { phase: 'site' }, activePlayer: 'me' }, 'me');

function card(plays: number, throws: number, offered: number, taken: number): CardPlan {
  return { plays, throws, windows: { [SITE]: [offered, taken] } };
}

const PLANS: DeckPlans = {
  decks: {
    [ALL_DECKS]: {
      games: 10,
      cards: {
        common: card(30, 10, 40, 30),
        rare: card(1, 1, 2, 1),
      },
    },
    a: {
      games: 5,
      cards: {
        common: card(1, 9, 20, 1),
        thin: card(1, 1, 3, 1),
        x: card(5, 5, 10, 5),
        y: card(5, 5, 10, 5),
        z: card(5, 5, 10, 5),
      },
    },
  },
};

describe('windowOf', () => {
  test('tells an open phase from one with a chain or a combat in front of it', () => {
    const position = { phaseState: { phase: 'site' }, activePlayer: 'me' };
    expect(windowOf(position, 'me')).toBe('site/own/open');
    expect(windowOf(position, 'them')).toBe('site/opp/open');
    expect(windowOf({ ...position, chain: {} }, 'me')).toBe('site/own/chain');
    expect(windowOf({ ...position, chain: {}, combat: {} }, 'me')).toBe('site/own/combat');
  });
});

describe('recognizeDeck', () => {
  test('finds an edited copy by its contents', () => {
    const plan = recognizeDeck({ playDeck: ['x', 'y', 'z', 'common', 'someone-elses-card'], draftPool: [] }, PLANS);
    expect(plan).toBe(PLANS.decks['a']);
  });

  test('leaves a deck it does not cover to the all-decks table', () => {
    expect(recognizeDeck({ playDeck: ['x', 'p', 'q', 'r', 's'], draftPool: [] }, PLANS)).toBeNull();
    expect(recognizeDeck(undefined, PLANS)).toBeNull();
  });
});

describe('adviceFrom', () => {
  const deck = { playDeck: ['x', 'y', 'z', 'common', 'thin'], draftPool: [] };

  test("prefers the deck's own count over the same card across decks", () => {
    const advice = adviceFrom(deck, PLANS);
    expect(advice.playRate('common', SITE)).toBeCloseTo(1 / 24);
    expect(advice.keepRate('common')).toBeCloseTo(3 / 14);
    expect(adviceFrom(undefined, PLANS).playRate('common', SITE)).toBeCloseTo(30 / 44);
  });

  test('falls back to all decks when the deck has too little to say', () => {
    const plans: DeckPlans = {
      decks: { ...PLANS.decks, [ALL_DECKS]: { games: 10, cards: { thin: card(20, 20, 40, 20) } } },
    };
    expect(adviceFrom(deck, plans).playRate('thin', SITE)).toBeCloseTo(20 / 44);
  });

  test('has no opinion on a card too rare to count', () => {
    const advice = adviceFrom(undefined, PLANS);
    expect(advice.playRate('rare', SITE)).toBeNull();
    expect(advice.keepRate('rare')).toBeNull();
    expect(advice.playRate('unknown', SITE)).toBeNull();
  });

  test('has no opinion on a window it never saw the card in', () => {
    expect(adviceFrom(undefined, PLANS).playRate('common', 'organization/own/open')).toBeNull();
  });
});
