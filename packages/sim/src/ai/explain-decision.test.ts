/**
 * @module ai/explain-decision.test
 *
 * The Ask AI explanation (`specs/2026-08-17-ask-ai-observer.md`): that every
 * agent family renders a readable answer, and — the part that matters when the
 * text travels to a browser — that no line is derived from anything the
 * explained seat cannot see.
 */

import { describe, test, expect } from 'vitest';
import { loadCardPool, setEngineConsoleLog } from '@meccg/shared';
import { projectPlayerView } from '@meccg/game-server';
import type { PlayerId } from '@meccg/shared';
import { createHeuristicAgent } from '../agents/heuristic-agent.js';
import { createRandomAgent } from '../agents/random-agent.js';
import { createHeuristic2Agent } from './h2/agent.js';
import { loadScenario } from './h2/scenario-store.js';
import { explainDecision, renderCandidateRanking } from './explain-decision.js';
import type { ConsideredAction } from '../types.js';

// Projecting a view recomputes legal actions, and the engine narrates that at
// length; the explanation is what is under test.
setEngineConsoleLog(false);

const cardPool = loadCardPool();
const SCENARIO = 'combat/assign-two-strikes';

/** The scenario every case below explains, with the seat that is to act. */
function position(): { state: ReturnType<typeof loadScenario>['state']; playerId: PlayerId } {
  const scenario = loadScenario(SCENARIO);
  return { state: scenario.state, playerId: scenario.actingPlayer };
}

describe('explainDecision — the generic agent path', () => {
  test('renders a header, a pick, a ranking and the reproduce footer', () => {
    const { state, playerId } = position();
    const explanation = explainDecision({
      agent: createHeuristicAgent(),
      agentSpec: 'heuristic',
      state,
      playerId,
      title: `scenario ${SCENARIO}`,
      cardPool,
      source: { gameId: 'some-game', stateSeq: 140 },
    });
    const text = explanation.lines.join('\n');

    expect(text).toContain('ASK AI — heuristic');
    expect(text).toContain(`Seat:`);
    expect(text).toContain('Asked:');
    expect(text).toContain('PICK  ');
    expect(text).toContain('RANKING');
    // The reproduce line is the panel's escape hatch into the CLI, so it must
    // name the position exactly.
    expect(text).toContain('--game some-game --seq 140 --player');
    expect(explanation.chosen).not.toBeNull();
    expect(explanation.chosenDescription.length).toBeGreaterThan(0);
    expect(explanation.viableCount).toBeGreaterThan(0);
  });

  test('says which unit the weights are in', () => {
    const { state, playerId } = position();
    const text = explainDecision({
      agent: createHeuristicAgent(),
      agentSpec: 'heuristic',
      state,
      playerId,
      title: 'position',
      cardPool,
    }).lines.join('\n');
    // The heuristic publishes sampling weights, so the ordering is meaningful
    // and the differences are not — a reader told only "42" cannot use it.
    expect(text).toContain('the ordering is meaningful');
  });

  test('is reproducible: the same question twice gives the same answer', () => {
    const { state, playerId } = position();
    const ask = () => explainDecision({
      agent: createRandomAgent(),
      agentSpec: 'random',
      state,
      playerId,
      title: 'position',
      cardPool,
      seed: 7,
    }).lines.join('\n');
    expect(ask()).toBe(ask());
  });

  test('omits the delegation note for an agent that does not draw the distinction', () => {
    const { state, playerId } = position();
    const text = explainDecision({
      agent: createHeuristicAgent(),
      agentSpec: 'heuristic',
      state,
      playerId,
      title: 'position',
      cardPool,
    }).lines.join('\n');
    // Absent `canDecide` means "does not draw the distinction", not "always".
    expect(text).not.toContain('cannot search this position');
  });

  test('reports the delegation when the agent cannot answer for itself', () => {
    const { state, playerId } = position();
    const delegating = {
      ...createHeuristicAgent(),
      name: 'pretend-mc',
      canDecide: () => false,
    };
    const text = explainDecision({
      agent: delegating,
      agentSpec: 'pretend-mc',
      state,
      playerId,
      title: 'position',
      cardPool,
    }).lines.join('\n');
    expect(text).toContain('cannot search this position');
    expect(text).toContain('fallback');
  });
});

describe('explainDecision — the H2 path', () => {
  test('renders the module derivation, not just a ranking', () => {
    const { state, playerId } = position();
    const text = explainDecision({
      agent: createHeuristic2Agent(),
      agentSpec: 'h2',
      state,
      playerId,
      title: `scenario ${SCENARIO}`,
      cardPool,
    }).lines.join('\n');

    // The sections `renderExplanation` owns: this is the same rendering the
    // `explain` CLI prints, which is the point of sharing the pipeline.
    expect(text).toContain('ASK AI — h2');
    expect(text).toContain('STANDING');
    expect(text).toContain('Position: scenario combat/assign-two-strikes');
  }, 60_000);
});

