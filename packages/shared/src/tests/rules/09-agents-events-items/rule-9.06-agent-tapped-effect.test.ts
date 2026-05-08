/**
 * @module rule-9.06-agent-tapped-effect
 *
 * CoE Rules — Section 9: Agents, Events, Items & Rings
 * Rule 9.06: Agent Tapped for Effect
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * If a player declares that a face-down agent hazard is being tapped to initiate a hazard effect, the player must reveal the agent as an active condition of the effect, but the agent is still treated as if it was face-down at the time of declaration.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, makeMHState, viableActions,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  LORIEN, MORIA, MINAS_TIRITH,
} from '../../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, CompanyId, PlayHazardAction } from '../../../index.js';
import { Phase, CardStatus, ZERO_EFFECTIVE_STATS } from '../../../index.js';
import type { AgentInPlay, CharacterInPlay, SiteInPlay } from '../../../index.js';

// An Article Missing (scout agent tap, +4 prowess, attacker assigns, discard-item on hit)
const AN_ARTICLE_MISSING = 'dm-43' as CardDefinitionId;
// Anarin — scout agent (homesite: Moria), prowess 4
const ANARIN = 'dm-1' as CardDefinitionId;

const AGENT_CHAR_ID = 'test-a06-agent-char' as CardInstanceId;
const MORIA_SITE_ID = 'test-a06-moria-site' as CardInstanceId;
const HOME_SITE_DECK_ID = 'test-a06-moria-deck' as CardInstanceId;

const AGENT_CHAR: CharacterInPlay = {
  instanceId: AGENT_CHAR_ID,
  definitionId: ANARIN,
  status: CardStatus.Untapped,
  items: [], allies: [], hazards: [], followers: [],
  controlledBy: 'general',
  effectiveStats: ZERO_EFFECTIVE_STATS,
};

const MORIA_SITE: SiteInPlay = {
  instanceId: MORIA_SITE_ID,
  definitionId: MORIA,
  status: CardStatus.Untapped,
};

describe('Rule 9.06 — Agent Tapped for Effect', () => {
  beforeEach(() => resetMint());

  test('face-down agent at destination site revealed when tapped by An Article Missing', () => {
    // Anarin (scout) is face-down at Moria (company's destination and his home site).
    // An Article Missing taps him, reveals him, and sets up M/H phase combat.
    // Rule 9.06: treated as face-down at declaration → +5 prowess (face-down at-home).
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [ARAGORN], destinationSite: MORIA }],
          hand: [],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [AN_ARTICLE_MISSING],
          siteDeck: [MORIA],
        },
      ],
    });

    // Agent: face-down, siteStack = [Moria] (at the company's destination)
    const agent: AgentInPlay = {
      id: 'agent-0-0' as CompanyId,
      character: AGENT_CHAR,
      revealed: false,
      siteStack: [MORIA_SITE],
      remainingActions: 1,
      inPlayAtTurnStart: true,
      attackedThisSitePhase: false,
      discardAtEndOfTurn: false,
    };

    // Home site instance in hazard player's site deck (for the reveal-with-home-site path)
    const homeSiteInDeck: SiteInPlay = { instanceId: HOME_SITE_DECK_ID, definitionId: MORIA, status: CardStatus.Untapped };

    const withAgent = {
      ...state,
      players: [
        state.players[0],
        {
          ...state.players[1],
          agents: [agent],
          siteDeck: [homeSiteInDeck],
        },
      ] as unknown as typeof state.players,
      phaseState: makeMHState({ hazardLimitAtReveal: 4, hazardsPlayedThisCompany: 0, destinationSiteName: 'Moria' }),
    };

    // The play-hazard action for An Article Missing should be offered with agentInstanceId
    const hazardActions = viableActions(withAgent, PLAYER_2, 'play-hazard');
    const tapActions = hazardActions.filter(a =>
      (a.action as PlayHazardAction).agentInstanceId === AGENT_CHAR_ID,
    );
    expect(tapActions.length).toBeGreaterThan(0);

    // Dispatch the action — should reveal the agent and set up combat
    const after = dispatch(withAgent, tapActions[0].action);

    // Agent is now revealed and tapped
    const agentAfter = after.players[1].agents.find(a => a.character.instanceId === AGENT_CHAR_ID);
    expect(agentAfter).toBeDefined();
    expect(agentAfter!.revealed).toBe(true);
    expect(agentAfter!.character.status).toBe(CardStatus.Tapped);
    expect(agentAfter!.remainingActions).toBe(0);

    // Combat is active
    expect(after.combat).not.toBeNull();
    expect(after.combat!.attackSource).toMatchObject({ type: 'agent', instanceId: AGENT_CHAR_ID });

    // Prowess: base 4 (Anarin) + 5 (face-down at-home, Moria is Anarin's homesite) + 4 (card bonus) = 13
    expect(after.combat!.strikeProwess).toBe(13);

    // Attacker assigns (An Article Missing: "Attacker chooses defending characters")
    expect(after.combat!.assignmentPhase).toBe('attacker');

    // The card is in the discard pile (short event)
    const cardDef = state.cardPool[AN_ARTICLE_MISSING as string];
    expect(after.players[1].discardPile.some(c => c.definitionId === AN_ARTICLE_MISSING)).toBe(true);
    void cardDef;
  });

  test('card not offered when no matching agent at destination site', () => {
    // The hazard player has An Article Missing but no scout agent at Moria.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [ARAGORN], destinationSite: MORIA }],
          hand: [],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [AN_ARTICLE_MISSING],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    // Agent is at Minas Tirith, NOT Moria
    const minasTirithSite: SiteInPlay = {
      instanceId: 'test-a06-minas' as CardInstanceId,
      definitionId: MINAS_TIRITH,
      status: CardStatus.Untapped,
    };
    const agent: AgentInPlay = {
      id: 'agent-0-0' as CompanyId,
      character: AGENT_CHAR,
      revealed: false,
      siteStack: [minasTirithSite],
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
      phaseState: makeMHState({ hazardLimitAtReveal: 4, hazardsPlayedThisCompany: 0, destinationSiteName: 'Moria' }),
    };

    const hazardActions = viableActions(withAgent, PLAYER_2, 'play-hazard');
    const tapActions = hazardActions.filter(a =>
      (a.action as PlayHazardAction).agentInstanceId === AGENT_CHAR_ID,
    );
    expect(tapActions).toHaveLength(0);
  });
});
