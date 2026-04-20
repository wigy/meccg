/**
 * @module as-4.test
 *
 * Card test: Perchen (as-4)
 * Type: minion-character
 * Effects: 1
 *
 * "Unique. +3 direct influence against any faction playable at Dunnish
 *  Clan-hold."
 *
 * Effects tested:
 * 1. stat-modifier: +3 DI during faction-influence-check when the faction's
 *    `playableAt` list contains "Dunnish Clan-hold".
 *
 * Fixture alignment: minion-character (ringwraith). The only faction in the
 * pool whose `playableAt` includes Dunnish Clan-hold is the hero faction
 * Dunlendings (tw-211), which the AS errata uses as the cross-alignment
 * target for Perchen's bonus.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  pool, PLAYER_1, PLAYER_2,
  buildSitePhaseState, buildTestState, resetMint,
  findCharInstanceId, getCharacter, RESOURCE_PLAYER,
  DUNLENDINGS, DUNNISH_CLAN_HOLD, BREE, RANGERS_OF_THE_NORTH,
  LORIEN, MORIA, MINAS_TIRITH, LEGOLAS,
} from '../test-helpers.js';
import type { CardDefinitionId, CharacterCard, InfluenceAttemptAction } from '../../index.js';
import { computeLegalActions, Phase } from '../../index.js';

const PERCHEN = 'as-4' as CardDefinitionId;

describe('Perchen (as-4)', () => {
  beforeEach(() => resetMint());

  // ─── Base stats (conditional bonus does not inflate base stats) ──────────────

  test('base effective DI is 2 (conditional bonus does not inflate base stats)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DUNNISH_CLAN_HOLD, characters: [PERCHEN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const baseDef = pool[PERCHEN as string] as CharacterCard;
    expect(baseDef.directInfluence).toBe(2);
    expect(getCharacter(state, RESOURCE_PLAYER, PERCHEN).effectiveStats.directInfluence)
      .toBe(baseDef.directInfluence);
  });

  // ─── Effect 1: +3 DI during faction-influence-check ──────────────────────────

  test('+3 DI bonus applies when influencing a faction playable at Dunnish Clan-hold', () => {
    // Perchen (man, base DI 2) attempts to influence Dunlendings (man faction,
    // influenceNumber 9, playable at Dunnish Clan-hold) while at Dunnish
    // Clan-hold. Dunlendings applies a -1 check modifier against Men.
    //   modifier = DI 2 + DI bonus 3 + Men check penalty (-1) = 4
    //   need     = 9 - 4 = 5
    const state = buildSitePhaseState({
      characters: [PERCHEN],
      site: DUNNISH_CLAN_HOLD,
      hand: [DUNLENDINGS],
    });

    const perchenId = findCharInstanceId(state, RESOURCE_PLAYER, PERCHEN);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const perchenAttempt = influenceActions.find(
      a => a.influencingCharacterId === perchenId,
    );
    expect(perchenAttempt).toBeDefined();
    // influenceNumber(9) - baseDI(2) - perchenDIBonus(3) - menCheckPenalty(-1 → +1 to need) = 5
    expect(perchenAttempt!.need).toBe(5);
  });

  test('+3 DI bonus does NOT apply to factions not playable at Dunnish Clan-hold', () => {
    // Perchen attempts Rangers of the North (dunadan faction, influenceNumber 10,
    // playable at Bree) while at Bree. Perchen is race=man — Rangers' +1 check
    // modifier is gated on dunadan, so it does not apply either.
    //   modifier = DI 2 + no DI bonus = 2
    //   need     = 10 - 2 = 8
    const state = buildSitePhaseState({
      characters: [PERCHEN],
      site: BREE,
      hand: [RANGERS_OF_THE_NORTH],
    });

    const perchenId = findCharInstanceId(state, RESOURCE_PLAYER, PERCHEN);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const perchenAttempt = influenceActions.find(
      a => a.influencingCharacterId === perchenId,
    );
    expect(perchenAttempt).toBeDefined();
    // influenceNumber(10) - baseDI(2) = 8 (no playable-at match → no bonus)
    expect(perchenAttempt!.need).toBe(8);
  });
});
