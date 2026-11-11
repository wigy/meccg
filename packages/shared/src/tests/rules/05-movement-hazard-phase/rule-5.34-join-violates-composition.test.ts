/**
 * @module rule-5.34-join-violates-composition
 *
 * CoE Rules — Section 5: Movement/Hazard Phase
 * Rule 2.IV.6.1: Forced join that would violate company composition
 *
 * Source: docs/coe-rules.md
 *
 * RULING:
 * If a resource player attempts to join multiple companies at the end of a
 * turn's movement/hazard phases but doing so would violate a company
 * composition rule, only one company of the hazard player's choice remains
 * and the other(s) must immediately return to their site(s) of origin.
 *
 * Regression for game mwbn88dm-czp7vq (seq 827): a 2-character company moved
 * to Eagles' Eyrie where a 6-character company of the same player was waiting,
 * and the end-of-M/H auto-join produced an 8-character company at a non-haven
 * site.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  LEGOLAS, GIMLI, FARAMIR, HALDIR, EOWYN, BEREGOND, BARD_BOWMAN, ADRAZAR, ANBORN,
  EAGLES_EYRIE, RIVENDELL, LORIEN,
  autoMergeNonHavenCompanies, resolveForcedJoinConflicts,
} from '../../test-helpers.js';
import { computeLegalActions, reduce, CardStatus } from '../../../index.js';
import type { GameState, CardDefinitionId } from '../../../index.js';

const BEORNS_HOUSE = 'tw-376' as CardDefinitionId;

describe('Rule 2.IV.6.1 — forced join that would violate company composition', () => {
  beforeEach(() => resetMint());

  test('6 + 2 characters at a non-haven: the mover returns to its (tapped, discarded) site of origin', () => {
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: EAGLES_EYRIE, characters: [LEGOLAS, GIMLI, FARAMIR, HALDIR, EOWYN, BEREGOND] },
            { site: EAGLES_EYRIE, characters: [BARD_BOWMAN, ADRAZAR] },
          ],
          hand: [],
          siteDeck: [],
          siteDiscardPile: [BEORNS_HOUSE],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ANBORN] }], hand: [], siteDeck: [] },
      ],
    });
    const p1 = built.players[0];
    const eyrie = p1.companies[0].currentSite!;
    const beorn = p1.siteDiscardPile[0];
    // Company 1 just moved from (tapped) Beorn's House to the Eyrie company 0
    // never left; Step 8 discarded the tapped origin site.
    const state: GameState = {
      ...built,
      players: [
        {
          ...p1,
          companies: [
            p1.companies[0],
            {
              ...p1.companies[1],
              currentSite: eyrie,
              siteCardOwned: false,
              moved: true,
              arrivedFrom: { instanceId: beorn.instanceId, definitionId: beorn.definitionId, status: CardStatus.Tapped },
            },
          ],
        },
        built.players[1],
      ],
    };

    const after = autoMergeNonHavenCompanies(resolveForcedJoinConflicts(state, 0), 0);
    const companies = after.players[0].companies;

    // No 8-character company: both companies survive separately.
    expect(companies).toHaveLength(2);
    expect(Math.max(...companies.map(c => c.characters.length))).toBe(6);
    // The unmoved 6-character company stays at the Eyrie with the site card.
    expect(companies[0].currentSite?.instanceId).toBe(eyrie.instanceId);
    expect(companies[0].siteCardOwned).toBe(true);
    // The mover is back at Beorn's House, reclaimed from the site discard pile.
    expect(companies[1].currentSite).toEqual({ instanceId: beorn.instanceId, definitionId: BEORNS_HOUSE, status: CardStatus.Tapped });
    expect(companies[1].siteCardOwned).toBe(true);
    expect(after.players[0].siteDiscardPile.some(c => c.instanceId === beorn.instanceId)).toBe(false);
    // No hazard-player choice was needed — only the unmoved company could remain.
    expect(after.pendingResolutions).toHaveLength(0);
  });

  test('when both companies moved, the hazard player chooses which one remains', () => {
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: EAGLES_EYRIE, characters: [LEGOLAS, GIMLI, FARAMIR, HALDIR, EOWYN, BEREGOND] },
            { site: EAGLES_EYRIE, characters: [BARD_BOWMAN, ADRAZAR] },
          ],
          hand: [],
          siteDeck: [LORIEN, BEORNS_HOUSE],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ANBORN] }], hand: [], siteDeck: [] },
      ],
    });
    const p1 = built.players[0];
    const eyrie = p1.companies[0].currentSite!;
    const [lorien, beorn] = p1.siteDeck;
    const state: GameState = {
      ...built,
      players: [
        {
          ...p1,
          companies: [
            { ...p1.companies[0], moved: true, arrivedFrom: { ...lorien, status: CardStatus.Untapped } },
            {
              ...p1.companies[1],
              currentSite: eyrie,
              siteCardOwned: false,
              moved: true,
              arrivedFrom: { ...beorn, status: CardStatus.Untapped },
            },
          ],
        },
        built.players[1],
      ],
    };

    const pending = autoMergeNonHavenCompanies(resolveForcedJoinConflicts(state, 0), 0);
    // Not merged yet — waiting for the hazard player's choice.
    expect(pending.players[0].companies).toHaveLength(2);
    expect(pending.pendingResolutions).toHaveLength(1);

    const choices = computeLegalActions(pending, PLAYER_2).filter(a => a.viable).map(a => a.action);
    expect(choices).toEqual([
      { type: 'select-company', player: PLAYER_2, companyId: p1.companies[0].id },
      { type: 'select-company', player: PLAYER_2, companyId: p1.companies[1].id },
    ]);
    // The resource player must wait.
    expect(computeLegalActions(pending, PLAYER_1)).toHaveLength(0);

    // Hazard player keeps the small company; the big one returns to Lórien.
    const result = reduce(pending, { type: 'select-company', player: PLAYER_2, companyId: p1.companies[1].id });
    expect(result.error).toBeUndefined();
    const companies = result.state.players[0].companies;
    expect(result.state.pendingResolutions).toHaveLength(0);
    expect(companies).toHaveLength(2);
    const big = companies.find(c => c.id === p1.companies[0].id)!;
    const small = companies.find(c => c.id === p1.companies[1].id)!;
    expect(small.currentSite?.instanceId).toBe(eyrie.instanceId);
    expect(small.siteCardOwned).toBe(true);
    expect(big.currentSite?.instanceId).toBe(lorien.instanceId);
    expect(result.state.players[0].siteDeck.map(c => c.instanceId)).toEqual([beorn.instanceId]);
  });

  test('a join that stays within seven characters still happens', () => {
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: EAGLES_EYRIE, characters: [LEGOLAS, GIMLI, FARAMIR, HALDIR, EOWYN] },
            { site: EAGLES_EYRIE, characters: [BARD_BOWMAN, ADRAZAR] },
          ],
          hand: [],
          siteDeck: [BEORNS_HOUSE],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ANBORN] }], hand: [], siteDeck: [] },
      ],
    });
    const p1 = built.players[0];
    const eyrie = p1.companies[0].currentSite!;
    const beorn = p1.siteDeck[0];
    const state: GameState = {
      ...built,
      players: [
        {
          ...p1,
          companies: [
            p1.companies[0],
            { ...p1.companies[1], currentSite: eyrie, siteCardOwned: false, moved: true, arrivedFrom: { ...beorn, status: CardStatus.Untapped } },
          ],
        },
        built.players[1],
      ],
    };

    const after = autoMergeNonHavenCompanies(resolveForcedJoinConflicts(state, 0), 0);
    expect(after.players[0].companies).toHaveLength(1);
    expect(after.players[0].companies[0].characters).toHaveLength(7);
  });
});
