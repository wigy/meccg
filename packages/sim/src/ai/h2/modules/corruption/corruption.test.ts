/**
 * @module ai/h2/modules/corruption/corruption.test
 *
 * What a failed corruption check costs is not the printed total on the cards
 * that leave play — it is what those points were worth in this standing,
 * source by source. These tests pin that, and the exactness of the odds the
 * engine publishes.
 */

import { describe, test, expect } from 'vitest';
import { CardStatus } from '@meccg/shared';
import type { CardDefinition, GameAction, PlayerView } from '@meccg/shared';
import type { ModuleContext } from '../../core/types.js';
import { DEFAULT_TUNABLES } from '../../core/tunables.js';
import { computeStanding } from '../../services/standing.js';
import { testMarshallingPoints, testWinProbModel } from '../../test-support.js';
import { corruptionModule } from './corruption.js';

const HERO = 'tw-hero';
const RING = 'tw-ring';

const POOL = {
  [HERO]: { name: 'Frodo', cardType: 'hero-character', mind: 4, marshallingPoints: 1, marshallingCategory: 'character' },
  [RING]: { name: 'The One Ring', marshallingPoints: 4, marshallingCategory: 'item' },
} as unknown as Readonly<Record<string, CardDefinition>>;

const CHECK = {
  type: 'corruption-check',
  characterId: 'hero-1',
  corruptionPoints: 5,
  corruptionModifier: 0,
  possessions: ['ring-1'],
  need: 6,
} as unknown as GameAction;

/** A context whose standing gives item points the stated marginal value. */
function contextWith(
  self: Record<string, number>,
  opponent: Record<string, number>,
  action: GameAction = CHECK,
  extra: readonly GameAction[] = [],
): ModuleContext {
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
          items: [{ instanceId: 'ring-1', definitionId: RING }],
          allies: [], hazards: [], followers: [],
          effectiveStats: { prowess: 3, body: 7, directInfluence: 0, corruptionPoints: 5 },
        },
      },
      companies: [{ id: 'company', characters: ['hero-1'] }],
      cardsInPlay: [],
      generalInfluence: 20,
      generalInfluenceUsed: 4,
    },
    opponent: { marshallingPoints: testMarshallingPoints(opponent), characters: {}, cardsInPlay: [] },
    turnNumber: 20,
  } as unknown as PlayerView;
  return {
    view,
    cardPool: POOL,
    legalActions: [action, ...extra],
    tunables: DEFAULT_TUNABLES,
    standing: computeStanding(view, testWinProbModel(), DEFAULT_TUNABLES),
  };
}

const BALANCED = { character: 3, item: 3, faction: 3, ally: 3 };

describe('the odds', () => {
  test('come from the target the engine publishes', () => {
    const evaluation = corruptionModule.evaluate(CHECK, contextWith(BALANCED, BALANCED))!;
    const held = evaluation.outcomes.find(o => o.label.includes('holds'))!;
    expect(held.p).toBeCloseTo(26 / 36, 12);
  });

  test('always produce a distribution summing to 1', () => {
    for (const need of [2, 6, 9, 12]) {
      const action = { ...CHECK, need } as unknown as GameAction;
      const evaluation = corruptionModule.evaluate(action, contextWith(BALANCED, BALANCED, action))!;
      expect(evaluation.outcomes.reduce((sum, o) => sum + o.p, 0)).toBeCloseTo(1, 12);
    }
  });

  test('a check that cannot fail has one outcome and risks nothing', () => {
    // Risks nothing, and is still worth taking: it releases the organization
    // phase, which is the only thing a check that cannot fail can be about.
    const safe = { ...CHECK, need: 2 } as unknown as GameAction;
    const evaluation = corruptionModule.evaluate(safe, contextWith(BALANCED, BALANCED, safe))!;
    expect(evaluation.outcomes).toHaveLength(1);
    expect(evaluation.sigmaTsd).toBe(0);
    expect(evaluation.expectedTsd).toBeCloseTo(DEFAULT_TUNABLES.gatingResolutionTsd, 9);
  });
});

