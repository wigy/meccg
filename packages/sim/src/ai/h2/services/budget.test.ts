/**
 * @module ai/h2/services/budget.test
 *
 * The budget is constraints, not preferences, so the tests are about the two
 * places a naive reading gets them wrong: direct influence already committed
 * to followers is not available for an influence attempt, and neither is the
 * influence of a character who cannot tap.
 */

import { describe, test, expect } from 'vitest';
import { CardStatus } from '@meccg/shared';
import type { CardDefinition, CompanyId, PlayerView } from '@meccg/shared';
import { computeBudget } from './budget.js';

const LEADER = 'tw-leader';
const FOLLOWER = 'tw-follower';

const POOL = {
  [LEADER]: { name: 'Leader', cardType: 'hero-character', mind: 4, marshallingPoints: 1 },
  [FOLLOWER]: { name: 'Follower', cardType: 'hero-character', mind: 3, marshallingPoints: 1 },
} as unknown as Readonly<Record<string, CardDefinition>>;

/** One character's shape in the view. */
interface CharSpec {
  readonly id: string;
  readonly definitionId?: string;
  readonly di?: number;
  readonly status?: CardStatus;
  readonly followers?: readonly string[];
}

/** A view with one company of the given characters. */
function viewWith(specs: readonly CharSpec[], used = 0): PlayerView {
  const characters: Record<string, unknown> = {};
  for (const spec of specs) {
    characters[spec.id] = {
      instanceId: spec.id,
      definitionId: spec.definitionId ?? LEADER,
      status: spec.status ?? CardStatus.Untapped,
      items: [],
      allies: [],
      hazards: [],
      followers: spec.followers ?? [],
      effectiveStats: { prowess: 5, body: 7, directInfluence: spec.di ?? 0, corruptionPoints: 0 },
    };
  }
  return {
    self: {
      id: 'p1',
      characters,
      companies: [{ id: 'company', characters: specs.map(s => s.id) }],
      cardsInPlay: [],
      generalInfluence: 20,
      generalInfluenceUsed: used,
    },
    opponent: { characters: {}, cardsInPlay: [] },
  } as unknown as PlayerView;
}

const COMPANY = 'company' as unknown as CompanyId;

describe('general influence', () => {
  test('reports what is left of the pool', () => {
    const budget = computeBudget(viewWith([{ id: 'a' }], 13), POOL);
    expect(budget.generalInfluence).toBe(20);
    expect(budget.generalInfluenceUsed).toBe(13);
    expect(budget.freeGeneralInfluence).toBe(7);
  });
});

describe('direct influence', () => {
  test('subtracts the mind of every follower the holder controls', () => {
    // 5 printed DI holding a mind-3 follower brings 2 to an influence attempt,
    // not 5 — the rest is already spent holding him.
    const view = viewWith([
      { id: 'leader', di: 5, followers: ['follower'] },
      { id: 'follower', definitionId: FOLLOWER },
    ]);
    const budget = computeBudget(view, POOL);
    expect(budget.characters['leader'].directInfluence).toBe(5);
    expect(budget.characters['leader'].freeDirectInfluence).toBe(2);
  });

  test('leaves a character with no followers at its printed value', () => {
    const budget = computeBudget(viewWith([{ id: 'solo', di: 3 }]), POOL);
    expect(budget.characters['solo'].freeDirectInfluence).toBe(3);
  });

  test('reports the mind a character costs, and zero for a definition without one', () => {
    const budget = computeBudget(viewWith([{ id: 'a' }, { id: 'b', definitionId: 'unknown' }]), POOL);
    expect(budget.characters['a'].mind).toBe(4);
    expect(budget.characters['b'].mind).toBe(0);
  });
});

describe('who can actually attempt an influence check', () => {
  test('is the untapped character with the most free influence', () => {
    const view = viewWith([
      { id: 'strong', di: 6, status: CardStatus.Untapped },
      { id: 'weak', di: 2, status: CardStatus.Untapped },
    ]);
    expect(computeBudget(view, POOL).bestInfluencerIn(COMPANY)?.instanceId).toBe('strong');
  });

  test('ignores a tapped character however much influence it has', () => {
    // `reducer-site.ts` validates that the influencing character is untapped,
    // so a tapped character's influence is worth nothing this turn — which is
    // exactly why tapping one is more expensive than a flat tempo constant.
    const view = viewWith([
      { id: 'strong', di: 9, status: CardStatus.Tapped },
      { id: 'weak', di: 2, status: CardStatus.Untapped },
    ]);
    expect(computeBudget(view, POOL).bestInfluencerIn(COMPANY)?.instanceId).toBe('weak');
  });

  test('is null when the whole company is tapped', () => {
    const view = viewWith([{ id: 'a', di: 5, status: CardStatus.Tapped }]);
    expect(computeBudget(view, POOL).bestInfluencerIn(COMPANY)).toBeNull();
  });

  test('is null for a company that does not exist', () => {
    const budget = computeBudget(viewWith([{ id: 'a' }]), POOL);
    expect(budget.bestInfluencerIn('nope' as unknown as CompanyId)).toBeNull();
  });
});

describe('taps', () => {
  test('counts only untapped characters, and wounded ones do not count', () => {
    const view = viewWith([
      { id: 'ready' },
      { id: 'tapped', status: CardStatus.Tapped },
      { id: 'hurt', status: CardStatus.Inverted },
    ]);
    const budget = computeBudget(view, POOL);
    expect(budget.tapsAvailable).toBe(1);
    expect(budget.untappedIn(COMPANY).map(c => c.instanceId as string)).toEqual(['ready']);
  });
});

describe('afterInfluenceMove', () => {
  test('stacking a general-influence character frees the pool, spends the holder', () => {
    const view = viewWith([
      { id: 'holder', di: 5 },
      { id: 'walker', definitionId: FOLLOWER },
    ], 7); // both minds charged: 4 + 3
    const budget = computeBudget(view, POOL);
    const moved = budget.afterInfluenceMove(
      'walker' as never, 'holder' as never);
    expect(moved.freeGeneralInfluence).toBe(20 - 7 + 3);
    expect(moved.freeDirectInfluence['holder']).toBe(5 - 3);
    expect(budget.freeGeneralInfluence).toBe(13); // pure: the budget is unchanged
  });

  test('un-stacking charges the pool and returns the holder\'s influence', () => {
    const view = viewWith([
      { id: 'holder', di: 5, followers: ['walker'] },
      { id: 'walker', definitionId: FOLLOWER },
    ], 4); // only the holder's mind is charged
    const budget = computeBudget(view, POOL);
    expect(budget.characters['holder'].freeDirectInfluence).toBe(2);
    const moved = budget.afterInfluenceMove('walker' as never, 'general' as never);
    expect(moved.freeGeneralInfluence).toBe(20 - 4 - 3);
    expect(moved.freeDirectInfluence['holder']).toBe(5);
  });

  test('a re-stack between holders moves nothing through the pool', () => {
    const view = viewWith([
      { id: 'holder', di: 5, followers: ['walker'] },
      { id: 'other', di: 4 },
      { id: 'walker', definitionId: FOLLOWER },
    ], 8); // holder + other minds charged
    const budget = computeBudget(view, POOL);
    const moved = budget.afterInfluenceMove('walker' as never, 'other' as never);
    expect(moved.freeGeneralInfluence).toBe(budget.freeGeneralInfluence);
    expect(moved.freeDirectInfluence['holder']).toBe(5);
    expect(moved.freeDirectInfluence['other']).toBe(4 - 3);
  });
});
