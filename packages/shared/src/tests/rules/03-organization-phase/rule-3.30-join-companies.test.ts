/**
 * @module rule-3.30-join-companies
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.30: Join Companies
 *
 * Source: docs/coe-rules.txt
 *
 * RULING:
 * The resource player may join companies at the same site while organizing
 * during the organization phase. Whenever companies are joined, effects
 * that are affecting either of the companies start affecting both of them.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, dispatch, reduce,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI, FRODO, BILBO,
  LORIEN, MORIA, MINAS_TIRITH, RIVENDELL,
  viableActions,
} from '../../test-helpers.js';
import type { GameState, MergeCompaniesAction } from '../../../index.js';

describe('Rule 3.30 — Join Companies', () => {
  beforeEach(() => resetMint());

  test('two companies at the same non-haven site can be merged via merge-companies', () => {
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: MORIA, characters: [ARAGORN] },
            { site: MORIA, characters: [LEGOLAS, FRODO] },
          ],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [GIMLI] }], hand: [], siteDeck: [] },
      ],
    });

    // Two companies at the same site share one site instance in real play.
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

    const merges = viableActions(state, PLAYER_1, 'merge-companies')
      .map(ea => ea.action as MergeCompaniesAction);
    const merge = merges.find(a => a.sourceCompanyId === sourceCompanyId && a.targetCompanyId === targetCompanyId);
    expect(merge).toBeDefined();

    const after = dispatch(state, merge!);
    expect(after.players[0].companies).toHaveLength(1);
    const survivor = after.players[0].companies[0];
    expect(survivor.id).toBe(targetCompanyId);
    expect(survivor.characters).toHaveLength(3);
    // Source company owned the physical site card; ownership transfers.
    expect(survivor.siteCardOwned).toBe(true);
  });

  test('companies at different sites cannot be merged', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: MORIA, characters: [ARAGORN] },
            { site: LORIEN, characters: [LEGOLAS] },
          ],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [GIMLI] }], hand: [], siteDeck: [] },
      ],
    });

    // Legal-action computer offers no merge between different-site companies.
    const merges = viableActions(state, PLAYER_1, 'merge-companies');
    expect(merges).toHaveLength(0);

    // Reducer guard: direct merge action is rejected.
    const direct: MergeCompaniesAction = {
      type: 'merge-companies',
      player: PLAYER_1,
      sourceCompanyId: state.players[0].companies[0].id,
      targetCompanyId: state.players[0].companies[1].id,
    };
    const rejected = reduce(state, direct);
    expect(rejected.error).toBeDefined();
    expect(rejected.error).toMatch(/same site/i);
  });

  test('joined company inherits all characters from both sides', () => {
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: MORIA, characters: [ARAGORN, BILBO] },
            { site: MORIA, characters: [LEGOLAS, FRODO] },
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

    const after = dispatch(state, {
      type: 'merge-companies',
      player: PLAYER_1,
      sourceCompanyId: state.players[0].companies[0].id,
      targetCompanyId: state.players[0].companies[1].id,
    });

    expect(after.players[0].companies).toHaveLength(1);
    expect(after.players[0].companies[0].characters).toHaveLength(4);
  });
});
