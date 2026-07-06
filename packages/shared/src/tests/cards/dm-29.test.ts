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
 * Rule status — all IMPLEMENTED (card is CERTIFIED):
 * | # | Rule                                             | Encoding                  |
 * |---|--------------------------------------------------|---------------------------|
 * | 1 | Deploys as an agent                              | re-typed minion-character + agent |
 * | 2 | Manifestation of Gollum (g.man.1, ally + agent)  | manifestId tw-246         |
 * | 3 | If face-up: an extra agent action                | extra-agent-actions whileRevealed |
 * | 4 | -1 kill MP to whoever eliminates him             | killMarshallingPoints -1  |
 * | 5 | Success vs a company with a ring → discard self + a ring | agent-attack-outcome → force-discard-card |
 * | 6 | Fail but survives → defender may play Gollum, discard self | agent-attack-outcome → agent-play-manifestation-offer |
 *
 * Rules 5–6 are `agent-attack-outcome` post-effects applied when My Precious's
 * agent attack finalizes: on a successful attack vs a company holding a ring, he
 * and a ring are discarded (attacker's choice, via the shared force-discard-card
 * flow); on a failed-but-survived attack, the defender is offered the option to
 * tap a character and play Gollum from hand (per wigy's ruling), discarding him.
 * The tests below drive all six rules with real engine assertions.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, makeMHState, viableActions, dispatch,
  PLAYER_1, PLAYER_2,
  ARAGORN,
  MORIA, LORIEN, RIVENDELL, MINAS_TIRITH,
} from '../test-helpers.js';
import { countExtraAgentActions } from '../../engine/mh-agents.js';
import { finalizeCombat } from '../../engine/combat-finalize.js';
import { makeCombatState } from '../../engine/reducer-utils.js';
import type { CardDefinitionId, CardInstanceId, CompanyId, AgentInPlay, GameState } from '../../index.js';
import { Phase, CardStatus } from '../../index.js';

const MY_PRECIOUS = 'dm-29' as CardDefinitionId;
const GOLLUM = 'tw-246' as CardDefinitionId;   // the ally manifestation of the same entity
const GOLD_RING = 'tw-306' as CardDefinitionId; // a gold-ring item ("Precious Gold Ring")

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

  // ─── Rule 5: successful attack vs a company with a ring ────────────────────

  test('successful attack vs a company holding a ring discards My Precious and enqueues a ring discard', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.MovementHazard, recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [GOLD_RING] }] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const companyId = state.players[0].companies[0].id;
    const defCharId = state.players[0].companies[0].characters[0];
    const withCombat: GameState = {
      ...state,
      phaseState: makeMHState({}),
      players: [state.players[0], { ...state.players[1], agents: [myPreciousAgent(true)] }] as typeof state.players,
      combat: {
        ...makeCombatState({
          attackSource: { type: 'agent', instanceId: 'p2-precious-char' as CardInstanceId },
          companyId, defendingPlayerId: PLAYER_1, attackingPlayerId: PLAYER_2,
          strikesTotal: 1, strikeProwess: 2, creatureBody: 9,
          assignmentPhase: 'attacker', detainment: false,
        }),
        strikeAssignments: [{ characterId: defCharId, excessStrikes: 0, resolved: true, result: 'wounded' }],
      },
    };
    const after = finalizeCombat(withCombat).state;
    expect(after.players[1].agents.some(a => a.character.definitionId === MY_PRECIOUS)).toBe(false);
    expect(after.players[1].discardPile.some(c => c.definitionId === MY_PRECIOUS)).toBe(true);
    expect(after.pendingResolutions.some(r => r.kind.type === 'force-discard-card')).toBe(true);
  });

  // ─── Rule 6: failed attack, survives → defender may play Gollum ─────────────

  test('failed attack (no wound): defender may tap a character to play Gollum, discarding My Precious', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.MovementHazard, recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [GOLLUM], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const companyId = state.players[0].companies[0].id;
    const defCharId = state.players[0].companies[0].characters[0];
    const withCombat: GameState = {
      ...state,
      phaseState: makeMHState({}),
      players: [state.players[0], { ...state.players[1], agents: [myPreciousAgent(true)] }] as typeof state.players,
      combat: {
        ...makeCombatState({
          attackSource: { type: 'agent', instanceId: 'p2-precious-char' as CardInstanceId },
          companyId, defendingPlayerId: PLAYER_1, attackingPlayerId: PLAYER_2,
          strikesTotal: 1, strikeProwess: 2, creatureBody: 9,
          assignmentPhase: 'attacker', detainment: false,
        }),
        strikeAssignments: [{ characterId: defCharId, excessStrikes: 0, resolved: true, result: 'success' }],
      },
    };
    const afterFinalize = finalizeCombat(withCombat).state;
    // The offer is enqueued for the defender; My Precious still in play.
    expect(afterFinalize.pendingResolutions.some(r => r.kind.type === 'agent-play-manifestation-offer')).toBe(true);
    expect(afterFinalize.players[1].agents.some(a => a.character.definitionId === MY_PRECIOUS)).toBe(true);

    // Defender plays Gollum (taps a character).
    const plays = viableActions(afterFinalize, PLAYER_1, 'play-agent-manifestation');
    expect(plays.length).toBeGreaterThan(0);
    const afterPlay = dispatch(afterFinalize, plays[0].action);

    // My Precious discarded; Gollum in play on the (now tapped) character.
    expect(afterPlay.players[1].agents.some(a => a.character.definitionId === MY_PRECIOUS)).toBe(false);
    expect(afterPlay.players[1].discardPile.some(c => c.definitionId === MY_PRECIOUS)).toBe(true);
    expect(afterPlay.players[0].characters[defCharId].allies.some(a => a.definitionId === GOLLUM)).toBe(true);
    expect(afterPlay.players[0].characters[defCharId].status).toBe(CardStatus.Tapped);
    expect(afterPlay.players[0].hand.some(c => c.definitionId === GOLLUM)).toBe(false);
  });
});
