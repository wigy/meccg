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
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  CardStatus,
} from '../../test-helpers.js';
import type { CardInstanceId, CompanyId } from '../../test-helpers.js';
import type { FreeCouncilPhaseState } from '../../../index.js';

describe('Rule 2.07 — Company Loses All Characters', () => {
  beforeEach(() => resetMint());

  // When a character is eliminated, cleanupEmptyCompanies handles the site routing.
  // We trigger character elimination via a Free Council corruption check (roll <= CP-2).

  test.todo('All characters leave play: company permanent-events are discarded');

  test('Another company at same site: site remains in play', () => {
    // P1 has Aragorn at Rivendell. A second P1 company (Legolas) shares
    // the same Rivendell site instance. When Aragorn is eliminated, the site
    // must NOT be returned or discarded — Legolas's company still occupies it.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.FreeCouncil,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const p1 = base.players[RESOURCE_PLAYER];
    const company1 = p1.companies[0];
    const aragornId = company1.characters[0];
    const rivendellSite = company1.currentSite!;

    // Move Legolas from P2 to a second P1 company sharing the same Rivendell instance
    const p2 = base.players[HAZARD_PLAYER];
    const legolasId = p2.companies[0].characters[0];
    const legolasChar = p2.characters[legolasId as string];

    const secondCompany = {
      ...company1,
      id: 'company-p1-1' as CompanyId,
      characters: [legolasId] as readonly CardInstanceId[],
      siteCardOwned: false,
    };

    const patchedState = {
      ...base,
      players: [
        {
          ...p1,
          companies: [company1, secondCompany],
          characters: { ...p1.characters, [legolasId as string]: legolasChar },
        },
        {
          ...p2,
          companies: [],
          characters: Object.fromEntries(Object.entries(p2.characters).filter(([k]) => k !== (legolasId as string))),
        },
      ] as typeof base.players,
    };

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

    const state = { ...patchedState, cheatRollTotal: 2, phaseState: fcState };
    const after = dispatch(state, { type: 'pass', player: PLAYER_1 });

    // Aragorn eliminated → company1 empty, but company2 (Legolas) still at Rivendell
    // So Rivendell must NOT be returned to location deck or discarded
    expect(after.players[RESOURCE_PLAYER].siteDeck.some(c => c.instanceId === rivendellSite.instanceId)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === rivendellSite.instanceId)).toBe(false);
    // The site remains in play with the surviving company
    expect(after.players[RESOURCE_PLAYER].companies.some(c => c.currentSite?.instanceId === rivendellSite.instanceId)).toBe(true);
  });

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
