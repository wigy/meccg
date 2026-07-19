/**
 * @module dm-28.test
 *
 * Card test: Lobelia Sackville-Baggins (dm-28) — CERTIFIED.
 * Manifestation of Mistress Lobelia (dm-178). Agent.
 *
 * Card text:
 *   "Unique. Manifestation of Mistress Lobelia. Agent. +3 direct influence
 *    against Hobbits and Hobbit factions. May not move to any site other than
 *    Bree, Old Forest, The White Towers, or a site in The Shire."
 *
 * Was mis-modeled as a bare `hazard-event` (unplayable). Per the authoritative
 * card DB (agent character: skills Scout, body 9, prowess 0, mind 3, DI 1,
 * homesite Bag End / Bree) it is re-modeled as a `minion-character` with the
 * `agent` keyword — so it deploys through the existing agent subsystem. Its
 * three special rules are implemented:
 *   - "+3 direct influence against Hobbits and Hobbit factions" — a conditional
 *     `stat-modifier direct-influence` applied at agent-influence time.
 *   - "may not move to any site other than …" — `agent-move-restriction` with a
 *     named-site / region allow-list.
 *   - "Manifestation of Mistress Lobelia" — a `manifestId` linking to the ally
 *     dm-178; the shared manifestation rule (g.man.1) now spans allies + agents,
 *     so the two cannot be in play at once (blocked on both play paths).
 *
 * Tests drive the engine for all four behaviors.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, makeMHState, viableActions, dispatch,
  PLAYER_1, PLAYER_2,
  ARAGORN, FRODO, LORIEN, RIVENDELL, MORIA, MINAS_TIRITH,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, CompanyId, AgentInPlay, GameState } from '../../index.js';
import { Phase, CardStatus, Alignment, computeLegalActions } from '../../index.js';

const LOBELIA = 'dm-28' as CardDefinitionId;
const MISTRESS_LOBELIA = 'dm-178' as CardDefinitionId; // the ally manifestation of the same entity
const BILL_FERNY = 'dm-3' as CardDefinitionId;         // a plain agent character (control)
const A_MINION_CHAR = 'as-3' as CardDefinitionId;      // a minion Man, to give the RW company a character

/** An in-play, revealed Lobelia agent for player 2, standing at `siteDef`. */
function lobeliaAgentAt(siteDef: CardDefinitionId): AgentInPlay {
  return {
    id: 'p2-lobelia' as CompanyId,
    character: {
      instanceId: 'p2-lobelia-char' as CardInstanceId,
      definitionId: LOBELIA,
      status: CardStatus.Untapped,
      items: [], allies: [], hazards: [], followers: [],
      controlledBy: 'general',
      effectiveStats: { prowess: 0, body: 9, directInfluence: 1, corruptionPoints: 0 },
    },
    revealed: true,
    siteStack: [{ instanceId: 'p2-lobelia-site' as CardInstanceId, definitionId: siteDef, status: CardStatus.Untapped }],
    remainingActions: 1,
    inPlayAtTurnStart: true,
    attackedThisSitePhase: false,
    discardAtEndOfTurn: false,
  };
}

