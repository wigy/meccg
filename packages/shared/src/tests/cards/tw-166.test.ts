/**
 * @module tw-166.test
 *
 * Card test: Imrahil (tw-166)
 * Type: hero-character
 * Effects: 1
 *
 * "Unique. +2 direct influence against the Knights of Dol Amroth faction."
 *
 * Tests:
 * 1. stat-modifier: +2 DI during faction-influence-check for Knights of Dol Amroth
 * 2. Negative: +2 DI bonus does not apply to other characters
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  FARAMIR,
  KNIGHTS_OF_DOL_AMROTH, DOL_AMROTH,
  buildSitePhaseState,
  findCharInstanceId, resetMint, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, InfluenceAttemptAction } from '../../index.js';
import { computeLegalActions } from '../../index.js';

const IMRAHIL = 'tw-166' as CardDefinitionId;

describe('Imrahil (tw-166)', () => {
  beforeEach(() => resetMint());

  test('+2 direct influence against Knights of Dol Amroth faction', () => {
    // Imrahil (dunadan, base DI 2) attempts to influence Knights of Dol Amroth at Dol Amroth.
    // Knights of Dol Amroth influence number = 9.
    // Imrahil has +2 DI bonus specifically for Knights of Dol Amroth.
    // Knights of Dol Amroth card gives Dúnedain +1 check modifier.
    //   modifier = DI(2) + Imrahil DI bonus(2) + dunadan check bonus(1) = 5
    //   need = 9 - 5 = 4
    const state = buildSitePhaseState({
      characters: [IMRAHIL],
      site: DOL_AMROTH,
      hand: [KNIGHTS_OF_DOL_AMROTH],
    });

    const imrahilId = findCharInstanceId(state, RESOURCE_PLAYER, IMRAHIL);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const imrahilAttempt = influenceActions.find(
      a => a.influencingCharacterId === imrahilId,
    );
    expect(imrahilAttempt).toBeDefined();

    // influenceNumber(9) - DI(2) - imrahilBonus(2) - dunedainCheckMod(1) = 4
    expect(imrahilAttempt!.need).toBe(4);
  });

  test('+2 DI bonus does not apply to other characters', () => {
    // Faramir (dunadan, base DI 1) attempts to influence Knights of Dol Amroth at Dol Amroth.
    // No Imrahil-specific bonus; dunadan check modifier (+1) still applies.
    //   modifier = DI(1) + dunadan check bonus(1) = 2
    //   need = 9 - 2 = 7
    const state = buildSitePhaseState({
      characters: [FARAMIR],
      site: DOL_AMROTH,
      hand: [KNIGHTS_OF_DOL_AMROTH],
    });

    const faramirId = findCharInstanceId(state, RESOURCE_PLAYER, FARAMIR);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const faramirAttempt = influenceActions.find(
      a => a.influencingCharacterId === faramirId,
    );
    expect(faramirAttempt).toBeDefined();

    // influenceNumber(9) - DI(1) - dunedainCheckMod(1) = 7 (no Imrahil-specific bonus)
    expect(faramirAttempt!.need).toBe(7);
  });
});
