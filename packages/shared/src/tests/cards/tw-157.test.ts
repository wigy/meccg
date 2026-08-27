/**
 * @module tw-157.test
 *
 * Card test: Ghân-buri-Ghân (tw-157)
 * Type: hero-character
 * Prowess 2 / Body 9 / Mind 5 / DI 2 / MP 2
 * Skills: scout, ranger
 * Race: man
 * Homesite: Drúadan Forest
 *
 * Text: "Unique. +2 direct influence against Wose factions."
 *
 * Engine Support:
 * | # | Feature                              | Status      | Notes                                          |
 * |---|---------------------------------------|-------------|-------------------------------------------------|
 * | 1 | +2 DI vs Wose factions                | IMPLEMENTED | stat-modifier, reason=faction-influence-check, faction.race=wose |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LORIEN, MORIA, MINAS_TIRITH,
  buildSitePhaseState,
  findCharInstanceId, pool, RESOURCE_PLAYER,
  getCharacter,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { CardDefinitionId, CharacterCard, InfluenceAttemptAction } from '../../index.js';

const GHAN_BURI_GHAN = 'tw-157' as CardDefinitionId;

const WOSES_OF_THE_DRUADAN_FOREST = 'tw-370' as CardDefinitionId; // wose faction, influence# 10
const DRUADAN_FOREST = 'tw-388' as CardDefinitionId; // border-hold, Ghân-buri-Ghân's homesite

const RIDERS_OF_ROHAN = 'tw-317' as CardDefinitionId; // man faction, influence# 10
const EDORAS = 'tw-394' as CardDefinitionId; // free-hold

describe('Ghân-buri-Ghân (tw-157)', () => {
  beforeEach(() => resetMint());

  // ── Base stats ─────────────────────────────────────────────────────────────

  test('base effective DI is 2 (conditional bonus does not inflate base stats)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LORIEN, characters: [GHAN_BURI_GHAN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const baseDef = pool[GHAN_BURI_GHAN as string] as CharacterCard;
    expect(baseDef.directInfluence).toBe(2);
    expect(getCharacter(state, RESOURCE_PLAYER, GHAN_BURI_GHAN).effectiveStats.directInfluence)
      .toBe(baseDef.directInfluence);
  });

  // ── Effect: +2 DI vs Wose factions (faction-influence-check) ───────────────

  test('+2 DI bonus applies when influencing Woses of the Drúadan Forest', () => {
    // influenceNumber(10) - baseDI(2) - diBonusVsWoseFaction(2) = 6
    const state = buildSitePhaseState({
      characters: [GHAN_BURI_GHAN],
      site: DRUADAN_FOREST,
      hand: [WOSES_OF_THE_DRUADAN_FOREST],
    });

    const ghanId = findCharInstanceId(state, RESOURCE_PLAYER, GHAN_BURI_GHAN);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const ghanAttempt = influenceActions.find(a => a.influencingCharacterId === ghanId);
    expect(ghanAttempt).toBeDefined();
    // 10 - (2 + 2) = 6
    expect(ghanAttempt!.need).toBe(6);
  });

  test('+2 DI bonus does NOT apply to non-Wose factions (Riders of Rohan)', () => {
    // influenceNumber(10) - baseDI(2) = 8 (no bonus for non-Wose factions)
    const state = buildSitePhaseState({
      characters: [GHAN_BURI_GHAN],
      site: EDORAS,
      hand: [RIDERS_OF_ROHAN],
    });

    const ghanId = findCharInstanceId(state, RESOURCE_PLAYER, GHAN_BURI_GHAN);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const ghanAttempt = influenceActions.find(a => a.influencingCharacterId === ghanId);
    expect(ghanAttempt).toBeDefined();
    // 10 - 2 = 8 (no bonus, Ghân-buri-Ghân is a man not affected by hobbit/dunadan check-modifiers on this faction)
    expect(ghanAttempt!.need).toBe(8);
  });
});
