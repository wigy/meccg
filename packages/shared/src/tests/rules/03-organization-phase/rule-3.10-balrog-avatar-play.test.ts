/**
 * @module rule-3.10-balrog-avatar-play
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.10: Balrog Avatar Play
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [BALROG] A Balrog avatar can only be played at the Under-gates.
 * [BALROG] If a Balrog player's opponent is also a Balrog player, both players may continue to play Balrog-specific cards regardless of which player plays a Balrog avatar first.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { CardDefinitionId } from '../../test-helpers.js';
import {
  buildTestState, resetMint, Phase, Alignment,
  viablePlayCharacterActions,
  PLAYER_1, PLAYER_2,
  ARAGORN, RIVENDELL,
} from '../../test-helpers.js';

// The Balrog avatar (MEBA §12). Single-test use → inline.
const THE_BALROG = 'ba-3' as CardDefinitionId;
const THE_UNDER_GATES = 'ba-100' as CardDefinitionId;
const MORIA_BALROG = 'ba-93' as CardDefinitionId; // a Balrog Darkhaven, but not the avatar's home site

describe('Rule 3.10 — Balrog Avatar Play', () => {
  beforeEach(() => resetMint());

  test('[BALROG] Avatar (The Balrog) can be played at The Under-gates (his home site)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          hand: [THE_BALROG],
          siteDeck: [THE_UNDER_GATES],
          companies: [],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          hand: [],
          siteDeck: [],
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
        },
      ],
      recompute: true,
    });

    const viable = viablePlayCharacterActions(state, PLAYER_1);
    expect(viable.length).toBeGreaterThan(0);
    const underGatesSite = state.players[0].siteDeck.find(s => s.definitionId === THE_UNDER_GATES);
    expect(viable.map(a => a.atSite)).toContain(underGatesSite!.instanceId);
  });

  test('[BALROG] Avatar cannot be played at Moria, even though it is a Balrog Darkhaven', () => {
    // Unlike an ordinary character (which may enter at any Darkhaven), the
    // Balrog avatar is home-site-only — Moria does not qualify.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          hand: [THE_BALROG],
          siteDeck: [MORIA_BALROG],
          companies: [],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          hand: [],
          siteDeck: [],
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
        },
      ],
      recompute: true,
    });

    expect(viablePlayCharacterActions(state, PLAYER_1)).toHaveLength(0);
  });

  test.todo('[BALROG] If a Balrog player\'s opponent is also a Balrog player, both may continue to play Balrog-specific cards regardless of which plays their avatar first');
});
