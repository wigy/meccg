/**
 * @module dm-2
 *
 * Card: Baduila (dm-2)
 * Type: minion-character (ringwraith alignment)
 * Homesite: Goblin-gate, Mount Gundabad
 * Prowess: 6, Body: 8, Mind: 8, DI: 2, MP: 3
 * Skills: warrior, scout, ranger. Keywords: agent
 *
 * Rules:
 * - Unique. Agent.
 * - Agent only: if you choose to discard Baduila at target company's new
 *   site, company must return to its site of origin.
 *   (CRF: read "If Baduila is discarded" as "If you choose to discard Baduila.")
 *
 * The agent-discard-return-to-origin ability discards the agent (not as an
 * agent action, not against the hazard limit) at the moving company's new
 * site during the opponent's M/H phase. Per CoE rule 2.IV.4 the company's
 * movement/hazard phase immediately ends, the company stays at its site of
 * origin (no site path, not moved this turn), and its player cannot initiate
 * any actions during that company's site phase.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, makeMHState, viableActions,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, LEGOLAS,
  LORIEN, MORIA,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, CompanyId, GameState } from '../../index.js';
import { Phase, CardStatus, Alignment, ZERO_EFFECTIVE_STATS } from '../../index.js';
import type { AgentInPlay, CharacterInPlay, SiteInPlay } from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';

const BADUILA = 'dm-2' as CardDefinitionId;
const DOL_GULDUR = 'tw-387' as CardDefinitionId;

const AGENT_CHAR_ID = 'test-dm2-agent-char' as CardInstanceId;
const DOL_GULDUR_SITE_ID = 'test-dm2-dol-guldur-site' as CardInstanceId;

const AGENT_CHAR: CharacterInPlay = {
  instanceId: AGENT_CHAR_ID,
  definitionId: BADUILA,
  status: CardStatus.Untapped,
  items: [], allies: [], hazards: [], followers: [],
  controlledBy: 'general',
  effectiveStats: ZERO_EFFECTIVE_STATS,
};

const DOL_GULDUR_SITE: SiteInPlay = {
  instanceId: DOL_GULDUR_SITE_ID,
  definitionId: DOL_GULDUR,
  status: CardStatus.Untapped,
};

/**
 * A game state with a P1 hero company at Lórien moving to Dol Guldur and the
 * given Baduila agent in the Ringwraith hazard player's agents array.
 */
function stateWithAgent(agent: AgentInPlay): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: LORIEN, characters: [ARAGORN], destinationSite: DOL_GULDUR }],
        hand: [],
        siteDeck: [DOL_GULDUR],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Ringwraith,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [],
        siteDeck: [],
      },
    ],
  });
  return {
    ...state,
    players: [
      state.players[0],
      { ...state.players[1], agents: [agent] },
    ] as unknown as typeof state.players,
    phaseState: makeMHState({ hazardLimitAtReveal: 5, hazardsPlayedThisCompany: 0, destinationSiteName: 'Dol Guldur' }),
  };
}

const BASE_AGENT: AgentInPlay = {
  id: 'agent-0-0' as CompanyId,
  character: AGENT_CHAR,
  revealed: true,
  siteStack: [DOL_GULDUR_SITE],
  remainingActions: 1,
  inPlayAtTurnStart: true,
  attackedThisSitePhase: false,
  discardAtEndOfTurn: false,
};

