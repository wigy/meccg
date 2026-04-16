/**
 * @module rule-8.06-combat-step2-defender-assigns
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.06: Step 2: Defending Player Assigns Strikes
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Combat, Step 2 (Defending Player Assigns Strikes) - The defending player may choose one or more of their untapped characters facing the attack to each be assigned one strike. If the attack has an effect that the attacker chooses defending characters, this step is skipped. Actions cannot be taken during this step, which happens immediately.
 * Each strike can target one and only one character, and each character can be the target of only one strike from a particular attack.
 * The defending player may choose to defer assigning one or more strikes even if there are untapped characters available to choose.
 *
 * Per CoE rule 2.V.2.2: Allies are not characters, but are treated as characters for the purposes of combat-specific actions or effects (e.g. facing strikes, tapping in support or to cancel attacks).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI, FRODO, BILBO,
  CAVE_DRAKE, ORC_PATROL, GWAIHIR,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState, attachAllyToChar,
  dispatch, resolveChain, setCharStatus, findCharInstanceId,
  handCardId, companyIdAt, viableActions,
  CardStatus,
} from '../../test-helpers.js';
import type { AssignStrikeAction } from '../../../index.js';
import { computeLegalActions, Phase, RegionType, SiteType } from '../../../index.js';

describe('Rule 8.06 — Step 2: Defending Player Assigns Strikes', () => {
  beforeEach(() => resetMint());

  test('Defender may assign strikes only to untapped characters and may defer remaining', () => {
    // Orc-patrol attacks a P1 company with 3 characters: Frodo (untapped),
    // Aragorn (tapped, not eligible), Bilbo (untapped). Orc-patrol has 3
    // strikes, all faced (not attacker-chooses), so assignment opens with
    // the defender. Verify:
    //   - tapped Aragorn is NOT offered as a target
    //   - both untapped characters are offered
    //   - the defender always has a `pass` option (defer)
    //   - after assigning one strike to Frodo, Frodo is not offered again
    //     (rule: each character gets at most one strike from this attack)
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [FRODO, ARAGORN, BILBO] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [ORC_PATROL],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    // Tap Aragorn so he is not eligible to face a strike.
    const tapped = setCharStatus(state, 0, ARAGORN, CardStatus.Tapped);

    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Rhudaur'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const gameState = { ...tapped, phaseState: mhState };

    const orcId = handCardId(gameState, 1);
    const companyId = companyIdAt(gameState, 0);
    const afterHazard = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: orcId,
      targetCompanyId: companyId,
      keyedBy: { method: 'region-type' as const, value: 'wilderness' },
    });
    const afterChain = resolveChain(afterHazard);

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.assignmentPhase).toBe('defender');

    // Defender's options: assign-strike for each *untapped* character + pass.
    const defActions = computeLegalActions(afterChain, PLAYER_1).filter(a => a.viable);
    const assigns = defActions.filter(a => a.action.type === 'assign-strike').map(a => a.action as AssignStrikeAction);
    expect(assigns).toHaveLength(2);

    const aragornId = findCharInstanceId(afterChain, 0, ARAGORN);
    const frodoId = findCharInstanceId(afterChain, 0, FRODO);
    const bilboId = findCharInstanceId(afterChain, 0, BILBO);

    const targetIds = assigns.map(a => a.characterId);
    expect(targetIds).toEqual(expect.arrayContaining([frodoId, bilboId]));
    expect(targetIds).not.toContain(aragornId);

    // Pass exists — defender may always defer.
    expect(defActions.some(a => a.action.type === 'pass')).toBe(true);

    // After assigning one strike to Frodo, Frodo is not offered again,
    // and the defender still has Bilbo + pass available.
    const afterAssign = dispatch(afterChain, {
      type: 'assign-strike', player: PLAYER_1, characterId: frodoId, tapped: false,
    });
    const stillAssigns = viableActions(afterAssign, PLAYER_1, 'assign-strike').map(a => (a.action as AssignStrikeAction).characterId);
    expect(stillAssigns).toEqual([bilboId]);
    expect(viableActions(afterAssign, PLAYER_1, 'pass').length).toBe(1);
  });

  test('ally with prowess is a valid strike target for attacker-chooses-defenders (CoE 2.V.2.2)', () => {
    // Frodo has ally Gwaihir (prowess 4). When Cave-drake (attacker-chooses-defenders)
    // attacks, the attacker should be able to assign a strike to Gwaihir.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [FRODO, ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [CAVE_DRAKE],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    // Attach Gwaihir to Frodo
    const withAlly = attachAllyToChar(state, 0, FRODO, GWAIHIR);

    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Rhudaur'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const gameState = { ...withAlly, phaseState: mhState };

    // P2 plays Cave-drake targeting P1's company
    const cavedrakeId = handCardId(gameState, 1);
    const companyId = companyIdAt(gameState, 0);
    const afterHazard = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cavedrakeId,
      targetCompanyId: companyId,
      keyedBy: { method: 'region-type' as const, value: 'wilderness' },
    });
    const afterChain = resolveChain(afterHazard);

    // Pass cancel-window to get to attacker assignment
    const afterPass = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.combat!.assignmentPhase).toBe('attacker');

    // Attacker should see 3 targets: Frodo, Aragorn, and Gwaihir (ally)
    const attackerActions = computeLegalActions(afterPass, PLAYER_2);
    const assignActions = attackerActions.filter(
      a => a.viable && a.action.type === 'assign-strike',
    );
    expect(assignActions).toHaveLength(3);

    // Find the Gwaihir assign action
    const frodoChar = afterPass.players[0].characters;
    const frodoId = Object.keys(frodoChar).find(
      k => frodoChar[k].definitionId === FRODO,
    )!;
    const gwaihirAlly = frodoChar[frodoId].allies.find(a => a.definitionId === GWAIHIR);
    expect(gwaihirAlly).toBeDefined();

    // Assign a strike to Gwaihir — should succeed
    dispatch(afterPass, {
      type: 'assign-strike',
      player: PLAYER_2,
      characterId: gwaihirAlly!.instanceId,
      tapped: false,
    });
  });

  test('ally is available as a defender-assigned strike target (CoE 2.V.2.2)', () => {
    // Test that allies appear in defender strike assignment (normal creature, not attacker-chooses)
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [FRODO, ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [ORC_PATROL],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    // Attach Gwaihir to Frodo
    const withAlly = attachAllyToChar(state, 0, FRODO, GWAIHIR);

    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Rhudaur'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const gameState = { ...withAlly, phaseState: mhState };

    // P2 plays Orc-patrol targeting P1's company
    const orcId = handCardId(gameState, 1);
    const companyId = companyIdAt(gameState, 0);
    const afterHazard = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: orcId,
      targetCompanyId: companyId,
      keyedBy: { method: 'region-type' as const, value: 'wilderness' },
    });
    const afterChain = resolveChain(afterHazard);

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.assignmentPhase).toBe('defender');

    // Defender should see 3 assign-strike targets: Frodo, Aragorn, and Gwaihir
    const defenderActions = computeLegalActions(afterChain, PLAYER_1);
    const assignActions = defenderActions.filter(
      a => a.viable && a.action.type === 'assign-strike',
    );
    expect(assignActions).toHaveLength(3);
  });
});
