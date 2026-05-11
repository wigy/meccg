/**
 * @module rule-3.45-under-deeps-movement
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.45: Under-Deeps Movement
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * UNDER-DEEPS MOVEMENT - To use Under-deeps Movement, either the company's current site or new site must be an Under-Deeps site, and the new site card must be listed as one of the adjacent sites on the company's current site card or vice versa.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, viableFor, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  MORIA, LORIEN,
} from '../../test-helpers.js';
import type { CardDefinitionId } from '../../test-helpers.js';
import type { PlanMovementAction } from '../../../types/actions-organization.js';

// DM Under-deeps site IDs (single-use, defined locally per project convention)
const THE_UNDER_GATES = 'dm-38' as CardDefinitionId;   // adj: Moria(0), Gem-deeps(6), Sulfur-deeps(5), Under-grottos(8), Under-leas(6)
const THE_UNDER_GROTTOS = 'dm-39' as CardDefinitionId; // adj: Goblin-gate(0), Under-leas(8), Under-gates(8)
const THE_UNDER_GALLERIES = 'dm-37' as CardDefinitionId; // adj: *region:Udûn(0), Under-courts(4), Sulfur-deeps(8)
const CIRITH_GORGOR = 'as-137' as CardDefinitionId;    // region: Udûn — surface site adjacent to Under-galleries via wildcard

describe('Rule 3.45 — Under-Deeps Movement', () => {
  beforeEach(() => resetMint());

  test('Company at surface site adjacent to Under-deeps is offered that Under-deeps destination', () => {
    // Moria (tw-413, surface) is listed in The Under-gates' (dm-38) adjacentSites with roll 0.
    // A company at Moria with The Under-gates in its site deck should get a plan-movement option.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [THE_UNDER_GATES],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const underGatesInstId = state.players[0].siteDeck.find(
      s => s.definitionId === THE_UNDER_GATES,
    )!.instanceId;

    const movements = viableFor(state, PLAYER_1)
      .filter(a => a.action.type === 'plan-movement') as { action: PlanMovementAction }[];

    expect(movements.some(a => a.action.destinationSite === underGatesInstId)).toBe(true);
  });

  test('Company at Under-deeps site is offered adjacent Under-deeps destinations', () => {
    // The Under-gates (dm-38) lists The Under-grottos (dm-39) with roll 8.
    // A company at The Under-gates with The Under-grottos in its site deck should get
    // a plan-movement option (the roll is handled at movement/hazard phase time).
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: THE_UNDER_GATES, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [THE_UNDER_GROTTOS],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const underGrottosInstId = state.players[0].siteDeck.find(
      s => s.definitionId === THE_UNDER_GROTTOS,
    )!.instanceId;

    const movements = viableFor(state, PLAYER_1)
      .filter(a => a.action.type === 'plan-movement') as { action: PlanMovementAction }[];

    expect(movements.some(a => a.action.destinationSite === underGrottosInstId)).toBe(true);
  });

  test('Company at Under-deeps site is not offered non-adjacent Under-deeps destinations', () => {
    // From The Under-gates (dm-38), The Under-galleries (dm-37) is NOT adjacent —
    // dm-38's adjacentSites lists Moria, Gem-deeps, Sulfur-deeps, Under-grottos, Under-leas
    // and dm-37's adjacentSites lists *region:Udûn, Under-courts, Sulfur-deeps.
    // Neither site lists the other, so plan-movement to The Under-galleries must NOT be offered.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: THE_UNDER_GATES, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [THE_UNDER_GALLERIES],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const underGalleriesInstId = state.players[0].siteDeck.find(
      s => s.definitionId === THE_UNDER_GALLERIES,
    )!.instanceId;

    const movements = viableFor(state, PLAYER_1)
      .filter(a => a.action.type === 'plan-movement') as { action: PlanMovementAction }[];

    expect(movements.some(a => a.action.destinationSite === underGalleriesInstId)).toBe(false);
  });

  test('Wildcard adjacency: company at Under-galleries can move to any site in Udûn region', () => {
    // The Under-galleries (dm-37) has "*region:Udûn": 0 in adjacentSites, meaning
    // any site whose region field equals "Udûn" is reachable with roll 0.
    // Cirith Gorgor (as-137) is in the Udûn region.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: THE_UNDER_GALLERIES, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [CIRITH_GORGOR],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const cirithGorgorInstId = state.players[0].siteDeck.find(
      s => s.definitionId === CIRITH_GORGOR,
    )!.instanceId;

    const movements = viableFor(state, PLAYER_1)
      .filter(a => a.action.type === 'plan-movement') as { action: PlanMovementAction }[];

    expect(movements.some(a => a.action.destinationSite === cirithGorgorInstId)).toBe(true);
  });
});
