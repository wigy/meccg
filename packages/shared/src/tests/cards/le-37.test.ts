/**
 * @module le-37.test
 *
 * Card test: Pon Opar (le-37)
 * Type: minion-character
 * Effects: 1
 *
 * "Unique. +2 direct influence against any faction playable at Southron Oasis."
 *
 * Effects tested:
 * 1. stat-modifier: +2 DI during a faction-influence-check when the faction's
 *    `playableAt` list contains "Southron Oasis" (the three factions keyed to
 *    that site: Southrons le-287/tw-329 and Haradrim as-63).
 *
 * Fixture alignment: minion-character (ringwraith). The positive target is the
 * minion faction Southrons (le-287, influenceNumber 9, playable at Southron
 * Oasis); the negative control is Easterlings (le-264, influenceNumber 9,
 * playable at Easterling Camp) which is not playable at Southron Oasis. Both
 * factions carry only `controller.inPlay`-gated check-modifiers, none of which
 * fire in these states, so `need` isolates Pon Opar's direct-influence bonus.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  pool, PLAYER_1,
  buildSitePhaseState, resetMint,
  findCharInstanceId, getCharacter, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, CharacterCard, InfluenceAttemptAction } from '../../index.js';
import { computeLegalActions } from '../../index.js';

const PON_OPAR = 'le-37' as CardDefinitionId;
const SOUTHRONS = 'le-287' as CardDefinitionId;        // faction playable at Southron Oasis
const SOUTHRON_OASIS = 'le-404' as CardDefinitionId;   // minion site (border-hold)
const EASTERLINGS = 'le-264' as CardDefinitionId;      // faction NOT playable at Southron Oasis
const EASTERLING_CAMP = 'le-371' as CardDefinitionId;  // minion site (border-hold)

describe('Pon Opar (le-37)', () => {
  beforeEach(() => resetMint());

  // ─── Base stats (conditional bonus does not inflate base stats) ──────────────

  test('base effective DI is 1 (conditional bonus does not inflate base stats)', () => {
    const state = buildSitePhaseState({
      characters: [PON_OPAR],
      site: SOUTHRON_OASIS,
      hand: [],
    });

    const baseDef = pool[PON_OPAR as string] as CharacterCard;
    expect(baseDef.directInfluence).toBe(1);
    expect(getCharacter(state, RESOURCE_PLAYER, PON_OPAR).effectiveStats.directInfluence)
      .toBe(baseDef.directInfluence);
  });

  // ─── Effect 1: +2 DI during faction-influence-check ──────────────────────────

  test('+2 DI bonus applies when influencing a faction playable at Southron Oasis', () => {
    // Pon Opar (man, base DI 1) attempts Southrons (man faction, influenceNumber
    // 9, playable at Southron Oasis) while at Southron Oasis. Southrons' own
    // check-modifiers require Haradrim/Asdriags in play (neither is), so they do
    // not apply.
    //   modifier = DI 1 + DI bonus 2 = 3
    //   need     = influenceNumber 9 - 3 = 6
    const state = buildSitePhaseState({
      characters: [PON_OPAR],
      site: SOUTHRON_OASIS,
      hand: [SOUTHRONS],
    });

    const ponId = findCharInstanceId(state, RESOURCE_PLAYER, PON_OPAR);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const ponAttempt = influenceActions.find(a => a.influencingCharacterId === ponId);
    expect(ponAttempt).toBeDefined();
    expect(ponAttempt!.need).toBe(6);
  });

  test('+2 DI bonus does NOT apply to a faction not playable at Southron Oasis', () => {
    // Pon Opar attempts Easterlings (man faction, influenceNumber 9, playable at
    // Easterling Camp) while at Easterling Camp. Easterlings is not playable at
    // Southron Oasis, so no direct-influence bonus applies; its own
    // check-modifiers require other factions in play (none are).
    //   modifier = DI 1 (no bonus)
    //   need     = influenceNumber 9 - 1 = 8
    const state = buildSitePhaseState({
      characters: [PON_OPAR],
      site: EASTERLING_CAMP,
      hand: [EASTERLINGS],
    });

    const ponId = findCharInstanceId(state, RESOURCE_PLAYER, PON_OPAR);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const ponAttempt = influenceActions.find(a => a.influencingCharacterId === ponId);
    expect(ponAttempt).toBeDefined();
    expect(ponAttempt!.need).toBe(8);
  });
});
