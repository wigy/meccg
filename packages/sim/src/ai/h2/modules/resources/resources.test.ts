/**
 * @module ai/h2/modules/resources/resources.test
 *
 * The per-source marginal value is the whole module, so the tests are about
 * it: the same printed marshalling points are worth different amounts in
 * different sources, and nothing at all in a capped one. H1's `mp * 20` gives
 * one answer to all three cases.
 */

import { describe, test, expect } from 'vitest';
import { CardStatus } from '@meccg/shared';
import type { CardDefinition, GameAction, PlayerView } from '@meccg/shared';
import type { ModuleContext } from '../../core/types.js';
import { DEFAULT_TUNABLES } from '../../core/tunables.js';
import { collectTunables } from '../../core/rationale.js';
import { computeStanding } from '../../services/standing.js';
import { testMarshallingPoints, testWinProbModel } from '../../test-support.js';
import { resourcesModule } from './resources.js';

const HERO = 'tw-hero';
const ITEM = 'tw-item';
const ALLY = 'tw-ally';
const TRINKET = 'tw-trinket';

const POOL = {
  [HERO]: { name: 'A Bearer', cardType: 'hero-character', mind: 3, marshallingPoints: 1, marshallingCategory: 'character' },
  [ITEM]: { name: 'Glamdring', marshallingPoints: 2, marshallingCategory: 'item', corruptionPoints: 1 },
  [ALLY]: { name: 'Eagle', marshallingPoints: 2, marshallingCategory: 'ally' },
  [TRINKET]: { name: 'A Trinket', marshallingPoints: 0, marshallingCategory: 'item' },
} as unknown as Readonly<Record<string, CardDefinition>>;

/** A `play-hero-resource` naming one of the pool's cards. */
function play(definitionId: string): GameAction {
  return { type: 'play-hero-resource', cardInstanceId: `card-${definitionId}` } as unknown as GameAction;
}

/** A context with the given standing and the three cards in hand. */
function contextWith(self: Record<string, number>, opponent: Record<string, number>): ModuleContext {
  const view = {
    self: {
      id: 'p1',
      marshallingPoints: testMarshallingPoints(self),
      hand: [ITEM, ALLY, TRINKET].map(d => ({ instanceId: `card-${d}`, definitionId: d })),
      characters: {},
      companies: [],
      cardsInPlay: [],
      generalInfluence: 20,
      generalInfluenceUsed: 0,
    },
    opponent: { marshallingPoints: testMarshallingPoints(opponent), characters: {}, cardsInPlay: [] },
    turnNumber: 20,
  } as unknown as PlayerView;
  return {
    view,
    cardPool: POOL,
    legalActions: [play(ITEM), play(ALLY), play(TRINKET)],
    tunables: DEFAULT_TUNABLES,
    standing: computeStanding(view, testWinProbModel(), DEFAULT_TUNABLES),
  };
}

/** A context with two possible bearers: one clean, one already corrupted. */
function contextWithBearers(): ModuleContext {
  const base = contextWith(
    { character: 3, item: 3, faction: 3, ally: 3 },
    { character: 3, item: 3, faction: 3, ally: 3 },
  );
  const characters: Record<string, unknown> = {};
  for (const [id, cp] of [['clean', 0], ['tainted', 7]] as const) {
    characters[id] = {
      instanceId: id,
      definitionId: HERO,
      status: CardStatus.Untapped,
      items: [], allies: [], hazards: [], followers: [],
      effectiveStats: { prowess: 4, body: 7, directInfluence: 0, corruptionPoints: cp },
    };
  }
  const view = {
    ...base.view,
    self: { ...base.view.self, characters, companies: [{ id: 'company', characters: ['clean', 'tainted'] }] },
  } as unknown as typeof base.view;
  return { ...base, view, standing: computeStanding(view, testWinProbModel(), DEFAULT_TUNABLES) };
}

describe('per-source valuation', () => {
  test('the same points are worth more in a source the opponent has none of', () => {
    // Identical cards, two MP each — but ours double in the ally source and
    // not in the item source. `mp * 20` cannot tell them apart.
    const context = contextWith(
      { character: 3, item: 3, faction: 3, ally: 3 },
      { character: 3, item: 3, faction: 3, ally: 0 },
    );
    const item = resourcesModule.evaluate(play(ITEM), context)!;
    const ally = resourcesModule.evaluate(play(ALLY), context)!;
    expect(context.standing.marginal.ally).toBeGreaterThan(context.standing.marginal.item);
    expect(ally.utility).toBeGreaterThan(item.utility);
  });

  test('a capped source makes the play worth less than the tap it costs', () => {
    const context = contextWith(
      { character: 2, item: 6, faction: 2, ally: 2 },
      { character: 3, item: 3, faction: 3, ally: 3 },
    );
    expect(context.standing.marginal.item).toBe(0);
    const evaluation = resourcesModule.evaluate(play(ITEM), context)!;
    expect(evaluation.expectedTsd).toBeLessThan(0);
    expect(JSON.stringify(evaluation.rationale)).toContain('half-total cap');
  });

  test('a card worth no points still costs the tap', () => {
    const context = contextWith(
      { character: 3, item: 3, faction: 3, ally: 3 },
      { character: 3, item: 3, faction: 3, ally: 3 },
    );
    const evaluation = resourcesModule.evaluate(play(TRINKET), context)!;
    expect(evaluation.expectedTsd).toBeCloseTo(-DEFAULT_TUNABLES.tapTempoCost, 12);
  });
});

describe('what it reports', () => {
  const context = contextWith(
    { character: 3, item: 3, faction: 3, ally: 3 },
    { character: 3, item: 3, faction: 3, ally: 3 },
  );

  test('produces a valid distribution and names its constants', () => {
    const evaluation = resourcesModule.evaluate(play(ITEM), context)!;
    expect(evaluation.outcomes.reduce((sum, o) => sum + o.p, 0)).toBe(1);
    expect(collectTunables(evaluation.rationale).has('tapTempoCost')).toBe(true);
  });

  test('prices the corruption a card brings against the bearer it lands on', () => {
    // Same card, same standing — only the bearer's existing corruption differs.
    // The one already close to failing must be charged more for taking it.
    const onto = (bearer: string): GameAction =>
      ({ type: 'play-hero-resource', cardInstanceId: `card-${ITEM}`, attachToCharacterId: bearer }) as unknown as GameAction;
    const clean = resourcesModule.evaluate(onto('clean'), contextWithBearers())!;
    const tainted = resourcesModule.evaluate(onto('tainted'), contextWithBearers())!;
    expect(tainted.expectedTsd).toBeLessThan(clean.expectedTsd);
    expect(JSON.stringify(tainted.rationale)).toContain('widens the failing band');
  });

  test('says so plainly when no bearer is named to charge the corruption to', () => {
    const evaluation = resourcesModule.evaluate(play(ITEM), context)!;
    expect(JSON.stringify(evaluation.rationale)).toContain('names no bearer');
  });

  test('declines an action naming a card it cannot find', () => {
    const unknown = { type: 'play-hero-resource', cardInstanceId: 'nope' } as unknown as GameAction;
    expect(resourcesModule.evaluate(unknown, context)).toBeNull();
  });
});
