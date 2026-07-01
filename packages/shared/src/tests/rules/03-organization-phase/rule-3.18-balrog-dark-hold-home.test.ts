/**
 * @module rule-3.18-balrog-dark-hold-home
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.18: Balrog Dark-Hold Home Site
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [BALROG] A Balrog player's character cards with a home site of "Any Dark-hold" instead have a home site of "Any non-Dark-hold Under-deeps site".
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { CardDefinitionId } from '../../test-helpers.js';
import {
  buildTestState, resetMint, Phase, Alignment,
  viablePlayCharacterActions,
  PLAYER_1, PLAYER_2,
  ARAGORN, RIVENDELL,
} from '../../test-helpers.js';

// Orc Captain (le-31): printed homesite "Any Dark-hold", mind 5, non-unique.
// Single-test use → inline.
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;
// The Gem-deeps (ba-90): Under-deeps, ruins-and-lairs (not a haven, not Dark-hold).
const THE_GEM_DEEPS = 'ba-90' as CardDefinitionId;
// The Iron-deeps (ba-91): Under-deeps, Dark-hold.
const THE_IRON_DEEPS = 'ba-91' as CardDefinitionId;

describe('Rule 3.18 — Balrog Dark-Hold Home Site', () => {
  beforeEach(() => resetMint());

  test('[BALROG] Character with "Any Dark-hold" homesite can be played at a non-Dark-hold Under-deeps site', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          hand: [ORC_CAPTAIN],
          siteDeck: [THE_GEM_DEEPS],
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
    const gemDeepsSite = state.players[0].siteDeck.find(s => s.definitionId === THE_GEM_DEEPS);
    expect(viable.map(a => a.atSite)).toContain(gemDeepsSite!.instanceId);
  });

  test('[BALROG] Character with "Any Dark-hold" homesite cannot be played at an actual Dark-hold', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          hand: [ORC_CAPTAIN],
          siteDeck: [THE_IRON_DEEPS],
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

  test('[MINION] Non-Balrog Ringwraith player does not get the Dark-hold remap (literal homesite does not match a non-haven Under-deeps site)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          hand: [ORC_CAPTAIN],
          siteDeck: [THE_GEM_DEEPS],
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
});
