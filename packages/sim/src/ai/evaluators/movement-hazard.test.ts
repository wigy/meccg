import { describe, test, expect } from 'vitest';
import type { CardDefinition, GameAction, PlayerView } from '@meccg/shared';
import { movementHazardEvaluator } from './movement-hazard.js';
import type { AiContext } from '../strategy.js';

// Full of Froth and Rage (as-30): a hazard permanent-event boosting all
// Spider/Animal attacks by +2 prowess while in play. Worthless once played
// after a matching creature's attack has already resolved.
const FULL_OF_FROTH_AND_RAGE: CardDefinition = {
  cardType: 'hazard-event',
  id: 'as-30',
  eventType: 'permanent',
  effects: [
    {
      type: 'stat-modifier',
      stat: 'prowess',
      value: 2,
      target: 'all-attacks',
      when: { 'enemy.race': { $in: ['spider', 'animal'] } },
    },
  ],
} as unknown as CardDefinition;

// Lesser Spiders (td-42): a Spider creature the boost above would strengthen.
const LESSER_SPIDERS: CardDefinition = {
  cardType: 'hazard-creature',
  id: 'td-42',
  strikes: 4,
  prowess: 7,
  race: 'spider',
} as unknown as CardDefinition;

// Stirring Bones (dm-111): an Undead creature the boost above does NOT match.
const STIRRING_BONES: CardDefinition = {
  cardType: 'hazard-creature',
  id: 'dm-111',
  strikes: 2,
  prowess: 9,
  race: 'undead',
} as unknown as CardDefinition;

// Doors of Night (tw-28): a permanent environment event with no effect this
// evaluator otherwise scores above the flat hazard-event baseline.
const DOORS_OF_NIGHT: CardDefinition = {
  cardType: 'hazard-event',
  id: 'tw-28',
  name: 'Doors of Night',
  eventType: 'permanent',
  effects: [
    {
      type: 'on-event',
      event: 'self-enters-play',
      apply: { type: 'move', select: 'filter-all', from: 'in-play', to: 'discard', filter: {} },
    },
  ],
} as unknown as CardDefinition;

// An Unexpected Outpost (dm-45): fetches one hazard from sideboard/discard,
// or two if Doors of Night is already in play.
const UNEXPECTED_OUTPOST: CardDefinition = {
  cardType: 'hazard-event',
  id: 'dm-45',
  name: 'An Unexpected Outpost',
  eventType: 'short',
  effects: [
    { type: 'move', select: 'target', from: ['sideboard', 'discard'], to: 'deck', count: 1 },
    {
      type: 'move', select: 'target', from: ['sideboard', 'discard'], to: 'deck', count: 1,
      when: { inPlay: 'Doors of Night' },
    },
  ],
} as unknown as CardDefinition;

const POOL: Record<string, CardDefinition> = {
  'as-30': FULL_OF_FROTH_AND_RAGE,
  'td-42': LESSER_SPIDERS,
  'dm-111': STIRRING_BONES,
  'tw-28': DOORS_OF_NIGHT,
  'dm-45': UNEXPECTED_OUTPOST,
};

function makeContext(handDefIds: readonly string[]): AiContext {
  const view = {
    self: {
      hand: handDefIds.map((definitionId, i) => ({ instanceId: `h${i}`, definitionId })),
    },
    opponent: {
      companies: [],
      characters: {},
    },
  } as unknown as PlayerView;
  return { view, cardPool: POOL, legalActions: [] };
}

function playHazard(cardInstanceId: string): GameAction {
  return {
    type: 'play-hazard',
    player: 'p2',
    cardInstanceId,
    targetCompanyId: 'company-p1-0',
  } as unknown as GameAction;
}

