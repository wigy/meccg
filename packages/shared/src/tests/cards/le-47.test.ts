/**
 * @module le-47.test
 *
 * Card test: Uchel (le-47)
 * Type: minion-character
 * Effects: 1
 *
 * "Unique. +4 direct influence against the Hillmen faction."
 *
 * Effects tested:
 * 1. stat-modifier: +4 DI during faction-influence-check when faction.name is "Hillmen"
 *
 * Fixture alignment: minion-character (ringwraith), so tests use minion sites
 * (LE) and minion faction targets (LE-269 Hillmen, LE-271 Men of Dorwinion).
 *
 * Uchel's base directInfluence is 0; the +4 bonus is conditional and only
 * resolves when influencing the Hillmen faction, so it must not inflate his
 * base stats or apply to any other faction.
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

const UCHEL = 'le-47' as CardDefinitionId;

// Minion sites
const MINAS_MORGUL = 'le-390' as CardDefinitionId; // haven
const BARAD_DUR = 'le-352' as CardDefinitionId;    // dark-hold
const CAMETH_BRIN = 'le-358' as CardDefinitionId;   // border-hold (Hillmen faction's site, Uchel's home)
const SHREL_KAIN = 'le-403' as CardDefinitionId;     // border-hold (Men of Dorwinion's site)

// Minion factions
const HILLMEN = 'le-269' as CardDefinitionId;           // man, influence# 11, playable at Cameth Brin
const MEN_OF_DORWINION = 'le-271' as CardDefinitionId;  // man, influence# 11, playable at Shrel-Kain

// Minion character (opponent)
const GRISHNAKH = 'le-12' as CardDefinitionId;

describe('Uchel (le-47)', () => {
  beforeEach(() => resetMint());

  // ─── Base stats (conditional bonus does not inflate base stats) ──────────────

  test('base effective DI is 0 (conditional bonus does not inflate base stats)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [UCHEL] }], hand: [], siteDeck: [CAMETH_BRIN] },
        { id: PLAYER_2, companies: [{ site: BARAD_DUR, characters: [GRISHNAKH] }], hand: [], siteDeck: [CAMETH_BRIN] },
      ],
    });

    const baseDef = pool[UCHEL as string] as CharacterCard;
    expect(baseDef.directInfluence).toBe(0);
    expect(getCharacter(state, RESOURCE_PLAYER, UCHEL).effectiveStats.directInfluence)
      .toBe(baseDef.directInfluence);
  });

  // ─── Effect 1: +4 DI during faction-influence-check (Hillmen) ────────────────

  test('+4 DI bonus applies when influencing Hillmen faction', () => {
    // Uchel (man, base DI 0) attempts to influence Hillmen (man faction,
    // influenceNumber 11) at Cameth Brin. With the +4 DI bonus vs Hillmen:
    // need = influenceNumber(11) - baseDI(0) - diBonusVsHillmen(4) = 7.
    const state = buildMinionSitePhaseState({
      characters: [UCHEL],
      site: CAMETH_BRIN,
      hand: [HILLMEN],
    });

    const uchelId = findCharInstanceId(state, RESOURCE_PLAYER, UCHEL);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const uchelAttempt = influenceActions.find(
      a => a.influencingCharacterId === uchelId,
    );
    expect(uchelAttempt).toBeDefined();

    // influenceNumber(11) - baseDI(0) - diBonusVsHillmen(4) = 7
    expect(uchelAttempt!.need).toBe(7);
  });

  test('+4 DI bonus does NOT apply to other factions (Men of Dorwinion)', () => {
    // Uchel (man, base DI 0) attempts to influence Men of Dorwinion
    // (man faction, influenceNumber 11) at Shrel-Kain. Uchel's bonus is
    // gated on faction.name being "Hillmen", so it must not apply here:
    // need = 11 - 0 = 11 (no bonus).
    const state = buildMinionSitePhaseState({
      characters: [UCHEL],
      site: SHREL_KAIN,
      hand: [MEN_OF_DORWINION],
    });

    const uchelId = findCharInstanceId(state, RESOURCE_PLAYER, UCHEL);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const uchelAttempt = influenceActions.find(
      a => a.influencingCharacterId === uchelId,
    );
    expect(uchelAttempt).toBeDefined();

    // influenceNumber(11) - baseDI(0) = 11 (no bonus for non-Hillmen)
    expect(uchelAttempt!.need).toBe(11);
  });
});
