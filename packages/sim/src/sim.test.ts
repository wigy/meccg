/**
 * @module sim.test
 *
 * Simulation-harness tests: headless games terminate cleanly, are
 * bit-reproducible from the seed, and replays round-trip through the JSONL
 * format and verify by deterministic re-simulation.
 */

import { describe, test, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { playGame } from './runner.js';
import { createRandomAgent } from './agents/random-agent.js';
import { createHeuristicAgent } from './agents/heuristic-agent.js';
import { loadDeck, listDecks } from './decks.js';
import { ReplayWriter, readReplay, verifyReplay } from './replay.js';
import type { DecisionRecord, GameObserver } from './types.js';
import { UNKNOWN_CARD } from '@meccg/shared';

/**
 * Budget for a test that plays a whole game.
 *
 * Vitest's 5s default is not enough for one when the suite runs files in
 * parallel: these pass in isolation and fail together, which reads as a
 * flaky suite rather than as a slow test.
 */
const GAME_TIMEOUT = 30000;

const DECKS: [ReturnType<typeof loadDeck>, ReturnType<typeof loadDeck>] =
  [loadDeck('challenge-deck-a'), loadDeck('challenge-deck-b')];

describe('deck catalog', () => {
  test('lists decks and loads legal engine configurations', () => {
    const decks = listDecks();
    expect(decks.length).toBeGreaterThan(0);
    const deck = loadDeck(decks[0].id);
    expect(deck.playDeck.length).toBeGreaterThanOrEqual(60);
    expect(deck.siteDeck.length).toBeGreaterThan(0);
    expect(deck.draftPool.length).toBeGreaterThan(0);
  });
});

describe('headless runner', () => {
  test('random-vs-random game runs to completion without engine errors', () => {
    const run = playGame({
      agents: [createRandomAgent(), createRandomAgent()],
      decks: DECKS,
      seed: 42,
    });
    expect(run.result.outcome).toBe('completed');
    expect(run.result.error).toBeUndefined();
    expect(run.result.decisions).toBeGreaterThan(100);
    expect(run.result.stats.branching.max).toBeGreaterThan(1);
  }, GAME_TIMEOUT);

  test('heuristic-vs-heuristic game runs to completion', () => {
    const run = playGame({
      agents: [createHeuristicAgent(), createHeuristicAgent()],
      decks: DECKS,
      seed: 7,
    });
    expect(run.result.outcome).toBe('completed');
    expect(run.result.winner).not.toBeNull();
  }, GAME_TIMEOUT);

  test('same seed reproduces the identical decision sequence', () => {
    const record = (): string[] => {
      const actions: string[] = [];
      const observer: GameObserver = {
        onDecision(r: DecisionRecord) {
          actions.push(JSON.stringify(r.action));
        },
      };
      const run = playGame({
        agents: [createRandomAgent(), createRandomAgent()],
        decks: DECKS,
        seed: 12345,
        maxDecisions: 400,
        observers: [observer],
      });
      expect(run.result.outcome === 'completed' || run.result.outcome === 'decision-limit').toBe(true);
      return actions;
    };
    const first = record();
    const second = record();
    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual(first);
  }, GAME_TIMEOUT);

  test('agents only ever see a projected view with hidden info redacted', () => {
    // The runner must feed agents PlayerView objects, never the raw
    // GameState. Play-deck contents are hidden even from their owner, so a
    // redacted own play deck proves the projection boundary is in place.
    let checked = 0;
    const spy = {
      name: 'spy',
      chooseAction(context: Parameters<ReturnType<typeof createRandomAgent>['chooseAction']>[0]) {
        for (const card of context.view.self.playDeck) {
          expect(card.definitionId).toBe(UNKNOWN_CARD);
        }
        if (context.view.self.playDeck.length > 0) checked++;
        return { action: context.legalActions[Math.floor(context.random() * context.legalActions.length)] };
      },
    };
    playGame({
      agents: [spy, spy],
      decks: DECKS,
      seed: 99,
      maxDecisions: 200,
    });
    expect(checked).toBeGreaterThan(0);
  });
});

describe('replay format', () => {
  test('round-trips through JSONL and verifies by re-simulation', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meccg-replay-'));
    const file = path.join(dir, 'replay.jsonl');
    const writer = new ReplayWriter(file);
    const run = playGame({
      agents: [createRandomAgent(), createRandomAgent()],
      decks: DECKS,
      seed: 4242,
      observers: [writer],
    });
    await writer.close();
    expect(run.result.outcome).toBe('completed');

    const replay = readReplay(file);
    expect(replay.header.seed).toBe(4242);
    expect(replay.header.players[0].deckId).toBe('challenge-deck-a');
    expect(replay.result?.outcome).toBe('completed');
    expect(replay.result?.decisions).toBe(run.result.decisions);
    const decisions = replay.records.filter(r => r.kind === 'decision');
    expect(decisions.length).toBe(run.result.decisions);
    // Every decision carries a human-readable description and candidates.
    for (const d of decisions.slice(0, 20)) {
      expect(d.description.length).toBeGreaterThan(0);
    }

    const verification = verifyReplay(replay);
    expect(verification.mismatches).toEqual([]);
    expect(verification.ok).toBe(true);
    expect(verification.decisionsReplayed).toBe(run.result.decisions);

    fs.rmSync(dir, { recursive: true, force: true });
  }, GAME_TIMEOUT);
});

describe('statistics', () => {
  test('per-game stats capture branching, phases, and score trajectory', () => {
    const run = playGame({
      agents: [createHeuristicAgent(), createHeuristicAgent()],
      decks: DECKS,
      seed: 7,
    });
    const stats = run.result.stats;
    expect(stats.decisions).toBe(run.result.decisions);
    expect(stats.decisionsByPlayer[0] + stats.decisionsByPlayer[1]).toBe(stats.decisions);
    expect(Object.keys(stats.decisionsByPhase).length).toBeGreaterThan(3);
    expect(stats.branching.mean).toBeGreaterThan(1);
    expect(stats.scoreByTurn.length).toBeGreaterThan(1);
    const totalActions = Object.values(stats.actionTypes).reduce((s, v) => s + v, 0);
    expect(totalActions).toBe(stats.decisions);
  }, GAME_TIMEOUT);
});
