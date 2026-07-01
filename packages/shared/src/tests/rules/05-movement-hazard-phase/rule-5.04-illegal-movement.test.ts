/**
 * @module rule-5.04-illegal-movement
 *
 * CoE Rules — Section 5: Movement/Hazard Phase
 * Rule 5.04: Illegal Movement Negated
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * If a company's movement is illegal when the new site is revealed during the company's movement/hazard phase, the movement is negated, the new site is returned to its player's location deck, and the company must remain at its current site but still conducts a movement/hazard phase.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, makeMHState, viableActions, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  MORIA, LORIEN,
} from '../../test-helpers.js';
import type { CardDefinitionId } from '../../test-helpers.js';
import type { MovementHazardPhaseState } from '../../../index.js';

// Moria → Henneth Annûn (tw-400) are 5 regions apart (Redhorn Gate → Wold &
// Foothills → Brown Lands → Dagorlad → Ithilien) — unreachable within
// BASE_MAX_REGION_DISTANCE (4). Neither is a haven, so starter movement
// doesn't apply either; only a region-distance bonus (e.g. Cram's
// extra-region-movement, discarded during organization) could have made
// this destination reachable when originally declared. Single-test use →
// inline.
const HENNETH_ANNUN = 'tw-400' as CardDefinitionId;

describe('Rule 5.04 — Illegal Movement Negated', () => {
  beforeEach(() => resetMint());

  test('A declared destination with no legal path within the current max region distance has its movement negated: destination returns to the location deck, company stays, and still conducts a full M/H phase', () => {
    // extraRegionDistance is reset to 0 for every company at the Long-event
    // → Movement/Hazard transition (before ANY company's M/H sub-phase
    // begins), so a region path that fit when declared during organization
    // (using a now-spent bonus) can no longer be completed by reveal time.
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN], destinationSite: HENNETH_ANNUN }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const state = { ...built, phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: false, maxRegionDistance: 4 }) };

    // No legal declare-path action reaches the declared destination.
    expect(viableActions(state, PLAYER_1, 'declare-path')).toHaveLength(0);
    // Rule 5.04's negation is offered as a 'pass' instead, so the company is
    // never stuck with zero actions.
    const passActions = viableActions(state, PLAYER_1, 'pass');
    expect(passActions).toHaveLength(1);

    const after = dispatch(state, passActions[0].action);
    const company = after.players[0].companies[0];

    // Movement negated: no destination, company stays at its current site.
    expect(company.destinationSite).toBeNull();
    expect(company.currentSite?.definitionId).toBe(MORIA);
    // The (would-be) new site is returned to the location deck.
    expect(after.players[0].siteDeck.some(c => c.definitionId === HENNETH_ANNUN)).toBe(true);

    // The company still conducts a full movement/hazard phase — it advances
    // past reveal-new-site rather than being stuck, treated as stationary at Moria.
    const mh = after.phaseState as MovementHazardPhaseState;
    expect(mh.step).not.toBe('reveal-new-site');
    expect(mh.destinationSiteName).toBe('Moria');
  });
});
