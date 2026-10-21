/**
 * @module dm-183.test
 *
 * Card test: Wolf (dm-183)
 * Type: minion-character (ringwraith), agent
 * Effects: 1
 *
 * "Unique. Agent. +2 direct influence against Dunlendings."
 *
 * Wolf has base DI 2 (prowess 3, body 7, mind 4, DI 2). The +2 bonus fires
 * during a faction-influence-check when the faction being influenced is named
 * "Dunlendings" — modelled as a direct-influence stat-modifier gated on
 * `reason: faction-influence-check` + `faction.name`. Against any other
 * faction no bonus applies.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  EDORAS, DUNNISH_CLAN_HOLD,
  RIDERS_OF_ROHAN, DUNLENDINGS,
  buildSitePhaseState, resetMint,
  findCharInstanceId, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, InfluenceAttemptAction } from '../../index.js';
import { computeLegalActions } from '../../index.js';

const WOLF = 'dm-183' as CardDefinitionId;

function wolfNeed(state: ReturnType<typeof buildSitePhaseState>): number {
  const wolfId = findCharInstanceId(state, RESOURCE_PLAYER, WOLF);
  const actions = computeLegalActions(state, PLAYER_1);
  const attempt = actions
    .filter(a => a.viable && a.action.type === 'influence-attempt')
    .map(a => a.action as InfluenceAttemptAction)
    .find(a => a.influencingCharacterId === wolfId);
  expect(attempt).toBeDefined();
  return attempt!.need;
}

describe('Wolf (dm-183)', () => {
  beforeEach(() => resetMint());

  test('+2 DI applies when influencing the Dunlendings faction', () => {
    // Wolf base DI 2, +2 vs Dunlendings → effective DI 4.
    // Dunlendings applies a -1 check modifier to men (Wolf is a man).
    // need = influenceNumber(Dunlendings = 10) - 4 - checkBonus(-1) = 7.
    const withBonus = wolfNeed(buildSitePhaseState({
      characters: [WOLF],
      site: DUNNISH_CLAN_HOLD,
      hand: [DUNLENDINGS],
    }));
    expect(withBonus).toBe(7);
  });

  test('+2 DI does NOT apply against another faction (Riders of Rohan)', () => {
    // Riders of Rohan is not Dunlendings: Wolf influences with base DI 2.
    // need = influenceNumber(Riders of Rohan = 10) - 2 = 8.
    const noBonus = wolfNeed(buildSitePhaseState({
      characters: [WOLF],
      site: EDORAS,
      hand: [RIDERS_OF_ROHAN],
    }));
    expect(noBonus).toBe(8);
  });
});
