/**
 * @module rule-3.41-ringwraith-movement
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.41: Ringwraith Movement Restrictions
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [MINION] A company that contains a Ringwraith can only move to a non-Darkhaven site if the Ringwraith's site of origin is a Darkhaven (unless using Dwar Unleashed) and the Ringwraith is in a mode (i.e. Black Rider, Fell Rider, or Heralded Lord). Additionally, a company that contains a Ringwraith can only use Starter Movement or Under-deeps Movement, and cannot have a site path that contains a Coastal Sea region.
 * [MINION] Ringwraith followers may move with their controlling Ringwraith without being in a mode themselves.
 * [MINION] If a Ringwraith's mode is removed while it is moving (e.g. due to an ally leaving play during a movement/hazard phase), the Ringwraith immediately ceases being in that mode but continues to move to its new site.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, viableActions, Phase, Alignment,
  PLAYER_1, PLAYER_2,
  LEGOLAS, LORIEN,
} from '../../test-helpers.js';
import type { CardDefinitionId } from '../../../index.js';
import type { PlanMovementAction } from '../../../types/actions-organization.js';

// le-58: The Witch-king — Ringwraith avatar (mind: null, race: ringwraith)
const THE_WITCH_KING = 'le-58' as CardDefinitionId;
// le-367: Dol Guldur — Darkhaven (siteType: haven)
const DOL_GULDUR = 'le-367' as CardDefinitionId;
// le-390: Minas Morgul — Darkhaven (siteType: haven); connected to Dol Guldur via havenPath
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
// le-364: Dead Marshes — shadow-hold (not a Darkhaven); nearestHaven = Dol Guldur
// so it IS reachable from Dol Guldur via starter movement for normal companies,
// but the Ringwraith restriction must exclude it when there is no mode card.
const DEAD_MARSHES = 'le-364' as CardDefinitionId;

describe('Rule 3.41 — Ringwraith Movement Restrictions', () => {
  beforeEach(() => resetMint());

  test('[MINION] Without mode card, Ringwraith company can only plan movement to Darkhaven', () => {
    // The Witch-king at Dol Guldur with no mode card in play.
    // Site deck contains both Minas Morgul (Darkhaven) and Dead Marshes
    // (shadow-hold whose nearestHaven is Dol Guldur — reachable via starter
    // movement for a normal company).  Only Minas Morgul must be offered;
    // Dead Marshes must be excluded by the Ringwraith restriction.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [THE_WITCH_KING] }],
          hand: [],
          siteDeck: [MINAS_MORGUL, DEAD_MARSHES],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const minasInst = state.players[0].siteDeck.find(s => s.definitionId === MINAS_MORGUL)!.instanceId;
    const deadInst  = state.players[0].siteDeck.find(s => s.definitionId === DEAD_MARSHES)!.instanceId;

    const plans = viableActions(state, PLAYER_1, 'plan-movement');

    // Minas Morgul (Darkhaven) must be a viable destination
    expect(plans.some(ea => (ea.action as PlanMovementAction).destinationSite === minasInst)).toBe(true);

    // Dead Marshes (shadow-hold) must be excluded even though it is reachable
    // from Dol Guldur via starter movement for non-Ringwraith companies.
    expect(plans.every(ea => (ea.action as PlanMovementAction).destinationSite !== deadInst)).toBe(true);
  });
});
