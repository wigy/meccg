/**
 * @module dm-165.test
 *
 * Card test: Withdrawn to Mordor (dm-165)
 * Type: hero-resource-event (short)
 *
 * Text:
 *   "Playable on a face-up agent. If the agent has a mind of 5 or less, it is
 *    discarded. If its mind is 6 or greater, return the agent to its owner's
 *    hand. Alternatively, an on-guard card is discarded."
 *
 * CRF 22 rulings:
 *   - The on-guard card must be discarded before it is revealed.
 *   - The "playable on a face-up agent" condition of the first paragraph does
 *     not apply to the second (on-guard) paragraph.
 *
 * Card shape:
 *   - effects[0]: withdraw-agent (returnMindThreshold 6, alternativeDiscardOnGuard true)
 *
 * Engine support:
 *   - withdraw-agent: implemented in legal-actions/organization.ts
 *     (withdrawAgentTargetActions — one play action per opponent face-up agent
 *     and per own unrevealed on-guard card) and reducer-events.ts
 *     (handlePlayResourceShortEvent — agent removed by printed mind, or
 *     on-guard card discarded to the opponent's discard pile).
 *
 * Playable: YES
 *
 * Player convention: P1 is the resource (active) player holding Withdrawn to
 * Mordor; P2 is the hazard (opponent) player who owns the agent / on-guard card.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS,
  LORIEN, MINAS_TIRITH, RIVENDELL, BREE,
  ORC_PATROL,
  buildTestState, resetMint, dispatch, reduce, viableActions,
  makeAgent, withAgentInPlay, placeOnGuard,
} from '../test-helpers.js';
import { Phase } from '../../index.js';
import type { CardDefinitionId, PlayShortEventAction } from '../../index.js';

const WITHDRAWN = 'dm-165' as CardDefinitionId;
// Dâsakûn (dm-4) has a printed mind of 5 → discarded by Withdrawn to Mordor.
const DASAKUN = 'dm-4' as CardDefinitionId;
// Firiel (dm-10) has a printed mind of 6 → returned to owner's hand.
const FIRIEL = 'dm-10' as CardDefinitionId;

const BASE_PLAYERS: Parameters<typeof buildTestState>[0]['players'] = [
  {
    id: PLAYER_1,
    companies: [{ site: LORIEN, characters: [ARAGORN] }],
    hand: [WITHDRAWN],
    siteDeck: [MINAS_TIRITH],
  },
  {
    id: PLAYER_2,
    companies: [{ site: RIVENDELL, characters: [LEGOLAS] }],
    hand: [],
    siteDeck: [BREE],
  },
];

describe('Withdrawn to Mordor (dm-165)', () => {
  beforeEach(() => resetMint());

  // ─── Legal-action targeting: agent mode ─────────────────────────────────────

  test('a face-up opponent agent is offered as a target', () => {
    const agent = makeAgent(FIRIEL, { revealed: true });
    const state = withAgentInPlay(
      buildTestState({ activePlayer: PLAYER_1, phase: Phase.Organization, players: BASE_PLAYERS }),
      HAZARD_PLAYER, agent,
    );
    const cardInst = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    const actions = viableActions(state, PLAYER_1, 'play-short-event');
    const agentAction = actions.find(
      ea => (ea.action as PlayShortEventAction).targetAgentId === agent.id,
    );

    expect(agentAction).toBeDefined();
    expect((agentAction!.action as PlayShortEventAction).cardInstanceId).toBe(cardInst);
  });

  test('a face-down agent is NOT offered as a target', () => {
    const agent = makeAgent(FIRIEL, { revealed: false });
    const state = withAgentInPlay(
      buildTestState({ activePlayer: PLAYER_1, phase: Phase.Organization, players: BASE_PLAYERS }),
      HAZARD_PLAYER, agent,
    );

    const actions = viableActions(state, PLAYER_1, 'play-short-event');

    expect(actions.some(ea => (ea.action as PlayShortEventAction).targetAgentId !== undefined)).toBe(false);
  });

  test('with no agent and no on-guard card, the card is not playable', () => {
    const state = buildTestState({ activePlayer: PLAYER_1, phase: Phase.Organization, players: BASE_PLAYERS });
    const cardInst = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    const actions = viableActions(state, PLAYER_1, 'play-short-event');

    expect(actions.some(ea => (ea.action as PlayShortEventAction).cardInstanceId === cardInst)).toBe(false);
  });

  test('the any-phase emitter never offers a target-less play (long-event phase)', () => {
    // Regression from heuristic self-play (decks q/r, seeds 5000/5001): the
    // generic any-phase short-event path (heroResourceShortEventActions,
    // used by the long-event/M-H windows) offered a bare play-short-event
    // for Withdrawn to Mordor with no target fields — which the reducer
    // rejects ("has no valid target"), killing the game. The emitter now
    // routes withdraw-agent cards through the shared target enumeration.
    const state = buildTestState({ activePlayer: PLAYER_1, phase: Phase.LongEvent, players: BASE_PLAYERS });
    const cardInst = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    // No face-up agent, no on-guard card → not offered at all.
    const actions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(actions.some(ea => (ea.action as PlayShortEventAction).cardInstanceId === cardInst)).toBe(false);

    // With a face-up agent in play, the long-event-phase offer carries the
    // target — and the reducer accepts exactly that offered action.
    const agent = makeAgent(FIRIEL, { revealed: true });
    const withAgent = withAgentInPlay(
      buildTestState({ activePlayer: PLAYER_1, phase: Phase.LongEvent, players: BASE_PLAYERS }),
      HAZARD_PLAYER, agent,
    );
    const offers = viableActions(withAgent, PLAYER_1, 'play-short-event')
      .filter(ea => (ea.action as PlayShortEventAction).targetAgentId === agent.id);
    expect(offers).toHaveLength(1);
    const after = dispatch(withAgent, offers[0].action);
    expect(after.players[RESOURCE_PLAYER].hand).toHaveLength(0);
  });

  // ─── Reducer: no-target play is rejected (regression, game mr9jvlnw-2ldyce) ──

  test('playing with neither an agent nor an on-guard target is rejected and does not spend the card', () => {
    // A face-down agent is in play but no face-up agent and no on-guard card,
    // so there is no legal target. The legal-action layer withholds the play
    // (see "with no agent and no on-guard card, the card is not playable"), but
    // a client that submits the action anyway must be rejected rather than
    // silently discarding (wasting) the event.
    const agent = makeAgent(FIRIEL, { revealed: false });
    const state = withAgentInPlay(
      buildTestState({ activePlayer: PLAYER_1, phase: Phase.Organization, players: BASE_PLAYERS }),
      HAZARD_PLAYER, agent,
    );
    const cardInst = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    const result = reduce(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardInst,
    });

    // The action is rejected...
    expect(result.error).toBeDefined();
    // ...and the event card remains in hand — not wasted to the discard pile.
    expect(result.state.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === cardInst)).toBe(true);
    expect(result.state.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === cardInst)).toBe(false);
  });

  // ─── Reducer: agent mode by mind ────────────────────────────────────────────

  test('agent with mind 5 or less is discarded to its owner', () => {
    const agent = makeAgent(DASAKUN, { revealed: true }); // mind 5
    const state = withAgentInPlay(
      buildTestState({ activePlayer: PLAYER_1, phase: Phase.Organization, players: BASE_PLAYERS }),
      HAZARD_PLAYER, agent,
    );
    const cardInst = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const agentCharInst = agent.character.instanceId;

    const next = dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardInst,
      targetAgentId: agent.id,
    });

    // Agent removed from play.
    expect(next.players[HAZARD_PLAYER].agents).toHaveLength(0);
    // Agent character in its owner's discard pile (not returned to hand).
    expect(next.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === agentCharInst)).toBe(true);
    expect(next.players[HAZARD_PLAYER].hand.some(c => c.instanceId === agentCharInst)).toBe(false);
    // The event card is spent to the playing player's discard pile.
    expect(next.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === cardInst)).toBe(true);
    expect(next.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === cardInst)).toBe(false);
  });

  test('agent with mind 6 or greater is returned to its owner\'s hand', () => {
    const agent = makeAgent(FIRIEL, { revealed: true }); // mind 6
    const state = withAgentInPlay(
      buildTestState({ activePlayer: PLAYER_1, phase: Phase.Organization, players: BASE_PLAYERS }),
      HAZARD_PLAYER, agent,
    );
    const cardInst = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const agentCharInst = agent.character.instanceId;

    const next = dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardInst,
      targetAgentId: agent.id,
    });

    expect(next.players[HAZARD_PLAYER].agents).toHaveLength(0);
    // Returned to hand, NOT discarded.
    expect(next.players[HAZARD_PLAYER].hand.some(c => c.instanceId === agentCharInst)).toBe(true);
    expect(next.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === agentCharInst)).toBe(false);
  });

  // ─── Legal-action targeting: on-guard mode ──────────────────────────────────

  test('an unrevealed on-guard card is offered as an alternative target', () => {
    const { state, ogCard } = placeOnGuard(
      buildTestState({ activePlayer: PLAYER_1, phase: Phase.Organization, players: BASE_PLAYERS }),
      RESOURCE_PLAYER, 0, ORC_PATROL,
    );

    const actions = viableActions(state, PLAYER_1, 'play-short-event');
    const ogAction = actions.find(
      ea => (ea.action as PlayShortEventAction).discardTargetInstanceId === ogCard.instanceId,
    );

    expect(ogAction).toBeDefined();
  });

  test('a revealed on-guard card is NOT offered (must act before reveal)', () => {
    const { state, ogCard } = placeOnGuard(
      buildTestState({ activePlayer: PLAYER_1, phase: Phase.Organization, players: BASE_PLAYERS }),
      RESOURCE_PLAYER, 0, ORC_PATROL, { revealed: true },
    );

    const actions = viableActions(state, PLAYER_1, 'play-short-event');

    expect(actions.some(ea => (ea.action as PlayShortEventAction).discardTargetInstanceId === ogCard.instanceId)).toBe(false);
  });

  // ─── Reducer: on-guard mode ─────────────────────────────────────────────────

  test('playing on the on-guard card discards it to its owner', () => {
    const { state, ogCard } = placeOnGuard(
      buildTestState({ activePlayer: PLAYER_1, phase: Phase.Organization, players: BASE_PLAYERS }),
      RESOURCE_PLAYER, 0, ORC_PATROL,
    );
    const cardInst = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    const next = dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardInst,
      discardTargetInstanceId: ogCard.instanceId,
    });

    // On-guard card removed from the company.
    expect(next.players[RESOURCE_PLAYER].companies[0].onGuardCards).toHaveLength(0);
    // Discarded to its owner (the hazard player who placed it).
    expect(next.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === ogCard.instanceId)).toBe(true);
    // The event card is spent.
    expect(next.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === cardInst)).toBe(true);
  });
});
