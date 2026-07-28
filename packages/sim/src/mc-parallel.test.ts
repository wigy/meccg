/**
 * @module mc-parallel.test
 *
 * Acceptance test §7.1 of specs/2026-07-28-parallel-monte-carlo.md: for a
 * fixed `rollouts` budget, the parallel Monte-Carlo agent (`jobs>1`) must
 * play a bit-identical game to the serial one from the same seed — same
 * decisions, same final state. This is the proof that distributing whole
 * rounds across workers changed how fast the estimate is computed, not
 * what is being estimated. (Speed-up and strength — §7.2/§7.3 — are
 * measured on the training host, not asserted here.)
 */

import { describe, test, expect } from 'vitest';
import { playGame } from './runner.js';
import { createMcAgent } from './agents/mc-agent.js';
import { createHeuristicAgent } from './agents/heuristic-agent.js';
import { loadDeck } from './decks.js';
import type { DecisionRecord, GameObserver } from './types.js';

const DECKS: [ReturnType<typeof loadDeck>, ReturnType<typeof loadDeck>] =
  [loadDeck('challenge-deck-a'), loadDeck('challenge-deck-b')];

describe('parallel Monte-Carlo agent', () => {
  test('jobs=2 plays a bit-identical game to jobs=1 at fixed rollouts', () => {
    const record = (jobs: number): { actions: string[]; searched: number; stateSeq: number } => {
      const actions: string[] = [];
      let searched = 0;
      const observer: GameObserver = {
        onDecision(r: DecisionRecord) {
          actions.push(JSON.stringify(r.action));
          // Searched decisions carry the agent's rollout note; setup-phase
          // decisions are forced or fall back to the heuristic and prove
          // nothing about the pool.
          if (r.agent === 'mc-test' && r.note?.startsWith('mc ')) searched++;
        },
      };
      const run = playGame({
        agents: [
          createMcAgent({ rollouts: 3, maxCandidates: 4, horizonTurns: 1, jobs, name: 'mc-test' }),
          createHeuristicAgent(),
        ],
        decks: DECKS,
        seed: 4242,
        maxDecisions: 200,
        observers: [observer],
      });
      expect(run.result.outcome === 'completed' || run.result.outcome === 'decision-limit').toBe(true);
      return { actions, searched, stateSeq: run.finalState.stateSeq };
    };

    const serial = record(1);
    const parallel = record(2);
    // The equivalence claim is empty unless the pool actually searched.
    expect(serial.searched).toBeGreaterThan(0);
    expect(parallel.searched).toBe(serial.searched);
    expect(serial.actions.length).toBe(200);
    expect(parallel.actions).toEqual(serial.actions);
    expect(parallel.stateSeq).toBe(serial.stateSeq);
  }, 300_000);
});
