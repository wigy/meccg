/**
 * @module ai/h2/modules/health/health.test
 *
 * Storing an ordinary item *gives up* marshalling points — it scores nothing
 * in the out-of-play pile — and how much that costs depends on what a point in
 * its source is worth. Transferring moves no points at all, and is scored as
 * the neutral action it is rather than given an invented preference.
 */

import { describe, test, expect } from 'vitest';
import { CardStatus, loadCardPool } from '@meccg/shared';
import type { CardDefinition, GameAction, PlayerView } from '@meccg/shared';
import type { ModuleContext } from '../../core/types.js';
import { DEFAULT_TUNABLES } from '../../core/tunables.js';
import { computeStanding } from '../../services/standing.js';
import { testMarshallingPoints, testWinProbModel } from '../../test-support.js';
import { loadScenario, scenarioView } from '../../scenario-store.js';
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

describe('salvaging the items of a character just eliminated', () => {
  // Passing discards every item not salvaged, so salvaging keeps the item. It
  // had no owner, and the AI threw away what the fallen carried — where the
  // human, in recorded game mu6un0sq-qitwwa, salvaged a Dagger and a Cram.
  test('beats passing, which discards the items', () => {
    const scenario = loadScenario('combat/salvage-items-of-the-fallen');
    const view = scenarioView(scenario);
    const context: ModuleContext = {
      view,
      cardPool: loadCardPool(),
      legalActions: view.legalActions.filter(e => e.viable).map(e => e.action),
      tunables: DEFAULT_TUNABLES,
      standing: computeStanding(view, testWinProbModel(), DEFAULT_TUNABLES),
    };
    const salvages = context.legalActions.filter(a => a.type === 'salvage-item');
    expect(salvages.length).toBeGreaterThan(0);
    for (const salvage of salvages) {
      const evaluation = healthModule.evaluate(salvage, context)!;
      expect(evaluation.utility).toBeGreaterThan(0);
      expect(JSON.stringify(evaluation.rationale)).toContain('the card kept');
    }
  });
});

describe('a free untap or heal (Hall of Fire)', () => {
  // Offered after a company's movement/hazard phase at a haven, optional and
  // costless. It had no owner, so `pass` won it every time.
  const RESTORE = {
    type: 'restore-character-by-effect', player: 'p1', characterInstanceId: 'hero-1',
  } as unknown as GameAction;
  const withStatus = (status: CardStatus): ModuleContext => {
    const base = contextWith(BALANCED, BALANCED);
    const hero = base.view.self.characters['hero-1' as never];
    const view = {
      ...base.view,
      self: { ...base.view.self, characters: { 'hero-1': { ...hero, status } } },
    } as unknown as PlayerView;
    return { ...base, view, standing: computeStanding(view, testWinProbModel(), DEFAULT_TUNABLES) };
  };

  test('heals a wounded character a turn sooner than the haven would', () => {
    const evaluation = healthModule.evaluate(RESTORE, withStatus(CardStatus.Inverted))!;
    expect(evaluation.expectedTsd).toBeCloseTo(
      DEFAULT_TUNABLES.woundTempoCost - DEFAULT_TUNABLES.tapTempoCost, 9,
    );
    expect(evaluation.utility).toBeGreaterThan(0);
  });

  test('is worth nothing as an untap, which the next untap phase gives anyway', () => {
    const evaluation = healthModule.evaluate(RESTORE, withStatus(CardStatus.Tapped))!;
    expect(evaluation.expectedTsd).toBe(0);
  });
});
