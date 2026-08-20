/**
 * @module ai/h2/modules/health/health.test
 *
 * Storing an ordinary item *gives up* marshalling points — it scores nothing
 * in the out-of-play pile — and how much that costs depends on what a point in
 * its source is worth. Transferring moves no points at all, and is scored as
 * the neutral action it is rather than given an invented preference.
 */

import { describe, test, expect } from 'vitest';
import { CardStatus } from '@meccg/shared';
import type { CardDefinition, GameAction, PlayerView } from '@meccg/shared';
import type { ModuleContext } from '../../core/types.js';
import { DEFAULT_TUNABLES } from '../../core/tunables.js';
import { computeStanding } from '../../services/standing.js';
import { testMarshallingPoints, testWinProbModel } from '../../test-support.js';
import { healthModule } from './health.js';

const HERO = 'tw-hero';
const PLAIN = 'tw-plain-item';
const TREASURE = 'tw-treasure';

const POOL = {
  [HERO]: { name: 'Bilbo', cardType: 'hero-character', mind: 3 },
  [PLAIN]: { name: 'A Sword', marshallingPoints: 2, marshallingCategory: 'item' },
  [TREASURE]: {
    name: 'A Hoard',
    marshallingPoints: 1,
    marshallingCategory: 'item',
    effects: [{ type: 'storable-at', marshallingPoints: 5 }],
  },
} as unknown as Readonly<Record<string, CardDefinition>>;

/** A store or transfer action naming one of the carried items. */
function act(type: string, definitionId: string): GameAction {
  return { type, itemInstanceId: `item-${definitionId}` } as unknown as GameAction;
}

/** A context carrying both items, with the given standing. */
function contextWith(self: Record<string, number>, opponent: Record<string, number>): ModuleContext {
  const view = {
    self: {
      id: 'p1',
      marshallingPoints: testMarshallingPoints(self),
      hand: [],
      characters: {
        'hero-1': {
          instanceId: 'hero-1',
          definitionId: HERO,
          status: CardStatus.Untapped,
          items: [PLAIN, TREASURE].map(d => ({ instanceId: `item-${d}`, definitionId: d })),
          allies: [], hazards: [], followers: [],
          effectiveStats: { prowess: 3, body: 7, directInfluence: 0, corruptionPoints: 0 },
        },
      },
      companies: [{ id: 'company', characters: ['hero-1'] }],
      cardsInPlay: [],
      generalInfluence: 20,
      generalInfluenceUsed: 3,
    },
    opponent: { marshallingPoints: testMarshallingPoints(opponent), characters: {}, cardsInPlay: [] },
    turnNumber: 20,
  } as unknown as PlayerView;
  return {
    view,
    cardPool: POOL,
    legalActions: [act('store-item', PLAIN)],
    tunables: DEFAULT_TUNABLES,
    standing: computeStanding(view, testWinProbModel(), DEFAULT_TUNABLES),
  };
}

const BALANCED = { character: 3, item: 3, faction: 3, ally: 3 };

describe('storing', () => {
  test('an ordinary item gives up its points, so the store is negative', () => {
    const evaluation = healthModule.evaluate(act('store-item', PLAIN), contextWith(BALANCED, BALANCED))!;
    expect(evaluation.expectedTsd).toBeLessThan(0);
    expect(evaluation.outcomes[0].label).toContain('gives up');
  });

  test('an item that pays more stored than carried is worth storing', () => {
    const evaluation = healthModule.evaluate(act('store-item', TREASURE), contextWith(BALANCED, BALANCED))!;
    expect(evaluation.expectedTsd).toBeGreaterThan(0);
  });

  test('costs nothing to store when the item source is capped anyway', () => {
    // The points were not counting, so giving them up costs nothing — the
    // same arithmetic that makes chasing a capped source pointless.
    const capped = contextWith({ character: 2, item: 8, faction: 2, ally: 2 }, BALANCED);
    expect(capped.standing.marginal.item).toBe(0);
    const evaluation = healthModule.evaluate(act('store-item', PLAIN), capped)!;
    expect(evaluation.expectedTsd).toBe(0);
  });
});