describe('what is at stake', () => {
  test('counts the character and everything the action says leaves with it', () => {
    const evaluation = corruptionModule.evaluate(CHECK, contextWith(BALANCED, BALANCED))!;
    const lost = evaluation.outcomes.find(o => o.label.includes('corrupted'))!;
    expect(lost.label).toContain('Frodo');
    expect(lost.label).toContain('The One Ring');
    expect(lost.dtsd).toBeLessThan(0);
  });

  test('is worth more when the item source doubles, and less when it is capped', () => {
    // The same ring, the same check — only the standing differs. A linear
    // reading of "4 item MP" cannot tell these two positions apart.
    const doubled = corruptionModule.evaluate(CHECK, contextWith(
      { character: 4, item: 4, faction: 4, ally: 4 },
      { character: 4, item: 0, faction: 4, ally: 4 },
    ))!;
    const capped = corruptionModule.evaluate(CHECK, contextWith(
      { character: 2, item: 8, faction: 2, ally: 2 },
      { character: 3, item: 3, faction: 3, ally: 3 },
    ))!;
    const risk = (e: typeof doubled): number =>
      e.outcomes.find(o => o.label.includes('corrupted'))!.dtsd;
    expect(risk(doubled)).toBeLessThan(risk(capped));
  });

  test('is worth taking, because declining does not avoid it', () => {
    // A pending check gates every other organization action until it resolves,
    // so `pass` does not buy safety — it stalls the phase in which every
    // resource has to be played. Scored as a bare risk this came out at or
    // below zero in all 43 corpus positions offering it, and H2 passed on every
    // one while the human took every one.
    const evaluation = corruptionModule.evaluate(CHECK, contextWith(BALANCED, BALANCED))!;
    expect(evaluation.expectedTsd).toBeGreaterThan(0);
  });

  test('and the risk it carries is untouched by that', () => {
    // The shift prices the decision, not the event: the corrupted outcome is
    // still a loss, and the spread between outcomes still says how dangerous
    // the roll is. Only the baseline it is measured against moved.
    const evaluation = corruptionModule.evaluate(CHECK, contextWith(BALANCED, BALANCED))!;
    const lost = evaluation.outcomes.find(o => o.label.includes('corrupted'))!;
    const held = evaluation.outcomes.find(o => o.label.includes('holds'))!;
    expect(lost.dtsd).toBeLessThan(held.dtsd);
    expect(evaluation.sigmaTsd).toBeGreaterThan(0);
  });

  test('declines an action without a published target', () => {
    const vague = { type: 'corruption-check', characterId: 'hero-1' } as unknown as GameAction;
    expect(corruptionModule.evaluate(vague, contextWith(BALANCED, BALANCED, vague))).toBeNull();
  });
});

describe('supporting somebody else\'s check', () => {
  // An untapped character "may tap for +1 each before the roll", so the whole
  // value of supporting is the failure it averts: the mass moved out of the
  // failing band, times what failing costs, less what the tap forgoes. Every
  // term is published or already priced — there is nothing to estimate.
  //
  // It is owned at all because it was not: `support-corruption-check` had no
  // module, so all 36 of the corpus disagreements on it were decided by the
  // Heuristics-1 fallback.
  const SUPPORT = {
    type: 'support-corruption-check',
    supportingCharacterId: 'hero-1',
    targetCharacterId: 'hero-1',
  } as unknown as GameAction;

  test('is worth the probability mass it moves out of the failing band', () => {
    const context = contextWith(BALANCED, BALANCED, CHECK, [SUPPORT]);
    const evaluation = corruptionModule.evaluate(SUPPORT, context)!;
    expect(evaluation).not.toBeNull();
    // need 6 → 5 on 2d6 is 26/36 → 30/36, a gain of exactly 4/36.
    expect(evaluation.outcomes[0].label).toContain('11.1%');
    expect(evaluation.module).toBe('corruption');
  });

  test('reads the odds off the check beside it, not from its own fields', () => {
    const easier = { ...CHECK, need: 4 } as unknown as GameAction;
    const context = contextWith(BALANCED, BALANCED, easier, [SUPPORT]);
    const text = JSON.stringify(corruptionModule.evaluate(SUPPORT, context)!.rationale);
    expect(text).toContain('"label":"need on 2d6","value":4');
  });

  test('declines when there is no check on the table to price', () => {
    const context = contextWith(BALANCED, BALANCED, SUPPORT);
    expect(corruptionModule.evaluate(SUPPORT, context)).toBeNull();
  });

  test('declines a check that cannot fail, where the +1 buys nothing', () => {
    const safe = { ...CHECK, need: 2 } as unknown as GameAction;
    const context = contextWith(BALANCED, BALANCED, safe, [SUPPORT]);
    expect(corruptionModule.evaluate(SUPPORT, context)).toBeNull();
  });

  test('charges the tap, and is worth less when the failure costs less', () => {
    // The whole point of pricing it rather than leaving it to a flat weight:
    // the same +1 is worth more on a check that would lose real points than on
    // one whose points the diversity cap has already taken away.
    const rich = corruptionModule.evaluate(
      SUPPORT, contextWith(BALANCED, BALANCED, CHECK, [SUPPORT]),
    )!;
    const capped = corruptionModule.evaluate(
      SUPPORT, contextWith({ character: 0, item: 40 }, { character: 0, item: 0 }, CHECK, [SUPPORT]),
    )!;
    expect(capped.expectedTsd).toBeLessThan(rich.expectedTsd);
    expect(JSON.stringify(rich.rationale)).toContain('the tap it spends');
  });
});
