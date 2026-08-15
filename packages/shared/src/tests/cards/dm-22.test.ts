/**
 * @module dm-22.test
 *
 * Card test: Pôn-ora-Pôn (dm-22)
 * Type: minion-character (agent, ringwraith alignment)
 *
 * Text: "Unique. Agent. +3 direct influence against Wose Factions."
 *
 * Stats: prowess 1, body 9, mind 5, directInfluence 2, skills: scout/ranger/diplomat
 *
 * Effects:
 * | # | Rule                                              | Status      | Notes                             |
 * |---|----------------------------------------------------|-------------|------------------------------------|
 * | 1 | +3 DI vs Wose Factions (faction-influence-check)    | IMPLEMENTED | stat-modifier, faction.race=wose  |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  pool, PLAYER_1, PLAYER_2,
  buildTestState, buildMinionSitePhaseState, resetMint,
  findCharInstanceId,
  getCharacter, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, CharacterCard, InfluenceAttemptAction } from '../../index.js';
import { computeLegalActions, Phase } from '../../index.js';

const PON_ORA_PON = 'dm-22' as CardDefinitionId;

// Minion sites
const MINAS_MORGUL = 'le-390' as CardDefinitionId; // haven
const BARAD_DUR = 'le-352' as CardDefinitionId;    // dark-hold
const THE_WORTHY_HILLS = 'le-415' as CardDefinitionId; // ruins-and-lairs (Woses of the Eryn Vorn's site)
const CAMETH_BRIN = 'le-358' as CardDefinitionId;      // border-hold (Hillmen's site)

// Minion factions
const WOSES_OF_THE_ERYN_VORN = 'le-296' as CardDefinitionId; // wose, influence# 12, playable at The Worthy Hills
const HILLMEN = 'le-269' as CardDefinitionId;                 // man, influence# 11, playable at Cameth Brin

// Minion character (opponent)
const GRISHNAKH = 'le-12' as CardDefinitionId;

describe('Pôn-ora-Pôn (dm-22)', () => {
  beforeEach(() => resetMint());

  // ─── Base stats (conditional bonus does not inflate base stats) ──────────────

  test('base effective DI is 2 (conditional bonus does not inflate base stats)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [PON_ORA_PON] }], hand: [], siteDeck: [BARAD_DUR] },
        { id: PLAYER_2, companies: [{ site: BARAD_DUR, characters: [GRISHNAKH] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });

    const baseDef = pool[PON_ORA_PON as string] as CharacterCard;
    expect(baseDef.directInfluence).toBe(2);
    expect(getCharacter(state, RESOURCE_PLAYER, PON_ORA_PON).effectiveStats.directInfluence)
      .toBe(baseDef.directInfluence);
  });

  // ─── Effect 1: +3 DI during faction-influence-check (Wose factions) ──────────

  test('+3 DI bonus applies when influencing Woses of the Eryn Vorn', () => {
    // Pôn-ora-Pôn (man, base DI 2) attempts to influence Woses of the Eryn Vorn
    // (wose faction, influenceNumber 12) at The Worthy Hills.
    // With the +3 DI bonus vs Wose factions:
    // need = influenceNumber(12) - baseDI(2) - diBonusVsWoseFaction(3) = 7.
    const state = buildMinionSitePhaseState({
      characters: [PON_ORA_PON],
      site: THE_WORTHY_HILLS,
      hand: [WOSES_OF_THE_ERYN_VORN],
    });

    const ponId = findCharInstanceId(state, RESOURCE_PLAYER, PON_ORA_PON);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const ponAttempt = influenceActions.find(
      a => a.influencingCharacterId === ponId,
    );
    expect(ponAttempt).toBeDefined();

    // influenceNumber(12) - baseDI(2) - diBonusVsWoseFaction(3) = 7
    expect(ponAttempt!.need).toBe(7);
  });

  test('+3 DI bonus does NOT apply to other factions (Hillmen)', () => {
    // Pôn-ora-Pôn (man, base DI 2) attempts to influence Hillmen (man faction,
    // influenceNumber 11) at Cameth Brin. Pôn-ora-Pôn's bonus is gated on
    // faction.race being "wose", so it must not apply here:
    // need = 11 - 2 = 9 (no bonus).
    const state = buildMinionSitePhaseState({
      characters: [PON_ORA_PON],
      site: CAMETH_BRIN,
      hand: [HILLMEN],
    });

    const ponId = findCharInstanceId(state, RESOURCE_PLAYER, PON_ORA_PON);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const ponAttempt = influenceActions.find(
      a => a.influencingCharacterId === ponId,
    );
    expect(ponAttempt).toBeDefined();

    // influenceNumber(11) - baseDI(2) = 9 (no bonus for non-Wose factions)
    expect(ponAttempt!.need).toBe(9);
  });
});
