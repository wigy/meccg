/**
 * @module ai/h2/modules/corruption/corruption.test
 *
 * What a failed corruption check costs is not the printed total on the cards
 * that leave play — it is what those points were worth in this standing,
 * source by source. These tests pin that, and the exactness of the odds the
 * engine publishes.
 */

import { describe, test, expect } from 'vitest';
import { CardStatus, computeLegalActions, loadCardPool } from '@meccg/shared';
import type { CardDefinition, GameAction, PlayerView } from '@meccg/shared';
import type { ModuleContext } from '../../core/types.js';
import { DEFAULT_TUNABLES } from '../../core/tunables.js';
import { computeStanding } from '../../services/standing.js';
import { testMarshallingPoints, testWinProbModel } from '../../test-support.js';
import { loadScenario, scenarioView } from '../../scenario-store.js';
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
function contextWith(self: Record<string, number>, opponent: Record<string, number>, action = CHECK): ModuleContext {
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
    legalActions: [action],
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
    const safe = { ...CHECK, need: 2 } as unknown as GameAction;
    const evaluation = corruptionModule.evaluate(safe, contextWith(BALANCED, BALANCED, safe))!;
    expect(evaluation.outcomes).toHaveLength(1);
    expect(evaluation.expectedTsd).toBe(0);
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

  test('declines an action without a published target', () => {
    const vague = { type: 'corruption-check', characterId: 'hero-1' } as unknown as GameAction;
    expect(corruptionModule.evaluate(vague, contextWith(BALANCED, BALANCED, vague))).toBeNull();
  });
});

describe('shedding an attached corruption card', () => {
  /** A position where a bearer is offered the roll to shake a Lure off. */
  function position() {
    const scenario = loadScenario('organization/shed-corruption');
    const view = scenarioView(scenario);
    const cardPool = loadCardPool();
    const legalActions = computeLegalActions(scenario.state, scenario.actingPlayer)
      .filter(legal => legal.viable)
      .map(legal => legal.action);
    return {
      legalActions,
      context: {
        view,
        cardPool,
        legalActions,
        tunables: DEFAULT_TUNABLES,
        standing: computeStanding(view, testWinProbModel(), DEFAULT_TUNABLES),
      } as ModuleContext,
    };
  }

  test('prices the attempt from the published threshold and the card\'s own corruption', () => {
    const { context, legalActions } = position();
    const shed = legalActions.find(a => a.type === 'activate-granted-action'
      && (a as unknown as { actionId?: string }).actionId === 'remove-self-on-roll');
    expect(shed).toBeDefined();
    const evaluation = corruptionModule.evaluate(shed!, context)!;
    expect(evaluation).not.toBeNull();
    // Two branches: it comes off, or the tap is spent for nothing.
    expect(evaluation.outcomes).toHaveLength(2);
    expect(evaluation.outcomes.reduce((sum, o) => sum + o.p, 0)).toBeCloseTo(1, 9);
    const text = JSON.stringify(evaluation.rationale);
    // The corruption is declared as a `stat-modifier` effect, not a top-level
    // number — reading only the number found zero on every hazard in the game.
    expect(text).toContain('corruption removed');
    expect(text).not.toMatch(/"value":"?tw-\d+/);
  });

  test('declines a granted action it has no model for', () => {
    const { context } = position();
    const other = {
      type: 'activate-granted-action',
      player: 'p1',
      characterId: 'nobody',
      actionId: 'saruman-fetch-spell',
      rollThreshold: 0,
    } as unknown as GameAction;
    expect(corruptionModule.evaluate(other, context)).toBeNull();
  });
});
