/**
 * @module as-3.test
 *
 * Card test: Mionid (as-3)
 * Type: minion-character
 *
 * "Unique. +2 direct influence against any faction playable at Variag Camp."
 *
 * Effects tested:
 * 1. stat-modifier: +2 direct-influence during faction-influence-check when
 *    the target faction's `playableAt` includes Variag Camp.
 *
 * Fixture alignment: minion-character (ringwraith). Uses minion sites (LE)
 * and a minion faction (Variags of Khand, le-292) whose playableAt is
 * Variag Camp. A control test at Goblin-gate vs Goblins of Goblin-gate
 * verifies the bonus does NOT apply to unrelated factions.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  buildSitePhaseState, resetMint,
  findCharInstanceId,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, InfluenceAttemptAction } from '../../index.js';
import { computeLegalActions } from '../../index.js';

const MIONID = 'as-3' as CardDefinitionId;
const VARIAG_CAMP = 'le-411' as CardDefinitionId;
const VARIAGS_OF_KHAND = 'le-292' as CardDefinitionId;
const GOBLIN_GATE = 'le-378' as CardDefinitionId;
const GOBLINS_OF_GOBLIN_GATE = 'le-265' as CardDefinitionId;

describe('Mionid (as-3)', () => {
  beforeEach(() => resetMint());

  test('+2 DI bonus applies when influencing a faction playable at Variag Camp', () => {
    // Mionid (base DI 0) attempts to influence Variags of Khand (influenceNumber 8)
    // at Variag Camp. The faction's playableAt = [{site: "Variag Camp"}], so the
    // effect fires: modifier = DI 0 + 2 (bonus) = 2 → need 8 - 2 = 6.
    const state = buildSitePhaseState({
      characters: [MIONID],
      site: VARIAG_CAMP,
      hand: [VARIAGS_OF_KHAND],
    });

    const mionidId = findCharInstanceId(state, RESOURCE_PLAYER, MIONID);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const mionidAttempt = influenceActions.find(
      a => a.influencingCharacterId === mionidId,
    );
    expect(mionidAttempt).toBeDefined();
    // influenceNumber(8) - baseDI(0) - variagBonus(2) = 6
    expect(mionidAttempt!.need).toBe(6);
  });

  test('+2 DI bonus does NOT apply to factions not playable at Variag Camp', () => {
    // Mionid attempts to influence Goblins of Goblin-gate (orc, influenceNumber 9,
    // playableAt = Goblin-gate) at Goblin-gate. Variag Camp is NOT in that
    // faction's playableAt, so the bonus must not fire: modifier = DI 0 → need 9.
    const state = buildSitePhaseState({
      characters: [MIONID],
      site: GOBLIN_GATE,
      hand: [GOBLINS_OF_GOBLIN_GATE],
    });

    const mionidId = findCharInstanceId(state, RESOURCE_PLAYER, MIONID);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const mionidAttempt = influenceActions.find(
      a => a.influencingCharacterId === mionidId,
    );
    expect(mionidAttempt).toBeDefined();
    // influenceNumber(9) - baseDI(0) = 9; no Variag Camp bonus
    expect(mionidAttempt!.need).toBe(9);
  });
});
