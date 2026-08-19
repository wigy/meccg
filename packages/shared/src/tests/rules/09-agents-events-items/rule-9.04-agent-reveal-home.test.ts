/**
 * @module rule-9.04-agent-reveal-home
 *
 * CoE Rules — Section 9: Agents, Events, Items & Rings
 * Rule 9.04: Agent Reveal at Home Site
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Revealing an agent hazard at its home site is not considered movement. A site card from the agent player's location deck that is listed as one of the agent's home sites must be placed with the agent when it is revealed; if the agent player does not have an available site in their location deck, the agent is immediately discarded at the end of the current turn.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, makeMHState, viableActions,
  PLAYER_1, PLAYER_2, HAZARD_PLAYER,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
} from '../../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, CompanyId } from '../../../index.js';
import { Phase, CardStatus, ZERO_EFFECTIVE_STATS } from '../../../index.js';
import type { AgentInPlay, CharacterInPlay } from '../../../index.js';

const ANARIN = 'dm-1' as CardDefinitionId;   // homesite: "Moria"

const AGENT_CHAR_ID = 'test-home-agent-char' as CardInstanceId;
const MORIA_SITE_ID = 'test-home-moria-site' as CardInstanceId;

const AGENT_CHAR: CharacterInPlay = {
  instanceId: AGENT_CHAR_ID,
  definitionId: ANARIN,
  status: CardStatus.Untapped,
  items: [],
  allies: [],
  hazards: [],
  followers: [],
  controlledBy: 'general',
  effectiveStats: ZERO_EFFECTIVE_STATS,
};

/** Build a state with a face-down agent (siteStack=[]) and Moria in the hazard player's siteDeck. */
function buildAgentAtHomeSite() {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
    ],
  });

  const agent: AgentInPlay = {
    id: 'agent-0-0' as CompanyId,
    character: AGENT_CHAR,
    revealed: false,
    siteStack: [],  // empty — home site placed at reveal (rule 9.04)
    remainingActions: 1,
    inPlayAtTurnStart: true,
    attackedThisSitePhase: false,
    discardAtEndOfTurn: false,
  };

  // Add Moria to hazard player's siteDeck as the home site
  const moriaSiteCard = { instanceId: MORIA_SITE_ID, definitionId: MORIA };

  return {
    ...base,
    players: [
      base.players[0],
      {
        ...base.players[1],
        agents: [agent],
        siteDeck: [...base.players[1].siteDeck, moriaSiteCard],
      },
    ] as unknown as typeof base.players,
    phaseState: makeMHState({ hazardLimitAtReveal: 2, hazardsPlayedThisCompany: 0 }),
  };
}

