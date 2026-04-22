/**
 * @module le-1.test
 *
 * Card test: Asternak (le-1)
 * Type: minion-character
 *
 * "Unique. +2 direct influence against any faction playable at Variag Camp."
 *
 * Effects tested:
 * 1. stat-modifier: +2 direct-influence during faction-influence-check when
 *    the target faction's `playableAt` includes Variag Camp.
 *
 * Fixture alignment: minion-character (ringwraith). Uses minion sites (LE)
 * and the minion faction Variags of Khand (le-292) whose playableAt is
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

const ASTERNAK = 'le-1' as CardDefinitionId;
const VARIAG_CAMP = 'le-411' as CardDefinitionId;
const VARIAGS_OF_KHAND = 'le-292' as CardDefinitionId;
const GOBLIN_GATE = 'le-378' as CardDefinitionId;
const GOBLINS_OF_GOBLIN_GATE = 'le-265' as CardDefinitionId;

describe('Asternak (le-1)', () => {
  beforeEach(() => resetMint());

  test('+2 DI bonus applies when influencing a faction playable at Variag Camp', () => {
    // Asternak (base DI 2) attempts to influence Variags of Khand
    // (influenceNumber 8) at Variag Camp. The faction's
    // playableAt = [{site: "Variag Camp"}], so the effect fires:
    //   modifier = DI 2 + Variag bonus 2 = 4
    //   need     = 8 - 4 = 4
    const state = buildSitePhaseState({
      characters: [ASTERNAK],
      site: VARIAG_CAMP,
      hand: [VARIAGS_OF_KHAND],
    });

    const asternakId = findCharInstanceId(state, RESOURCE_PLAYER, ASTERNAK);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const asternakAttempt = influenceActions.find(
      a => a.influencingCharacterId === asternakId,
    );
    expect(asternakAttempt).toBeDefined();
    // influenceNumber(8) - baseDI(2) - variagBonus(2) = 4
    expect(asternakAttempt!.need).toBe(4);
  });

  test('+2 DI bonus does NOT apply to factions not playable at Variag Camp', () => {
    // Asternak attempts to influence Goblins of Goblin-gate (orc,
    // influenceNumber 9, playableAt = Goblin-gate) at Goblin-gate. Variag
    // Camp is NOT in that faction's playableAt, so the bonus must not
    // fire: modifier = DI 2 → need 9 - 2 = 7.
    const state = buildSitePhaseState({
      characters: [ASTERNAK],
      site: GOBLIN_GATE,
      hand: [GOBLINS_OF_GOBLIN_GATE],
    });

    const asternakId = findCharInstanceId(state, RESOURCE_PLAYER, ASTERNAK);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const asternakAttempt = influenceActions.find(
      a => a.influencingCharacterId === asternakId,
    );
    expect(asternakAttempt).toBeDefined();
    // influenceNumber(9) - baseDI(2) = 7; no Variag Camp bonus
    expect(asternakAttempt!.need).toBe(7);
  });
});
