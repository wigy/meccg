/**
 * @module le-19.test
 *
 * Card test: Layos (le-19)
 * Type: minion-character
 * Effects: 1
 *
 * "Unique. +2 direct influence against the Men of Dorwinion faction."
 *
 * Effects tested:
 * 1. stat-modifier: +2 DI during faction-influence-check when faction.name is "Men of Dorwinion"
 *
 * Fixture alignment: minion-character (ringwraith), so tests use minion sites
 * (LE) and a minion faction target (LE-271 Men of Dorwinion).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  pool, PLAYER_1, PLAYER_2,
  buildTestState, buildSitePhaseState, resetMint,
  findCharInstanceId,
  getCharacter, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, CharacterCard, InfluenceAttemptAction } from '../../index.js';
import { computeLegalActions, Phase } from '../../index.js';

const LAYOS = 'le-19' as CardDefinitionId;

// Minion sites
const MINAS_MORGUL = 'le-390' as CardDefinitionId; // haven
const MORIA_MINION = 'le-392' as CardDefinitionId; // shadow-hold
const BARAD_DUR = 'le-352' as CardDefinitionId;    // dark-hold
const SHREL_KAIN = 'le-403' as CardDefinitionId;   // border-hold (Layos's homesite, Men of Dorwinion's site)
const GOBLIN_GATE = 'le-378' as CardDefinitionId;  // shadow-hold (Goblins of Goblin-gate's site)

// Minion factions
const MEN_OF_DORWINION = 'le-271' as CardDefinitionId;         // man, influence# 10, playable at Shrel-Kain
const GOBLINS_OF_GOBLIN_GATE = 'le-265' as CardDefinitionId;   // orc, influence# 9, playable at Goblin-gate

// Minion character (opponent)
const GRISHNAKH = 'le-12' as CardDefinitionId;

describe('Layos (le-19)', () => {
  beforeEach(() => resetMint());

  // ─── Base stats (conditional bonuses do not inflate base stats) ──────────────

  test('base effective DI is 2 (conditional bonus does not inflate base stats)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [LAYOS] }], hand: [], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: BARAD_DUR, characters: [GRISHNAKH] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const baseDef = pool[LAYOS as string] as CharacterCard;
    expect(baseDef.directInfluence).toBe(2);
    expect(getCharacter(state, RESOURCE_PLAYER, LAYOS).effectiveStats.directInfluence)
      .toBe(baseDef.directInfluence);
  });

  // ─── Effect 1: +2 DI during faction-influence-check (Men of Dorwinion) ───────

  test('+2 DI bonus applies when influencing Men of Dorwinion faction', () => {
    // Layos (man, base DI 2) attempts to influence Men of Dorwinion
    // (man faction, influenceNumber 10) at Shrel-Kain.
    // With the +2 DI bonus vs Men of Dorwinion: modifier = DI 2 + 2 = 4 → need 10 - 4 = 6.
    const state = buildSitePhaseState({
      characters: [LAYOS],
      site: SHREL_KAIN,
      hand: [MEN_OF_DORWINION],
    });

    const layosId = findCharInstanceId(state, RESOURCE_PLAYER, LAYOS);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const layosAttempt = influenceActions.find(
      a => a.influencingCharacterId === layosId,
    );
    expect(layosAttempt).toBeDefined();

    // influenceNumber(10) - baseDI(2) - diBonusVsMenOfDorwinion(2) = 6
    expect(layosAttempt!.need).toBe(6);
  });

  test('+2 DI bonus does NOT apply to other factions (Goblins of Goblin-gate)', () => {
    // Layos (man, base DI 2) attempts to influence Goblins of Goblin-gate
    // (orc faction, influenceNumber 9) at Goblin-gate. Layos's bonus is gated
    // on faction.name being "Men of Dorwinion", so it should not apply here:
    // need = 9 - 2 = 7 (no bonus).
    const state = buildSitePhaseState({
      characters: [LAYOS],
      site: GOBLIN_GATE,
      hand: [GOBLINS_OF_GOBLIN_GATE],
    });

    const layosId = findCharInstanceId(state, RESOURCE_PLAYER, LAYOS);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const layosAttempt = influenceActions.find(
      a => a.influencingCharacterId === layosId,
    );
    expect(layosAttempt).toBeDefined();

    // influenceNumber(9) - baseDI(2) = 7 (no bonus for non-Men-of-Dorwinion)
    expect(layosAttempt!.need).toBe(7);
  });
});
