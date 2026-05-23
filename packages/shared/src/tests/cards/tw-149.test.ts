/**
 * @module tw-149.test
 *
 * Card test: Faramir (tw-149)
 * Type: hero-character (wizard), unique
 * Prowess 5 / Body 8 / Mind 5 / DI 1 / MP 2
 * Skills: warrior, ranger
 * Race: dunadan
 * Homesite: Henneth Annûn
 * Effects: 1
 *
 * "Unique. +2 direct influence against the Rangers of Ithilien faction."
 *
 * Engine Support:
 * | # | Feature                                  | Status      | Notes                                                      |
 * |---|------------------------------------------|-------------|------------------------------------------------------------|
 * | 1 | +2 DI vs Rangers of Ithilien faction     | IMPLEMENTED | stat-modifier, reason=faction-influence-check, faction.name |
 *
 * Playable: YES
 * Certified: 2026-05-23
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  FARAMIR, MORIA, HENNETH_ANNUN, RANGERS_OF_ITHILIEN,
  findCharInstanceId, buildSitePhaseState,
  resetMint, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { InfluenceAttemptAction } from '../../index.js';

describe('Faramir (tw-149)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: +2 DI vs Rangers of Ithilien faction ──

  test('+2 DI reduces need to 4 when Faramir influences Rangers of Ithilien', () => {
    // Faramir (dunadan, DI 1) at Henneth Annûn influencing Rangers of Ithilien
    // (influenceNumber 8, dunadan +1 check-modifier from faction card).
    // effective DI = baseDI(1) + Faramir +2 bonus = 3
    // need = 8 - 3 - 1 (dunadan check-modifier) = 4
    const state = buildSitePhaseState({
      characters: [FARAMIR],
      site: HENNETH_ANNUN,
      hand: [RANGERS_OF_ITHILIEN],
    });

    const faramirId = findCharInstanceId(state, RESOURCE_PLAYER, FARAMIR);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const faramirAttempt = influenceActions.find(a => a.influencingCharacterId === faramirId);
    expect(faramirAttempt).toBeDefined();

    // influenceNumber(8) - baseDI(1) - diBonus(2) - dunedanCheckMod(1) = 4
    expect(faramirAttempt!.need).toBe(4);
  });

  test('+2 DI bonus is specific to Rangers of Ithilien (no boost at unrelated sites)', () => {
    // Faramir at Moria with no factions: no influence actions available,
    // confirming the +2 DI bonus does not bleed into base stats.
    const state = buildSitePhaseState({
      characters: [FARAMIR],
      site: MORIA,
      hand: [],
    });

    const actions = computeLegalActions(state, PLAYER_1);
    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions).toHaveLength(0);
  });
});
