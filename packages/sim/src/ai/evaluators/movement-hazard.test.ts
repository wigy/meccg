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
