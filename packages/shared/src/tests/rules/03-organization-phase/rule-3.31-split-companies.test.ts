/**
 * @module rule-3.31-split-companies
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.31: Split Companies
 *
 * Source: docs/coe-rules.txt
 *
 * RULING:
 * The resource player may split a company into multiple companies at the
 * same site while organizing during the organization phase. When a company
 * splits, the resource player chooses which characters are considered the
 * original company and which are the new company. When a company splits at
 * a haven, its player may place an additional untapped copy of the haven
 * with the new company.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, dispatch,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI, FRODO,
  MORIA, MINAS_TIRITH, RIVENDELL,
  viableActions,
} from '../../test-helpers.js';
import type { SplitCompanyAction } from '../../../index.js';

describe('Rule 3.31 — Split Companies', () => {
  beforeEach(() => resetMint());

  test('split-company creates a new company at the same site with the chosen character', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN, FRODO] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [GIMLI] }], hand: [], siteDeck: [] },
      ],
    });

    const sourceCompanyId = state.players[0].companies[0].id;
    const siteInstanceId = state.players[0].companies[0].currentSite!.instanceId;
    const aragornInstId = state.players[0].companies[0].characters[0];

    const splits = viableActions(state, PLAYER_1, 'split-company')
      .map(ea => ea.action as SplitCompanyAction);
    const split = splits.find(a => a.characterId === aragornInstId && a.sourceCompanyId === sourceCompanyId);
    expect(split).toBeDefined();

    const after = dispatch(state, split!);
    expect(after.players[0].companies).toHaveLength(2);

    const original = after.players[0].companies.find(c => c.id === sourceCompanyId)!;
    const newCompany = after.players[0].companies.find(c => c.id !== sourceCompanyId)!;

    // Original keeps the un-split characters; new company has the one that split off.
    expect(original.characters).toHaveLength(1);
    expect(newCompany.characters).toEqual([aragornInstId]);

    // New company sits at the same site (non-haven → same instance).
    expect(newCompany.currentSite?.instanceId).toBe(siteInstanceId);
  });

  test('cannot split a company with only one GI character (source would become empty)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [GIMLI] }], hand: [], siteDeck: [] },
      ],
    });

    // Legal-action computer suppresses the split entirely.
    const splits = viableActions(state, PLAYER_1, 'split-company');
    expect(splits).toHaveLength(0);
  });

  test('splitting at a haven takes an additional untapped haven copy from the location deck for the new company', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          // Duplicate Rivendell in the site deck so the split can claim it.
          companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }],
          hand: [],
          siteDeck: [RIVENDELL, MORIA],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [GIMLI] }], hand: [], siteDeck: [] },
      ],
    });

    const sourceCompanyId = state.players[0].companies[0].id;
    const originalSiteInstanceId = state.players[0].companies[0].currentSite!.instanceId;
    const aragornInstId = state.players[0].companies[0].characters[0];
    const siteDeckBefore = state.players[0].siteDeck.length;

    const after = dispatch(state, {
      type: 'split-company',
      player: PLAYER_1,
      sourceCompanyId,
      characterId: aragornInstId,
    });

    const newCompany = after.players[0].companies.find(c => c.id !== sourceCompanyId)!;

    // New company sits at a distinct Rivendell instance pulled from the site deck.
    expect(newCompany.currentSite?.definitionId).toBe(RIVENDELL);
    expect(newCompany.currentSite?.instanceId).not.toBe(originalSiteInstanceId);
    expect(newCompany.siteCardOwned).toBe(true);

    // The duplicate Rivendell was removed from the site deck.
    expect(after.players[0].siteDeck).toHaveLength(siteDeckBefore - 1);
    expect(after.players[0].siteDeck.some(c => c.definitionId === RIVENDELL)).toBe(false);
  });
});
