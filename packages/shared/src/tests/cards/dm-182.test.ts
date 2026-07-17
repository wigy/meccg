/**
 * @module dm-182.test
 *
 * Card test: Freca (dm-182)
 * Type: minion-character (ringwraith), agent
 * Effects: 2
 *
 * "Unique. Agent. +1 direct influence against Riders of Rohan and Dunlendings."
 *
 * Freca has base DI 2 (prowess 4, body 8, mind 5, DI 2). The +1 bonus fires
 * during a faction-influence-check when the faction being influenced is named
 * "Riders of Rohan" or "Dunlendings" — modelled as two direct-influence
 * stat-modifiers gated on `reason: faction-influence-check` + `faction.name`.
 * Against any other faction no bonus applies.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  EDORAS, DUNNISH_CLAN_HOLD, MINAS_TIRITH,
  RIDERS_OF_ROHAN, DUNLENDINGS, MEN_OF_ANORIEN,
  buildSitePhaseState, resetMint,
  findCharInstanceId, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, InfluenceAttemptAction } from '../../index.js';
import { computeLegalActions } from '../../index.js';

const FRECA = 'dm-182' as CardDefinitionId;

function frecaNeed(state: ReturnType<typeof buildSitePhaseState>): number {
  const frecaId = findCharInstanceId(state, RESOURCE_PLAYER, FRECA);
  const actions = computeLegalActions(state, PLAYER_1);
  const attempt = actions
    .filter(a => a.viable && a.action.type === 'influence-attempt')
    .map(a => a.action as InfluenceAttemptAction)
    .find(a => a.influencingCharacterId === frecaId);
  expect(attempt).toBeDefined();
  return attempt!.need;
}

describe('Freca (dm-182)', () => {
  beforeEach(() => resetMint());

  test('+1 DI applies when influencing the Riders of Rohan faction', () => {
    // Freca base DI 2, +1 vs Riders of Rohan → effective DI 3.
    // need = influenceNumber(Riders of Rohan) - 3.
    const withBonus = frecaNeed(buildSitePhaseState({
      characters: [FRECA],
      site: EDORAS,
      hand: [RIDERS_OF_ROHAN],
    }));
    expect(withBonus).toBe(7);
  });

  test('+1 DI applies when influencing the Dunlendings faction', () => {
    // Freca base DI 2, +1 vs Dunlendings → effective DI 3.
    // Dunlendings applies a -1 check modifier to men (Freca is a man).
    // need = influenceNumber(Dunlendings) - 3 - checkBonus(-1).
    const withBonus = frecaNeed(buildSitePhaseState({
      characters: [FRECA],
      site: DUNNISH_CLAN_HOLD,
      hand: [DUNLENDINGS],
    }));
    expect(withBonus).toBe(8);
  });

  test('+1 DI does NOT apply against an unrelated faction', () => {
    // Men of Anórien is neither Riders of Rohan nor Dunlendings: no Freca bonus.
    // Its +1 check modifier applies only to dúnedain, so Freca (a man) gets none.
    // need = influenceNumber(Men of Anórien = 8) - baseDI(2) = 6.
    const noBonus = frecaNeed(buildSitePhaseState({
      characters: [FRECA],
      site: MINAS_TIRITH,
      hand: [MEN_OF_ANORIEN],
    }));
    expect(noBonus).toBe(6);
  });
});
