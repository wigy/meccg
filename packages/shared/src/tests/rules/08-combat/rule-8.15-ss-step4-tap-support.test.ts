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
  ARAGORN, LEGOLAS, BILBO, GWAIHIR,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  ORC_LIEUTENANT,
  Phase,
  buildTestState, resetMint, makeMHState, makeShadowMHState, attachAllyToChar, findCharInstanceId,
  handCardId, companyIdAt, charIdAt, dispatch, resolveChain, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../../test-helpers.js';
import { computeLegalActions, SiteType, Race } from '../../../index.js';
import type { CombatState, CardInstanceId } from '../../../index.js';

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

    const aragornId = charIdAt(afterChain, RESOURCE_PLAYER);
    const bilboId = charIdAt(afterChain, RESOURCE_PLAYER, 0, 1);
    const legolasId = charIdAt(afterChain, RESOURCE_PLAYER, 0, 2);

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

  test('an ally that has itself been assigned a strike is NOT offered as a supporter (CoE 3.iv.4)', () => {
    // Regression: the support-action generator gated characters on "not
    // assigned a strike" but offered any untapped ally unconditionally. An
    // ally is a valid strike target, so an ally assigned its own (unresolved)
    // strike was wrongly offered to support another strike.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN, LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    // Gwaihir is an ally on Aragorn; it will be a strike target too.
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, GWAIHIR);
    const aragornId = findCharInstanceId(withAlly, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findCharInstanceId(withAlly, RESOURCE_PLAYER, LEGOLAS);
    const gwaihirId = withAlly.players[0].characters[aragornId].allies[0].instanceId;
    const companyId = companyIdAt(withAlly, RESOURCE_PLAYER);

    // Two strikes: current strike on Legolas (unresolved), a second strike
    // assigned to the untapped Gwaihir ally (unresolved).
    const combat: CombatState = {
      attackSource: { type: 'creature', instanceId: 'fake-creature' as CardInstanceId },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 2,
      strikeProwess: 8,
      creatureBody: null,
      creatureRace: Race.Orc,
      strikeAssignments: [
        { characterId: legolasId, excessStrikes: 0, resolved: false },
        { characterId: gwaihirId, excessStrikes: 0, resolved: false },
      ],
      currentStrikeIndex: 0,
      phase: 'resolve-strike',
      assignmentPhase: 'done',
      bodyCheckTarget: null,
      detainment: false,
    };
    const state = { ...withAlly, phaseState: makeShadowMHState(), combat };

    const supports = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'support-strike')
      .map(a => (a.action as { supportingCharacterId: CardInstanceId }).supportingCharacterId);

    // Aragorn (no strike, untapped) may support; Gwaihir (assigned strike 1)
    // may not.
    expect(supports).toContain(aragornId);
    expect(supports).not.toContain(gwaihirId);
  });
});
