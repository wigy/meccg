/**
 * @module tw-140.test
 *
 * Card test: Denethor II (tw-140)
 * Type: hero-character
 * Effects: 1
 *
 * "Unique. +2 direct influence against the Tower Guard of Minas Tirith faction."
 *
 * Tests:
 * 1. stat-modifier: +2 DI during faction-influence-check for Tower Guard of
 *    Minas Tirith
 * 2. The bonus does not apply to a different character attempting the same
 *    faction influence
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { CardDefinitionId } from '../../types/common.js';
import {
  PLAYER_1,
  LEGOLAS,
  MINAS_TIRITH,
  buildSitePhaseState, resetMint,
  findCharInstanceId, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { InfluenceAttemptAction } from '../../index.js';
import { computeLegalActions } from '../../index.js';

const DENETHOR_II = 'tw-140' as CardDefinitionId;
const TOWER_GUARD_OF_MINAS_TIRITH = 'tw-352' as CardDefinitionId;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Denethor II (tw-140)', () => {
  beforeEach(() => resetMint());

  test('+2 direct influence against Tower Guard of Minas Tirith faction', () => {
    // Denethor II (dunadan, base DI 2) attempts to influence Tower Guard of
    // Minas Tirith at Minas Tirith.
    // Tower Guard influence number = 8.
    // Denethor has +2 DI bonus specifically for Tower Guard of Minas Tirith.
    // Tower Guard card gives Dúnedain +1 check modifier.
    //   modifier = DI 2 + DI bonus 2 + dúnadan check bonus 1 = 5
    //   need = 8 - 5 = 3
    const state = buildSitePhaseState({
      characters: [DENETHOR_II],
      site: MINAS_TIRITH,
      hand: [TOWER_GUARD_OF_MINAS_TIRITH],
    });

    const denethorId = findCharInstanceId(state, RESOURCE_PLAYER, DENETHOR_II);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const denethorAttempt = influenceActions.find(
      a => a.influencingCharacterId === denethorId,
    );
    expect(denethorAttempt).toBeDefined();

    // influenceNumber(8) - baseDI(2) - denethorDIBonus(2) - dúnadanCheckMod(1) = 3
    expect(denethorAttempt!.need).toBe(3);
  });

  test('+2 DI bonus does not apply to a different character', () => {
    // Legolas (elf, DI 2) attempting Tower Guard of Minas Tirith at Minas
    // Tirith gets no Denethor-specific bonus and no Dúnedain check bonus.
    const state = buildSitePhaseState({
      characters: [LEGOLAS],
      site: MINAS_TIRITH,
      hand: [TOWER_GUARD_OF_MINAS_TIRITH],
    });

    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const legolasAttempt = influenceActions.find(
      a => a.influencingCharacterId === legolasId,
    );
    expect(legolasAttempt).toBeDefined();

    // influenceNumber(8) - baseDI(2) = 6 (no Denethor-specific bonus, no Dúnadan check bonus)
    expect(legolasAttempt!.need).toBe(6);
  });
});