describe('dm-2 — Baduila', () => {
  beforeEach(() => resetMint());

  test('discarding Baduila at the company\'s new site returns the company to its site of origin', () => {
    const withAgent = stateWithAgent(BASE_AGENT);
    const originInstanceId = withAgent.players[RESOURCE_PLAYER].companies[0].currentSite!.instanceId;
    const companyId = withAgent.players[RESOURCE_PLAYER].companies[0].id;

    const discardActions = viableActions(withAgent, PLAYER_2, 'agent-discard-return-to-origin');
    expect(discardActions.length).toBe(1);

    const after = dispatch(withAgent, discardActions[0].action);

    // Baduila is discarded: gone from agents, card in the hazard player's
    // discard pile, her site-stack site back in the hazard player's site deck.
    expect(after.players[1].agents).toHaveLength(0);
    expect(after.players[1].discardPile.some(c => c.instanceId === AGENT_CHAR_ID)).toBe(true);
    expect(after.players[1].siteDeck.some(c => c.instanceId === DOL_GULDUR_SITE_ID)).toBe(true);

    // The company did NOT move: it remains at its site of origin (Lórien),
    // has no destination, and is not considered to have moved this turn.
    const company = after.players[RESOURCE_PLAYER].companies[0];
    expect(company.currentSite?.instanceId).toBe(originInstanceId);
    expect(company.currentSite?.definitionId).toBe(LORIEN);
    expect(company.destinationSite).toBeNull();
    expect(company.moved).toBe(false);
    // The destination site was never consumed from the location deck.
    expect(after.players[RESOURCE_PLAYER].siteDeck.some(c => c.definitionId === DOL_GULDUR)).toBe(true);

    // Rule 2.IV.4: a site-phase-do-nothing constraint blocks the company's
    // site phase, sourced from the discarded Baduila.
    expect(after.activeConstraints.some(
      c => c.kind.type === 'site-phase-do-nothing'
        && c.target.kind === 'company' && c.target.companyId === companyId
        && c.sourceDefinitionId === BADUILA,
    )).toBe(true);

    // Rule 2.IV.4: the company's movement/hazard phase immediately ended —
    // with no other company to handle, the game is in the site phase.
    expect(after.phaseState.phase).toBe(Phase.Site);
  });

  test('after the forced return, the company can only pass during its site phase', () => {
    const withAgent = stateWithAgent(BASE_AGENT);
    const companyId = withAgent.players[RESOURCE_PLAYER].companies[0].id;

    const discardActions = viableActions(withAgent, PLAYER_2, 'agent-discard-return-to-origin');
    const inSitePhase = dispatch(withAgent, discardActions[0].action);
    expect(inSitePhase.phaseState.phase).toBe(Phase.Site);

    const atEnterOrSkip = dispatch(inSitePhase, { type: 'select-company', player: PLAYER_1, companyId: companyId as never });

    const viableTypes = new Set(
      computeLegalActions(atEnterOrSkip, PLAYER_1).filter(ea => ea.viable).map(ea => ea.action.type),
    );
    // CoE 2.IV.4: "the company's player cannot initiate any actions during
    // that company's site phase" — the only legal action is to pass.
    expect(viableTypes.has('enter-site')).toBe(false);
    expect([...viableTypes]).toEqual(['pass']);
  });

  test('a tapped Baduila may still be discarded — the ability requires no tap', () => {
    const tappedAgent: AgentInPlay = {
      ...BASE_AGENT,
      character: { ...AGENT_CHAR, status: CardStatus.Tapped },
    };
    const withAgent = stateWithAgent(tappedAgent);

    const discardActions = viableActions(withAgent, PLAYER_2, 'agent-discard-return-to-origin');
    expect(discardActions.length).toBe(1);
  });

  test('a face-down Baduila at the company\'s new site may be discarded', () => {
    const faceDownAgent: AgentInPlay = { ...BASE_AGENT, revealed: false };
    const withAgent = stateWithAgent(faceDownAgent);
    const originInstanceId = withAgent.players[RESOURCE_PLAYER].companies[0].currentSite!.instanceId;

    // A single action — no home-site binding is needed for a discard.
    const discardActions = viableActions(withAgent, PLAYER_2, 'agent-discard-return-to-origin');
    expect(discardActions.length).toBe(1);

    const after = dispatch(withAgent, discardActions[0].action);
    expect(after.players[1].agents).toHaveLength(0);
    expect(after.players[1].discardPile.some(c => c.instanceId === AGENT_CHAR_ID)).toBe(true);
    expect(after.players[1].siteDeck.some(c => c.instanceId === DOL_GULDUR_SITE_ID)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].companies[0].currentSite?.instanceId).toBe(originInstanceId);
  });

  test('action not offered when Baduila is at a different site than the company\'s new site', () => {
    const agentAtMoria: AgentInPlay = {
      ...BASE_AGENT,
      siteStack: [{
        instanceId: 'test-dm2-moria-site' as CardInstanceId,
        definitionId: MORIA,
        status: CardStatus.Untapped,
      }],
    };
    const withAgent = stateWithAgent(agentAtMoria);

    const discardActions = viableActions(withAgent, PLAYER_2, 'agent-discard-return-to-origin');
    expect(discardActions).toHaveLength(0);
  });

  test('action not offered against a stationary company — it has no new site', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });
    // Baduila is at the company's CURRENT site — but the company is not moving.
    const lorienSite: SiteInPlay = {
      instanceId: 'test-dm2-lorien-site' as CardInstanceId,
      definitionId: LORIEN,
      status: CardStatus.Untapped,
    };
    const withAgent = {
      ...state,
      players: [
        state.players[0],
        { ...state.players[1], agents: [{ ...BASE_AGENT, siteStack: [lorienSite] }] },
      ] as unknown as typeof state.players,
      phaseState: makeMHState({ hazardLimitAtReveal: 5, hazardsPlayedThisCompany: 0 }),
    };

    const discardActions = viableActions(withAgent, PLAYER_2, 'agent-discard-return-to-origin');
    expect(discardActions).toHaveLength(0);
  });

  test('action not offered when Baduila is wounded', () => {
    const woundedAgent: AgentInPlay = {
      ...BASE_AGENT,
      character: { ...AGENT_CHAR, status: CardStatus.Inverted },
      remainingActions: 0,
    };
    const withAgent = stateWithAgent(woundedAgent);

    const discardActions = viableActions(withAgent, PLAYER_2, 'agent-discard-return-to-origin');
    expect(discardActions).toHaveLength(0);
  });

  test('action not offered when Baduila was not in play at turn start', () => {
    const newAgent: AgentInPlay = { ...BASE_AGENT, inPlayAtTurnStart: false };
    const withAgent = stateWithAgent(newAgent);

    const discardActions = viableActions(withAgent, PLAYER_2, 'agent-discard-return-to-origin');
    expect(discardActions).toHaveLength(0);
  });
});
