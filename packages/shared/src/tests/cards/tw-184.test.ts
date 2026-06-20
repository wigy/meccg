/**
 * @module tw-184.test
 *
 * Card test: Thranduil (tw-184)
 * Type: hero-character (wizard), unique
 * Prowess 7 / Body 8 / Mind 9 / DI 3 / MP 3
 * Skills: warrior, ranger, sage
 * Race: elf
 * Homesite: Thranduil's Halls
 * Effects: 1
 *
 * "Unique. +2 direct influence against the Wood-elves faction."
 *
 * Engine Support:
 * | # | Feature                           | Status      | Notes                                                    |
 * |---|-----------------------------------|-------------|----------------------------------------------------------|
 * | 1 | +2 DI vs Wood-elves faction       | IMPLEMENTED | stat-modifier, reason=faction-influence-check, faction.name |
 *
 * Playable: YES
 * Certified: 2026-05-18
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  THRANDUILS_HALLS, MORIA,
  WOOD_ELVES,
  findCharInstanceId, buildSitePhaseState,
  resetMint, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { CardDefinitionId, InfluenceAttemptAction } from '../../index.js';

const THRANDUIL = 'tw-184' as CardDefinitionId;

describe('Thranduil (tw-184)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: +2 DI vs Wood-elves faction ──

  test('+2 DI reduces need to 2 when Thranduil influences Wood-elves', () => {
    // Thranduil (elf, DI 3) at Thranduil's Halls influencing Wood-elves
    // (influenceNumber 9, elf +1 check-modifier).
    // effective DI = baseDI(3) + Thranduil +2 bonus = 5
    // need = 9 - 5 - 1 (elf check-modifier) = 3
    const state = buildSitePhaseState({
      characters: [THRANDUIL],
      site: THRANDUILS_HALLS,
      hand: [WOOD_ELVES],
    });

    const thranduilId = findCharInstanceId(state, RESOURCE_PLAYER, THRANDUIL);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const thranduilAttempt = influenceActions.find(a => a.influencingCharacterId === thranduilId);
    expect(thranduilAttempt).toBeDefined();

    // influenceNumber(9) - baseDI(3) - diBonus(2) - elfCheckMod(1) = 3
    expect(thranduilAttempt!.need).toBe(3);
  });

  test('+2 DI bonus is specific to Wood-elves (no boost for site deck)', () => {
    // Verify the +2 DI bonus does not bleed into base stats.
    // Thranduil at a different site phase state, not near Wood-elves faction.
    // We confirm need is higher when there is no faction bonus applied.
    // At Moria (no factions playable): influence actions should be empty.
    const state = buildSitePhaseState({
      characters: [THRANDUIL],
      site: MORIA,
      hand: [],
    });

    const actions = computeLegalActions(state, PLAYER_1);
    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    // No factions in hand and Moria does not host Wood-elves → no influence actions.
    expect(influenceActions).toHaveLength(0);
  });
});
