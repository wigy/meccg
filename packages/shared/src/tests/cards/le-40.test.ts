/**
 * @module le-40.test
 *
 * Card test: Shámas (le-40)
 * Type: minion-character
 *
 * "Unique. +1 direct influence against Man factions. Additionally, +2 direct
 *  influence against the Dunlendings faction."
 *
 * Tests:
 * 1. stat-modifier: +1 DI during faction-influence-check vs any Man faction
 * 2. stat-modifier: +2 additional DI (stacking with the Man bonus) vs the
 *    Dunlendings faction specifically
 * 3. Neither bonus applies to a non-Man faction
 * 4. Neither bonus applies to a different character influencing the same
 *    Man faction
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, RESOURCE_PLAYER,
  buildMinionSitePhaseState, resetMint, findCharInstanceId,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { CardDefinitionId, InfluenceAttemptAction } from '../../index.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const SHAMAS = 'le-40' as CardDefinitionId;
const GORBAG = 'le-11' as CardDefinitionId; // orc — no Man-faction bonus
const DUNNISH_CLAN_HOLD_MINION = 'le-370' as CardDefinitionId;
const DUNLENDINGS_MINION = 'le-263' as CardDefinitionId; // race: man, influenceNumber 10
const GOBLIN_GATE_MINION = 'le-378' as CardDefinitionId;
const GOBLINS_OF_GOBLIN_GATE = 'le-265' as CardDefinitionId; // race: orc, influenceNumber 9

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Shámas (le-40)', () => {
  beforeEach(() => resetMint());

  test('+1 DI (Man) and +2 DI (Dunlendings) stack for a total of +3 vs Dunlendings', () => {
    // Shámas (man, base DI 1) attempts to influence Dunlendings (man faction,
    // influenceNumber 10) at Dunnish Clan-hold.
    // DI = base 1 + Man bonus 1 + Dunlendings bonus 2 = 4.
    // need = influenceNumber(10) - DI(4) = 6.
    const state = buildMinionSitePhaseState({
      characters: [SHAMAS],
      site: DUNNISH_CLAN_HOLD_MINION,
      hand: [DUNLENDINGS_MINION],
    });

    const shamasId = findCharInstanceId(state, RESOURCE_PLAYER, SHAMAS);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const shamasAttempt = influenceActions.find(a => a.influencingCharacterId === shamasId);
    expect(shamasAttempt).toBeDefined();
    expect(shamasAttempt!.need).toBe(6);
  });

  test('bonuses do not apply against a non-Man faction', () => {
    // Goblins of Goblin-gate (orc faction, influenceNumber 9) — neither the
    // Man nor the Dunlendings bonus applies. need = influenceNumber - baseDI(1).
    const state = buildMinionSitePhaseState({
      characters: [SHAMAS],
      site: GOBLIN_GATE_MINION,
      hand: [GOBLINS_OF_GOBLIN_GATE],
    });

    const shamasId = findCharInstanceId(state, RESOURCE_PLAYER, SHAMAS);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const shamasAttempt = influenceActions.find(a => a.influencingCharacterId === shamasId);
    expect(shamasAttempt).toBeDefined();
    // influenceNumber(9) - baseDI(1) = 8, no faction bonus applies.
    expect(shamasAttempt!.need).toBe(8);
  });

  test('bonuses do not apply to a different character influencing Dunlendings', () => {
    // Gorbag (orc, base DI 0) has his own +3 DI vs Orc factions, which does
    // not apply here since Dunlendings is a Man faction.
    const state = buildMinionSitePhaseState({
      characters: [GORBAG],
      site: DUNNISH_CLAN_HOLD_MINION,
      hand: [DUNLENDINGS_MINION],
    });

    const gorbagId = findCharInstanceId(state, RESOURCE_PLAYER, GORBAG);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const gorbagAttempt = influenceActions.find(a => a.influencingCharacterId === gorbagId);
    expect(gorbagAttempt).toBeDefined();
    // influenceNumber(10) - baseDI(0) = 10, no bonus applies.
    expect(gorbagAttempt!.need).toBe(10);
  });
});
