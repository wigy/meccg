/**
 * @module rule-2.04-uniqueness-in-play
 *
 * CoE Rules — Section 2: Untap Phase
 * Rule 2.04: Uniqueness In Play
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * If a card is "unique" or "cannot be duplicated," only one such card can be in play or otherwise in effect at a time, across both your cards and your opponent's cards.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, makeSitePhase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, EOWYN,
  GLAMDRING,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
} from '../../test-helpers.js';
import { computeLegalActions } from '../../../engine/legal-actions/index.js';
import type { EvaluatedAction } from '../../../index.js';

function viableOfType(actions: EvaluatedAction[], type: string): EvaluatedAction[] {
  return actions.filter(a => a.viable && a.action.type === type);
}

function nonViableOfType(actions: EvaluatedAction[], type: string): EvaluatedAction[] {
  return actions.filter(a => !a.viable && a.action.type === type);
}

describe('Rule 2.04 — Uniqueness In Play', () => {
  beforeEach(() => resetMint());

  test('Unique character already in play for same player cannot be played again', () => {
    // Aragorn already in play for P1, also in hand — should be blocked
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          hand: [ARAGORN],
          siteDeck: [],
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
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

    const actions = computeLegalActions(state, PLAYER_1);
    const playActions = viableOfType(actions, 'play-character');
    expect(playActions).toHaveLength(0);

    const blocked = nonViableOfType(actions, 'play-character');
    expect(blocked.length).toBeGreaterThan(0);
  });

  test('Unique character in play for opponent cannot be played by resource player', () => {
    // Legolas in play for P2, Legolas in P1's hand — should be blocked by uniqueness
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          hand: [LEGOLAS],
          siteDeck: [],
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
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

    const actions = computeLegalActions(state, PLAYER_1);
    const playActions = viableOfType(actions, 'play-character');
    // Legolas should not be playable since the opponent already has one
    expect(playActions).toHaveLength(0);
  });

  test('Different unique characters can coexist in play', () => {
    // Aragorn in play for P1, Eowyn in hand — different unique characters, should be playable
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          hand: [EOWYN],
          siteDeck: [],
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
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

    const actions = computeLegalActions(state, PLAYER_1);
    const playActions = viableOfType(actions, 'play-character');
    expect(playActions.length).toBeGreaterThan(0);
  });

  test('Unique item in play for opponent cannot be played by resource player', () => {
    // Glamdring already on P2's Legolas. P1 has Glamdring in hand at Moria (ruins-and-lairs).
    // Uniqueness should block P1 from playing it.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        {
          id: PLAYER_1,
          hand: [GLAMDRING],
          siteDeck: [MINAS_TIRITH],
          companies: [{ site: MORIA, characters: [ARAGORN] }],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [MINAS_TIRITH],
          companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS, items: [GLAMDRING] }] }],
        },
      ],
      recompute: true,
    });

    const siteState = { ...state, phaseState: makeSitePhase() };
    const actions = computeLegalActions(siteState, PLAYER_1);

    const playItem = viableOfType(actions, 'play-hero-resource');
    expect(playItem).toHaveLength(0);

    const blocked = nonViableOfType(actions, 'not-playable');
    const glamdringBlocked = blocked.filter(a => a.reason?.includes('unique'));
    expect(glamdringBlocked.length).toBeGreaterThan(0);
  });
});
