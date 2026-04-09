/**
 * @module rule-3.11-non-avatar-character-play
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.11: Non-Avatar Character Play Location
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * A non-avatar character can only be played at the character's home site or one of its player's havens. Additionally, if a player's avatar is in play, that player can only play a character at the avatar's current site or under direct influence with an existing company.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  viablePlayCharacterActions, nonViablePlayCharacterActions,
  PLAYER_1, PLAYER_2,
  ARAGORN, GANDALF, LEGOLAS, BILBO,
  RIVENDELL, LORIEN, MORIA, BREE,
} from '../../test-helpers.js';

describe('Rule 3.11 — Non-Avatar Character Play Location', () => {
  beforeEach(() => resetMint());

  test('Non-avatar character is playable at its homesite from the site deck', () => {
    // P1 has Aragorn (homesite Bree, mind 9) in hand, no avatar in play, and Bree
    // in the site deck. Aragorn should be playable at Bree to form a new company.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          hand: [ARAGORN],
          siteDeck: [BREE],
          companies: [],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [],
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        },
      ],
      recompute: true,
    });

    const viable = viablePlayCharacterActions(state, PLAYER_1);
    expect(viable.length).toBe(1);

    const breeInst = state.players[0].siteDeck.find(s => s.definitionId === BREE)!.instanceId;
    expect(viable[0].atSite).toBe(breeInst);
  });

  test('Non-avatar character is playable at a haven from the site deck (even when not its homesite)', () => {
    // Aragorn's homesite is Bree, but he is also playable at any haven. With
    // Rivendell in the site deck, Aragorn should be playable there.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          hand: [ARAGORN],
          siteDeck: [RIVENDELL],
          companies: [],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [],
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        },
      ],
      recompute: true,
    });

    const viable = viablePlayCharacterActions(state, PLAYER_1);
    expect(viable.length).toBe(1);

    const rivendellInst = state.players[0].siteDeck.find(s => s.definitionId === RIVENDELL)!.instanceId;
    expect(viable[0].atSite).toBe(rivendellInst);
  });

  test('Non-avatar character is not playable at a non-haven, non-homesite location', () => {
    // Only Moria (shadow-hold, not a haven and not Aragorn's homesite) is
    // available — Aragorn must be reported as non-viable.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          hand: [ARAGORN],
          siteDeck: [MORIA],
          companies: [],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [],
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        },
      ],
      recompute: true,
    });

    expect(viablePlayCharacterActions(state, PLAYER_1)).toHaveLength(0);
    expect(nonViablePlayCharacterActions(state, PLAYER_1).length).toBeGreaterThan(0);
  });

  test('When avatar is in play, the site deck is excluded from non-avatar plays', () => {
    // P1 has Gandalf (avatar) in play at Rivendell and Aragorn (homesite Bree)
    // in hand, with Bree in the site deck. Without an avatar in play Aragorn
    // would be playable at Bree, but rule 2.II.2.2 restricts non-avatar play
    // to the avatar's current site or DI under an existing company.
    //
    // Aragorn must therefore be playable only at Rivendell (the avatar's
    // current site, which is also a haven), and never at Bree from the site
    // deck.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          hand: [ARAGORN],
          siteDeck: [BREE],
          companies: [{ site: RIVENDELL, characters: [GANDALF, BILBO] }],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [],
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        },
      ],
      recompute: true,
    });

    const viable = viablePlayCharacterActions(state, PLAYER_1);

    const breeInst = state.players[0].siteDeck.find(s => s.definitionId === BREE)!.instanceId;
    const rivendellInst = state.players[0].companies[0].currentSite!.instanceId;

    // Aragorn must not be playable at Bree from the site deck
    const playsAtBree = viable.filter(a => a.atSite === breeInst);
    expect(playsAtBree).toHaveLength(0);

    // Aragorn is still playable at Rivendell (avatar's site, also a haven)
    const playsAtRivendell = viable.filter(a => a.atSite === rivendellInst);
    expect(playsAtRivendell.length).toBeGreaterThan(0);
  });
});
