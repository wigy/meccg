/**
 * @module rule-3.04-hero-avatar-location
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.04: Hero Avatar Play Location
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [HERO] A Wizard avatar can only be played at the avatar's home site or Rivendell.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  viablePlayCharacterActions,
  PLAYER_1, PLAYER_2,
  SARUMAN, LEGOLAS,
  RIVENDELL, LORIEN, ISENGARD,
} from '../../test-helpers.js';

describe('Rule 3.04 — Hero Avatar Play Location', () => {
  beforeEach(() => resetMint());

  test('[HERO] Wizard avatar (Saruman) can be played at his home site (Isengard)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          hand: [SARUMAN],
          siteDeck: [ISENGARD],
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
    expect(viable.length).toBeGreaterThan(0);
    const sitesPlayedAt = viable.map(a => a.atSite);
    const isengardSite = state.players[0].siteDeck.find(s => s.definitionId === ISENGARD);
    expect(sitesPlayedAt).toContain(isengardSite!.instanceId);
  });

  test('[HERO] Wizard avatar (Saruman) can be played at Rivendell even though it is not his home site', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          hand: [SARUMAN],
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
    expect(viable.length).toBeGreaterThan(0);
    const sitesPlayedAt = viable.map(a => a.atSite);
    const rivendellSite = state.players[0].siteDeck.find(s => s.definitionId === RIVENDELL);
    expect(sitesPlayedAt).toContain(rivendellSite!.instanceId);
  });

  test('[HERO] Wizard avatar (Saruman) cannot be played at Lorien (haven, but not home site or Rivendell)', () => {
    // Lorien is a haven, but not Saruman's home site (Isengard) or Rivendell —
    // unlike an ordinary character, a Wizard avatar does not get "any haven".
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          hand: [SARUMAN],
          siteDeck: [LORIEN],
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
    expect(viable).toHaveLength(0);
  });
});
