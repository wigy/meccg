/**
 * @module dm-29.test
 *
 * Card test: My Precious (dm-29) — Manifestation of Gollum (tw-246). Agent.
 *
 * Card text:
 *   "Unique. Manifestation of Gollum. Agent. If face-up, may take an extra
 *    agent action (not counting against the hazard limit) each time he normally
 *    takes an agent action. If he attacks successfully against a company with a
 *    ring, he and a ring (attacker's choice) are discarded. If My Precious
 *    attacks and fails but is not defeated, the defender may tap a character in
 *    the target company to play Gollum (My Precious is discarded). Any player
 *    whose character eliminates My Precious receives -1 kill MPs."
 *
 * Was mis-modeled as a bare `hazard-event` (unplayable). Per the authoritative
 * card DB (agent character: skills Scout, body 9, prowess 2, mind 4, DI 0,
 * homesite Goblin-gate/Moria/Shelob's Lair/Mt. Doom, -1 kill MP) it is
 * re-modeled as a `minion-character` with the `agent` keyword — deploying
 * through the existing agent subsystem.
 *
 * Rule status:
 * | # | Rule                                             | Status                    |
 * |---|--------------------------------------------------|---------------------------|
 * | 1 | Deploys as an agent                              | IMPLEMENTED (re-typed)    |
 * | 2 | Manifestation of Gollum (g.man.1, ally + agent)  | IMPLEMENTED (manifestId)  |
 * | 3 | If face-up: an extra agent action                | IMPLEMENTED (extra-agent-actions whileRevealed) |
 * | 4 | -1 kill MP to whoever eliminates him             | IMPLEMENTED (killMarshallingPoints -1) |
 * | 5 | Success vs a company with a ring → discard self + a ring | NOT IMPLEMENTED (agent-attack-outcome combat sub-flow) |
 * | 6 | Fail but survives → defender may play Gollum, discard self | NOT IMPLEMENTED (agent-attack-outcome combat sub-flow) |
 *
 * Rules 5–6 are two new interactive combat sub-flows hooked into the
 * agent-attack outcome; they are a dedicated feature and NOT yet implemented, so
 * this card is NOT certified. The tests below exercise rules 1–3 with real
 * engine-driven assertions.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, makeMHState, viableActions,
  PLAYER_1, PLAYER_2,
  ARAGORN,
  MORIA, LORIEN, RIVENDELL, MINAS_TIRITH,
} from '../test-helpers.js';
import { countExtraAgentActions } from '../../engine/mh-agents.js';
import type { CardDefinitionId, CardInstanceId, CompanyId, AgentInPlay, GameState } from '../../index.js';
import { Phase, CardStatus } from '../../index.js';

const MY_PRECIOUS = 'dm-29' as CardDefinitionId;
const GOLLUM = 'tw-246' as CardDefinitionId;   // the ally manifestation of the same entity

/** An in-play My Precious agent for player 2, revealed or face-down. */
function myPreciousAgent(revealed: boolean): AgentInPlay {
  return {
    id: 'p2-precious' as CompanyId,
    character: {
      instanceId: 'p2-precious-char' as CardInstanceId,
      definitionId: MY_PRECIOUS,
      status: CardStatus.Untapped,
      items: [], allies: [], hazards: [], followers: [],
      controlledBy: 'general',
      effectiveStats: { prowess: 2, body: 9, directInfluence: 0, corruptionPoints: 0 },
    },
    revealed,
    siteStack: [{ instanceId: 'p2-precious-site' as CardInstanceId, definitionId: MORIA, status: CardStatus.Untapped }],
    remainingActions: 1,
    inPlayAtTurnStart: true,
    attackedThisSitePhase: false,
    discardAtEndOfTurn: false,
  };
}

describe('My Precious (dm-29)', () => {
  beforeEach(() => resetMint());

  // ─── Deployment: re-modeled as a deployable agent ──────────────────────────

  test('is offered for agent deployment (play-agent-hazard) from hand', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.MovementHazard, recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [MY_PRECIOUS], siteDeck: [RIVENDELL] },
      ],
    });
    const ready: GameState = { ...state, phaseState: makeMHState({ destinationSiteName: 'Some Site' }) };
    const preciousId = ready.players[1].hand[0].instanceId;
    const deploys = viableActions(ready, PLAYER_2, 'play-agent-hazard');
    expect(deploys.some(a => (a.action as { agentCardInstanceId?: string }).agentCardInstanceId === (preciousId as unknown as string))).toBe(true);
  });

  // ─── Manifestation (g.man.1): cannot coexist with the Gollum ally ──────────

  test('cannot be deployed while the Gollum ally (tw-246) is in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.MovementHazard, recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [MY_PRECIOUS], siteDeck: [RIVENDELL] },
      ],
    });
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
              allies: [{ instanceId: 'gollum-ally' as CardInstanceId, definitionId: GOLLUM, status: CardStatus.Untapped }],
            },
          },
        },
        state.players[1],
      ] as typeof state.players,
    };
    const preciousId = withAlly.players[1].hand[0].instanceId;
    const deploys = viableActions(withAlly, PLAYER_2, 'play-agent-hazard');
    expect(deploys.some(a => (a.action as { agentCardInstanceId?: string }).agentCardInstanceId === (preciousId as unknown as string))).toBe(false);
  });

  // ─── Rule 3: extra agent action only while face-up ─────────────────────────

  test('grants an extra agent action only while face-up (revealed)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.MovementHazard, recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const faceDown: GameState = { ...base, players: [base.players[0], { ...base.players[1], agents: [myPreciousAgent(false)] }] as typeof base.players };
    const faceUp: GameState = { ...base, players: [base.players[0], { ...base.players[1], agents: [myPreciousAgent(true)] }] as typeof base.players };
    expect(countExtraAgentActions(faceDown)).toBe(0);
    expect(countExtraAgentActions(faceUp)).toBe(1);
  });
});
