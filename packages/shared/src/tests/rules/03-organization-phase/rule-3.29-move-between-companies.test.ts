/**
 * @module rule-3.29-move-between-companies
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.29: Move Between Companies
 *
 * Source: docs/coe-rules.txt
 *
 * RULING:
 * The resource player may move a character (and that character's followers)
 * being controlled with general influence between companies at the same site
 * without creating a third company while organizing during the organization
 * phase.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, dispatch,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI, FRODO, BILBO,
  LORIEN, MORIA, MINAS_TIRITH, RIVENDELL,
  viableActions,
} from '../../test-helpers.js';
import type { GameState, MoveToCompanyAction } from '../../../index.js';

describe('Rule 3.29 — Move Between Companies', () => {
  beforeEach(() => resetMint());

  test('GI character moves from source to target company at same site without creating a third company', () => {
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: MORIA, characters: [ARAGORN, FRODO] },
            { site: MORIA, characters: [LEGOLAS] },
          ],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [GIMLI] }], hand: [], siteDeck: [] },
      ],
    });

    const sharedMoria = built.players[0].companies[0].currentSite!;
    const state: GameState = {
      ...built,
      players: [
        {
          ...built.players[0],
          companies: built.players[0].companies.map((c, i) =>
            i === 1 ? { ...c, currentSite: sharedMoria, siteCardOwned: false } : c,
          ),
        },
        built.players[1],
      ],
    };

    const sourceCompanyId = state.players[0].companies[0].id;
    const targetCompanyId = state.players[0].companies[1].id;
    const aragornInstId = state.players[0].companies[0].characters[0];

    const moves = viableActions(state, PLAYER_1, 'move-to-company')
      .map(ea => ea.action as MoveToCompanyAction);
    const move = moves.find(a =>
      a.characterInstanceId === aragornInstId
      && a.sourceCompanyId === sourceCompanyId
      && a.targetCompanyId === targetCompanyId,
    );
    expect(move).toBeDefined();

    const after = dispatch(state, move!);

    // Still exactly two companies — rule 3.29 explicitly forbids creating a third.
    expect(after.players[0].companies).toHaveLength(2);

    const source = after.players[0].companies.find(c => c.id === sourceCompanyId)!;
    const target = after.players[0].companies.find(c => c.id === targetCompanyId)!;
    expect(source.characters).not.toContain(aragornInstId);
    expect(target.characters).toContain(aragornInstId);
  });

  test('cannot move between companies at different sites', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: MORIA, characters: [ARAGORN, FRODO] },
            { site: LORIEN, characters: [LEGOLAS] },
          ],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [GIMLI] }], hand: [], siteDeck: [] },
      ],
    });

    // No move-to-company offers between companies at different sites.
    const moves = viableActions(state, PLAYER_1, 'move-to-company');
    expect(moves).toHaveLength(0);
  });

  test('cannot move a character if it would leave the source company empty', () => {
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: MORIA, characters: [ARAGORN] }, // only 1 GI char
            { site: MORIA, characters: [LEGOLAS, BILBO] },
          ],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [GIMLI] }], hand: [], siteDeck: [] },
      ],
    });

    const sharedMoria = built.players[0].companies[0].currentSite!;
    const state: GameState = {
      ...built,
      players: [
        {
          ...built.players[0],
          companies: built.players[0].companies.map((c, i) =>
            i === 1 ? { ...c, currentSite: sharedMoria, siteCardOwned: false } : c,
          ),
        },
        built.players[1],
      ],
    };

    const sourceCompanyId = state.players[0].companies[0].id;
    const aragornInstId = state.players[0].companies[0].characters[0];

    // Source company's lone character cannot be offered a move-to-company.
    const moves = viableActions(state, PLAYER_1, 'move-to-company')
      .map(ea => ea.action as MoveToCompanyAction);
    const wouldEmpty = moves.find(a =>
      a.characterInstanceId === aragornInstId && a.sourceCompanyId === sourceCompanyId,
    );
    expect(wouldEmpty).toBeUndefined();
  });
});
