/**
 * @module rule-8.02-combat-step1-pre-assignment
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.02: Step 1: Pre-Assignment Actions
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Combat, Step 1 (Pre-Assignment Actions) - Prior to strikes being assigned, either player may take actions that they would normally be allowed to take during the current phase of the game in which combat is taking place. Regardless of the phase of the game in which combat is taking place, the resource player may take resource/character actions, and the hazard player may take hazard actions if combat is taking place during a movement/hazard phase, that would either:
 * • cancel the attack
 * • modify attributes of the attack as a whole (e.g. the number of strikes, which player assigns strikes, the prowess or body of the attack, etc.).
 * Players cannot take actions that cancel the attack or modify the attack as a whole after this step, which continues until both players have finished taking actions prior to strike assignment.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, viableActions, dispatch,
  makeCancelWindowCombat, placeOnGuard,
  PLAYER_1, PLAYER_2, ARAGORN, LEGOLAS, MORIA, LORIEN, RIVENDELL, MINAS_TIRITH,
  RESOURCE_PLAYER,
} from '../../test-helpers.js';
import { Alignment, Race } from '../../../index.js';
import type { CardDefinitionId, GameState } from '../../../index.js';

const UNABATED_IN_MALICE = 'ba-26' as CardDefinitionId;

// The pre-assignment cancel/modify window is implemented: `inCancelWindow`
// (legal-actions/combat.ts) gates `cancelAttackActions`/`modifyAttackActions`
// to `combat.phase === 'assign-strikes'` with no strikes assigned yet (or the
// equivalent pre-resolution window for "each character faces a strike"
// attacks), matching CRF 22 Annotation 13 ("an attack may not be canceled
// once its strikes have been assigned"). It is exercised implicitly by many
// individual cancel-attack card tests throughout this section (e.g. Escape,
// Adûnaphel the Ringwraith). What remains unverified in isolation is the
// specific "still counts against the company's hazard limit" claim for a
// hazard action taken by the attacker in this window during an M/H-phase
// combat — hazard-limit bookkeeping is uniform across every hazard play
// (mh-hazard-play.ts) regardless of whether combat happens to be active, so
// there is no separate "combat pre-assignment" hazard-limit carve-out to
// isolate from the general hazard-limit rules already covered in section 05.
describe('Rule 8.02 — Step 1: Pre-Assignment Actions', () => {
  beforeEach(() => resetMint());

  test.todo('Before strikes assigned, players may cancel attack or modify attack attributes; company hazard limit still in effect');

  test('defender cannot begin strike assignment while the attacker still holds a pre-assignment modify-attack option', () => {
    // Regression (game ms77xgju-p0ke1j, seq 79): the hazard player (attacker)
    // had placed Unabated in Malice on-guard, which became a live modify-attack
    // option the moment the company faced the site's automatic-attack. But the
    // defending player's assign-strike action was offered in the very same
    // window, and the defender assigned a strike before the attacker got a
    // chance to reveal the card — silently foreclosing it. Per CoE rule 8.02,
    // "[step 1] continues until both players have finished taking actions
    // prior to strike assignment": the defender may not begin strike
    // assignment while the attacker still holds a pending modify-attack option.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const combat0 = makeCancelWindowCombat(base, {
      attackSourceType: 'automatic-attack',
      creatureRace: Race.Wolf,
      strikesTotal: 3,
      strikeProwess: 7,
    });
    // Hazard player (PLAYER_2, the attacker) placed ba-26 on-guard on the
    // defending (PLAYER_1) company during the M/H phase.
    const { state: combat } = placeOnGuard(combat0, RESOURCE_PLAYER, 0, UNABATED_IN_MALICE);

    // The attacker has a live modify-attack option (the on-guard reveal)...
    const attackerOptions = viableActions(combat, PLAYER_2, 'modify-attack');
    expect(attackerOptions).toHaveLength(1);

    // ...so the defender must not yet be offered assign-strike.
    expect(viableActions(combat, PLAYER_1, 'assign-strike')).toHaveLength(0);

    // Once the attacker declines (passes) the window, the defender may proceed.
    const afterPass = dispatch(combat, { type: 'pass', player: PLAYER_2 });
    expect(afterPass.combat!.attackerPreAssignDone).toBe(true);
    expect(viableActions(afterPass, PLAYER_1, 'assign-strike').length).toBeGreaterThan(0);
  });

  test('defender may assign strikes immediately once the attacker reveals/exhausts their modify-attack option', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const combat0 = makeCancelWindowCombat(base, {
      attackSourceType: 'automatic-attack',
      creatureRace: Race.Wolf,
      strikesTotal: 3,
      strikeProwess: 7,
    });
    const { state: combat } = placeOnGuard(combat0, RESOURCE_PLAYER, 0, UNABATED_IN_MALICE);

    const reveal = viableActions(combat, PLAYER_2, 'modify-attack')[0].action;
    const afterReveal: GameState = dispatch(combat, reveal);

    // The card is now spent — the attacker has nothing left to declare, so
    // the defender may assign strikes without waiting for an explicit pass.
    expect(viableActions(afterReveal, PLAYER_2, 'modify-attack')).toHaveLength(0);
    expect(viableActions(afterReveal, PLAYER_1, 'assign-strike').length).toBeGreaterThan(0);
    expect(afterReveal.combat!.strikesTotal).toBe(4);
    expect(afterReveal.combat!.strikeProwess).toBe(8);
  });
});
