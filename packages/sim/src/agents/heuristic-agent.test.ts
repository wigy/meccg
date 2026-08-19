/**
 * @module agents/heuristic-agent.test
 *
 * Regression coverage for the argmax-vs-sample seam. Production games spawn
 * the AI through text-client's `ai-client.ts`, which resolves the `heuristic`
 * agent through this module — it must never hand back a lower-weighted
 * action just because the random stream landed there, the same guarantee
 * {@link ../ai/strategy.test.ts} pins for `pickBest` in isolation.
 */

import { describe, test, expect } from 'vitest';
import type { CardDefinition, GameAction, PlayerView } from '@meccg/shared';
import { createHeuristicAgent } from './heuristic-agent.js';
import type { AgentContext } from '../types.js';

// The Moon Is Dead (dm-71): a hazard permanent-event boosting all Undead
// attacks by +1 prowess/+1 strike. Worthless once played after a matching
// creature's attack has already resolved.
const THE_MOON_IS_DEAD: CardDefinition = {
  cardType: 'hazard-event',
  id: 'dm-71',
  name: 'The Moon Is Dead',
  eventType: 'permanent',
  effects: [
    { type: 'stat-modifier', stat: 'prowess', value: 1, target: 'all-attacks', when: { 'enemy.race': 'undead' } },
    { type: 'stat-modifier', stat: 'strikes', value: 1, target: 'all-attacks', when: { 'enemy.race': 'undead' } },
  ],
} as unknown as CardDefinition;

// Corpse-candle (tw-23): the Undead creature the boost above strengthens.
const CORPSE_CANDLE: CardDefinition = {
  cardType: 'hazard-creature',
  id: 'tw-23',
  name: 'Corpse-candle',
  strikes: 1,
  prowess: 7,
  race: 'undead',
} as unknown as CardDefinition;

const POOL: Record<string, CardDefinition> = {
  'dm-71': THE_MOON_IS_DEAD,
  'tw-23': CORPSE_CANDLE,
};

function playHazard(cardInstanceId: string): GameAction {
  return { type: 'play-hazard', player: 'p2', cardInstanceId, targetCompanyId: 'company-p1-0' } as unknown as GameAction;
}

/** A random stream that hands out the given values in order, then repeats the last. */
function stream(...values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

/**
 * Bug report: Game mt07ie2z-3163h9, turn 2. Both Corpse-candle and The Moon
 * Is Dead were in hand; Corpse-candle listed first (as it was in the actual
 * legal-action list), so a low `random()` draw falls in its slice of the
 * weighted interval under sampling — reproducing "the AI played Corpse-candle
 * before The Moon Is Dead, so Corpse-candle got no benefit from it."
 */
function context(random: () => number): AgentContext {
  return {
    view: {
      phaseState: { phase: 'movement-hazard' },
      self: {
        hand: [
          { instanceId: 'p2-46', definitionId: 'tw-23' },
          { instanceId: 'p2-58', definitionId: 'dm-71' },
        ],
      },
      opponent: { companies: [], characters: {} },
    } as unknown as PlayerView,
    cardPool: POOL,
    legalActions: [playHazard('p2-46'), playHazard('p2-58')],
    evaluated: [],
    random,
  } as unknown as AgentContext;
}

describe('createHeuristicAgent', () => {
  test('plays The Moon Is Dead before Corpse-candle regardless of the random draw', () => {
    const agent = createHeuristicAgent();
    for (const r of [0, 0.05, 0.5, 0.99]) {
      const decision = agent.chooseAction(context(stream(r)));
      expect(decision.action).toMatchObject({ cardInstanceId: 'p2-58' });
    }
  });

  test('`sample: true` reproduces the bug: a low draw still picks Corpse-candle first', () => {
    // Confirms the scenario is genuinely adversarial to sampling, not just to
    // this particular agent wiring — the default (argmax) must differ from
    // this on the exact same context.
    const agent = createHeuristicAgent({ sample: true });
    const decision = agent.chooseAction(context(stream(0.05)));
    expect(decision.action).toMatchObject({ cardInstanceId: 'p2-46' });
  });
});