describe('movementHazardEvaluator play-hazard sequencing', () => {
  test('scores a matching board-wide boost above the creature it would strengthen', () => {
    const context = makeContext(['as-30', 'td-42']);
    const boostScore = movementHazardEvaluator.score(playHazard('h0'), context);
    const creatureScore = movementHazardEvaluator.score(playHazard('h1'), context);
    expect(boostScore).not.toBeNull();
    expect(creatureScore).not.toBeNull();
    expect(boostScore!).toBeGreaterThan(creatureScore!);
  });

  test('falls back to the flat baseline when hand has no matching creature', () => {
    const context = makeContext(['as-30', 'dm-111']);
    const boostScore = movementHazardEvaluator.score(playHazard('h0'), context);
    expect(boostScore).toBe(5);
  });

  test('scores Doors of Night above An Unexpected Outpost\'s baseline when both are in hand', () => {
    // Bug report: the AI played An Unexpected Outpost, then Doors of Night
    // afterwards in the same hazard round — wasting Outpost's double-fetch
    // bonus, which only applies if Doors of Night is already in play.
    const context = makeContext(['dm-45', 'tw-28']);
    const outpostScore = movementHazardEvaluator.score(playHazard('h0'), context);
    const doorsScore = movementHazardEvaluator.score(playHazard('h1'), context);
    expect(outpostScore).toBe(5);
    expect(doorsScore).not.toBeNull();
    expect(doorsScore!).toBeGreaterThan(outpostScore!);
  });

  test('Doors of Night falls back to the flat baseline without a dependent card in hand', () => {
    const context = makeContext(['tw-28']);
    const doorsScore = movementHazardEvaluator.score(playHazard('h0'), context);
    expect(doorsScore).toBe(5);
  });
});

function marvelsTold(discardTargetInstanceId: string): GameAction {
  return {
    type: 'play-short-event',
    player: 'p2',
    cardInstanceId: 'td-134-instance',
    targetScoutInstanceId: 'scout-instance',
    discardTargetInstanceId,
  } as unknown as GameAction;
}

describe('movementHazardEvaluator play-short-event discard targeting', () => {
  // Bug report: the AI played Marvels Told (forces discard of an in-play
  // hazard-event) and chose to discard Foolish Words off Faramir — but
  // Faramir was in the *opponent's* company, so removing it undid the AI's
  // own hindrance and benefited the opponent instead of the AI. Meanwhile
  // the same legal-action set offered discarding Power Built by Waiting,
  // an opponent-played hazard raising the limit against the AI's own
  // company — the actually beneficial choice, left unscored alongside the
  // harmful one.
  test('scores discarding a hazard-event on the opponent\'s character as zero', () => {
    const context: AiContext = {
      view: {
        self: { hand: [], characters: {}, cardsInPlay: [] },
        opponent: {
          companies: [],
          characters: {
            'p1-101': { hazards: [{ instanceId: 'p2-91', definitionId: 'le-112' }] },
          },
          cardsInPlay: [],
        },
      } as unknown as PlayerView,
      cardPool: POOL,
      legalActions: [],
    };

    expect(movementHazardEvaluator.score(marvelsTold('p2-91'), context)).toBe(0);
  });

  test('scores discarding an opponent\'s board-wide hazard event above zero', () => {
    const context: AiContext = {
      view: {
        self: { hand: [], characters: {}, cardsInPlay: [] },
        opponent: {
          companies: [],
          characters: {},
          cardsInPlay: [{ instanceId: 'p1-52', definitionId: 'as-34' }],
        },
      } as unknown as PlayerView,
      cardPool: POOL,
      legalActions: [],
    };

    expect(movementHazardEvaluator.score(marvelsTold('p1-52'), context)).toBeGreaterThan(0);
  });
});

function placeOnGuard(cardInstanceId: string): GameAction {
  return { type: 'place-on-guard', player: 'p2', cardInstanceId } as unknown as GameAction;
}

describe('movementHazardEvaluator place-on-guard weighting', () => {
  // Bug report: "the AI always places a card on guard". One place-on-guard
  // action exists per hand card (any card can be the face-down bluff), so a
  // flat per-action weight let the category's combined odds scale with hand
  // size, drowning out "pass" whenever the hand had more than a couple of
  // cards.
  test('splits a fixed total weight across all place-on-guard options instead of scoring each one flatly', () => {
    const manyOptions = Array.from({ length: 8 }, (_, i) => placeOnGuard(`h${i}`));
    const context: AiContext = {
      ...makeContext(['as-30']),
      legalActions: [...manyOptions, { type: 'pass', player: 'p2' } as unknown as GameAction],
    };

    const perActionScore = movementHazardEvaluator.score(manyOptions[0], context)!;
    const totalGuardWeight = perActionScore * manyOptions.length;

    // The combined weight of "place something on guard" stays at the
    // original single-decision magnitude regardless of hand size.
    expect(totalGuardWeight).toBeCloseTo(4);
  });

  test('scores the single-option case the same as before the fix', () => {
    const context: AiContext = {
      ...makeContext(['as-30']),
      legalActions: [placeOnGuard('h0'), { type: 'pass', player: 'p2' } as unknown as GameAction],
    };
    expect(movementHazardEvaluator.score(placeOnGuard('h0'), context)).toBe(4);
  });
});
