/**
 * @module puct.test
 *
 * Determinizing-PUCT search tests (P5): the search agent plays legal,
 * reproducible games through the runner (every action it returns was
 * offered — search over sampled worlds never leaks an illegal move into
 * the real game), searched decisions carry visit counts, and forced or
 * non-determinizable decisions fall back to the policy.
 */

import { describe, test, expect } from 'vitest';
import * as path from 'path';
import { playGame } from './runner.js';
import { loadDeck } from './decks.js';
import { createHeuristicAgent } from './agents/heuristic-agent.js';
import { createSearchAgent } from './agents/search-agent.js';
import type { DecisionRecord, GameObserver } from './types.js';

const FIXTURE = path.join(__dirname, '..', 'test-fixtures', 'bc-mini-weights.json');
const DECKS: [ReturnType<typeof loadDeck>, ReturnType<typeof loadDeck>] =
  [loadDeck('challenge-deck-a'), loadDeck('challenge-deck-b')];

describe('search agent', () => {
  test('plays a legal, reproducible game and searches contested decisions', () => {
    const record = (): { actions: string[]; searched: number; fallbacks: number } => {
      const actions: string[] = [];
      let searched = 0;
      let fallbacks = 0;
      const observer: GameObserver = {
        onDecision(r: DecisionRecord) {
          actions.push(r.action.type);
          if (r.agent.startsWith('search')) {
            if (r.note?.startsWith('puct visits')) searched++;
            else fallbacks++;
          }
        },
      };
      const run = playGame({
        agents: [
          createSearchAgent(FIXTURE, { decks: DECKS, sims: 12, worlds: 2 }),
          createHeuristicAgent(),
        ],
        decks: DECKS,
        seed: 777,
        maxDecisions: 60,
        observers: [observer],
      });
      // No engine errors or deadlocks: every searched action was legal in
      // the REAL game, not just in the sampled worlds.
      expect(run.result.outcome === 'completed' || run.result.outcome === 'decision-limit').toBe(true);
      return { actions, searched, fallbacks };
    };

    const first = record();
    expect(first.actions.length).toBe(60);
    // The searcher both searched (contested quiet points) and fell back
    // (forced decisions, unsupported windows) at least once each.
    expect(first.searched).toBeGreaterThan(0);
    expect(first.fallbacks).toBeGreaterThan(0);

    // Seeded stream drives world sampling → bit-reproducible games.
    const second = record();
    expect(second.actions).toEqual(first.actions);
    expect(second.searched).toBe(first.searched);
  });
});
