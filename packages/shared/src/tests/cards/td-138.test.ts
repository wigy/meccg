/**
 * @module td-138.test
 *
 * Card test: Men of Dale (td-138)
 * Type: hero-resource-faction
 * Race: man
 * Influence number: 8 (playable at Dale)
 * Effects: 2
 *
 * "Unique. Playable at Dale if the influence check is greater than 7.
 *  Standard Modifications: Men (+2), Dwarves (+1)."
 *
 * Effects tested:
 * 1. check-modifier: +2 to the faction-influence roll when the influencing
 *    character's race is "man" (bearer.race === "man").
 * 2. check-modifier: +1 to the faction-influence roll when the influencing
 *    character's race is "dwarf" (bearer.race === "dwarf").
 *
 * Fixture notes:
 * - Site: Dale (td-174, border-hold, nearest haven Lórien).
 * - Man character: Théoden (tw-182, man, DI 3).
 * - Dwarf character: Gimli (tw-159, dwarf, DI 2).
 * - Control character: Aragorn II (tw-120, dunadan, DI 3) — no bonus.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  buildSitePhaseState, resetMint,
  findCharInstanceId,
  RESOURCE_PLAYER,
  THEODEN, GIMLI, ARAGORN,
} from '../test-helpers.js';
import type { CardDefinitionId, InfluenceAttemptAction } from '../../index.js';
import { computeLegalActions } from '../../index.js';

const MEN_OF_DALE = 'td-138' as CardDefinitionId;
const DALE = 'td-174' as CardDefinitionId;

describe('Men of Dale (td-138)', () => {
  beforeEach(() => resetMint());

  // ─── Effect 1: +2 check bonus for Men ────────────────────────────────────────

  test('+2 influence check bonus applies when influencing character is a Man', () => {
    // Théoden (man, base DI 3) attempts to influence Men of Dale (influence# 8)
    // at Dale. Men +2 check modifier fires.
    //   modifier = DI 3 + check bonus 2 = 5
    //   need     = 8 - 5 = 3
    const state = buildSitePhaseState({
      characters: [THEODEN],
      site: DALE,
      hand: [MEN_OF_DALE],
    });

    const thodenId = findCharInstanceId(state, RESOURCE_PLAYER, THEODEN);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const attempt = influenceActions.find(a => a.influencingCharacterId === thodenId);
    expect(attempt).toBeDefined();
    // influenceNumber(8) - DI(3) - manBonus(2) = 3
    expect(attempt!.need).toBe(3);
  });

  // ─── Effect 2: +1 check bonus for Dwarves ────────────────────────────────────

  test('+1 influence check bonus applies when influencing character is a Dwarf', () => {
    // Gimli (dwarf, base DI 2) attempts to influence Men of Dale (influence# 8)
    // at Dale. Dwarves +1 check modifier fires.
    //   modifier = DI 2 + check bonus 1 = 3
    //   need     = 8 - 3 = 5
    const state = buildSitePhaseState({
      characters: [GIMLI],
      site: DALE,
      hand: [MEN_OF_DALE],
    });

    const gimliId = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const attempt = influenceActions.find(a => a.influencingCharacterId === gimliId);
    expect(attempt).toBeDefined();
    // influenceNumber(8) - DI(2) - dwarfBonus(1) = 5
    expect(attempt!.need).toBe(5);
  });

  // ─── Control: no bonus for other races ───────────────────────────────────────

  test('no influence check bonus for non-Man, non-Dwarf characters', () => {
    // Aragorn II (dunadan, base DI 3) attempts to influence Men of Dale at Dale.
    // Neither Men nor Dwarves modifier fires — modifier = DI 3 only.
    //   need = 8 - 3 = 5
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: DALE,
      hand: [MEN_OF_DALE],
    });

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const attempt = influenceActions.find(a => a.influencingCharacterId === aragornId);
    expect(attempt).toBeDefined();
    // influenceNumber(8) - DI(3) = 5 (no race bonus)
    expect(attempt!.need).toBe(5);
  });
});
