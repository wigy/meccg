/**
 * @module ai/h2/modules/combat/mp-value.test
 *
 * What a combat outcome costs in marshalling points. The salvage rule is the
 * part worth pinning: the same character loses very different amounts
 * depending on who is standing next to him, and a model that ignored it would
 * refuse to defend with anyone carrying items.
 */

import { describe, test, expect } from 'vitest';
import type { CardDefinition, CardInstanceId, CombatState, PlayerView } from '@meccg/shared';
import { CardStatus } from '@meccg/shared';
import { attackStillDefeatable, eliminationCost, killMpOnOffer, strikeCompletesTheAttack } from './mp-value.js';

const HERO = 'tw-hero' as const;
const MAJOR_ITEM = 'tw-major' as const;
const MINOR_ITEM = 'tw-minor' as const;
const CREATURE = 'tw-creature' as const;

const POOL = {
  [HERO]: { marshallingPoints: 3, marshallingCategory: 'character', body: 7 },
  [MAJOR_ITEM]: { marshallingPoints: 2, marshallingCategory: 'item' },
  [MINOR_ITEM]: { marshallingPoints: 1, marshallingCategory: 'item' },
  [CREATURE]: { killMarshallingPoints: 4 },
} as unknown as Readonly<Record<string, CardDefinition>>;

/** A view with one company: a bearer carrying items, plus companions. */
function viewWith(
  items: readonly string[],
  companions: readonly { id: string; status: CardStatus }[],
): PlayerView {
  const characters: Record<string, unknown> = {
    bearer: {
      instanceId: 'bearer',
      definitionId: HERO,
      status: CardStatus.Untapped,
      items: items.map((definitionId, i) => ({ instanceId: `item-${i}`, definitionId })),
      allies: [],
      hazards: [],
    },
  };
  for (const companion of companions) {
    characters[companion.id] = {
      instanceId: companion.id,
      definitionId: HERO,
      status: companion.status,
      items: [],
      allies: [],
      hazards: [],
    };
  }
  return {
    self: { id: 'p1', characters, cardsInPlay: [], companies: [] },
    opponent: { characters: {}, cardsInPlay: [] },
  } as unknown as PlayerView;
}

/** The company's character list, bearer first. */
function company(companions: readonly string[]): readonly CardInstanceId[] {
  return ['bearer', ...companions] as unknown as readonly CardInstanceId[];
}

describe('the cost of losing a character', () => {
  test('is its own marshalling points when it carries nothing', () => {
    const cost = eliminationCost(viewWith([], []), POOL, 'bearer' as CardInstanceId, company([]));
    expect(cost.characterMp).toBe(3);
    expect(cost.lostItemMp).toBe(0);
    expect(cost.delta).toEqual({ character: -3 });
  });

  test('includes every item when nobody is left to salvage them', () => {
    const cost = eliminationCost(viewWith([MAJOR_ITEM, MINOR_ITEM], []), POOL, 'bearer' as CardInstanceId, company([]));
    expect(cost.lostItemMp).toBe(3);
    expect(cost.delta).toEqual({ character: -3, item: -3 });
  });

  test('lets each unwounded companion rescue one item (CoE 3.I.2)', () => {
    const view = viewWith([MAJOR_ITEM, MINOR_ITEM], [{ id: 'friend', status: CardStatus.Untapped }]);
    const cost = eliminationCost(view, POOL, 'bearer' as CardInstanceId, company(['friend']));
    // One rescuer takes the major item; the minor one is lost.
    expect(cost.salvageableItems).toBe(1);
    expect(cost.lostItemMp).toBe(1);
  });

  test('rescues the most valuable items first', () => {
    const view = viewWith([MINOR_ITEM, MAJOR_ITEM], [{ id: 'friend', status: CardStatus.Untapped }]);
    expect(eliminationCost(view, POOL, 'bearer' as CardInstanceId, company(['friend'])).lostItemMp).toBe(1);
  });

  test('does not count a wounded companion as a rescuer', () => {
    const view = viewWith([MAJOR_ITEM], [{ id: 'hurt', status: CardStatus.Inverted }]);
    const cost = eliminationCost(view, POOL, 'bearer' as CardInstanceId, company(['hurt']));
    expect(cost.salvageableItems).toBe(0);
    expect(cost.lostItemMp).toBe(2);
  });

  test('counts a tapped companion, who may still salvage', () => {
    const view = viewWith([MAJOR_ITEM], [{ id: 'tired', status: CardStatus.Tapped }]);
    expect(eliminationCost(view, POOL, 'bearer' as CardInstanceId, company(['tired'])).lostItemMp).toBe(0);
  });
});

/** A combat state with the given attack source and assignments. */
function combatWith(overrides: Partial<CombatState>): CombatState {
  return {
    attackSource: { type: 'creature', instanceId: 'creature-1' },
    detainment: false,
    currentStrikeIndex: 0,
    strikeAssignments: [{ characterId: 'bearer', excessStrikes: 0, resolved: false }],
    ...overrides,
  } as unknown as CombatState;
}

/** A view in which the attacking creature is visible in play. */
function viewWithCreature(): PlayerView {
  return {
    self: { characters: {}, cardsInPlay: [] },
    opponent: {
      characters: {},
      cardsInPlay: [{ instanceId: 'creature-1', definitionId: CREATURE }],
    },
  } as unknown as PlayerView;
}

describe('kill marshalling points', () => {
  test('come from the creature card that is attacking', () => {
    expect(killMpOnOffer(POOL, combatWith({}), viewWithCreature())).toBe(4);
  });

  test('are zero for a detainment attack (CoE 3.II.3)', () => {
    expect(killMpOnOffer(POOL, combatWith({ detainment: true }), viewWithCreature())).toBe(0);
  });

  test('are zero for a site automatic attack — there is no card to claim', () => {
    const combat = combatWith({ attackSource: { type: 'automatic-attack', siteInstanceId: 's', attackIndex: 0 } as never });
    expect(killMpOnOffer(POOL, combat, viewWithCreature())).toBe(0);
  });
});

describe('when the points are actually banked', () => {
  const assignments = (results: readonly (string | undefined)[]): CombatState =>
    combatWith({
      currentStrikeIndex: 0,
      strikeAssignments: results.map(result => ({
        characterId: 'bearer',
        excessStrikes: 0,
        resolved: result !== undefined,
        result,
      })) as never,
    });

  test('a lone strike completes the attack by itself', () => {
    expect(strikeCompletesTheAttack(assignments([undefined]))).toBe(true);
  });

  test('a strike with another still unresolved does not', () => {
    expect(strikeCompletesTheAttack(assignments([undefined, undefined]))).toBe(false);
  });

  test('a strike does complete it once every other one is defeated', () => {
    expect(strikeCompletesTheAttack(assignments([undefined, 'success']))).toBe(true);
  });

  test('an attack with a strike already through can never be banked', () => {
    // Kill MP is all-or-nothing, so the term has to drop to zero rather than
    // lingering as optimism about a creature that is going to the discard pile.
    expect(attackStillDefeatable(assignments([undefined, 'wounded']))).toBe(false);
    expect(attackStillDefeatable(assignments([undefined, 'tie']))).toBe(false);
    expect(attackStillDefeatable(assignments([undefined, 'success']))).toBe(true);
  });
});
