import { describe, test, expect } from 'vitest';
import type { CardDefinition, GameAction, PlayerView } from '@meccg/shared';
import { setupEvaluator } from './setup.js';
import type { AiContext } from '../strategy.js';

// Black Arrow (tw-494): Warrior only, tap for -1/-1; discards on tap if the
// bearer isn't a Man.
const BLACK_ARROW: CardDefinition = {
  cardType: 'hero-resource-item',
  id: 'tw-494',
  name: 'Black Arrow',
  prowessModifier: 0,
  bodyModifier: 0,
  effects: [
    {
      type: 'modify-attack',
      cost: { tap: 'self' },
      prowessModifier: -1,
      bodyModifier: -1,
      when: { 'bearer.skills': { $includes: 'warrior' } },
      discardIfBearerNot: { race: ['man'] },
    },
  ],
} as unknown as CardDefinition;

// Elrohir (tw-144): Elf, Warrior/Ranger, prowess 5.
const ELROHIR: CardDefinition = {
  cardType: 'hero-character',
  id: 'tw-144',
  name: 'Elrohir',
  race: 'elf',
  skills: ['warrior', 'ranger'],
  prowess: 5,
} as unknown as CardDefinition;

// Beorn (tw-126): Man, Warrior/Ranger, prowess 7.
const BEORN: CardDefinition = {
  cardType: 'hero-character',
  id: 'tw-126',
  name: 'Beorn',
  race: 'man',
  skills: ['warrior', 'ranger'],
  prowess: 7,
} as unknown as CardDefinition;

// Gandalf-ish non-warrior for the "when" gate case: a Man, but no warrior skill.
const NON_WARRIOR_MAN: CardDefinition = {
  cardType: 'hero-character',
  id: 'tw-999',
  name: 'Loremaster',
  race: 'man',
  skills: ['loremaster'],
  prowess: 3,
} as unknown as CardDefinition;

const POOL: Record<string, CardDefinition> = {
  'tw-494': BLACK_ARROW,
  'tw-144': ELROHIR,
  'tw-126': BEORN,
  'tw-999': NON_WARRIOR_MAN,
};

function makeView(characters: Record<string, { definitionId: string; prowess: number }>): PlayerView {
  return {
    self: {
      characters: Object.fromEntries(
        Object.entries(characters).map(([id, c]) => [
          id,
          { instanceId: id, definitionId: c.definitionId, effectiveStats: { prowess: c.prowess } },
        ]),
      ),
    },
  } as unknown as PlayerView;
}

function assignStartingItem(characterInstanceId: string): GameAction {
  return { type: 'assign-starting-item', player: 'p2', itemDefId: 'tw-494', characterInstanceId } as unknown as GameAction;
}

describe('setupEvaluator assign-starting-item', () => {
  test('prefers a Man bearer over an Elf bearer for a discard-if-not-Man item, even with lower prowess', () => {
    const view = makeView({
      elrohir: { definitionId: 'tw-144', prowess: 5 },
      beorn: { definitionId: 'tw-126', prowess: 7 },
    });
    const context: AiContext = { view, cardPool: POOL, legalActions: [assignStartingItem('elrohir'), assignStartingItem('beorn')] };

    const elrohirScore = setupEvaluator.score(assignStartingItem('elrohir'), context);
    const beornScore = setupEvaluator.score(assignStartingItem('beorn'), context);

    expect(beornScore).toBeGreaterThan(elrohirScore ?? -Infinity);
  });

  test('heavily penalizes a bearer who cannot meet the item\'s activation gate at all', () => {
    const view = makeView({
      beorn: { definitionId: 'tw-126', prowess: 7 },
      loremaster: { definitionId: 'tw-999', prowess: 3 },
    });
    const context: AiContext = { view, cardPool: POOL, legalActions: [assignStartingItem('beorn'), assignStartingItem('loremaster')] };

    const beornScore = setupEvaluator.score(assignStartingItem('beorn'), context);
    const loremasterScore = setupEvaluator.score(assignStartingItem('loremaster'), context);

    expect(beornScore).toBeGreaterThan(loremasterScore ?? Infinity);
  });
});
