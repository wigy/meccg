/**
 * @module rule-9.00-agent-state-model
 *
 * CoE Rules — Section 9: Agents, Events, Items & Rings
 * Rule 9.00: Agent state model — AgentInPlay type, PlayerState.agents field,
 * projection (SelfView / OpponentAgentView), and serialization round-trip.
 *
 * Source: specs/2026-04-22-agents-plan.md §3.1
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA,
} from '../../test-helpers.js';
import { CardStatus } from '../../../index.js';
import type { GameState } from '../../../index.js';
import type {
  AgentInPlay,
  CardInstanceId,
  CardDefinitionId,
  CompanyId,
} from '../../../index.js';

/** Build a minimal stub AgentInPlay for use in state patches. */
function makeStubAgent(
  id: string,
  characterInstanceId: string,
  characterDefinitionId: string,
  siteInstanceId: string,
  siteDefinitionId: string,
  revealed: boolean,
): AgentInPlay {
  return {
    id: id as CompanyId,
    character: {
      instanceId: characterInstanceId as CardInstanceId,
      definitionId: characterDefinitionId as CardDefinitionId,
      status: CardStatus.Untapped,
      items: [],
      allies: [],
      hazards: [],
      followers: [],
      controlledBy: 'general',
      effectiveStats: { prowess: 3, body: 8, directInfluence: 0, corruptionPoints: 0 },
    },
    revealed,
    siteStack: [{
      instanceId: siteInstanceId as CardInstanceId,
      definitionId: siteDefinitionId as CardDefinitionId,
      status: CardStatus.Untapped,
    }],
    remainingActions: 1,
    inPlayAtTurnStart: false,
    attackedThisSitePhase: false,
    discardAtEndOfTurn: false,
  };
}

describe('Rule 9.00 — Agent state model', () => {
  beforeEach(() => resetMint());

  test('PlayerState.agents initialises as empty array', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    expect(state.players[0].agents).toEqual([]);
    expect(state.players[1].agents).toEqual([]);
  });

  test('agents field survives JSON serialisation round-trip (no agents)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const roundTripped = JSON.parse(JSON.stringify(state)) as GameState;
    expect(roundTripped.players[0].agents).toEqual([]);
    expect(roundTripped.players[1].agents).toEqual([]);
  });

  test('agents field survives JSON serialisation round-trip (with agent)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });

    const agent = makeStubAgent(
      'p2-agent-1',
      'p2-char-agent-1',
      'dm-1',
      'p2-site-agent-1',
      'tw-100',
      false,
    );

    const stateWithAgent = {
      ...base,
      players: [
        base.players[0],
        { ...base.players[1], agents: [agent] },
      ] as typeof base.players,
    };

    const roundTripped = JSON.parse(JSON.stringify(stateWithAgent)) as GameState;

    // Agent array and scalar fields preserved
    expect(roundTripped.players[1].agents).toHaveLength(1);
    const rt = roundTripped.players[1].agents[0];
    expect(rt.id).toBe('p2-agent-1');
    expect(rt.revealed).toBe(false);
    expect(rt.remainingActions).toBe(1);
    expect(rt.inPlayAtTurnStart).toBe(false);
    expect(rt.attackedThisSitePhase).toBe(false);
    expect(rt.discardAtEndOfTurn).toBe(false);

    // Character identity preserved
    expect(rt.character.instanceId).toBe('p2-char-agent-1');
    expect(rt.character.definitionId).toBe('dm-1');
    expect(rt.character.status).toBe(CardStatus.Untapped);
    expect(rt.character.items).toEqual([]);

    // Site stack preserved
    expect(rt.siteStack).toHaveLength(1);
    expect(rt.siteStack[0].instanceId).toBe('p2-site-agent-1');
    expect(rt.siteStack[0].definitionId).toBe('tw-100');
  });

  test('face-down agent: character stays in agents, not in player.characters', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });

    const agent = makeStubAgent(
      'p2-agent-1',
      'p2-char-agent-1',
      'dm-1',
      'p2-site-agent-1',
      'tw-100',
      false,
    );

    const stateWithAgent = {
      ...base,
      players: [
        base.players[0],
        { ...base.players[1], agents: [agent] },
      ] as typeof base.players,
    };

    // Agent character must NOT appear in player.characters
    const p2 = stateWithAgent.players[1];
    expect(Object.keys(p2.characters)).not.toContain('p2-char-agent-1');
    // But must be accessible via the agents array
    expect(p2.agents[0].character.instanceId).toBe('p2-char-agent-1');
  });

  test('multiple agents preserve insertion order after round-trip', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });

    const agent1 = makeStubAgent('p2-agent-1', 'p2-char-1', 'dm-1', 'p2-site-1', 'tw-100', false);
    const agent2 = makeStubAgent('p2-agent-2', 'p2-char-2', 'dm-2', 'p2-site-2', 'tw-101', true);

    const stateWithAgents = {
      ...base,
      players: [
        base.players[0],
        { ...base.players[1], agents: [agent1, agent2] },
      ] as typeof base.players,
    };

    const rt = (JSON.parse(JSON.stringify(stateWithAgents)) as GameState).players[1].agents;
    expect(rt).toHaveLength(2);
    expect(rt[0].id).toBe('p2-agent-1');
    expect(rt[1].id).toBe('p2-agent-2');
    expect(rt[1].revealed).toBe(true);
  });
});
