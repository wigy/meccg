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
import { Alignment, computeLegalActions, Phase } from '../../../index.js';
import type { CardDefinitionId } from '../../../index.js';
import {
  buildTestState, resetMint, handCardId,
  viableOfType, nonViableOfType,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
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

  test.todo('A banned card may be discarded at any time vs a Balrog opponent to bring a sideboard card into the play deck');
});
