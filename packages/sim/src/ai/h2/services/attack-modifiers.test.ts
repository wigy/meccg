/**
 * @module ai/h2/services/attack-modifiers.test
 *
 * What the modifier reader may and may not credit.
 *
 * The policy is asymmetric on purpose: a condition this cannot check drops the
 * whole modifier, because crediting a boost the engine will not apply is worse
 * than missing one. That makes the *readable* shapes worth pinning — a shape
 * that silently stops being read costs the AI the card entirely, which is
 * exactly what happened to Full of Froth and Rage.
 */

import { describe, expect, test } from 'vitest';
import { loadCardPool } from '@meccg/shared';
import type { CardDefinition, PlayerView } from '@meccg/shared';
import { ALL_RACES, attackBoostOf, conditionOf } from './attack-modifiers.js';

const cardPool = loadCardPool();

/** A view with nothing in play, which is all these cases need. */
const bareView = {
  self: { cardsInPlay: [] },
  opponent: { cardsInPlay: [] },
} as unknown as PlayerView;

/** The definition of a card by printed name. */
function byName(name: string): CardDefinition {
  const id = Object.keys(cardPool).find(key =>
    (cardPool[key] as unknown as { name?: string }).name === name);
  expect(id).toBeDefined();
  return cardPool[id!];
}

describe('conditionOf', () => {
  test('an absent clause applies to every attack', () => {
    expect(conditionOf(undefined, bareView, cardPool)).toEqual({ races: [ALL_RACES], applies: true });
  });

  test('a bare race names that race', () => {
    expect(conditionOf({ 'enemy.race': 'orc' }, bareView, cardPool))
      .toEqual({ races: ['orc'], applies: true });
  });

  test('a race list names every race in it', () => {
    // Full of Froth and Rage's shape. Read as a string check, this clause fell
    // through and took the whole modifier with it.
    expect(conditionOf({ 'enemy.race': { $in: ['spider', 'animal'] } }, bareView, cardPool))
      .toEqual({ races: ['spider', 'animal'], applies: true });
  });

  test('an unreadable clause is still dropped rather than assumed', () => {
    expect(conditionOf({ 'enemy.race': { $nin: ['orc'] } }, bareView, cardPool)).toBeNull();
    expect(conditionOf({ 'something.else': 'x' }, bareView, cardPool)).toBeNull();
    expect(conditionOf({ 'enemy.race': { $in: [] } }, bareView, cardPool)).toBeNull();
  });

  test('an inPlay clause is false until the card it names is out', () => {
    expect(conditionOf({ inPlay: 'Doors of Night' }, bareView, cardPool)?.applies).toBe(false);
    // The card being priced counts as in play in the arm where it is played.
    expect(conditionOf({ inPlay: 'Doors of Night' }, bareView, cardPool, 'Doors of Night')?.applies)
      .toBe(true);
  });
});

describe('attackBoostOf', () => {
  test('reads a modifier that names two races at once', () => {
    // "All Spider and Animal attacks receive +2 prowess." Before the list shape
    // was read this returned null, so the AI could not see that the card did
    // anything: it never played it, never planned around it, and priced it at
    // nothing to keep.
    const boost = attackBoostOf(byName('Full of Froth and Rage'), bareView, cardPool);
    expect(boost).not.toBeNull();
    expect(boost!.get('spider')).toEqual({ prowess: 2, strikes: 0 });
    expect(boost!.get('animal')).toEqual({ prowess: 2, strikes: 0 });
    // And nothing else: an Orc attack is not a Spider or Animal one.
    expect(boost!.get('orc')).toBeUndefined();
    expect(boost!.get(ALL_RACES)).toBeUndefined();
  });

  test('still reads a single-race modifier', () => {
    const boost = attackBoostOf(byName('Minions Stir'), bareView, cardPool);
    expect(boost).not.toBeNull();
    expect(boost!.get('orc')?.prowess).toBeGreaterThan(0);
  });

  test('declines a card that declares no all-attacks modifier', () => {
    // Doors of Night's value is that other cards name it, not what it declares.
    expect(attackBoostOf(byName('Doors of Night'), bareView, cardPool)).toBeNull();
  });
});
