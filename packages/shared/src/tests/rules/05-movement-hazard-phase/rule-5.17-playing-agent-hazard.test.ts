/**
 * @module rule-5.17-playing-agent-hazard
 *
 * CoE Rules — Section 5: Movement/Hazard Phase
 * Rule 5.17: Playing an Agent Hazard
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Playing an Agent Hazard - As an action during a movement/hazard phase, the hazard player may play an agent as a hazard (i.e. it does not count as a character nor a creature). Playing an agent hazard counts as one against the hazard limit, and may be done regardless of whether the agent counts as a character or a hazard for its player's deck-building requirements. The agent is played face-down and untapped, never provides marshalling points to its own player even if that player defeats it, and is considered to be at one of its home sites (although no site card is necessary until the agent is revealed, at which point its starting site must be declared).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, makeMHState, viableActions,
  PLAYER_1, PLAYER_2, HAZARD_PLAYER,
  ARAGORN, LEGOLAS,
  MORIA, LORIEN, RIVENDELL,
} from '../../test-helpers.js';
import type { CardDefinitionId, MovementHazardPhaseState } from '../../../index.js';
import { Phase, CardStatus } from '../../../index.js';

const ANARIN = 'dm-1' as CardDefinitionId; // homesite: "Moria"

describe('Rule 5.17 — Playing an Agent Hazard', () => {
  beforeEach(() => resetMint());

  test('Agent hazard played face-down and untapped; counts against hazard limit; considered at home site', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ANARIN], siteDeck: [RIVENDELL] },
      ],
    });
    const withMH = { ...state, phaseState: makeMHState({ hazardLimitAtReveal: 4, hazardsPlayedThisCompany: 0 }) };

    const actions = viableActions(withMH, PLAYER_2, 'play-agent-hazard');
    expect(actions.length).toBeGreaterThan(0);

    const after = dispatch(withMH, actions[0].action);
    const hazardPlayer = after.players[HAZARD_PLAYER];
    const agent = hazardPlayer.agents[0];

    // Played face-down (not revealed)
    expect(agent.revealed).toBe(false);

    // Played untapped
    expect(agent.character.status).toBe(CardStatus.Untapped);

    // Counts against hazard limit: hazardsPlayedThisCompany incremented by 1
    expect((after.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany).toBe(1);

    // Considered at home site: empty siteStack means agent is at home (no site card needed until reveal)
    expect(agent.siteStack.length).toBe(0);
  });
});
