/**
 * @module dm-26.test
 *
 * Card test: Woffung (dm-26)
 * Type: minion-character (ringwraith)
 * Effects: none
 *
 * "Unique. Agent."
 *
 * Woffung is a plain agent with no "Agent only:" special abilities. Its whole
 * behaviour is the generic agent subsystem plus card uniqueness:
 *   - it may be played from hand as a face-down agent hazard (the `agent`
 *     keyword), costing one hazard slot;
 *   - once face-down it may be revealed at one of its home sites (it has three:
 *     Lake-town, Dale, Shrel-Kain — one reveal action per matching site in the
 *     location deck);
 *   - being unique, revealing a second Woffung while one is already face-up
 *     immediately discards the newcomer (rule 9.05).
 *
 * These tests drive the reducer / legal-action computation for that generic
 * path with Woffung as the subject; there is nothing card-specific to assert.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, makeMHState, viableActions,
  PLAYER_1, PLAYER_2, HAZARD_PLAYER,
  ARAGORN, LEGOLAS,
  MORIA, LORIEN, RIVENDELL,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, CompanyId, MovementHazardPhaseState } from '../../index.js';
import { Phase, CardStatus, ZERO_EFFECTIVE_STATS, Alignment } from '../../index.js';
import type { AgentInPlay, CharacterInPlay } from '../../index.js';

const WOFFUNG = 'dm-26' as CardDefinitionId;      // unique; homesite: "Lake-town, Dale, Shrel-Kain"
const LAKE_TOWN = 'le-385' as CardDefinitionId;   // minion-site, border-hold
const DALE = 'le-363' as CardDefinitionId;        // minion-site, border-hold
const SHREL_KAIN = 'le-403' as CardDefinitionId;  // minion-site, border-hold

/** A face-down/face-up Woffung agent in play. */
function makeWoffungAgent(opts: {
  agentId: string;
  charId: CardInstanceId;
  revealed?: boolean;
  siteStack?: AgentInPlay['siteStack'];
}): AgentInPlay {
  const character: CharacterInPlay = {
    instanceId: opts.charId,
    definitionId: WOFFUNG,
    status: CardStatus.Untapped,
    items: [],
    allies: [],
    hazards: [],
    followers: [],
    controlledBy: 'general',
    effectiveStats: ZERO_EFFECTIVE_STATS,
  };
  return {
    id: opts.agentId as CompanyId,
    character,
    revealed: opts.revealed ?? false,
    siteStack: opts.siteStack ?? [],
    remainingActions: 1,
    inPlayAtTurnStart: true,
    attackedThisSitePhase: false,
    discardAtEndOfTurn: false,
  };
}

describe('Woffung (dm-26)', () => {
  beforeEach(() => resetMint());

  test('may be played from hand as a face-down agent hazard (Agent keyword)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [WOFFUNG], siteDeck: [RIVENDELL], alignment: Alignment.Ringwraith },
      ],
    });
    const withMH = { ...state, phaseState: makeMHState({ hazardLimitAtReveal: 4, hazardsPlayedThisCompany: 0 }) };

    const actions = viableActions(withMH, PLAYER_2, 'play-agent-hazard');
    expect(actions.length).toBe(1);

    const before = withMH.phaseState.hazardsPlayedThisCompany;
    const after = dispatch(withMH, actions[0].action);
    const hazardPlayer = after.players[HAZARD_PLAYER];

    // Removed from hand, now a single face-down untapped agent (no site yet).
    expect(hazardPlayer.hand.some(c => c.definitionId === WOFFUNG)).toBe(false);
    expect(hazardPlayer.agents.length).toBe(1);
    const agent = hazardPlayer.agents[0];
    expect(agent.character.definitionId).toBe(WOFFUNG);
    expect(agent.revealed).toBe(false);
    expect(agent.character.status).toBe(CardStatus.Untapped);
    expect(agent.siteStack.length).toBe(0);

    // Costs one against the hazard limit (rule 5.17 / 2.IV.vii.1).
    expect((after.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany).toBe(before + 1);
  });

  test('face-down Woffung may be revealed at any of its three home sites', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [] },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [LAKE_TOWN, DALE, SHREL_KAIN],
          alignment: Alignment.Ringwraith,
        },
      ],
    });
    const agent = makeWoffungAgent({ agentId: 'agent-0-0', charId: 'woffung-char' as CardInstanceId });
    const withAgent = {
      ...state,
      players: [
        state.players[0],
        { ...state.players[1], agents: [agent] },
      ] as unknown as typeof state.players,
      phaseState: makeMHState({ hazardLimitAtReveal: 4, hazardsPlayedThisCompany: 0 }),
    };

    // One reveal action per matching home site in the location deck (all three).
    const reveals = viableActions(withAgent, PLAYER_2, 'reveal-agent');
    expect(reveals.length).toBe(3);

    // Reveal at the first offered home site: agent turns face-up, its home site
    // moves onto the site stack and out of the location deck (rule 9.03/9.04).
    const chosen = reveals[0].action as { homeSiteInstanceId: CardInstanceId };
    const chosenSiteId = chosen.homeSiteInstanceId;
    const before = withAgent.players[HAZARD_PLAYER].siteDeck.length;

    const after = dispatch(withAgent, reveals[0].action);
    const revealed = after.players[HAZARD_PLAYER].agents[0];
    expect(revealed.revealed).toBe(true);
    expect(revealed.siteStack.length).toBe(1);
    expect(revealed.siteStack[0].instanceId).toBe(chosenSiteId);
    // Home site removed from the location deck.
    expect(after.players[HAZARD_PLAYER].siteDeck.length).toBe(before - 1);
    expect(after.players[HAZARD_PLAYER].siteDeck.some(s => s.instanceId === chosenSiteId)).toBe(false);
  });

  test('unique: revealing a second Woffung while one is face-up discards the newcomer (rule 9.05)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [] },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [LAKE_TOWN],
          alignment: Alignment.Ringwraith,
        },
      ],
    });

    // One Woffung already face-up (at Dale), plus a fresh face-down Woffung.
    const faceUp = makeWoffungAgent({
      agentId: 'agent-1-0',
      charId: 'woffung-faceup' as CardInstanceId,
      revealed: true,
      siteStack: [{ instanceId: 'dale-site' as CardInstanceId, definitionId: DALE, status: CardStatus.Untapped }],
    });
    const faceDown = makeWoffungAgent({ agentId: 'agent-0-0', charId: 'woffung-facedown' as CardInstanceId });

    const withAgents = {
      ...state,
      players: [
        state.players[0],
        { ...state.players[1], agents: [faceDown, faceUp] },
      ] as unknown as typeof state.players,
      phaseState: makeMHState({ hazardLimitAtReveal: 4, hazardsPlayedThisCompany: 0 }),
    };

    const reveals = viableActions(withAgents, PLAYER_2, 'reveal-agent');
    const faceDownReveal = reveals.find(
      a => (a.action as { agentId: CompanyId }).agentId === ('agent-0-0' as CompanyId),
    );
    expect(faceDownReveal).toBeDefined();

    const after = dispatch(withAgents, faceDownReveal!.action);
    // The newly-revealed copy is discarded; only the original face-up remains.
    const faceUpAgents = after.players[HAZARD_PLAYER].agents.filter(a => a.revealed);
    const faceDownAgents = after.players[HAZARD_PLAYER].agents.filter(a => !a.revealed);
    expect(faceUpAgents.length).toBe(1);
    expect(faceDownAgents.length).toBe(0);
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === WOFFUNG)).toBe(true);
  });
});
