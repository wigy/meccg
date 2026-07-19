/**
 * @module rule-8.21-combat-step5-resolve-attack
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.21: Step 5: Resolve the Attack
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Combat, Step 5 (Resolve the Attack) - When the final strike and all associated body checks and/or effects have been resolved, the attack concludes as follows:
 * • Creature Attacks - If at least one strike was assigned and all assigned strikes were defeated, the creature is defeated and placed in the marshalling point pile of the defending player (unless detainment or taken as a trophy). If any of the strikes were not defeated or if no strikes were assigned, the creature is immediately discarded. The same applies to hazard events that create an attack and have a marshalling point value designated as kill points.
 * • Automatic-Attacks and Rescue-attacks - If at least one strike was assigned and all assigned strikes were defeated, the attack is defeated. Creature cards played as automatic-attacks are immediately discarded.
 * • Agent Hazard Attacks - Each time one of its strikes fails, the agent hazard is wounded and must make a body check. If all strikes are defeated and all body checks fail, a defending hero or Fallen-Wizard player may place the agent in their own marshalling point pile to be counted as kill MPs; otherwise the agent is removed from play.
 * • Company vs. Company Combat - Each character defeated by a strike is wounded and must make a body check. If the character is eliminated, it counts as kill MPs for the opposing player.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Phase, SiteType } from '../../../index.js';
import {
  resetMint, executeAction, makeDetainmentStrikeState, buildTestState,
  makeMHState, resolveChain, dispatch, viableActions, handCardId,
  companyIdAt, charIdAt,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  BARROW_WIGHT, ASSASSIN, DARK_QUARRELS,
  ARAGORN, LEGOLAS, GIMLI, BREE, LORIEN, MINAS_TIRITH, RIVENDELL,
} from '../../test-helpers.js';

describe('Rule 8.21 — Step 5: Resolve the Attack', () => {
  beforeEach(() => resetMint());

  test('Creature attacks: all assigned strikes defeated → creature to kill pile', () => {
    const { state, creatureInstanceId } = makeDetainmentStrikeState({
      detainment: false,
      strikeProwess: 3,
      creatureInPlay: BARROW_WIGHT,
    });
    const after = executeAction(state, PLAYER_1, 'resolve-strike', 12, false);

    expect(after.combat).toBeNull();
    expect(after.players[RESOURCE_PLAYER].killPile.some(c => c.instanceId === creatureInstanceId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === creatureInstanceId)).toBe(false);
  });

  test('Creature attacks: a strike not defeated → creature immediately discarded (not kill pile)', () => {
    // A high creature prowess vs a low defender roll fails the strike — the
    // creature is not defeated, so per rule 8.21 it is discarded rather than
    // moved to the defender's kill pile, regardless of the character's own outcome.
    const { state, creatureInstanceId } = makeDetainmentStrikeState({
      detainment: false,
      strikeProwess: 99,
      creatureInPlay: BARROW_WIGHT,
    });
    const wounded = executeAction(state, PLAYER_1, 'resolve-strike', 2, false);
    // Aragorn (body 9) survives the resulting body check (roll 5) as wounded.
    const after = executeAction(wounded, PLAYER_2, 'body-check-roll', 5);

    expect(after.combat).toBeNull();
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === creatureInstanceId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].killPile.some(c => c.instanceId === creatureInstanceId)).toBe(false);
  });

  // The "automatic-attacks/rescue-attacks discard played creatures
  // unconditionally" bullet is covered by rule 6.04's played-auto-attack
  // tests; agent hazard attack disposal is covered by section 09's agent
  // rules; company-vs-company wound/eliminate/kill-MP disposal is covered
  // by the CvCC-specific combat rules elsewhere in this section.
  test('No strikes remain assigned to a creature attack → creature immediately discarded (no kill MP)', () => {
    // Assassin has three attacks (maxCancels 2). Dark Quarrels cancels one
    // attack (Assassin's race is "men"); the defender then taps two
    // characters to cancel the remaining two attacks. With every strike
    // canceled, no strikes were ultimately assigned to the attack — per
    // rule 8.21 the creature is immediately discarded to its owner's
    // discard pile, never the defender's marshalling point (kill) pile.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BREE, characters: [ARAGORN, LEGOLAS, GIMLI] }],
          hand: [DARK_QUARRELS],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [ASSASSIN], siteDeck: [RIVENDELL] },
      ],
    });
    const state = {
      ...base,
      phaseState: makeMHState({
        resolvedSitePath: [],
        resolvedSitePathNames: [],
        destinationSiteType: SiteType.BorderHold,
        destinationSiteName: 'Bree',
      }),
    };

    const assassinId = handCardId(state, HAZARD_PLAYER);
    const afterPlay = dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: assassinId,
      targetCompanyId: companyIdAt(state, RESOURCE_PLAYER),
      keyedBy: { method: 'site-type' as const, value: 'border-hold' },
    });
    const inCombat = resolveChain(afterPlay);
    expect(inCombat.combat!.strikesTotal).toBe(3);

    // Cancel one attack with Dark Quarrels during the cancel window.
    const [cancelEvent] = viableActions(inCombat, PLAYER_1, 'cancel-attack');
    expect(cancelEvent).toBeDefined();
    const afterEventCancel = resolveChain(dispatch(inCombat, cancelEvent.action));
    expect(afterEventCancel.combat!.strikesTotal).toBe(2);

    // Defender ends the cancel window; attacker assigns both remaining
    // strikes to Aragorn.
    const afterPass = dispatch(afterEventCancel, { type: 'pass', player: PLAYER_1 });
    const aragornId = charIdAt(afterPass, RESOURCE_PLAYER, 0, 0);
    const legolasId = charIdAt(afterPass, RESOURCE_PLAYER, 0, 1);
    const gimliId = charIdAt(afterPass, RESOURCE_PLAYER, 0, 2);
    const assigned = dispatch(afterPass, {
      type: 'assign-strike',
      player: PLAYER_2,
      characterId: aragornId,
      tapped: false,
    });
    expect(assigned.combat!.assignmentPhase).toBe('cancel-by-tap');

    // Tap Legolas and Gimli to cancel the two remaining attacks.
    const oneLeft = dispatch(assigned, { type: 'cancel-by-tap', player: PLAYER_1, characterId: legolasId });
    expect(oneLeft.combat!.strikeAssignments).toHaveLength(1);
    const after = dispatch(oneLeft, { type: 'cancel-by-tap', player: PLAYER_1, characterId: gimliId });

    // All strikes canceled — combat ends and the Assassin goes to the
    // attacker's discard pile, not the defender's kill pile.
    expect(after.combat).toBeNull();
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === assassinId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].killPile.some(c => c.instanceId === assassinId)).toBe(false);
    expect(after.players[HAZARD_PLAYER].cardsInPlay.some(c => c.instanceId === assassinId)).toBe(false);
  });
});
