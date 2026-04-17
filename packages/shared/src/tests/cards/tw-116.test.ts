/**
 * @module tw-116.test
 *
 * Card test: Adrazar (tw-116)
 * Type: hero-character
 * Effects: 1
 *
 * "Unique. +1 direct influence against all factions."
 *
 * This tests the single effect:
 * 1. stat-modifier: +1 DI during faction-influence-check (unconditional on faction race)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  pool, PLAYER_1, PLAYER_2,
  ADRAZAR, LEGOLAS,
  DOL_AMROTH, LORIEN, MORIA, MINAS_TIRITH, THRANDUILS_HALLS,
  KNIGHTS_OF_DOL_AMROTH, WOOD_ELVES,
  buildTestState, resetMint,
  findCharInstanceId, buildSitePhaseState,
  getCharacter, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, Phase } from '../../index.js';
import type { CharacterCard, InfluenceAttemptAction } from '../../index.js';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Adrazar (tw-116)', () => {
  beforeEach(() => resetMint());

  test('base effective DI is 1 (conditional bonus does not inflate base stats)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_AMROTH, characters: [ADRAZAR] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const baseDef = pool[ADRAZAR as string] as CharacterCard;
    expect(baseDef.directInfluence).toBe(1);
    expect(getCharacter(state, RESOURCE_PLAYER, ADRAZAR).effectiveStats.directInfluence).toBe(baseDef.directInfluence);
  });

  test('+1 DI bonus applies when influencing Knights of Dol Amroth (dunadan faction)', () => {
    // Adrazar (dunadan, base DI 1) attempts to influence Knights of Dol Amroth at Dol Amroth.
    // Knights influence number = 9, Dúnadan get +1 check modifier from faction card.
    // With Adrazar's +1 DI bonus vs all factions:
    //   modifier = DI 1 + DI bonus 1 + check bonus 1 = 3
    //   need = 9 - 3 = 6
    // Without the DI bonus:
    //   modifier = DI 1 + check bonus 1 = 2
    //   need = 9 - 2 = 7
    const state = buildSitePhaseState({
      characters: [ADRAZAR],
      site: DOL_AMROTH,
      hand: [KNIGHTS_OF_DOL_AMROTH],
    });

    const adrazarId = findCharInstanceId(state, RESOURCE_PLAYER, ADRAZAR);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const adrazarAttempt = influenceActions.find(
      a => a.influencingCharacterId === adrazarId,
    );
    expect(adrazarAttempt).toBeDefined();

    // influenceNumber(9) - baseDI(1) - diBonusAllFactions(1) - dúnadanCheckMod(1) = 6
    expect(adrazarAttempt!.need).toBe(6);
  });

  test('+1 DI bonus applies when influencing Wood-elves (elf faction)', () => {
    // Adrazar (dunadan, base DI 1) attempts to influence Wood-elves at Thranduil's Halls.
    // Wood-elves influence number = 8, Elves get +1 check modifier for elf bearers only.
    // Adrazar is dunadan, not elf, so the elf check modifier does NOT apply.
    // With Adrazar's +1 DI bonus vs all factions:
    //   modifier = DI 1 + DI bonus 1 = 2
    //   need = 8 - 2 = 6
    // Without the DI bonus:
    //   modifier = DI 1
    //   need = 8 - 1 = 7
    const state = buildSitePhaseState({
      characters: [ADRAZAR],
      site: THRANDUILS_HALLS,
      hand: [WOOD_ELVES],
    });

    const adrazarId = findCharInstanceId(state, RESOURCE_PLAYER, ADRAZAR);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const adrazarAttempt = influenceActions.find(
      a => a.influencingCharacterId === adrazarId,
    );
    expect(adrazarAttempt).toBeDefined();

    // influenceNumber(8) - baseDI(1) - diBonusAllFactions(1) = 6
    expect(adrazarAttempt!.need).toBe(6);
  });
});
