/**
 * @module cycle-guard.test
 *
 * State-signature and cycle-guard tests. Some cards make a costless no-op
 * loop legal — *I'll Report You* (le-196): "you may return this card to
 * your hand during any organization phase" — and a deterministic argmax
 * policy rides such a loop forever. Two model agents did exactly that on
 * challenge decks m/n, burning a 25,000-decision budget inside turn 1;
 * the same pathology would hang a human's lobby game against the AI.
 */

import { describe, test, expect } from 'vitest';
import * as path from 'path';
import { playGame } from './runner.js';
import { createBcAgent } from './agents/bc-agent.js';
import { createHeuristicAgent } from './agents/heuristic-agent.js';
import { loadDeck } from './decks.js';
import { viewSignature } from './state-signature.js';
import type { Agent } from './types.js';
import type { PlayerView } from '@meccg/shared';

const FIXTURE = path.join(__dirname, '..', 'test-fixtures', 'bc-mini-weights.json');
const DECKS: [ReturnType<typeof loadDeck>, ReturnType<typeof loadDeck>] =
  [loadDeck('challenge-deck-a'), loadDeck('challenge-deck-b')];

describe('view signature', () => {
  test('is stable for the same view and moves when the game progresses', () => {
    const seen: { signature: string; view: PlayerView }[] = [];
    // Delegate to real play: a degenerate "always take the first action"
    // agent stalls in setup, where little of what the signature tracks
    // moves, and would not exercise progression at all.
    const inner = createHeuristicAgent();
    const spy: Agent = {
      name: 'spy',
      chooseAction(context) {
        seen.push({ signature: viewSignature(context.view), view: context.view });
        return inner.chooseAction(context);
      },
    };
    playGame({ agents: [spy, createHeuristicAgent()], decks: DECKS, seed: 31, maxDecisions: 400 });
    expect(seen.length).toBeGreaterThan(10);

    // Deterministic: recomputing from the same view gives the same string.
    for (const entry of seen.slice(0, 20)) {
      expect(viewSignature(entry.view)).toBe(entry.signature);
    }
    // A real game visits many distinct signatures rather than sitting still.
    expect(new Set(seen.map(e => e.signature)).size).toBeGreaterThan(seen.length / 4);
  });
});

describe('bc agent cycle guard', () => {
  test('never repeats an action from a state signature it already acted from', () => {
    const takenBySignature = new Map<string, string[]>();
    const guarded = createBcAgent(FIXTURE);
    const watcher: Agent = {
      name: 'watch',
      chooseAction(context) {
        const signature = viewSignature(context.view);
        const decision = guarded.chooseAction(context);
        const evaluated = context.view.legalActions.find(e => e.action === decision.action);
        const key = evaluated?.actionId ?? decision.action.type;
        const previous = takenBySignature.get(signature) ?? [];
        // The guard may fall back to the argmax only when every candidate
        // from this signature has already been tried.
        if (previous.includes(key)) {
          const viableCount = context.legalActions.length;
          expect(previous.length).toBeGreaterThanOrEqual(viableCount);
        }
        previous.push(key);
        takenBySignature.set(signature, previous);
        return decision;
      },
    };
    const run = playGame({
      agents: [watcher, createHeuristicAgent()],
      decks: DECKS,
      seed: 606,
      maxDecisions: 300,
    });
    expect(run.result.outcome === 'completed' || run.result.outcome === 'decision-limit').toBe(true);
    expect(takenBySignature.size).toBeGreaterThan(10);
  });
});
