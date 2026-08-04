/**
 * @module ai/heuristic.test
 *
 * Regression for a game where the "AI-Heuristic" strategy played Marvels
 * Told and picked, among several equally-legal `discardTargetInstanceId`
 * options, the one attached to the *opponent's* character — discarding a
 * hazard event it had itself cast against that opponent, which relieves
 * the opponent instead of the AI. See `discardTargetsOpponentHazard` in
 * `evaluators/common.ts` for the underlying fix.
 */

import { describe, test, expect } from 'vitest';
import type { GameAction, PlayerView } from '@meccg/shared';
import { heuristicStrategy } from './heuristic.js';
import type { AiContext } from './strategy.js';

function marvelsToldAction(discardTargetInstanceId: string): GameAction {
  return {
    type: 'play-short-event',
    player: 'p2',
    cardInstanceId: 'p2-22',
    targetScoutInstanceId: 'p2-107',
    discardTargetInstanceId,
  } as unknown as GameAction;
}

describe('discard-in-play short events (Marvels Told and its kin)', () => {
  test('never weighs a target attached to the opponent\'s character above zero', () => {
    // Mirrors the reported game: "own-hazard" (le-112, Foolish Words) is
    // attached to our own character; "opponent-hazard" is the copy we
    // ourselves played onto the opponent's Faramir.
    const view = {
      phaseState: { phase: 'movement-hazard' },
      self: {
        hand: [],
        characters: {
          'p2-107': { hazards: [{ instanceId: 'own-hazard', definitionId: 'le-112' }] },
        },
      },
      opponent: {
        companies: [],
        characters: {
          'p1-101': { hazards: [{ instanceId: 'opponent-hazard', definitionId: 'le-112' }] },
        },
      },
    } as unknown as PlayerView;

    const ownTarget = marvelsToldAction('own-hazard');
    const opponentTarget = marvelsToldAction('opponent-hazard');
    const context: AiContext = {
      view,
      cardPool: {},
      legalActions: [ownTarget, opponentTarget],
    } as unknown as AiContext;

    const weighted = heuristicStrategy.weighActions(context);
    const ownWeight = weighted.find(w => w.action === ownTarget)?.weight;
    const opponentWeight = weighted.find(w => w.action === opponentTarget)?.weight;

    expect(opponentWeight).toBe(0);
    expect(ownWeight).toBeGreaterThan(0);
  });
});
