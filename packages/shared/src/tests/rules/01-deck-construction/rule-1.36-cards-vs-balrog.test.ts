/**
 * @module rule-1.36-cards-vs-balrog
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.36: Cards Not Playable vs Balrog
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * A player cannot play any of the following cards against a Balrog opponent, but a player may remove one of these cards from their hand at any time against a Balrog opponent in order to bring one card of any type from their sideboard into their play deck and then shuffle:
 * • The Balrog (Ally)
 * • The Black Council
 * • Durin's Bane
 * • Balrog of Moria
 * • Reluctant Final Parting
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Alignment, computeLegalActions, Phase, reduce } from '../../../index.js';
import type { CardDefinitionId, SwapBannedVsBalrogAction } from '../../../index.js';
import {
  buildTestState, resetMint, handCardId, dispatch, makeSitePhase,
  viableOfType, nonViableOfType,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, BILBO, GALADRIEL, ORC_GUARD, RIVENDELL, MINAS_TIRITH,
} from '../../test-helpers.js';

// wh-41 = The Black Council — a minion permanent-event with no play-target,
// so it is unconditionally offered as a viable play-permanent-event action
// once BANNED_VS_BALROG_OPPONENT is not blocking it.
const THE_BLACK_COUNCIL = 'wh-41' as CardDefinitionId;

describe('Rule 1.36 — Cards Not Playable vs Balrog', () => {
  beforeEach(() => resetMint());

  test('a banned card is viable to play when the opponent is not a Balrog player', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [], hand: [THE_BLACK_COUNCIL], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [], hand: [], siteDeck: [] },
      ],
    });
    const cardId = handCardId(state, RESOURCE_PLAYER);
    const actions = computeLegalActions(state, PLAYER_1);
    const plays = viableOfType(actions, 'play-permanent-event');
    expect(plays.some(a => 'cardInstanceId' in a.action && a.action.cardInstanceId === cardId)).toBe(true);
  });

  test('a banned card cannot be played when the opponent is a Balrog player (MEBA)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [], hand: [THE_BLACK_COUNCIL], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Balrog, companies: [], hand: [], siteDeck: [] },
      ],
    });
    const cardId = handCardId(state, RESOURCE_PLAYER);
    const actions = computeLegalActions(state, PLAYER_1);

    // Never offered as a viable play-permanent-event action.
    const plays = viableOfType(actions, 'play-permanent-event');
    expect(plays.some(a => 'cardInstanceId' in a.action && a.action.cardInstanceId === cardId)).toBe(false);

    // Reported to the UI as explicitly not-playable, with the MEBA reason.
    const notPlayable = nonViableOfType(actions, 'not-playable')
      .find(a => 'cardInstanceId' in a.action && a.action.cardInstanceId === cardId);
    expect(notPlayable?.reason).toMatch(/Balrog/);
    expect(notPlayable?.reason).toMatch(/MEBA/);
  });

  test('a banned card may be traded at any time vs a Balrog opponent for a sideboard card, which is shuffled into the play deck', () => {
    // CRF 22 settles where the traded card goes: "he may remove it from the
    // game" — the out-of-play pile, not the discard pile a fetch could reach.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [THE_BLACK_COUNCIL],
          siteDeck: [MINAS_TIRITH],
          playDeck: [BILBO],
          sideboard: [GALADRIEL, ORC_GUARD],
        },
        { id: PLAYER_2, alignment: Alignment.Balrog, companies: [], hand: [], siteDeck: [] },
      ],
    });
    const bannedId = handCardId(state, RESOURCE_PLAYER);
    const sideboard = state.players[RESOURCE_PLAYER].sideboard;

    // Offered once per sideboard card — the rule takes "one card of any type",
    // so both the resource and the hazard card in the sideboard qualify.
    const swaps = viableOfType(computeLegalActions(state, PLAYER_1), 'swap-banned-vs-balrog');
    expect(swaps.map(ea => (ea.action as SwapBannedVsBalrogAction).sideboardCardInstanceId).sort())
      .toEqual(sideboard.map(c => c.instanceId).sort());
    expect(swaps.every(ea => (ea.action as SwapBannedVsBalrogAction).cardInstanceId === bannedId)).toBe(true);

    const after = dispatch(state, {
      type: 'swap-banned-vs-balrog',
      player: PLAYER_1,
      cardInstanceId: bannedId,
      sideboardCardInstanceId: sideboard[0].instanceId,
    });

    const player = after.players[RESOURCE_PLAYER];
    expect(player.hand.some(c => c.instanceId === bannedId)).toBe(false);
    expect(player.outOfPlayPile.some(c => c.instanceId === bannedId)).toBe(true);
    expect(player.discardPile.some(c => c.instanceId === bannedId)).toBe(false);
    expect(player.sideboard.map(c => c.instanceId)).toEqual([sideboard[1].instanceId]);
    expect(player.playDeck.map(c => c.instanceId).sort())
      .toEqual([state.players[RESOURCE_PLAYER].playDeck[0].instanceId, sideboard[0].instanceId].sort());
  });

  test('the trade is offered outside the organization phase — the rule grants it "at any time"', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [THE_BLACK_COUNCIL],
          siteDeck: [MINAS_TIRITH],
          sideboard: [GALADRIEL],
        },
        { id: PLAYER_2, alignment: Alignment.Balrog, companies: [], hand: [], siteDeck: [] },
      ],
    });
    const sited = { ...state, phaseState: makeSitePhase() };

    expect(viableOfType(computeLegalActions(sited, PLAYER_1), 'swap-banned-vs-balrog')).toHaveLength(1);
  });

  test('no trade is offered when the opponent is not a Balrog player', () => {
    // The same hand card against a Ringwraith: playable, so nothing to trade
    // away. The sideboard is untouchable by this rule.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [THE_BLACK_COUNCIL],
          siteDeck: [MINAS_TIRITH],
          sideboard: [GALADRIEL],
        },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [], hand: [], siteDeck: [] },
      ],
    });

    expect(viableOfType(computeLegalActions(state, PLAYER_1), 'swap-banned-vs-balrog')).toHaveLength(0);
  });

  test('an ordinary hand card is not tradable, even against a Balrog opponent', () => {
    // Only the cards the Balrog opponent has made unplayable may be traded —
    // the rest of the hand stays in the hand.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [BILBO],
          siteDeck: [MINAS_TIRITH],
          sideboard: [GALADRIEL],
        },
        { id: PLAYER_2, alignment: Alignment.Balrog, companies: [], hand: [], siteDeck: [] },
      ],
    });
    const bilboId = handCardId(state, RESOURCE_PLAYER);

    expect(viableOfType(computeLegalActions(state, PLAYER_1), 'swap-banned-vs-balrog')).toHaveLength(0);

    const rejected = reduce(state, {
      type: 'swap-banned-vs-balrog',
      player: PLAYER_1,
      cardInstanceId: bilboId,
      sideboardCardInstanceId: state.players[RESOURCE_PLAYER].sideboard[0].instanceId,
    });
    expect(rejected.error).toBeDefined();
  });
});
