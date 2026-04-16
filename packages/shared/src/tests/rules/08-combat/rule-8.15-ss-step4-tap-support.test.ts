/**
 * @module rule-8.15-ss-step4-tap-support
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.15: Strike Step 4: Tapping for +1 Support
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Strike Sequence, Step 4 (Tapping for +1 Support) - A defending resource player may tap one or more of their untapped characters in the same company who hasn't been assigned a strike (even if the character wasn't allowed to face the attack) to "support" by applying a temporary +1 modification to the prowess of the character facing the strike.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, BILBO,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  ORC_LIEUTENANT,
  Phase,
  buildTestState, resetMint, makeMHState,
  handCardId, companyIdAt, charIdAt, dispatch, resolveChain,
} from '../../test-helpers.js';
import { computeLegalActions, SiteType } from '../../../index.js';

describe('Rule 8.15 — Strike Step 4: Tapping for +1 Support', () => {
  beforeEach(() => resetMint());

  test('Each support-strike adds +1 to facing character prowess and updates the resolve-strike need/explanation', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN, BILBO, LEGOLAS] }],
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

    const creatureId = handCardId(gameState, 1);
    const companyId = companyIdAt(gameState, 0);
    const afterPlay = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: creatureId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'ruins-and-lairs' },
    });
    const afterChain = resolveChain(afterPlay);

    const aragornId = charIdAt(afterChain, 0, 0, 0);
    const bilboId = charIdAt(afterChain, 0, 0, 1);
    const legolasId = charIdAt(afterChain, 0, 0, 2);

    // Assign the single strike to Bilbo (low prowess, well above the
    // need-2 floor) — Aragorn and Legolas remain available to support.
    const r1 = dispatch(afterChain, {
      type: 'assign-strike',
      player: PLAYER_1,
      characterId: bilboId,
      tapped: false,
    });
    expect(r1.combat!.phase).toBe('resolve-strike');

    // Initial need: Bilbo's prowess vs creature prowess.
    const initialResolve = computeLegalActions(r1, PLAYER_1)
      .find(a => a.action.type === 'resolve-strike' && (a.action as { tapToFight: boolean }).tapToFight);
    expect(initialResolve).toBeDefined();
    const initialNeed = (initialResolve!.action as { need: number }).need;
    const initialExplanation = (initialResolve!.action as { explanation: string }).explanation;

    // Tap Aragorn to support: +1 prowess → need decreases by 1.
    const r2 = dispatch(r1, {
      type: 'support-strike',
      player: PLAYER_1,
      supportingCharacterId: aragornId,
      targetCharacterId: bilboId,
    });
    expect(r2.combat!.strikeAssignments[0].supportCount).toBe(1);

    const afterOneSupport = computeLegalActions(r2, PLAYER_1)
      .find(a => a.action.type === 'resolve-strike' && (a.action as { tapToFight: boolean }).tapToFight);
    expect(afterOneSupport).toBeDefined();
    expect((afterOneSupport!.action as { need: number }).need).toBe(initialNeed - 1);
    expect((afterOneSupport!.action as { explanation: string }).explanation).not.toBe(initialExplanation);

    // Tap Legolas as a second supporter: +1 more prowess.
    const r3 = dispatch(r2, {
      type: 'support-strike',
      player: PLAYER_1,
      supportingCharacterId: legolasId,
      targetCharacterId: bilboId,
    });
    expect(r3.combat!.strikeAssignments[0].supportCount).toBe(2);

    const afterTwoSupports = computeLegalActions(r3, PLAYER_1)
      .find(a => a.action.type === 'resolve-strike' && (a.action as { tapToFight: boolean }).tapToFight);
    expect(afterTwoSupports).toBeDefined();
    expect((afterTwoSupports!.action as { need: number }).need).toBe(initialNeed - 2);
  });
});
