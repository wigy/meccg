/**
 * @module td-139.test
 *
 * Card test: Men of Lake-town (td-139)
 * Type: hero-resource-faction
 * Race: man
 * Influence number: 9 (playable at Lake-town)
 * Effects: 2
 *
 * "Unique. Playable at Lake-town if the influence check is greater than 8.
 *  Standard Modifications: Men (+2), Dwarves (-1)."
 *
 * Effects tested:
 * 1. check-modifier: +2 to the faction-influence roll when the influencing
 *    character's race is "man" (bearer.race === "man").
 * 2. check-modifier: -1 to the faction-influence roll when the influencing
 *    character's race is "dwarf" (bearer.race === "dwarf").
 *
 * Fixture notes:
 * - Site: Lake-town (tw-406, border-hold, nearest haven Lórien).
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

const MEN_OF_LAKE_TOWN = 'td-139' as CardDefinitionId;
const LAKE_TOWN = 'tw-406' as CardDefinitionId;

describe('Men of Lake-town (td-139)', () => {
  beforeEach(() => resetMint());

  // ─── Effect 1: +2 check bonus for Men ────────────────────────────────────────

  test('+2 influence check bonus applies when influencing character is a Man', () => {
    // Théoden (man, base DI 3) attempts to influence Men of Lake-town
    // (influence# 9) at Lake-town. Men +2 check modifier fires.
    //   modifier = DI 3 + check bonus 2 = 5
    //   need     = 9 - 5 = 4
    const state = buildSitePhaseState({
      characters: [THEODEN],
      site: LAKE_TOWN,
      hand: [MEN_OF_LAKE_TOWN],
    });

    const theodenId = findCharInstanceId(state, RESOURCE_PLAYER, THEODEN);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const attempt = influenceActions.find(a => a.influencingCharacterId === theodenId);
    expect(attempt).toBeDefined();
    // influenceNumber(9) - DI(3) - manBonus(2) = 4
    expect(attempt!.need).toBe(4);
  });

  // ─── Effect 2: -1 check penalty for Dwarves ──────────────────────────────────

  test('-1 influence check penalty applies when influencing character is a Dwarf', () => {
    // Gimli (dwarf, base DI 2) attempts to influence Men of Lake-town
    // (influence# 9) at Lake-town. Dwarves -1 check modifier fires.
    //   modifier = DI 2 + check bonus (-1) = 1
    //   need     = 9 - 1 = 8
    const state = buildSitePhaseState({
      characters: [GIMLI],
      site: LAKE_TOWN,
      hand: [MEN_OF_LAKE_TOWN],
    });

    const gimliId = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const attempt = influenceActions.find(a => a.influencingCharacterId === gimliId);
    expect(attempt).toBeDefined();
    // influenceNumber(9) - DI(2) - dwarfBonus(-1) = 8
    expect(attempt!.need).toBe(8);
  });

  // ─── Control: no bonus for other races ───────────────────────────────────────

  test('no influence check bonus for non-Man, non-Dwarf characters', () => {
    // Aragorn II (dunadan, base DI 3) attempts to influence Men of Lake-town
    // at Lake-town. Neither Men nor Dwarves modifier fires — modifier = DI 3.
    //   need = 9 - 3 = 6
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: LAKE_TOWN,
      hand: [MEN_OF_LAKE_TOWN],
    });

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const attempt = influenceActions.find(a => a.influencingCharacterId === aragornId);
    expect(attempt).toBeDefined();
    // influenceNumber(9) - DI(3) = 6 (no race bonus)
    expect(attempt!.need).toBe(6);
  });
});
