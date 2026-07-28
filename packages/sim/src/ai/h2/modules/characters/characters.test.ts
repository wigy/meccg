/**
 * @module ai/h2/modules/characters/characters.test
 *
 * A character is a score, a cost and a capability at once. These tests pin the
 * part that is exact — the points, priced per source — and the part that is
 * deliberately *not* priced, because reporting the mind cost without inventing
 * a value for what it displaces is the honest shape until the roster plan
 * exists.
 */

import { describe, test, expect } from 'vitest';
import { CardStatus } from '@meccg/shared';
import type { CardDefinition, GameAction, PlayerView } from '@meccg/shared';
import type { ModuleContext } from '../../core/types.js';
import { DEFAULT_TUNABLES } from '../../core/tunables.js';
import { computeStanding } from '../../services/standing.js';
import { testMarshallingPoints, testWinProbModel } from '../../test-support.js';
import { charactersModule } from './characters.js';

const SCORER = 'tw-scorer';
const CHEAP = 'tw-cheap';

const POOL = {
  [SCORER]: { name: 'Elrond', marshallingPoints: 3, marshallingCategory: 'character', mind: 8 },
  [CHEAP]: { name: 'A Hobbit', marshallingPoints: 0, marshallingCategory: 'character', mind: 1 },
} as unknown as Readonly<Record<string, CardDefinition>>;

/** A play action naming a card in hand. */
function play(definitionId: string): GameAction {
  return { type: 'play-character', cardInstanceId: `card-${definitionId}` } as unknown as GameAction;
}

/** A context with both characters in hand and one in play. */
function contextWith(self: Record<string, number>, opponent: Record<string, number>, used = 4): ModuleContext {
  const view = {
    self: {
      id: 'p1',
      marshallingPoints: testMarshallingPoints(self),
      hand: [SCORER, CHEAP].map(d => ({ instanceId: `card-${d}`, definitionId: d })),
      characters: {
        'held-1': {
          instanceId: 'held-1',
          definitionId: SCORER,
          status: CardStatus.Untapped,
          items: [], allies: [], hazards: [], followers: [],
          effectiveStats: { prowess: 5, body: 7, directInfluence: 3, corruptionPoints: 0 },
        },
      },
      companies: [{ id: 'company', characters: ['held-1'] }],
      cardsInPlay: [],
      generalInfluence: 20,
      generalInfluenceUsed: used,
    },
    opponent: { marshallingPoints: testMarshallingPoints(opponent), characters: {}, cardsInPlay: [] },
    turnNumber: 20,
  } as unknown as PlayerView;
  return {
    view,
    cardPool: POOL,
    legalActions: [play(SCORER)],
    tunables: DEFAULT_TUNABLES,
    standing: computeStanding(view, testWinProbModel(), DEFAULT_TUNABLES),
  };
}

const BALANCED = { character: 3, item: 3, faction: 3, ally: 3 };

describe('playing a character', () => {
  test('is worth what a point in the character source is worth', () => {
    const evaluation = charactersModule.evaluate(play(SCORER), contextWith(BALANCED, BALANCED))!;
    expect(evaluation.expectedTsd).toBeGreaterThan(0);
  });

  test('is worth nothing when the character source is capped', () => {
    const capped = contextWith({ character: 8, item: 2, faction: 2, ally: 2 }, BALANCED);
    expect(capped.standing.marginal.character).toBe(0);
    expect(charactersModule.evaluate(play(SCORER), capped)!.expectedTsd).toBe(0);
  });

  test('a character with no points is neutral, not negative', () => {
    // Playing it costs mind, but mind is reported rather than priced — so the
    // module must not quietly charge for it.
    const evaluation = charactersModule.evaluate(play(CHEAP), contextWith(BALANCED, BALANCED))!;
    expect(evaluation.expectedTsd).toBe(0);
  });

  test('reports the mind against what the pool has left, without pricing it', () => {
    const evaluation = charactersModule.evaluate(play(SCORER), contextWith(BALANCED, BALANCED, 13))!;
    const text = JSON.stringify(evaluation.rationale);
    expect(text).toContain('7 of 20 general influence free');
    expect(text).toContain('reported, not priced');
    expect(evaluation.assumptions.some(a => a.includes('roster plan'))).toBe(true);
  });
});

describe('changing controller', () => {
  const move = { type: 'move-to-influence', characterId: 'held-1' } as unknown as GameAction;

  test('moves no marshalling points', () => {
    const evaluation = charactersModule.evaluate(move, contextWith(BALANCED, BALANCED))!;
    expect(evaluation.expectedTsd).toBe(0);
    expect(evaluation.outcomes[0].label).toContain('no marshalling points move');
  });

  test('reports the direct influence at stake, since that is what factions spend', () => {
    const evaluation = charactersModule.evaluate(move, contextWith(BALANCED, BALANCED))!;
    expect(JSON.stringify(evaluation.rationale)).toContain('reducer-site.ts');
  });
});

describe('what it declines', () => {
  test('an action naming a character it cannot find', () => {
    const unknown = { type: 'play-character', cardInstanceId: 'nope' } as unknown as GameAction;
    expect(charactersModule.evaluate(unknown, contextWith(BALANCED, BALANCED))).toBeNull();
  });
});
