/**
 * @module rule-9.08-agent-alignment-movement
 *
 * CoE Rules — Section 9: Agents, Events, Items & Rings
 * Rule 9.08: Agent Alignment Movement Restrictions
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [MINION] A Ringwraith player's agent hazards may move as if Dagorlad and Ûdun are adjacent.
 * [FALLEN-WIZARD] A Fallen-wizard player's agent hazards can only use hero site cards for movement, and cannot use or reveal the hero version of a site that corresponds to its player's minion site that is in play or in that player's discard pile.
 * [BALROG] A Balrog player's agent hazards can only use minion site cards for movement.
 * [BALROG] A Balrog player's agent hazards may move as if Dagorlad and Ûdun are adjacent.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, makeMHState, viableActions,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  LORIEN, MORIA,
} from '../../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, CompanyId, AgentMoveAction } from '../../../index.js';
import { Phase, CardStatus, ZERO_EFFECTIVE_STATS, Alignment } from '../../../index.js';
import type { AgentInPlay, CharacterInPlay, SiteInPlay } from '../../../index.js';

const DEAD_MARSHES = 'tw-384' as CardDefinitionId;   // Dagorlad region, hero-site
const CIRITH_GORGOR = 'as-137' as CardDefinitionId;  // Ûdun region, hero-site
const ANARIN = 'dm-1' as CardDefinitionId;            // homesite: "Moria"

const AGENT_CHAR_ID = 'test-a08-agent-char' as CardInstanceId;
const DEAD_MARSHES_SITE_ID = 'test-a08-dead-marshes' as CardInstanceId;

const AGENT_CHAR: CharacterInPlay = {
  instanceId: AGENT_CHAR_ID,
  definitionId: ANARIN,
  status: CardStatus.Untapped,
  items: [], allies: [], hazards: [], followers: [],
  controlledBy: 'general',
  effectiveStats: ZERO_EFFECTIVE_STATS,
};

const DEAD_MARSHES_SITE: SiteInPlay = {
  instanceId: DEAD_MARSHES_SITE_ID,
  definitionId: DEAD_MARSHES,
  status: CardStatus.Untapped,
};

describe('Rule 9.08 — Agent Alignment Movement Restrictions', () => {
  beforeEach(() => resetMint());

  test('[RINGWRAITH] agent at Dead Marshes (Dagorlad) can move to Cirith Gorgor (Ûdun)', () => {
    // Dead Marshes and Cirith Gorgor are in isolated regions (no normal adjacency).
    // Ringwraith player treats Dagorlad ↔ Ûdun as adjacent (rule 9.08).
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [] },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [CIRITH_GORGOR],
        },
      ],
    });

    const agent: AgentInPlay = {
      id: 'agent-0-0' as CompanyId,
      character: AGENT_CHAR,
      revealed: false,
      siteStack: [DEAD_MARSHES_SITE],
      actedThisTurn: false,
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
    // Look up destination definition IDs via the state's site deck
    const cirithInst = withAgent.players[1].siteDeck.find(s => s.definitionId === CIRITH_GORGOR);
    const toCirith = moveActions.filter(a =>
      (a.action as AgentMoveAction).destinationSiteInstanceId === cirithInst?.instanceId,
    );
    expect(toCirith.length).toBeGreaterThan(0);
  });

  test('[WIZARD] agent at Dead Marshes cannot move to Cirith Gorgor (no Dagorlad ↔ Ûdun adjacency)', () => {
    // Wizard player has no special adjacency rule — Dagorlad and Ûdun are not adjacent.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [] },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [CIRITH_GORGOR],
        },
      ],
    });

    const agent: AgentInPlay = {
      id: 'agent-0-0' as CompanyId,
      character: AGENT_CHAR,
      revealed: false,
      siteStack: [DEAD_MARSHES_SITE],
      actedThisTurn: false,
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
    const cirithInst = withAgent.players[1].siteDeck.find(s => s.definitionId === CIRITH_GORGOR);
    const toCirith = moveActions.filter(a =>
      (a.action as AgentMoveAction).destinationSiteInstanceId === cirithInst?.instanceId,
    );
    expect(toCirith).toHaveLength(0);
  });

  test('[FALLEN-WIZARD] agent cannot move to minion site cards', () => {
    // Fallen-wizard agents may only use hero site cards for movement.
    // Cirith Gorgor is a hero-site, so it's allowed.
    // We add a minion site (Moria is not minion, but let's verify the filter works).
    // The agent's siteDeck contains both hero and minion sites; only hero sites allowed.
    const GOBLIN_GATE = 'as-5' as CardDefinitionId; // minion-site (Against the Shadow)

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [] },
        {
          id: PLAYER_2,
          alignment: Alignment.FallenWizard,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [CIRITH_GORGOR],
        },
      ],
    });

    const agent: AgentInPlay = {
      id: 'agent-0-0' as CompanyId,
      character: AGENT_CHAR,
      revealed: false,
      siteStack: [DEAD_MARSHES_SITE],
      actedThisTurn: false,
      inPlayAtTurnStart: true,
      attackedThisSitePhase: false,
      discardAtEndOfTurn: false,
    };

    // Also add a minion site to the deck to verify it's excluded
    const withAgent = {
      ...state,
      players: [
        state.players[0],
        {
          ...state.players[1],
          agents: [agent],
          siteDeck: [...state.players[1].siteDeck, { instanceId: 'test-a08-goblin-gate' as CardInstanceId, definitionId: GOBLIN_GATE }],
        },
      ] as unknown as typeof state.players,
      phaseState: makeMHState({ hazardLimitAtReveal: 4, hazardsPlayedThisCompany: 0 }),
    };

    const moveActions = viableActions(withAgent, PLAYER_2, 'agent-move');
    // Minion site must not appear as a destination
    const goblinInst = withAgent.players[1].siteDeck.find(s => s.definitionId === GOBLIN_GATE);
    const toMinionSite = moveActions.filter(a =>
      (a.action as AgentMoveAction).destinationSiteInstanceId === goblinInst?.instanceId,
    );
    expect(toMinionSite).toHaveLength(0);
  });
});
