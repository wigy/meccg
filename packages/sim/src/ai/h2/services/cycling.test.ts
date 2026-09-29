/**
 * @module ai/h2/services/cycling.test
 * The strong players' keep rules for the end-of-turn cycle.
 */

import { describe, expect, test } from 'vitest';
import { loadCardPool } from '@meccg/shared';
import type { CardInstanceId, PlayerView } from '@meccg/shared';
import { DEFAULT_TUNABLES } from '../core/tunables.js';
import type { CardPrices } from './card-price.js';
import { cyclingKeeps } from './cycling.js';

const pool = loadCardPool();
const idOf = (name: string): string =>
  Object.keys(pool).find(id => (pool[id] as unknown as { name?: string }).name === name)!;

/** A hand of named cards, one company, and what the opponent has revealed. */
function position(hand: readonly string[], revealed: readonly string[] = [], companies = 1) {
  const cards = hand.map((name, i) => ({ instanceId: `h${i}-${name}`, definitionId: idOf(name) }));
  const view = {
    self: { hand: cards, companies: new Array(companies).fill(0).map((_, i) => ({ id: `c${i}`, characters: [] })) },
    opponent: {
      revealedCards: revealed.map((name, i) => ({ instanceId: `r${i}`, definitionId: idOf(name) })),
      discardPile: [], killPile: [], outOfPlayPile: [], cardsInPlay: [], characters: {}, hand: [],
    },
  } as unknown as PlayerView;
  // Worth by printed points, so the scoring cards order by size; the rest at the floor.
  const prices = {
    floor: 1,
    worth: (id: CardInstanceId) => {
      const card = cards.find(c => c.instanceId === id);
      const points = (pool[card!.definitionId] as unknown as { marshallingPoints?: number }).marshallingPoints ?? 0;
      return { instanceId: id, name: '', tsd: points > 0 ? 1 + points : 1, reason: '' };
    },
  } as unknown as CardPrices;
  // Every rule on, whatever ships as the default.
  const rules = { ...DEFAULT_TUNABLES, cyclingKeepAnswers: 1, cyclingKeepPoints: 1, cyclingCombatCap: 3 };
  const kept = cyclingKeeps(view, pool, prices, rules);
  const keptNames = cards.filter(c => kept.has(c.instanceId as CardInstanceId)).map(c => c.instanceId.split('-').slice(1).join('-'));
  return keptNames;
}

describe('the end-of-turn keep rules', () => {
  test('one Marvels Told and one Twilight, unless the threat they answer has been shown', () => {
    expect(position(['Marvels Told', 'Marvels Told', 'Twilight', 'Twilight']))
      .toEqual(['Marvels Told', 'Twilight']);
    // Corruption shown: every Marvels Told; no environment shown: still one Twilight.
    expect(position(['Marvels Told', 'Marvels Told', 'Twilight', 'Twilight'], ['Lure of Nature']))
      .toEqual(['Marvels Told', 'Marvels Told', 'Twilight']);
  });

  test('next turn\'s points — one per company — and a big one beyond that', () => {
    // One company: the biggest scoring card, plus the next one only if it is big.
    expect(position(['Rangers of the North', 'Dagger of Westernesse', 'Hauberk of Bright Mail']))
      .toEqual(['Rangers of the North']);
    expect(position(['Rangers of the North', 'Riders of Rohan'])).toEqual(['Rangers of the North', 'Riders of Rohan']);
    // Two companies: two cards.
    expect(position(['Rangers of the North', 'Hauberk of Bright Mail', 'Glamdring'], [], 2)).toHaveLength(2);
  });

  test('every combat card, up to the cap', () => {
    const kept = position(['Risky Blow', 'Concealment', 'Dodge', 'Vanishment', 'Escape']);
    expect(kept).toHaveLength(3);
  });
});
