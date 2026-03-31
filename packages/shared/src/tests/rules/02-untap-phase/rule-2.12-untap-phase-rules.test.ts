/**
 * @module rule-2.12-untap-phase-rules
 *
 * CoE Rules — Section 2: Untap Phase
 * Rule 2.12: Untap Phase - Untap or Heal
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * During the untap phase, for each of the resource player's non-site cards, that player may either untap the card if it is tapped or, if the card is a character at one of the player's havens, heal the character to the tapped position.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, reduce, Phase, CardStatus,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
} from '../../test-helpers.js';


describe('Rule 2.12 — Untap Phase - Untap or Heal', () => {
  beforeEach(() => resetMint());

  test('Tapped characters are untapped during untap phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, status: CardStatus.Tapped }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS }] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const result = reduce(state, { type: 'untap', player: PLAYER_1 });
    expect(result.error).toBeUndefined();

    const charId = result.state.players[0].companies[0].characters[0] as string;
    expect(result.state.players[0].characters[charId].status).toBe(CardStatus.Untapped);
  });

  test('Wounded character at haven is healed to tapped position', () => {
    // Rivendell is a haven — wounded (inverted) character should heal to tapped
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, status: CardStatus.Inverted }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS }] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const result = reduce(state, { type: 'untap', player: PLAYER_1 });
    expect(result.error).toBeUndefined();

    const charId = result.state.players[0].companies[0].characters[0] as string;
    // Healed to tapped, not untapped
    expect(result.state.players[0].characters[charId].status).toBe(CardStatus.Tapped);
  });

  test('Wounded character NOT at haven remains wounded', () => {
    // Moria is not a haven — wounded character should remain wounded
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, status: CardStatus.Inverted }] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS }] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const result = reduce(state, { type: 'untap', player: PLAYER_1 });
    expect(result.error).toBeUndefined();

    const charId = result.state.players[0].companies[0].characters[0] as string;
    expect(result.state.players[0].characters[charId].status).toBe(CardStatus.Inverted);
  });

  test('Untapped characters remain untapped', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, status: CardStatus.Untapped }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS }] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const result = reduce(state, { type: 'untap', player: PLAYER_1 });
    expect(result.error).toBeUndefined();

    const charId = result.state.players[0].companies[0].characters[0] as string;
    expect(result.state.players[0].characters[charId].status).toBe(CardStatus.Untapped);
  });

  test('Only resource player non-site cards are affected by untap', () => {
    // Opponent's tapped character should NOT be untapped during resource player's untap
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS, status: CardStatus.Tapped }] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const result = reduce(state, { type: 'untap', player: PLAYER_1 });
    expect(result.error).toBeUndefined();

    // Opponent's character should still be tapped
    const charId = result.state.players[1].companies[0].characters[0] as string;
    expect(result.state.players[1].characters[charId].status).toBe(CardStatus.Tapped);
  });
});
