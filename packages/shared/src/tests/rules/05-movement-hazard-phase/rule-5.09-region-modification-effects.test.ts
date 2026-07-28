/**
 * @module rule-5.09-region-modification-effects
 *
 * CoE Rules — Section 5: Movement/Hazard Phase
 * Rule 5.09: Region Modification Effects
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * If a named region has its type modified or otherwise treated differently by an effect, that modification is immediately reflected in all site paths (both for site cards and moving companies) where that region is also specified by name. If an unnamed region has its type directly modified or otherwise treated differently by an effect, that modification is only reflected in the site path where the unnamed region was changed. In other words, if an effect modifies an unnamed region in a site's path or a corresponding company's site path to/from the site while using Starter Movement, that modification is immediately reflected in that same site path and any other company's site paths using Starter Movement to/from that site, but nowhere else.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, makeMHState, viableActions, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  MORIA, LORIEN,
} from '../../test-helpers.js';
import { RegionType, SiteType } from '../../../types/common.js';
import type { CardDefinitionId } from '../../test-helpers.js';
import type { ActiveConstraint, PlayHazardAction } from '../../../index.js';

// Wild Fell Beast (td-81): keyed only to `regionTypes: ['shadow', 'shadow']` —
// needs at least two shadow-type regions in the site path, and nothing else.
const WILD_FELL_BEAST = 'td-81' as CardDefinitionId;

describe('Rule 5.09 — Region Modification Effects', () => {
  beforeEach(() => resetMint());

  test('An active region-type override (e.g. from Deeper Shadow, le-179) on a named region is reflected in creature keying against that company\'s site path', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [WILD_FELL_BEAST], siteDeck: [] },
      ],
    });
    // Only one region in the path is shadow-typed to start with — one short of
    // the two Shadow-lands Wild Fell Beast requires.
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness, RegionType.Shadow],
      resolvedSitePathNames: ['Rhudaur', 'Angmar'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const withoutOverride = { ...state, phaseState: mhState };
    expect(viableActions(withoutOverride, PLAYER_2, 'play-hazard')).toHaveLength(0);

    // An active region-type-override constraint (as created by Deeper
    // Shadow's change-region-type option — see le-179.test.ts) turns
    // "Rhudaur" from wilderness to shadow for the rest of the turn, bringing
    // the path's shadow count up to the two the creature needs.
    const regionOverride: ActiveConstraint = {
      id: 'test-region-override-1' as ActiveConstraint['id'],
      source: 'test-src-1' as ActiveConstraint['source'],
      sourceDefinitionId: 'le-179' as CardDefinitionId,
      scope: { kind: 'turn' },
      target: { kind: 'player', playerId: PLAYER_1 },
      kind: {
        type: 'attribute-modifier',
        attribute: 'region.type',
        op: 'override',
        value: 'shadow',
        filter: { 'region.name': 'Rhudaur' },
      },
    };
    const withOverride = { ...state, phaseState: mhState, activeConstraints: [regionOverride] };

    const plays = viableActions(withOverride, PLAYER_2, 'play-hazard') as { action: PlayHazardAction }[];
    expect(plays.length).toBeGreaterThan(0);
  });
});
