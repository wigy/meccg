/**
 * @module tw-169.test
 *
 * Card test: Mablung (tw-169)
 * Type: hero-character
 * Effects: 1
 *
 * "Unique. +2 direct influence against the Men of Anfalas faction."
 *
 * Tests:
 * 1. stat-modifier: +2 DI during faction-influence-check for Men of Anfalas,
 *    and confirms the bonus is specific to Mablung (does not apply to another
 *    Dúnadan character attempting the same faction-influence).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  ARAGORN,
  LOND_GALEN, MEN_OF_ANFALAS,
  buildSitePhaseState, resetMint,
  findCharInstanceId, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, InfluenceAttemptAction } from '../../index.js';
import { computeLegalActions } from '../../index.js';

const MABLUNG = 'tw-169' as CardDefinitionId;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Mablung (tw-169)', () => {
  beforeEach(() => resetMint());

  test('+2 direct influence against the Men of Anfalas faction', () => {
    // Mablung (dunadan, base DI 0) attempts to influence Men of Anfalas at
    // Lond Galen. Men of Anfalas influence number = 9.
    // Mablung has +2 DI bonus specifically for Men of Anfalas.
    // Men of Anfalas card also gives Dúnedain +1 check modifier.
    //   modifier = DI 0 + DI bonus 2 + Dúnadan check bonus 1 = 3
    //   need = 9 - 3 = 6
    const state = buildSitePhaseState({
      characters: [MABLUNG],
      site: LOND_GALEN,
      hand: [MEN_OF_ANFALAS],
    });

    const mablungId = findCharInstanceId(state, RESOURCE_PLAYER, MABLUNG);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const mablungAttempt = influenceActions.find(
      a => a.influencingCharacterId === mablungId,
    );
    expect(mablungAttempt).toBeDefined();

    // influenceNumber(9) - baseDI(0) - mablungDIBonus(2) - dúnadanCheckMod(1) = 6
    expect(mablungAttempt!.need).toBe(6);
  });

  test('+2 DI bonus does not apply to a different Dúnadan character', () => {
    // Aragorn (dunadan, base DI 3) attempts to influence Men of Anfalas at
    // Lond Galen. He gets the faction's Dúnadan check bonus but NOT
    // Mablung's character-specific +2 DI bonus.
    //   modifier = DI 3 + dúnadanCheckMod 1 = 4
    //   need = 9 - 4 = 5
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: LOND_GALEN,
      hand: [MEN_OF_ANFALAS],
    });

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const aragornAttempt = influenceActions.find(
      a => a.influencingCharacterId === aragornId,
    );
    expect(aragornAttempt).toBeDefined();

    // influenceNumber(9) - baseDI(3) - dúnadanCheckMod(1) = 5 (no Mablung bonus)
    expect(aragornAttempt!.need).toBe(5);
  });
});
