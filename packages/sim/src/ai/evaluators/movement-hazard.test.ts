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

const POOL: Record<string, CardDefinition> = {
  'as-30': FULL_OF_FROTH_AND_RAGE,
  'td-42': LESSER_SPIDERS,
  'dm-111': STIRRING_BONES,
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