describe('explaining a move already made', () => {
  test('says so when the agent agrees with what was played', () => {
    const { state, playerId } = position();
    const agent = createHeuristicAgent();
    // What the agent itself would pick, played back to it as the move made.
    const pick = explainDecision({
      agent, agentSpec: 'heuristic', state, playerId, title: 'position', cardPool,
    }).chosen!;

    const text = explainDecision({
      agent, agentSpec: 'heuristic', state, playerId, title: 'position', cardPool,
      actuallyPlayed: pick,
    }).lines.join('\n');

    expect(text).toContain('ACTUALLY PLAYED');
    expect(text).toContain('agrees');
  });

  test('names what it would have played instead when it disagrees', () => {
    const { state, playerId } = position();
    const agent = createHeuristicAgent();
    const explanation = explainDecision({
      agent, agentSpec: 'heuristic', state, playerId, title: 'position', cardPool,
    });
    // Any viable action that is not the agent's own pick.
    const other = projectPlayerView(state, playerId).legalActions
      .filter(e => e.viable)
      .map(e => e.action)
      .find(a => JSON.stringify(a) !== JSON.stringify(explanation.chosen))!;

    const text = explainDecision({
      agent, agentSpec: 'heuristic', state, playerId, title: 'position', cardPool,
      actuallyPlayed: other,
    }).lines.join('\n');

    expect(text).toContain('would have played');
    expect(text).toContain(explanation.chosenDescription);
  });
});

describe('the view-only invariant', () => {
  test('an explanation never names a card the explained seat cannot see', () => {
    const { state, playerId } = position();
    const opponent = state.players.find(p => p.id !== playerId)!;
    // Only cards whose *definition* appears nowhere else in the game count as
    // hidden: both players field challenge decks, so a name held in the
    // opponent's hand is usually also sitting in the explained seat's own hand
    // or discard, where mentioning it leaks nothing. Counting the definition's
    // instances is what separates the two cases.
    const stateJson = JSON.stringify(state);
    const occurrences = (definitionId: string) =>
      stateJson.split(`"definitionId":"${definitionId}"`).length - 1;
    const hiddenNames = opponent.hand
      .filter(card => occurrences(card.definitionId) === 1)
      .map(card => cardPool[card.definitionId]?.name)
      .filter((name): name is string => typeof name === 'string' && name.length > 3);

    const text = explainDecision({
      agent: createHeuristicAgent(),
      agentSpec: 'heuristic',
      state,
      playerId,
      title: 'position',
      cardPool,
    }).lines.join('\n');

    // Everything rendered comes from projectPlayerView(state, playerId), so the
    // opponent's hand cannot appear — the guard that keeps the panel from
    // leaking what the seat does not know.
    expect(hiddenNames.length).toBeGreaterThan(0);
    for (const name of hiddenNames) {
      expect(text).not.toContain(name);
    }
    for (const card of opponent.hand) {
      expect(text).not.toContain(card.instanceId);
    }
  });
});

describe('renderCandidateRanking', () => {
  const action = (type: string) => ({ type } as unknown as ConsideredAction['action']);
  const describe_ = (a: { type: string }) => `do ${a.type}`;

  test('sorts by weight, marks the pick, and numbers the rows', () => {
    const candidates: ConsideredAction[] = [
      { action: action('a'), weight: 1 },
      { action: action('b'), weight: 5 },
    ];
    const lines = renderCandidateRanking({
      describe: describe_,
      candidates,
      picked: candidates[0].action,
    });
    expect(lines[0]).toContain(' 1.');
    expect(lines[0]).toContain('do b');
    expect(lines[0]).not.toContain('→');
    expect(lines[1]).toContain('→');
    expect(lines[1]).toContain('do a');
  });

  test('keeps the pick visible even when it ranks below the printed rows', () => {
    const candidates: ConsideredAction[] = Array.from({ length: 8 }, (_, i) => ({
      action: action(`a${i}`),
      weight: 10 - i,
    }));
    const lines = renderCandidateRanking({
      describe: describe_,
      candidates,
      picked: candidates[7].action,
      maxRows: 3,
    });
    // Three rows, the appended pick, and the "and N more" tail.
    expect(lines).toHaveLength(5);
    expect(lines.some(line => line.includes('→') && line.includes('do a7'))).toBe(true);
    expect(lines[lines.length - 1]).toContain('and 4 more');
  });
});
