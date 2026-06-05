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

  test('Wizard avatar is playable at its own home site (non-haven)', () => {
    // Saruman's home site is Isengard (ruins-and-lairs, not a haven).
    // Rule 3.04 allows playing a Wizard avatar at its home site — so
    // Saruman must be viable at Isengard even though it is not a haven.
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
    expect(viable).toHaveLength(1);
    const isengardInst = state.players[0].siteDeck.find(s => s.definitionId === ISENGARD)!.instanceId;
    expect(viable[0].atSite).toBe(isengardInst);
  });

  test('Wizard avatar is playable at Rivendell (even when homesite is elsewhere)', () => {
    // Saruman's home site is Isengard, but Rivendell is the Hero player's
    // canonical haven for wizard avatars (rule 3.04). Saruman must be viable
    // at Rivendell even though it is not his homesite.
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
    expect(viable).toHaveLength(1);
    const rivendellInst = state.players[0].siteDeck.find(s => s.definitionId === RIVENDELL)!.instanceId;
    expect(viable[0].atSite).toBe(rivendellInst);
  });

});
