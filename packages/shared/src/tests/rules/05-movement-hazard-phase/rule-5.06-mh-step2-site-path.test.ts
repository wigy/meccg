/**
 * @module rule-5.06-mh-step2-site-path
 *
 * CoE Rules — Section 5: Movement/Hazard Phase
 * Rule 5.06: Step 2: Determine the Site Path
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Movement/Hazard Phase, Step 2 (Determine the Site Path) - If the company is moving, the site from which the company is departing becomes its "site of origin." The resource player declares which type of movement is being used in order to determine the company's "site path":
 * • Starter Movement - The company's site path is the sequence of regions designated on the haven card(s) if moving from haven to haven, and otherwise is listed on the left side of the non-haven card. This site path includes the region types listed, as well as the name of the region containing the site of origin and the name of the region containing the new site (but no region names for any intervening regions).
 * • Region Movement - The company's site path is declared by the resource player when the new site is revealed. This declared sequence of regions may be different than the site's site path, but must have been legal when movement was initially declared during the organization phase (including not exceeding the maximum number of regions, not repeating regions, etc.). This site path includes both the region types and names of all regions being moved through.
 * • Under-Deeps Movement - The company doesn't have a site path (i.e. a surface site's region is not moved through).
 * • Special Movement - The company's site path depends on the effect being used for movement, but generally does not include regions unless the effect states otherwise.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, makeMHState, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, MORIA, LORIEN,
} from '../../test-helpers.js';
import type { CardDefinitionId } from '../../test-helpers.js';
import type { MovementHazardPhaseState } from '../../../index.js';
import { MovementType } from '../../../types/common.js';

// Regions on the Rivendell → Moria path (RegionType 'wilderness' for both).
// Single-test use → inline.
const HOLLIN = 'tw-466' as CardDefinitionId;
const REDHORN_GATE = 'tw-481' as CardDefinitionId;
// The Under-gates (dm-38): under-deeps, adjacent to Moria with roll 0 (no
// roll step needed — declare-path auto-advances).
const THE_UNDER_GATES = 'dm-38' as CardDefinitionId;

describe('Rule 5.06 — Step 2: Determine the Site Path', () => {
  beforeEach(() => resetMint());

  test('Starter movement: site path is the non-haven card\'s printed sitePath plus origin/destination region names', () => {
    // Rivendell (haven, region Rhudaur) → Moria (non-haven, region Redhorn
    // Gate, printed sitePath [wilderness, wilderness]).
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: MORIA }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const state = { ...base, phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: false }) };

    const after = dispatch(state, { type: 'declare-path', player: PLAYER_1, movementType: MovementType.Starter });
    const mh = after.phaseState as MovementHazardPhaseState;

    expect(mh.resolvedSitePath).toEqual(['wilderness', 'wilderness']);
    expect(mh.resolvedSitePathNames).toEqual(['Rhudaur', 'Redhorn Gate']);
  });

  test('Region movement: site path is exactly the player-declared region sequence (types and names)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: MORIA }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const state = { ...base, phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: false }) };

    const after = dispatch(state, {
      type: 'declare-path',
      player: PLAYER_1,
      movementType: MovementType.Region,
      regionPath: [HOLLIN, REDHORN_GATE],
    });
    const mh = after.phaseState as MovementHazardPhaseState;

    expect(mh.resolvedSitePath).toEqual(['wilderness', 'wilderness']);
    expect(mh.resolvedSitePathNames).toEqual(['Hollin', 'Redhorn Gate']);
  });

  test('Under-deeps movement: the company has no site path', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN], destinationSite: THE_UNDER_GATES }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const state = { ...base, phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: false }) };

    const after = dispatch(state, { type: 'declare-path', player: PLAYER_1, movementType: MovementType.UnderDeeps });
    const mh = after.phaseState as MovementHazardPhaseState;

    expect(mh.resolvedSitePath).toEqual([]);
    expect(mh.resolvedSitePathNames).toEqual([]);
  });

  test('Special movement: no region path is generally included', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: MORIA }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const state = { ...base, phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: false }) };

    const after = dispatch(state, { type: 'declare-path', player: PLAYER_1, movementType: MovementType.Special });
    const mh = after.phaseState as MovementHazardPhaseState;

    expect(mh.resolvedSitePath).toEqual([]);
    expect(mh.resolvedSitePathNames).toEqual([]);
  });
});
