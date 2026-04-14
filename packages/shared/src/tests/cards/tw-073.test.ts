/**
 * @module tw-073.test
 *
 * Card test: Orc-lieutenant (tw-073)
 * Type: hazard-creature
 * Effects: 1
 *
 * "Orcs. One strike. If played on a company that has already faced an Orc
 * attack this turn, Orc-lieutenant receives +4 prowess."
 *
 * This tests:
 * 1. Base stats: 1 strike, 7 prowess, no body, 1 kill MP
 * 2. stat-modifier: +4 prowess when company.facedRaces includes "orc"
 * 3. No prowess bonus when no prior Orc attack faced
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, GIMLI,
  ORC_LIEUTENANT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState,
  resolveChain,
  handCardId, companyIdAt, charIdAt, dispatch,
} from '../test-helpers.js';
import { computeLegalActions, Phase, SiteType } from '../../index.js';
// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Orc-lieutenant (tw-073)', () => {
  beforeEach(() => resetMint());


  test('base prowess 7 when company has not faced an Orc attack', () => {
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
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [ORC_LIEUTENANT],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const mhState = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const gameState = { ...state, phaseState: mhState };

    const lieutenantId = handCardId(gameState, 1);
    const companyId = companyIdAt(gameState, 0);
    const afterPlay = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: lieutenantId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'shadow-hold' },
    });

    const afterChain = resolveChain(afterPlay);
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikeProwess).toBe(7);
    expect(afterChain.combat!.strikesTotal).toBe(1);
  });

  test('+4 prowess (total 11) when company has already faced an Orc attack', () => {
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
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [ORC_LIEUTENANT, ORC_LIEUTENANT],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const mhState = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const gameState = { ...state, phaseState: mhState };

    // --- First attack: play first Orc-lieutenant (1 strike Orc) ---
    const firstLtId = handCardId(gameState, 1, 0);
    const companyId = companyIdAt(gameState, 0);
    const afterPlayFirst = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: firstLtId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'shadow-hold' },
    });

    const afterFirstChain = resolveChain(afterPlayFirst);
    expect(afterFirstChain.combat).not.toBeNull();
    expect(afterFirstChain.combat!.creatureRace).toBe('orc');
    expect(afterFirstChain.combat!.strikeProwess).toBe(7);

    // Defender assigns strike to Aragorn
    const aragornId = charIdAt(afterFirstChain, 0);
    let s = dispatch(afterFirstChain, {
      type: 'assign-strike',
      player: PLAYER_1,
      characterId: aragornId,
      tapped: false,
    });

    // Resolve the single strike — high roll so Aragorn wins
    s = { ...s, cheatRollTotal: 12 };
    const resolveActions = computeLegalActions(s, PLAYER_1);
    const resolveAction = resolveActions.find(a => a.viable && a.action.type === 'resolve-strike');
    expect(resolveAction).toBeDefined();
    s = dispatch(s, resolveAction!.action);

    // Combat finalized — back in M/H play-hazards
    expect(s.combat).toBeNull();

    // Verify the hazard was recorded in phaseState.hazardsEncountered
    expect(s.phaseState.phase).toBe(Phase.MovementHazard);
    const mh = s.phaseState as typeof mhState;
    expect(mh.hazardsEncountered).toContain('Orc-lieutenant');

    // --- Second attack: play second Orc-lieutenant ---
    const secondLtId = handCardId(s, 1, 0);
    const afterPlaySecond = dispatch(s, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: secondLtId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'shadow-hold' },
    });

    const afterSecondChain = resolveChain(afterPlaySecond);
    expect(afterSecondChain.combat).not.toBeNull();
    expect(afterSecondChain.combat!.strikeProwess).toBe(11);
  });
});
