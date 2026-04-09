/**
 * @module rule-3.03-avatar-play-location
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.03: Avatar Play Location
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * An avatar character can only be played at the avatar's home site or certain haven(s) specific to the player.
 * A player playing their first avatar is commonly referred to as "revealing" their avatar, and a player cannot then play a different avatar (unless as a Ringwraith follower).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  viablePlayCharacterActions, nonViablePlayCharacterActions,
  PLAYER_1, PLAYER_2,
  GANDALF, ARAGORN, BILBO, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, BREE,
} from '../../test-helpers.js';

describe('Rule 3.03 — Avatar Play Location', () => {
  beforeEach(() => resetMint());

  test('Avatar (Gandalf) is playable at a haven from the site deck', () => {
    // P1 has Gandalf in hand and no companies. Site deck has a haven (Rivendell)
    // and a non-haven (Moria). Gandalf should be playable at Rivendell only.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          hand: [GANDALF],
          siteDeck: [RIVENDELL, MORIA],
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

    // Gandalf must be playable at Rivendell (haven)
    expect(viable.length).toBe(1);
    const sitesPlayedAt = viable.map(a => a.atSite);
    const rivendellSite = state.players[0].siteDeck.find(s => s.definitionId === RIVENDELL);
    expect(sitesPlayedAt).toContain(rivendellSite!.instanceId);
  });

  test('Avatar (Gandalf) is playable at a haven where the player already has a company', () => {
    // P1 has Gandalf in hand. Existing company is at Rivendell (haven) with Bilbo.
    // Gandalf should be playable at Rivendell to join that company.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          hand: [GANDALF],
          siteDeck: [],
          companies: [{ site: RIVENDELL, characters: [BILBO] }],
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

    const rivendellSite = state.players[0].companies[0].currentSite!.instanceId;
    expect(viable[0].atSite).toBe(rivendellSite);
  });

  test('Avatar (Gandalf) is not playable when no haven is available', () => {
    // P1 has Gandalf in hand. The only company is at Bree (non-haven, border-hold)
    // and the only site in the site deck is Moria (non-haven, shadow-hold).
    // Gandalf has no playable site, so the play action must be marked non-viable.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          hand: [GANDALF],
          siteDeck: [MORIA],
          companies: [{ site: BREE, characters: [ARAGORN] }],
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
    // The engine should still report the attempted play, marked non-viable
    expect(nonViablePlayCharacterActions(state, PLAYER_1).length).toBeGreaterThan(0);
  });
});