describe('Rule 9.04 — Agent Reveal at Home Site', () => {
  beforeEach(() => resetMint());

  test('revealing at home site is not movement — always legal; home site placed at reveal from location deck', () => {
    const state = buildAgentAtHomeSite();
    const revealActions = viableActions(state, PLAYER_2, 'reveal-agent');
    // One action: reveal Anarin at Moria
    expect(revealActions.length).toBe(1);

    const after = dispatch(state, revealActions[0].action);
    const agent = after.players[HAZARD_PLAYER].agents[0];
    expect(agent.revealed).toBe(true);
    expect(agent.siteStack.length).toBe(1);
    expect(agent.siteStack[0].instanceId).toBe(MORIA_SITE_ID);
    // Agent NOT in discard — reveal at homesite is always legal
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === ANARIN)).toBe(false);
    // Moria removed from location deck
    expect(after.players[HAZARD_PLAYER].siteDeck.every(s => s.instanceId !== MORIA_SITE_ID)).toBe(true);
  });

  test('reveal-agent offered even when no matching home site in location deck — revealed without site, discarded at end of turn (rule 9.04)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        // No Moria in hazard player's siteDeck
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const agent: AgentInPlay = {
      id: 'agent-0-0' as CompanyId,
      character: AGENT_CHAR,
      revealed: false,
      siteStack: [],
      remainingActions: 1,
      inPlayAtTurnStart: true,
      attackedThisSitePhase: false,
    discardAtEndOfTurn: false,
    };

    const state = {
      ...base,
      players: [
        base.players[0],
        { ...base.players[1], agents: [agent] },
      ] as unknown as typeof base.players,
      phaseState: makeMHState({ hazardLimitAtReveal: 2, hazardsPlayedThisCompany: 0 }),
    };

    const revealActions = viableActions(state, PLAYER_2, 'reveal-agent');
    // Reveal is offered without a homeSiteInstanceId
    expect(revealActions.length).toBe(1);
    const revealAction = revealActions[0].action as { homeSiteInstanceId?: unknown };
    expect(revealAction.homeSiteInstanceId).toBeUndefined();

    // After dispatch, agent is revealed with empty siteStack (will be discarded at end of turn)
    const after = dispatch(state, revealActions[0].action);
    const revealedAgent = after.players[HAZARD_PLAYER].agents[0];
    expect(revealedAgent.revealed).toBe(true);
    expect(revealedAgent.siteStack.length).toBe(0);
  });

  test('agent revealed without home site is discarded at end of turn (rule 9.04)', () => {
    // Turns strictly alternate, so a player's own untap phase always follows
    // a turn during which THEY were the hazard player. An agent this player
    // revealed without a home site during the preceding turn therefore lives
    // in their own `agents` zone (PLAYER_1) by the time PLAYER_1's untap runs.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const agent: AgentInPlay = {
      id: 'agent-0-0' as CompanyId,
      character: AGENT_CHAR,
      revealed: true,
      siteStack: [],
      remainingActions: 1,
      inPlayAtTurnStart: true,
      attackedThisSitePhase: false,
      discardAtEndOfTurn: true,
    };

    const state = {
      ...base,
      players: [
        { ...base.players[0], agents: [agent] },
        base.players[1],
      ] as unknown as typeof base.players,
    };

    // Dispatch the 'untap' action (resource player untaps — triggers performUntap which discards)
    const after = dispatch(state, { type: 'untap', player: PLAYER_1 });

    // Agent is gone from its owner's (PLAYER_1's) zone
    expect(after.players[0].agents).toHaveLength(0);
    // Character card ends up in its owning player's discard pile
    expect(after.players[0].discardPile.some(c => c.instanceId === AGENT_CHAR_ID)).toBe(true);
  });

  test('agent revealed without home site during opponent\'s turn is NOT discarded until its own owner\'s next untap, not delayed an extra turn', () => {
    // Reproduces a reported bug: an agent revealed as hazard during the
    // opponent's turn was only discarded two turns later (on the opponent's
    // own subsequent untap) instead of at the very next untap phase (its
    // owner's own, which immediately follows per rule 9.04).
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const agent: AgentInPlay = {
      id: 'agent-0-0' as CompanyId,
      character: AGENT_CHAR,
      revealed: true,
      siteStack: [],
      remainingActions: 1,
      inPlayAtTurnStart: true,
      attackedThisSitePhase: false,
      discardAtEndOfTurn: true,
    };

    // PLAYER_2 owns the agent — it was revealed as a hazard during PLAYER_1's
    // preceding turn. PLAYER_2's own untap phase (starting their next turn,
    // right after PLAYER_1's) is where the discard must happen.
    const state = {
      ...base,
      activePlayer: PLAYER_2,
      players: [
        base.players[0],
        { ...base.players[1], agents: [agent] },
      ] as unknown as typeof base.players,
    };

    const after = dispatch(state, { type: 'untap', player: PLAYER_2 });

    expect(after.players[1].agents).toHaveLength(0);
    expect(after.players[1].discardPile.some(c => c.instanceId === AGENT_CHAR_ID)).toBe(true);
  });
});