describe('Lobelia Sackville-Baggins (dm-28)', () => {
  beforeEach(() => resetMint());

  // ─── Deployment: re-modeled as a deployable agent ──────────────────────────

  test('is offered for agent deployment (play-agent-hazard) from hand', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.MovementHazard, recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [LOBELIA, BILL_FERNY], siteDeck: [RIVENDELL] },
      ],
    });
    const ready: GameState = { ...state, phaseState: makeMHState({ destinationSiteName: 'Some Site' }) };
    const lobeliaId = ready.players[1].hand.find(c => c.definitionId === LOBELIA)!.instanceId;
    const deploys = viableActions(ready, PLAYER_2, 'play-agent-hazard');
    expect(deploys.some(a => (a.action as { agentCardInstanceId?: string }).agentCardInstanceId === (lobeliaId as unknown as string))).toBe(true);
  });

  // ─── Manifestation (g.man.1): cannot coexist with the Mistress Lobelia ally ─

  test('cannot be deployed while the Mistress Lobelia ally (dm-178) is in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.MovementHazard, recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [LOBELIA], siteDeck: [RIVENDELL] },
      ],
    });
    // Attach the Mistress Lobelia ally to a hero character (in play).
    const aragornId = state.players[0].companies[0].characters[0];
    const withAlly: GameState = {
      ...state,
      phaseState: makeMHState({ destinationSiteName: 'Some Site' }),
      players: [
        {
          ...state.players[0],
          characters: {
            ...state.players[0].characters,
            [aragornId]: {
              ...state.players[0].characters[aragornId],
              allies: [{ instanceId: 'ml-ally' as CardInstanceId, definitionId: MISTRESS_LOBELIA, status: CardStatus.Untapped }],
            },
          },
        },
        state.players[1],
      ] as typeof state.players,
    };
    const lobeliaId = withAlly.players[1].hand[0].instanceId;
    const deploys = viableActions(withAlly, PLAYER_2, 'play-agent-hazard');
    // No VIABLE deploy of Lobelia while her manifestation is in play.
    expect(deploys.some(a => (a.action as { agentCardInstanceId?: string }).agentCardInstanceId === (lobeliaId as unknown as string))).toBe(false);
  });

  // ─── "+3 direct influence against Hobbits" ─────────────────────────────────

  test('applies +3 direct influence when influencing a Hobbit', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.MovementHazard, recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [FRODO] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    // Lobelia agent standing at a NON-home site (Lórien) → no +2 home bonus.
    const withAgent: GameState = {
      ...state,
      phaseState: makeMHState({ destinationSiteName: 'Some Site' }),
      players: [state.players[0], { ...state.players[1], agents: [lobeliaAgentAt(LORIEN)] }] as typeof state.players,
    };
    const frodoId = withAgent.players[0].companies[0].characters[0];

    const after = dispatch(withAgent, {
      type: 'agent-influence-attempt',
      player: PLAYER_2,
      agentId: 'p2-lobelia' as CompanyId,
      targetPlayer: PLAYER_1,
      targetInstanceId: frodoId,
      targetKind: 'character',
      explanation: '',
    });

    const pending = after.pendingResolutions.find(r => r.kind.type === 'opponent-influence-defend');
    expect(pending).toBeDefined();
    // Base DI 1 + 3 (vs Hobbit), no home bonus (agent is away from home).
    expect((pending!.kind as { attempt: { influencerDI: number } }).attempt.influencerDI).toBe(4);
  });

  // ─── Movement restriction (allow-list) ─────────────────────────────────────

  test('never offered a move to a site outside its allow-list', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.MovementHazard, recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [RIVENDELL, MINAS_TIRITH] },
      ],
    });
    const withAgent: GameState = {
      ...state,
      phaseState: makeMHState({ destinationSiteName: 'Some Site' }),
      players: [state.players[0], { ...state.players[1], agents: [lobeliaAgentAt(LORIEN)] }] as typeof state.players,
    };
    // Neither Rivendell nor Minas Tirith is Bree/Old Forest/The White Towers or
    // in The Shire — so the allow-list must exclude both from agent-move.
    const disallowed = new Set<string>([RIVENDELL as string, MINAS_TIRITH as string]);
    const moves = viableActions(withAgent, PLAYER_2, 'agent-move');
    const movedToDisallowed = moves.some(a => {
      const destInst = (a.action as { destinationSiteInstanceId?: string }).destinationSiteInstanceId;
      const destDef = withAgent.players[1].siteDeck.find(s => s.instanceId === destInst)?.definitionId as string | undefined;
      return destDef !== undefined && disallowed.has(destDef);
    });
    expect(movedToDisallowed).toBe(false);
  });

  // ─── Deploy-only: a pure hazard agent, never a company character ───────────

  test('cannot be played as a company character, even by a Ringwraith player', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Organization, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA, characters: [A_MINION_CHAR] }], hand: [LOBELIA], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [] },
      ],
    });
    const lobeliaId = state.players[0].hand[0].instanceId;
    const plays = computeLegalActions(state, PLAYER_1)
      .filter(a => a.action.type === 'play-character' && (a.action as { characterInstanceId?: string }).characterInstanceId === (lobeliaId as unknown as string));
    // She is recognized but not playable as a character (hazard agent — deploy-only).
    expect(plays.length).toBeGreaterThan(0);
    expect(plays.every(a => !a.viable)).toBe(true);
    expect(plays.some(a => /hazard agent/.test(a.reason ?? ''))).toBe(true);
  });
});
