/**
 * @module rule-6.03-automatic-attacks
 *
 * CoE Rules — Section 6: Site Phase
 * Rule 6.03: Step 2: Automatic-Attacks
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Entering a Site, Step 2 (Automatic-Attacks) - If the site has any automatic-attacks, the first automatic-attack is initiated and resolved, followed by any additional automatic-attacks, with each proceeding immediately in the order listed on the site card. Once all automatic-attacks have been faced and regardless of whether they were defeated, the company is considered to have successfully entered the site.
 * The resource player can only take actions during a company's site phase after that company has successfully entered its site (but may still take actions during combat prior to entering the site, per the normal rules for combat).
 * Automatic-attacks must be faced when entering a site even if they were defeated during a previous turn.
 * Automatic-attacks added to a site are added to the end of the site's other automatic-attacks.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  ARAGORN, LEGOLAS, GWAIHIR,
  MORIA,
  resetMint,
  buildSitePhaseState, setupAutoAttackStep, runAutoAttackCombat,
  dispatch,
  attachAllyToChar, findCharInstanceId, RESOURCE_PLAYER,
} from '../../test-helpers.js';
import { BAG_END_LE, ETTENMOORS_HERO } from '../../../card-ids.js';
import type { CardDefinitionId } from '../../../index.js';

// Mount Gundabad (le-395): single automatic-attack "Orcs — each character
// faces 1 strike with 7 prowess (detainment against overt company)".
const MOUNT_GUNDABAD = 'le-395' as CardDefinitionId;

describe('Rule 6.03 — Step 2: Automatic-Attacks', () => {
  beforeEach(() => resetMint());

  test('Auto-attack initiates combat when company enters site', () => {
    // MORIA has 1 auto-attack: Orcs 4 strikes, 7 prowess.
    // After setupAutoAttackStep, a pass by PLAYER_1 triggers the attack.
    const state = buildSitePhaseState({ site: MORIA, characters: [ARAGORN] });
    const readyState = setupAutoAttackStep(state);

    const afterPass = dispatch(readyState, { type: 'pass', player: PLAYER_1 });

    expect(afterPass.combat).not.toBeNull();
    expect(afterPass.combat!.strikesTotal).toBe(4);
    expect(afterPass.combat!.strikeProwess).toBe(7);
    expect(afterPass.combat!.attackSource.type).toBe('automatic-attack');
  });

  test('Company enters site after all auto-attacks faced regardless of defeat outcome', () => {
    // ETTENMOORS_HERO has 1 auto-attack: Trolls 1 strike, 9 prowess.
    // Run through it (high roll so character survives), then pass once more
    // to advance past the automatic-attacks step — siteEntered becomes true.
    const state = buildSitePhaseState({ site: ETTENMOORS_HERO, characters: [ARAGORN] });
    const readyState = setupAutoAttackStep(state);

    const result = runAutoAttackCombat(readyState, ARAGORN, 12, null);
    // Combat is done; pass once more to complete the auto-attacks step
    const afterAllFaced = dispatch(result.state, { type: 'pass', player: PLAYER_1 });

    const siteState = afterAllFaced.phaseState as import('../../../index.js').SitePhaseState;
    expect(siteState.siteEntered).toBe(true);
  });

  test('Multiple auto-attacks are faced in order listed on the site card', () => {
    // BAG_END_LE (le-350) has 2 auto-attacks in order:
    //   1st: Hobbits — 5 strikes, 5 prowess
    //   2nd: Dúnedain — 3 strikes, 11 prowess
    const state = buildSitePhaseState({ site: BAG_END_LE, characters: [ARAGORN] });
    const readyState = setupAutoAttackStep(state);

    // Pass triggers the first auto-attack
    const afterFirst = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(afterFirst.combat).not.toBeNull();
    expect(afterFirst.combat!.strikesTotal).toBe(5);
    expect(afterFirst.combat!.strikeProwess).toBe(5);
    expect(afterFirst.combat!.creatureRace).toBe('hobbit');

    // Null out combat to simulate the first attack having been resolved,
    // then pass to trigger the second auto-attack.
    const betweenAttacks = { ...afterFirst, combat: null };
    const siteStateBetween = betweenAttacks.phaseState as import('../../../index.js').SitePhaseState;
    expect(siteStateBetween.automaticAttacksResolved).toBe(1);

    const afterSecond = dispatch(betweenAttacks, { type: 'pass', player: PLAYER_1 });
    expect(afterSecond.combat).not.toBeNull();
    expect(afterSecond.combat!.strikesTotal).toBe(3);
    expect(afterSecond.combat!.strikeProwess).toBe(11);
    expect(afterSecond.combat!.creatureRace).toBe('dunadan');

    const siteStateSecond = afterSecond.phaseState as import('../../../index.js').SitePhaseState;
    expect(siteStateSecond.automaticAttacksResolved).toBe(2);

    // After the second attack resolves, siteEntered becomes true
    const afterSecondResolved = { ...afterSecond, combat: null };
    const afterAllFaced = dispatch(afterSecondResolved, { type: 'pass', player: PLAYER_1 });
    const finalSiteState = afterAllFaced.phaseState as import('../../../index.js').SitePhaseState;
    expect(finalSiteState.siteEntered).toBe(true);
  });

  test('"Each character faces 1 strike" auto-attack also pre-assigns a strike to an attached ally (CoE 2.V.2.2)', () => {
    // Mount Gundabad's automatic-attack is "each character faces 1 strike".
    // Per CoE 2.V.2.2, allies are treated as characters for facing strikes, so
    // Gwaihir (attached to Aragorn) must also be pre-assigned a strike
    // alongside Aragorn and Legolas — not just the company's 2 characters.
    const state = buildSitePhaseState({ site: MOUNT_GUNDABAD, characters: [ARAGORN, LEGOLAS] });
    const withAlly = attachAllyToChar(state, RESOURCE_PLAYER, ARAGORN, GWAIHIR);
    const aragornId = findCharInstanceId(withAlly, RESOURCE_PLAYER, ARAGORN);
    const allyInstanceId = withAlly.players[RESOURCE_PLAYER].characters[aragornId].allies[0].instanceId;

    const readyState = setupAutoAttackStep(withAlly);
    const afterPass = dispatch(readyState, { type: 'pass', player: PLAYER_1 });

    expect(afterPass.combat).not.toBeNull();
    expect(afterPass.combat!.strikesTotal).toBe(3);
    expect(afterPass.combat!.strikeAssignments).toHaveLength(3);
    expect(afterPass.combat!.strikeAssignments.some(sa => sa.characterId === allyInstanceId)).toBe(true);
  });
});
