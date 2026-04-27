/**
 * @module rule-8.14-ss-step3-minus3-untapped
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.14: Strike Step 3: -3 to Stay Untapped
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Strike Sequence, Step 3 (Applying -3 to Stay Untapped) - A defending resource player may apply a temporary -3 modification to the prowess of the character facing the strike in order to prevent the character from tapping after the strike.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  LORIEN, MORIA, MINAS_TIRITH, RIVENDELL,
  ORC_LIEUTENANT,
  Phase,
  buildTestState, resetMint, makeMHState,
  handCardId, companyIdAt, charIdAt, dispatch, resolveChain, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../../test-helpers.js';
import { computeLegalActions, SiteType } from '../../../index.js';
import type { ResolveStrikeAction } from '../../../types/actions-movement-hazard.js';

describe('Rule 8.14 — Strike Step 3: -3 to Stay Untapped', () => {
  beforeEach(() => resetMint());

  test('Defending resource player may apply -3 prowess to prevent character from tapping after strike', () => {
    // Aragorn (prowess=6) faces Orc-lieutenant (prowess=7).
    // tap-to-fight need = max(2, 7-6+1) = 2
    // stay-untapped need = max(2, 7-(6-3)+1) = max(2, 5) = 5
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [ORC_LIEUTENANT],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const mhState = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const gameState = { ...state, phaseState: mhState };

    // Play the creature hazard and resolve chain
    const creatureId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const afterPlay = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: creatureId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'ruins-and-lairs' },
    });
    const afterChain = resolveChain(afterPlay);

    // Assign the single strike to Aragorn
    const aragornId = charIdAt(afterChain, RESOURCE_PLAYER, 0, 0);
    const afterAssign = dispatch(afterChain, {
      type: 'assign-strike',
      player: PLAYER_1,
      characterId: aragornId,
      tapped: false,
    });
    expect(afterAssign.combat!.phase).toBe('resolve-strike');

    // Both tap-to-fight and stay-untapped options must be offered
    const resolveActions = computeLegalActions(afterAssign, PLAYER_1)
      .filter(a => a.action.type === 'resolve-strike') as { action: ResolveStrikeAction }[];
    expect(resolveActions).toHaveLength(2);

    const tapAction = resolveActions.find(a => a.action.tapToFight);
    const untapAction = resolveActions.find(a => !a.action.tapToFight);
    expect(tapAction).toBeDefined();
    expect(untapAction).toBeDefined();

    // Stay-untapped applies -3 to prowess: need increases by 3
    expect(untapAction!.action.need).toBe(tapAction!.action.need + 3);
    expect(untapAction!.action.need).toBeGreaterThan(tapAction!.action.need);
  });
});
