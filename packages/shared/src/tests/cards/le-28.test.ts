/**
 * @module le-28.test
 *
 * Card test: Odoacer (le-28)
 * Type: minion-character
 * Effects: 1
 *
 * "Unique. +3 direct influence against the Woodmen faction."
 *
 * Effects tested:
 * 1. stat-modifier: +3 DI during faction-influence-check when faction.name is "Woodmen"
 *
 * Fixture alignment: minion-character (ringwraith), so tests use minion sites
 * (LE) and minion faction targets (LE-295 Woodmen, LE-271 Men of Dorwinion).
 *
 * Odoacer's base directInfluence is 0; the +3 bonus is conditional and only
 * resolves when influencing the Woodmen faction, so it must not inflate his
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

const ODOACER = 'le-28' as CardDefinitionId;

// Minion sites
const MINAS_MORGUL = 'le-390' as CardDefinitionId; // haven
const BARAD_DUR = 'le-352' as CardDefinitionId;    // dark-hold
const WOODMEN_TOWN = 'le-414' as CardDefinitionId;  // border-hold (Woodmen faction's site)
const SHREL_KAIN = 'le-403' as CardDefinitionId;     // border-hold (Men of Dorwinion's site)

// Minion factions
const WOODMEN = 'le-295' as CardDefinitionId;            // man, influence# 11, playable at Woodmen-town
const MEN_OF_DORWINION = 'le-271' as CardDefinitionId;   // man, influence# 10, playable at Shrel-Kain

// Minion character (opponent)
const GRISHNAKH = 'le-12' as CardDefinitionId;

describe('Odoacer (le-28)', () => {
  beforeEach(() => resetMint());

  // ─── Base stats (conditional bonus does not inflate base stats) ──────────────

  test('base effective DI is 0 (conditional bonus does not inflate base stats)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [ODOACER] }], hand: [], siteDeck: [WOODMEN_TOWN] },
        { id: PLAYER_2, companies: [{ site: BARAD_DUR, characters: [GRISHNAKH] }], hand: [], siteDeck: [WOODMEN_TOWN] },
      ],
    });

    const baseDef = pool[ODOACER as string] as CharacterCard;
    expect(baseDef.directInfluence).toBe(0);
    expect(getCharacter(state, RESOURCE_PLAYER, ODOACER).effectiveStats.directInfluence)
      .toBe(baseDef.directInfluence);
  });

  // ─── Effect 1: +3 DI during faction-influence-check (Woodmen) ────────────────

  test('+3 DI bonus applies when influencing Woodmen faction', () => {
    // Odoacer (man, base DI 0) attempts to influence Woodmen (man faction,
    // influenceNumber 11) at Woodmen-town. With the +3 DI bonus vs Woodmen:
    // need = influenceNumber(11) - baseDI(0) - diBonusVsWoodmen(3) = 8.
    const state = buildMinionSitePhaseState({
      characters: [ODOACER],
      site: WOODMEN_TOWN,
      hand: [WOODMEN],
    });

    const odoacerId = findCharInstanceId(state, RESOURCE_PLAYER, ODOACER);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const odoacerAttempt = influenceActions.find(
      a => a.influencingCharacterId === odoacerId,
    );
    expect(odoacerAttempt).toBeDefined();

    // influenceNumber(11) - baseDI(0) - diBonusVsWoodmen(3) = 8
    expect(odoacerAttempt!.need).toBe(8);
  });

  test('+3 DI bonus does NOT apply to other factions (Men of Dorwinion)', () => {
    // Odoacer (man, base DI 0) attempts to influence Men of Dorwinion
    // (man faction, influenceNumber 10) at Shrel-Kain. Odoacer's bonus is
    // gated on faction.name being "Woodmen", so it must not apply here:
    // need = 10 - 0 = 10 (no bonus).
    const state = buildMinionSitePhaseState({
      characters: [ODOACER],
      site: SHREL_KAIN,
      hand: [MEN_OF_DORWINION],
    });

    const odoacerId = findCharInstanceId(state, RESOURCE_PLAYER, ODOACER);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const odoacerAttempt = influenceActions.find(
      a => a.influencingCharacterId === odoacerId,
    );
    expect(odoacerAttempt).toBeDefined();

    // influenceNumber(11) - baseDI(0) = 11 (no bonus for non-Woodmen)
    expect(odoacerAttempt!.need).toBe(11);
  });
});
