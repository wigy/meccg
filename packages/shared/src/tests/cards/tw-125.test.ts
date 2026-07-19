/**
 * @module tw-125.test
 *
 * Card test: Barliman Butterbur (tw-125)
 * Type: hero-character (wizard alignment), unique
 * Race: Man | Skills: warrior
 * Stats: prowess 2, body 6, mind 1, direct influence 0, MP 0
 * Homesite: Bree
 *
 * Card text:
 *   "Unique. -1 to all of his corruption checks. -1 to influence checks against factions."
 *
 * Engine Support (all mechanics pre-existing — no engine change for this card):
 * | # | Feature                                   | Status      | Notes                                                  |
 * |---|-------------------------------------------|-------------|--------------------------------------------------------|
 * | 1 | -1 to all of his corruption checks        | IMPLEMENTED | check-modifier corruption, value -1 (bearer scope)     |
 * | 2 | -1 to influence checks against factions   | IMPLEMENTED | check-modifier influence, value -1, reason faction-... |
 *
 * Playable: YES
 *
 * Rules exercised:
 *   1. -1 to all of his corruption checks: a pending corruption check reports
 *      modifier -1 and need = CP + 1 - (-1) = CP + 2 (harder). The influence
 *      modifier does NOT leak in — the reported corruption modifier is exactly -1.
 *   2. -1 to influence checks against factions: influencing a faction (Rangers
 *      of the North, influence# 10, at Bree) with base-DI-0 Barliman yields
 *      need = influence#(10) - (-1) = 11 (raised by the penalty), and the
 *      attempt's explanation records the "-1" check bonus.
 *
 * Fixtures: hero-character (wizard), hero sites (TW), hero item / hero faction.
 *   BARLIMAN (tw-125)             - hero Man warrior, DI 0, corruptionModifier 0
 *   MITHRIL_COAT (tw-345)         - hero item, 2 corruption points (triggers check)
 *   RANGERS_OF_THE_NORTH (tw-311) - hero faction, influence# 10, playable at Bree
 *   BREE (tw-378)                 - hero border-hold (Rangers' site; Barliman's homesite)
 *   RIVENDELL (tw-421)            - hero haven (company site for the corruption check)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, Alignment,
  buildTestState, buildSitePhaseState, resetMint,
  findCharInstanceId, firstFactionInfluenceAttempt,
  getCharacter, RESOURCE_PLAYER, ARAGORN, RIVENDELL, MORIA, LORIEN,
  enqueueTransferCorruptionCheck,
} from '../test-helpers.js';
import { computeLegalActions, Phase } from '../../index.js';
import type { CardDefinitionId, CorruptionCheckAction } from '../../index.js';

const BARLIMAN = 'tw-125' as CardDefinitionId;             // hero Man warrior, DI 0
const MITHRIL_COAT = 'tw-345' as CardDefinitionId;         // hero item, 2 corruption points
const RANGERS_OF_THE_NORTH = 'tw-311' as CardDefinitionId; // hero faction, influence# 10, at Bree
const BREE = 'tw-378' as CardDefinitionId;                 // hero border-hold, Rangers' site

describe('Barliman Butterbur (tw-125)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: -1 to all of his corruption checks ──────────────────────────────

  test('-1 corruption modifier increases the need on a pending corruption check', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [{ defId: BARLIMAN, items: [MITHRIL_COAT] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const barlimanId = findCharInstanceId(state, RESOURCE_PLAYER, BARLIMAN);
    const itemInstId = getCharacter(state, RESOURCE_PLAYER, BARLIMAN).items[0].instanceId;

    const stateWithCheck = enqueueTransferCorruptionCheck(state, PLAYER_1, barlimanId, itemInstId);

    const ccActions = computeLegalActions(stateWithCheck, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'corruption-check')
      .map(a => a.action as CorruptionCheckAction);

    expect(ccActions).toHaveLength(1);
    expect(ccActions[0].characterId).toBe(barlimanId);
    // Exactly -1 — the influence penalty (gated on faction-influence-check) does
    // NOT bleed into a corruption context.
    expect(ccActions[0].corruptionModifier).toBe(-1);
    // need = CP + 1 - modifier. With modifier -1, need = CP + 2 (harder).
    expect(ccActions[0].need).toBe(ccActions[0].corruptionPoints + 1 - (-1));
  });

  // ─── Rule 2: -1 to influence checks against factions ─────────────────────────

  test('-1 influence penalty raises the need to influence a faction', () => {
    // Rangers of the North (influence# 10) at Bree, influenced by base-DI-0
    // Barliman. Without the penalty the need would be 10; the -1 check modifier
    // raises it to 11.
    const state = buildSitePhaseState({
      characters: [BARLIMAN],
      site: BREE,
      hand: [RANGERS_OF_THE_NORTH],
    });

    const barlimanId = findCharInstanceId(state, RESOURCE_PLAYER, BARLIMAN);
    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);

    expect(attempt).toBeDefined();
    expect(attempt!.influencingCharacterId).toBe(barlimanId);
    expect(attempt!.need).toBe(11);
    // The penalty is recorded in the attempt's explanation as a -1 check bonus.
    expect(attempt!.explanation).toContain('-1');
  });
});
