/**
 * @module le-27.test
 *
 * Card test: Nevido Smôd (le-27)
 * Type: minion-character
 *
 * "Unique. +2 direct influence against any faction playable at Easterling Camp."
 *
 * Effects tested:
 * 1. stat-modifier: +2 direct-influence during faction-influence-check when
 *    the target faction's `playableAt` includes Easterling Camp.
 *
 * Fixture alignment: minion-character (ringwraith). Uses minion sites (LE)
 * and minion factions — Easterlings (le-264) whose playableAt is Easterling
 * Camp for the positive case, and Goblins of Goblin-gate (le-265) at
 * Goblin-gate (le-378) for the negative control.
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

const NEVIDO_SMOD = 'le-27' as CardDefinitionId;
const EASTERLING_CAMP = 'le-371' as CardDefinitionId;
const EASTERLINGS = 'le-264' as CardDefinitionId;
const GOBLIN_GATE = 'le-378' as CardDefinitionId;
const GOBLINS_OF_GOBLIN_GATE = 'le-265' as CardDefinitionId;

describe('Nevido Smôd (le-27)', () => {
  beforeEach(() => resetMint());

  test('+2 DI bonus applies when influencing a faction playable at Easterling Camp', () => {
    // Nevido Smôd (base DI 1) attempts to influence Easterlings (influenceNumber 8)
    // at Easterling Camp. The faction's playableAt = [{site: "Easterling Camp"}], so
    // the effect fires: modifier = DI 1 + 2 (bonus) = 3 → need 8 - 3 = 5.
    const state = buildSitePhaseState({
      characters: [NEVIDO_SMOD],
      site: EASTERLING_CAMP,
      hand: [EASTERLINGS],
    });

    const nevidoId = findCharInstanceId(state, RESOURCE_PLAYER, NEVIDO_SMOD);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const nevidoAttempt = influenceActions.find(
      a => a.influencingCharacterId === nevidoId,
    );
    expect(nevidoAttempt).toBeDefined();
    // influenceNumber(8) - baseDI(1) - easterlingBonus(2) = 5
    expect(nevidoAttempt!.need).toBe(5);
  });

  test('+2 DI bonus does NOT apply to factions not playable at Easterling Camp', () => {
    // Nevido Smôd attempts to influence Goblins of Goblin-gate (orc, influenceNumber 9,
    // playableAt = Goblin-gate) at Goblin-gate. Easterling Camp is NOT in that
    // faction's playableAt, so the bonus must not fire: modifier = DI 1 → need 8.
    const state = buildSitePhaseState({
      characters: [NEVIDO_SMOD],
      site: GOBLIN_GATE,
      hand: [GOBLINS_OF_GOBLIN_GATE],
    });

    const nevidoId = findCharInstanceId(state, RESOURCE_PLAYER, NEVIDO_SMOD);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const nevidoAttempt = influenceActions.find(
      a => a.influencingCharacterId === nevidoId,
    );
    expect(nevidoAttempt).toBeDefined();
    // influenceNumber(9) - baseDI(1) = 8; no Easterling Camp bonus
    expect(nevidoAttempt!.need).toBe(8);
  });
});
