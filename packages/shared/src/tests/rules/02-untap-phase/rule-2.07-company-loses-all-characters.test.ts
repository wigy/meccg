/**
 * @module rule-2.07-company-loses-all-characters
 *
 * CoE Rules — Section 2: Untap Phase
 * Rule 2.07: Company Loses All Characters
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * If all characters in a company leave play, all permanent-events played on the company as a whole are immediately discarded. If the company's player has no other companies at the same site, the site must be immediately returned to its player's location deck if it is untapped, discarded if it is tapped, or stay in play until the end of all movement/hazard phases for the turn if this occurs during the company's movement/hazard phase (at which point the normal rules for sites at the end of the movement/hazard phase are followed).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  CardStatus,
} from '../../test-helpers.js';
import type { FreeCouncilPhaseState, CardInstanceId } from '../../../index.js';

describe('Rule 2.07 — Company Loses All Characters', () => {
  beforeEach(() => resetMint());

  // When a character is eliminated, cleanupEmptyCompanies handles the site routing.
  // We trigger character elimination via a Free Council corruption check (roll <= CP-2).

  test.todo('All characters leave play: company permanent-events are discarded');

  test('No other company at same site and site untapped: site returned to location deck', () => {
    // Aragorn at RIVENDELL (untapped). CP=5, roll=2 → 2 <= 5-2=3 → eliminated.
    // After elimination: RIVENDELL site (untapped) must go to siteDeck.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.FreeCouncil,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const aragornId = base.players[RESOURCE_PLAYER].companies[0].characters[0];
    const rivendellInstId = base.players[RESOURCE_PLAYER].companies[0].currentSite!.instanceId;

    const fcState: FreeCouncilPhaseState = {
      phase: Phase.FreeCouncil,
      tiebreaker: false,
      step: 'corruption-checks',
      currentPlayer: PLAYER_1,
      checkedCharacters: [],
      firstPlayerDone: false,
      pendingCheck: {
        characterId: aragornId,
        corruptionPoints: 5,
        corruptionModifier: 0,
        possessions: [] as CardInstanceId[],
        need: 6,
        explanation: 'CP 5',
        supportCount: 0,
      },
    };

    const state = { ...base, cheatRollTotal: 2, phaseState: fcState };
    const after = dispatch(state, { type: 'pass', player: PLAYER_1 });

    // Aragorn was eliminated → company empty → RIVENDELL untapped → back to siteDeck
    expect(after.players[RESOURCE_PLAYER].siteDeck.some(c => c.instanceId === rivendellInstId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === rivendellInstId)).toBe(false);
  });

  test('No other company at same site and site tapped: site discarded', () => {
    // Aragorn at MORIA (tapped). CP=5, roll=2 → eliminated.
    // After elimination: MORIA (tapped) must go to discardPile, not siteDeck.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.FreeCouncil,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    // Manually tap the site
    const company = base.players[RESOURCE_PLAYER].companies[0];
    const tappedState = {
      ...base,
      players: [
        {
          ...base.players[RESOURCE_PLAYER],
          companies: [{ ...company, currentSite: { ...company.currentSite!, status: CardStatus.Tapped } }],
        },
        base.players[1],
      ] as typeof base.players,
    };

    const aragornId = tappedState.players[RESOURCE_PLAYER].companies[0].characters[0];
    const moriaInstId = tappedState.players[RESOURCE_PLAYER].companies[0].currentSite!.instanceId;

    const fcState: FreeCouncilPhaseState = {
      phase: Phase.FreeCouncil,
      tiebreaker: false,
      step: 'corruption-checks',
      currentPlayer: PLAYER_1,
      checkedCharacters: [],
      firstPlayerDone: false,
      pendingCheck: {
        characterId: aragornId,
        corruptionPoints: 5,
        corruptionModifier: 0,
        possessions: [] as CardInstanceId[],
        need: 6,
        explanation: 'CP 5',
        supportCount: 0,
      },
    };

    const state = { ...tappedState, cheatRollTotal: 2, phaseState: fcState };
    const after = dispatch(state, { type: 'pass', player: PLAYER_1 });

    // MORIA was tapped → goes to discardPile, not siteDeck
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === moriaInstId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].siteDeck.some(c => c.instanceId === moriaInstId)).toBe(false);
  });

  test.todo('During movement/hazard phase: site stays until end of all M/H phases');

  test.todo('Another company at same site: site remains in play');
});
