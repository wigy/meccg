/**
 * @module tw-118.test
 *
 * Card test: Anborn (tw-118)
 * Type: hero-character
 * Effects: 1
 *
 * "Unique. +2 direct influence against the Men of Lebennin faction."
 *
 * This tests the single effect:
 * 1. stat-modifier: +2 DI during faction-influence-check for Men of Lebennin
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  pool, PLAYER_1, PLAYER_2,
  ANBORN, LEGOLAS,
  PELARGIR, LORIEN, MORIA, MINAS_TIRITH, DOL_AMROTH,
  MEN_OF_LEBENNIN, KNIGHTS_OF_DOL_AMROTH,
  buildTestState, resetMint,
  findCharInstanceId, buildSitePhaseState,
} from '../test-helpers.js';
import { computeLegalActions, Phase } from '../../index.js';
import type { CharacterCard, InfluenceAttemptAction } from '../../index.js';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Anborn (tw-118)', () => {
  beforeEach(() => resetMint());

  test('base effective DI is 0 (conditional bonus does not inflate base stats)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: PELARGIR, characters: [ANBORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const anbornId = findCharInstanceId(state, 0, ANBORN);
    const baseDef = pool[ANBORN as string] as CharacterCard;
    expect(baseDef.directInfluence).toBe(0);
    expect(state.players[0].characters[anbornId as string].effectiveStats.directInfluence).toBe(baseDef.directInfluence);
  });

  test('+2 DI bonus applies when influencing Men of Lebennin', () => {
    // Anborn (dunadan, base DI 0) attempts to influence Men of Lebennin at Pelargir.
    // Men of Lebennin influence number = 8, Dúnadan get +1 check modifier from faction card.
    // With Anborn's +2 DI bonus vs Men of Lebennin:
    //   modifier = DI 0 + DI bonus 2 + check bonus 1 = 3
    //   need = 8 - 3 = 5
    const state = buildSitePhaseState({
      characters: [ANBORN],
      site: PELARGIR,
      hand: [MEN_OF_LEBENNIN],
    });

    const anbornId = findCharInstanceId(state, 0, ANBORN);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const anbornAttempt = influenceActions.find(
      a => a.influencingCharacterId === anbornId,
    );
    expect(anbornAttempt).toBeDefined();

    // influenceNumber(8) - baseDI(0) - diBonusMenOfLebennin(2) - dúnadanCheckMod(1) = 5
    expect(anbornAttempt!.need).toBe(5);
  });

  test('+2 DI bonus does NOT apply when influencing other factions', () => {
    // Anborn (dunadan, base DI 0) attempts to influence Knights of Dol Amroth at Dol Amroth.
    // Knights influence number = 9, Dúnadan get +1 check modifier from faction card.
    // Anborn's DI bonus is specific to Men of Lebennin, so it does NOT apply here.
    //   modifier = DI 0 + check bonus 1 = 1
    //   need = 9 - 1 = 8
    const state = buildSitePhaseState({
      characters: [ANBORN],
      site: DOL_AMROTH,
      hand: [KNIGHTS_OF_DOL_AMROTH],
    });

    const anbornId = findCharInstanceId(state, 0, ANBORN);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const anbornAttempt = influenceActions.find(
      a => a.influencingCharacterId === anbornId,
    );
    expect(anbornAttempt).toBeDefined();

    // influenceNumber(9) - baseDI(0) - dúnadanCheckMod(1) = 8
    expect(anbornAttempt!.need).toBe(8);
  });
});
