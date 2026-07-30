/**
 * @module rule-8.34-detainment-creature-mp
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.34: Detainment Creature MP
 *
 * Source: docs/coe-rules.md
 */

/*
 * RULING:
 *
 * 3.II.3 — A detainment creature attack is not worth marshalling points
 * to a player that defeats it. If at least one strike of a detainment
 * creature attack was assigned and all of its strikes were defeated, the
 * creature card is discarded instead of being placed in the attacked
 * player's marshalling point pile.
 *
 * 3.II.4 — A Nazgûl attack against a minion company is detainment, unless
 * the attack is an automatic-attack (in which case the Nazgûl attack is
 * not detainment unless modified by an effect).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  BARROW_WIGHT,
  resetMint,
  executeAction,
  makeDetainmentStrikeState,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../../test-helpers.js';
import { isDetainmentAttack } from '../../../engine/detainment.js';
import { Alignment, Race } from '../../../types/common.js';

describe('Rule 8.34 — Detainment Creature MP', () => {
  beforeEach(() => resetMint());

  test('3.II.3 baseline — creature defeated by a NON-detainment attack lands in the defender kill pile', () => {
    // Aragorn prowess 9, creature strike prowess 3, no body.
    // Roll 3 → total 12 > 3 → strike defeated. No body → combat finalizes.
    const { state, creatureInstanceId } = makeDetainmentStrikeState({
      detainment: false,
      strikeProwess: 3,
      creatureInPlay: BARROW_WIGHT,
    });
    const after = executeAction(state, PLAYER_1, 'resolve-strike', 3, false);

    expect(after.combat).toBeNull();
    expect(after.players[RESOURCE_PLAYER].killPile.some(c => c.instanceId === creatureInstanceId)).toBe(true);
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === creatureInstanceId)).toBe(false);
  });

  test('3.II.3 — detainment creature defeated (≥1 strike assigned, all defeated) → attacker discard, NOT defender kill pile', () => {
    const { state, creatureInstanceId } = makeDetainmentStrikeState({
      detainment: true,
      strikeProwess: 3,
      creatureInPlay: BARROW_WIGHT,
    });
    const after = executeAction(state, PLAYER_1, 'resolve-strike', 3, false);

    expect(after.combat).toBeNull();
    // Creature lands in the hazard player's (attacker's) discard pile.
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === creatureInstanceId)).toBe(true);
    // Not in the defender's kill pile — 0 kill-MP awarded.
    expect(after.players[RESOURCE_PLAYER].killPile.some(c => c.instanceId === creatureInstanceId)).toBe(false);
  });

  test('3.II.3 — detainment creature whose strike was NOT defeated (character tapped) follows existing not-defeated routing', () => {
    // Strike prowess 15 vs character prowess 9 + roll 3 = 12 < 15 → failed
    // strike (character tapped under detainment). Not allDefeated → normal
    // "combat ended, creature to attacker discard" path fires; no kill-MP
    // is awarded in either branch.
    const { state, creatureInstanceId } = makeDetainmentStrikeState({
      detainment: true,
      strikeProwess: 15,
      creatureInPlay: BARROW_WIGHT,
    });
    const after = executeAction(state, PLAYER_1, 'resolve-strike', 3, false);

    expect(after.combat).toBeNull();
    expect(after.players[RESOURCE_PLAYER].killPile.some(c => c.instanceId === creatureInstanceId)).toBe(false);
    // Creature still goes somewhere (discard), never disappears.
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === creatureInstanceId)).toBe(true);
  });

  // 3.II.4 is a property of the detainment predicate itself, so it is
  // exercised by direct calls to `isDetainmentAttack` — the same pattern
  // rule 5.25 uses for the 3.II.2 alignment branches. The nine Nazgûl
  // hazard creatures are `race: "ringwraith"` cards (e.g. Adûnaphel tw-2)
  // played through the same hazard combat path as any other creature; a
  // plain Nazgûl attack carries no keying that would trigger the earlier
  // 3.II.2.R1/R2 branches, isolating the 3.II.4 branch here.

  test('3.II.4 — a Nazgûl (non-automatic) attack vs a minion company is detainment', () => {
    const nazgulAttack = { attackRace: Race.Ringwraith };
    expect(isDetainmentAttack({ ...nazgulAttack, defendingAlignment: Alignment.Ringwraith })).toBe(true);
    expect(isDetainmentAttack({ ...nazgulAttack, defendingAlignment: Alignment.Balrog })).toBe(true);
    // Control: a non-Nazgûl creature with the same (empty) keying is not.
    expect(isDetainmentAttack({ attackRace: Race.Man, defendingAlignment: Alignment.Ringwraith })).toBe(false);
  });

  test('3.II.4 — a Nazgûl automatic-attack vs a minion company is NOT detainment unless modified by an effect', () => {
    const auto = { attackRace: Race.Ringwraith, isAutomaticAttack: true };
    expect(isDetainmentAttack({ ...auto, defendingAlignment: Alignment.Ringwraith })).toBe(false);
    expect(isDetainmentAttack({ ...auto, defendingAlignment: Alignment.Balrog })).toBe(false);
    // "unless modified by an effect": a combat-detainment effect on the
    // attack restores detainment even for the automatic-attack.
    expect(isDetainmentAttack({
      ...auto,
      defendingAlignment: Alignment.Ringwraith,
      attackEffects: [{ type: 'combat-detainment' }],
    })).toBe(true);
  });

  test('3.II.4 — a Nazgûl attack vs a hero or Fallen-wizard company is not auto-detainment', () => {
    const nazgulAttack = { attackRace: Race.Ringwraith };
    expect(isDetainmentAttack({ ...nazgulAttack, defendingAlignment: Alignment.Wizard })).toBe(false);
    expect(isDetainmentAttack({ ...nazgulAttack, defendingAlignment: Alignment.FallenWizard })).toBe(false);
  });
});