describe('transferring', () => {
  test('moves no marshalling points and is scored as neutral', () => {
    const evaluation = healthModule.evaluate(act('transfer-item', PLAIN), contextWith(BALANCED, BALANCED))!;
    expect(evaluation.expectedTsd).toBe(0);
    expect(evaluation.outcomes).toHaveLength(1);
    expect(JSON.stringify(evaluation.rationale)).toContain('not what it scores');
  });

  test('says why it is neutral rather than leaving the zero unexplained', () => {
    const evaluation = healthModule.evaluate(act('transfer-item', PLAIN), contextWith(BALANCED, BALANCED))!;
    expect(evaluation.assumptions.some(a => a.includes('are not invented here'))).toBe(true);
  });

  test('a bearer with no corruption points still transfers at zero — the check cannot fail', () => {
    const context = contextWith(BALANCED, BALANCED);
    const action = {
      type: 'transfer-item', itemInstanceId: `item-${PLAIN}`, fromCharacterId: 'hero-1', toCharacterId: 'hero-2',
    } as unknown as GameAction;
    const evaluation = healthModule.evaluate(action, context)!;
    expect(evaluation.expectedTsd).toBe(0);
  });

  test('a second transfer of the same item this turn is charged, so it no longer ties with pass', () => {
    // game mt1j9m0i-5d4lze, turn 7: with every company member at corruption 0
    // or 1, `checkRisk` correctly prices each hop's check at zero (2d6 cannot
    // roll under 2), so without `repeatedTransferCost` every hop ties with
    // `pass` and the agent's tie-break prefers to act — the item toured all
    // five characters, one hop per decision, for nothing.
    const context = contextWith(BALANCED, BALANCED);
    const action = {
      type: 'transfer-item', itemInstanceId: `item-${PLAIN}`, fromCharacterId: 'hero-1', toCharacterId: 'hero-2',
    } as unknown as GameAction;

    const firstHop = healthModule.evaluate(action, context)!;
    expect(firstHop.expectedTsd).toBe(0);

    const secondHop = healthModule.evaluate(action, { ...context, itemTransfers: { [`item-${PLAIN}`]: 1 } })!;
    expect(secondHop.expectedTsd).toBeLessThan(0);
    expect(JSON.stringify(secondHop.rationale)).toContain('already transferred this turn');
  });

  test('a bearer who would risk failing the enqueued check makes the transfer costly, not neutral', () => {
    // CoE 2.II.5: transferring enqueues a corruption check on the giving
    // bearer unconditionally. A bearer already carrying corruption points can
    // fail that check and be discarded (CoE 7.1) — a real cost the AI must
    // not treat as free, or it shuffles items around for no reason (game
    // msuhv0u9-w8joja, turn 2: five corruption checks moving two items that
    // could have been transferred directly).
    const context = contextWith(BALANCED, BALANCED);
    const characters = context.view.self.characters as unknown as
      Record<string, { effectiveStats: { corruptionPoints: number } }>;
    characters['hero-1'].effectiveStats.corruptionPoints = 5;
    const action = {
      type: 'transfer-item', itemInstanceId: `item-${PLAIN}`, fromCharacterId: 'hero-1', toCharacterId: 'hero-2',
    } as unknown as GameAction;
    const evaluation = healthModule.evaluate(action, context)!;
    expect(evaluation.expectedTsd).toBeLessThan(0);
    expect(JSON.stringify(evaluation.rationale)).toContain('corruption check risked');
  });
});

describe('what it declines', () => {
  test('an action naming an item it cannot find', () => {
    const unknown = { type: 'store-item', itemInstanceId: 'nope' } as unknown as GameAction;
    expect(healthModule.evaluate(unknown, contextWith(BALANCED, BALANCED))).toBeNull();
  });
});
