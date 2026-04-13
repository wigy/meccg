/**
 * @module rule-5.33-joining-after-mh
 *
 * CoE Rules — Section 5: Movement/Hazard Phase
 * Rule 5.33 (2.IV.6): Joining Companies After M/H Phases
 *
 * Source: docs/coe-rules.txt
 *
 * RULING:
 * The resource player must immediately join any companies at the same
 * non-haven site at the end of a turn's movement/hazard phases. The
 * resource player may choose which, if any, companies at the same haven
 * site to join at the end of a turn's movement/hazard phases.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI, FRODO,
  LORIEN, MORIA, MINAS_TIRITH, RIVENDELL,
  autoMergeNonHavenCompanies,
} from '../../test-helpers.js';
import type { GameState } from '../../../index.js';

describe('Rule 5.33 — Joining Companies After M/H Phases', () => {
  beforeEach(() => resetMint());

  test('two companies at the same non-haven site auto-join into one', () => {
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: MORIA, characters: [ARAGORN] },
            { site: MORIA, characters: [LEGOLAS] },
          ],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [GIMLI] }], hand: [], siteDeck: [] },
      ],
    });

    // In real play the two companies would share one Moria instance after
    // movement. Mirror that by reusing company 0's currentSite for company 1.
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

    const merged = autoMergeNonHavenCompanies(state, 0);

    expect(merged.players[0].companies).toHaveLength(1);
    const survivor = merged.players[0].companies[0];
    // Characters from both companies end up in the survivor.
    expect(survivor.characters).toHaveLength(2);
    // The merged company keeps ownership of the physical site card (company 0 had it).
    expect(survivor.siteCardOwned).toBe(true);
    expect(survivor.currentSite?.instanceId).toBe(sharedMoria.instanceId);
  });

  test('two companies at the same haven are NOT auto-joined', () => {
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: RIVENDELL, characters: [ARAGORN] },
            { site: RIVENDELL, characters: [LEGOLAS] },
          ],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [] },
      ],
    });

    const sharedHaven = built.players[0].companies[0].currentSite!;
    const state: GameState = {
      ...built,
      players: [
        {
          ...built.players[0],
          companies: built.players[0].companies.map((c, i) =>
            i === 1 ? { ...c, currentSite: sharedHaven, siteCardOwned: false } : c,
          ),
        },
        built.players[1],
      ],
    };

    const merged = autoMergeNonHavenCompanies(state, 0);

    // Companies at the haven remain separate (joining havens is optional).
    expect(merged.players[0].companies).toHaveLength(2);
  });

  test('three companies at the same non-haven site collapse into one; unrelated companies untouched', () => {
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: MORIA, characters: [ARAGORN] },
            { site: MORIA, characters: [LEGOLAS] },
            { site: MORIA, characters: [FRODO] },
            { site: LORIEN, characters: [GIMLI] }, // unrelated — different site
          ],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [] },
      ],
    });

    const sharedMoria = built.players[0].companies[0].currentSite!;
    const state: GameState = {
      ...built,
      players: [
        {
          ...built.players[0],
          companies: built.players[0].companies.map((c, i) =>
            i === 1 || i === 2 ? { ...c, currentSite: sharedMoria, siteCardOwned: false } : c,
          ),
        },
        built.players[1],
      ],
    };

    const merged = autoMergeNonHavenCompanies(state, 0);

    // 4 → 2: three Moria companies collapse to one, Lorien company unchanged.
    expect(merged.players[0].companies).toHaveLength(2);

    const moriaCompany = merged.players[0].companies.find(c => c.currentSite?.instanceId === sharedMoria.instanceId)!;
    expect(moriaCompany.characters).toHaveLength(3);
    expect(moriaCompany.siteCardOwned).toBe(true);

    const lorienCompany = merged.players[0].companies.find(c => c.currentSite?.instanceId !== sharedMoria.instanceId)!;
    expect(lorienCompany.characters).toHaveLength(1);
  });
});
