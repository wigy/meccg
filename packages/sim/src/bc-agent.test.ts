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
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadBcWeights, runBcSelfTest, bcForward, createBcAgent, classMassIndex } from './agents/bc-agent.js';
import { createAgentFromWeights } from './agents/from-weights.js';
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

  test('class-mass decoding chooses the type, not the loudest candidate', () => {
    // The shape the fix exists for: one `pass` candidate outscores every
    // individual movement plan while the plans together outweigh it more
    // than twice over. Argmax takes index 0; class-mass takes the best
    // movement plan.
    const probs = [0.15, 0.10, 0.10, 0.10, 0.09];
    const types = ['pass', 'plan-movement', 'plan-movement', 'plan-movement', 'plan-movement'];
    expect(classMassIndex(probs, types, () => true)).toBe(1);

    // The cycle guard's filter is honoured: with the first two plans already
    // tried from this signature, movement still wins its class and the best
    // remaining plan is taken.
    expect(classMassIndex(probs, types, i => i !== 1 && i !== 2)).toBe(3);

    // Filtered down to a single type, it degenerates to the argmax of that
    // type, and an empty candidate set reports no choice rather than 0.
    expect(classMassIndex(probs, types, i => i === 0)).toBe(0);
    expect(classMassIndex(probs, types, () => false)).toBe(-1);
  });

  test('class-mass decoding plays a legal, deterministic game', () => {
    const record = (): string[] => {
      const actions: string[] = [];
      const observer: GameObserver = {
        onDecision(r: DecisionRecord) {
          actions.push(r.action.type);
        },
      };
      const run = playGame({
        agents: [createBcAgent(FIXTURE, { decode: 'class-mass' }), createHeuristicAgent()],
        decks: DECKS,
        seed: 909,
        maxDecisions: 120,
        observers: [observer],
      });
      expect(run.result.outcome === 'completed' || run.result.outcome === 'decision-limit').toBe(true);
      return actions;
    };
    const first = record();
    expect(first.length).toBe(120);
    expect(record()).toEqual(first);
    // The two readouts are alternatives, not a pair.
    expect(() => createBcAgent(FIXTURE, { decode: 'class-mass', temperature: 1 })).toThrow('alternatives');
  });

  test('a weights file declares how it should be read', () => {
    // The lobby's `--model` seam names a path and nothing else, so the file
    // has to carry its own readout or every model gets the same one — and
    // the right one differs by teacher.
    const declared = path.join(os.tmpdir(), `bc-declared-${process.pid}.json`);
    const raw = JSON.parse(fs.readFileSync(FIXTURE, 'utf-8')) as Record<string, unknown>;
    fs.writeFileSync(declared, JSON.stringify({ ...raw, decode: { mode: 'sample', temperature: 1 } }));
    try {
      expect(createBcAgent(FIXTURE).name).toBe('bc');
      expect(createBcAgent(declared).name).toBe('bc@1');
      // An explicit option still wins over the file's declaration.
      expect(createBcAgent(declared, { decode: 'class-mass' }).name).toBe('bc@class');

      fs.writeFileSync(declared, JSON.stringify({ ...raw, decode: { mode: 'sideways' } }));
      expect(() => createBcAgent(declared)).toThrow('unknown decode mode');
      fs.writeFileSync(declared, JSON.stringify({ ...raw, decode: { mode: 'sample', temperature: 0 } }));
      expect(() => createBcAgent(declared)).toThrow('temperature');
    } finally {
      fs.rmSync(declared, { force: true });
    }
  });

  test('a weights file can delegate its widest decisions', () => {
    // The lobby seam takes a bare file name, so a hybrid has to be
    // expressible as a file or it cannot be offered as a model at all.
    const routed = path.join(os.tmpdir(), `bc-routed-${process.pid}.json`);
    const raw = JSON.parse(fs.readFileSync(FIXTURE, 'utf-8')) as Record<string, unknown>;
    fs.writeFileSync(routed, JSON.stringify({
      ...raw, route: { types: ['plan-movement', 'discard-card'], to: 'heuristic' },
    }));
    try {
      expect(createAgentFromWeights(FIXTURE).name).toBe('bc');
      expect(createAgentFromWeights(routed).name).toBe('bc+heuristic');

      fs.writeFileSync(routed, JSON.stringify({ ...raw, route: { types: ['pass'], to: 'mc' } }));
      expect(() => createAgentFromWeights(routed)).toThrow('not a known delegate');
      fs.writeFileSync(routed, JSON.stringify({ ...raw, route: { types: [], to: 'heuristic' } }));
      expect(() => createAgentFromWeights(routed)).toThrow('non-empty');
    } finally {
      fs.rmSync(routed, { force: true });
    }
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
