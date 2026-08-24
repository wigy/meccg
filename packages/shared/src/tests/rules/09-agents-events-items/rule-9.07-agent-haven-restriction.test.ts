/**
 * @module rule-9.07-agent-haven-restriction
 *
 * CoE Rules — Section 9: Agents, Events, Items & Rings
 * Rule 9.07: Agent Haven Movement Restriction
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * An agent hazard cannot move to any version of a site that corresponds to a Haven for Wizard players (including Edhellond, Grey Havens, Lórien, and Rivendell), and cannot move to a site that corresponds to a Wizardhaven in play unless it is an Elf agent. If a non-Elf agent hazard is revealed and any of the sites through which it moved are currently a Haven or Wizardhaven in play, the agent is discarded even if the movement was legal when the agent originally moved face-down.
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
import type { AgentInPlay, CharacterInPlay, SiteInPlay } from '../../../index.js';

const ANARIN = 'dm-1' as CardDefinitionId;   // homesite: "Moria"

const AGENT_CHAR_ID = 'test-h07-agent-char' as CardInstanceId;
const MORIA_SITE_ID = 'test-h07-moria-site' as CardInstanceId;
const RIVENDELL_SITE_ID = 'test-h07-rivendell-site' as CardInstanceId;

const AGENT_CHAR: CharacterInPlay = {
  instanceId: AGENT_CHAR_ID,
  definitionId: ANARIN,
  status: CardStatus.Untapped,
  items: [], allies: [], hazards: [], followers: [],
  controlledBy: 'general',
  effectiveStats: ZERO_EFFECTIVE_STATS,
};

const RIVENDELL_SITE: SiteInPlay = {
  instanceId: RIVENDELL_SITE_ID,
  definitionId: RIVENDELL,
  status: CardStatus.Untapped,
};

describe('Rule 9.07 — Agent Haven Movement Restriction', () => {
  beforeEach(() => resetMint());

  test('agent cannot move to Rivendell (a Haven site) during agent-move', () => {
    // Agent at Moria; Rivendell is adjacent to some sites but is a Haven.
    // Rivendell should NOT appear as a destination in agent-move actions.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL, MORIA] },
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

    const withAgent = {
      ...state,
      players: [
        state.players[0],
        { ...state.players[1], agents: [agent] },
      ] as unknown as typeof state.players,
      phaseState: makeMHState({ hazardLimitAtReveal: 4, hazardsPlayedThisCompany: 0 }),
    };

    const moveActions = viableActions(withAgent, PLAYER_2, 'agent-move');
    // None of the move destinations should be Rivendell
    const toRivendell = moveActions.filter(a =>
      (a.action as { destinationSiteInstanceId: CardInstanceId }).destinationSiteInstanceId === RIVENDELL_SITE_ID,
    );
    expect(toRivendell).toHaveLength(0);
  });

  test('agent cannot move to Lórien (a Haven site) during agent-move', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN, MORIA] },
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

    const lorienSiteId = 'test-h07-lorien-dest' as CardInstanceId;
    const withAgent = {
      ...state,
      players: [
        state.players[0],
        {
          ...state.players[1],
          agents: [agent],
          siteDeck: [
            { instanceId: lorienSiteId, definitionId: LORIEN },
            { instanceId: MORIA_SITE_ID, definitionId: MORIA },
          ],
        },
      ] as unknown as typeof state.players,
      phaseState: makeMHState({ hazardLimitAtReveal: 4, hazardsPlayedThisCompany: 0 }),
    };

    const moveActions = viableActions(withAgent, PLAYER_2, 'agent-move');
    const toLorien = moveActions.filter(a =>
      (a.action as { destinationSiteInstanceId: CardInstanceId }).destinationSiteInstanceId === lorienSiteId,
    );
    expect(toLorien).toHaveLength(0);
  });

  test('agent revealed with Haven site in prior siteStack is immediately discarded (rule 9.07)', () => {
    // Simulate an agent that (illegally) has Rivendell in its movement path.
    // On reveal, the engine checks the siteStack and discards the agent.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL, MORIA] },
      ],
    });

    // Agent with Rivendell (a Haven) as prior stack entry
    const agent: AgentInPlay = {
      id: 'agent-0-0' as CompanyId,
      character: AGENT_CHAR,
      revealed: false,
      siteStack: [RIVENDELL_SITE],  // passed through a Haven
      remainingActions: 1,
      inPlayAtTurnStart: true,
      attackedThisSitePhase: false,
      discardAtEndOfTurn: false,
    };

    const moriaSiteCard = { instanceId: MORIA_SITE_ID, definitionId: MORIA };
    const withAgent = {
      ...state,
      players: [
        state.players[0],
        { ...state.players[1], agents: [agent], siteDeck: [moriaSiteCard] },
      ] as unknown as typeof state.players,
      phaseState: makeMHState({ hazardLimitAtReveal: 2, hazardsPlayedThisCompany: 0 }),
    };

    // Reveal-agent is offered (the restriction is enforced at reveal time, not before)
    const revealActions = viableActions(withAgent, PLAYER_2, 'reveal-agent');
    expect(revealActions.length).toBeGreaterThan(0);

    const after = dispatch(withAgent, revealActions[0].action);

    // Agent discarded (moved through a Haven)
    expect(after.players[HAZARD_PLAYER].agents).toHaveLength(0);
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === AGENT_CHAR_ID)).toBe(true);
    // Regression: the chosen home site was never taken out of the location
    // deck, so the discard must leave it there, and the stack site returns to
    // the deck — the home-site instance used to be deleted from the deck
    // entirely, vanishing from the game state.
    expect(after.players[HAZARD_PLAYER].siteDeck.some(s => s.instanceId === MORIA_SITE_ID)).toBe(true);
    expect(after.players[HAZARD_PLAYER].siteDeck.some(s => s.instanceId === RIVENDELL_SITE_ID)).toBe(true);
  });
});
