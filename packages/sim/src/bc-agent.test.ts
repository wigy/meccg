/**
 * @module bc-agent.test
 *
 * Behavioral-cloning agent tests: the TypeScript forward pass reproduces
 * the PyTorch trainer's outputs on the weights file's embedded self-test
 * example (runtime parity), the weights loader rejects malformed files,
 * and the agent plays legal, deterministic games through the runner using
 * the committed mini fixture.
 */

import { describe, test, expect } from 'vitest';
import * as path from 'path';
import { loadBcWeights, runBcSelfTest, bcForward, createBcAgent } from './agents/bc-agent.js';
import { playGame } from './runner.js';
import { loadDeck } from './decks.js';
import { createHeuristicAgent } from './agents/heuristic-agent.js';
import type { DecisionRecord, GameObserver } from './types.js';

const FIXTURE = path.join(__dirname, '..', 'test-fixtures', 'bc-mini-weights.json');
const DECKS: [ReturnType<typeof loadDeck>, ReturnType<typeof loadDeck>] =
  [loadDeck('challenge-deck-a'), loadDeck('challenge-deck-b')];

describe('bc weights', () => {
  test('TS forward pass matches the trainer on the embedded self-test', () => {
    const model = loadBcWeights(FIXTURE);
    expect(model.vocabSize).toBeGreaterThan(1000);
    const worst = runBcSelfTest(model);
    expect(worst).toBeLessThan(2e-4);
  });

  test('probabilities are a masked distribution', () => {
    const model = loadBcWeights(FIXTURE);
    const output = bcForward(
      model,
      { global: model.selfTest.global, entities: model.selfTest.entities },
      { candidates: model.selfTest.candidates, mask: model.selfTest.mask },
    );
    const total = output.probs.reduce((sum, p) => sum + p, 0);
    expect(total).toBeCloseTo(1, 6);
    output.probs.forEach((p, i) => {
      if (model.selfTest.mask[i] < 0.5) expect(p).toBe(0);
      else expect(p).toBeGreaterThanOrEqual(0);
    });
    expect(Math.abs(output.value)).toBeLessThanOrEqual(1);
  });

  test('rejects a file with a broken tensor', () => {
    expect(() => loadBcWeights(path.join(__dirname, '..', 'package.json'))).toThrow('meccg-bc-weights');
  });
});

describe('bc agent', () => {
  test('temperature sampling stays legal and reproducible (rollout mode)', () => {
    const record = (): string[] => {
      const actions: string[] = [];
      const observer: GameObserver = {
        onDecision(r: DecisionRecord) {
          actions.push(r.action.type);
        },
      };
      const run = playGame({
        agents: [createBcAgent(FIXTURE, { temperature: 1 }), createBcAgent(FIXTURE, { temperature: 1 })],
        decks: DECKS,
        seed: 606,
        maxDecisions: 100,
        observers: [observer],
      });
      expect(run.result.outcome === 'completed' || run.result.outcome === 'decision-limit').toBe(true);
      return actions;
    };
    const first = record();
    expect(first.length).toBe(100);
    expect(record()).toEqual(first);
    expect(() => createBcAgent(FIXTURE, { temperature: 0 })).toThrow('temperature');
  });

  test('plays a legal, deterministic game against the heuristic', () => {
    const record = (): string[] => {
      const actions: string[] = [];
      const observer: GameObserver = {
        onDecision(r: DecisionRecord) {
          actions.push(`${r.agent}:${r.action.type}`);
        },
      };
      const run = playGame({
        agents: [createBcAgent(FIXTURE), createHeuristicAgent()],
        decks: DECKS,
        seed: 909,
        maxDecisions: 120,
        observers: [observer],
      });
      // No engine errors or deadlocks: every action the net picked was
      // legal (the intentional 120-decision cap is the only allowed stop).
      expect(run.result.outcome === 'completed' || run.result.outcome === 'decision-limit').toBe(true);
      return actions;
    };
    const first = record();
    expect(first.length).toBe(120);
    expect(first.some(entry => entry.startsWith('bc:'))).toBe(true);
    // Argmax policy + fixed seed → bit-reproducible games.
    expect(record()).toEqual(first);
  });
});
