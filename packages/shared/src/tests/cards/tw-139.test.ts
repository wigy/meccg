/**
 * @module tw-139.test
 *
 * Card test: Damrod (tw-139)
 * Type: hero-character (wizard alignment), race dúnadan, homesite Vale of Erech
 * Stats: prowess 2, body 7, mind 2, direct influence 0, MP 0 (character)
 * Skills: scout, ranger
 *
 * Card text:
 *   "Unique. +2 direct influence against the Men of Lamedon faction."
 *
 * Effect tested:
 * 1. stat-modifier direct-influence: +2 during a faction-influence-check when
 *    faction.name is "Men of Lamedon". The bonus reduces the influence `need`
 *    computed for the faction-influence attempt.
 *
 * This is a well-established engine pattern (cf. Círdan tw-137, Faramir tw-149,
 * Anborn tw-118). The tests drive computeLegalActions and assert on the
 * resulting influence-attempt `need` — no assertions on card JSON itself.
 *
 * Data note: this certification also corrected the truncated `playableAt`
 * site name ("Vale" → "Vale of Erech") on Men of Lamedon (tw-279) and Army of
 * the Dead (tw-193); the truncated name matched no site, so both factions were
 * silently unplayable. The correction is what makes the Men-of-Lamedon
 * influence attempt reachable in the positive test below.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, RESOURCE_PLAYER,
  buildSitePhaseState, resetMint,
  findCharInstanceId,
} from '../test-helpers.js';
import type {
  CardDefinitionId, InfluenceAttemptAction,
} from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';

const DAMROD = 'tw-139' as CardDefinitionId;
const MEN_OF_LAMEDON = 'tw-279' as CardDefinitionId;        // man faction, inf# 8, playable at Vale of Erech
const RANGERS_OF_THE_NORTH = 'tw-311' as CardDefinitionId;  // dúnadan faction, inf# 10, playable at Bree
const VALE_OF_ERECH = 'tw-434' as CardDefinitionId;         // border-hold, Damrod's homesite, where Men of Lamedon plays
const BREE = 'tw-378' as CardDefinitionId;                  // border-hold, where Rangers of the North plays

describe('Damrod (tw-139)', () => {
  beforeEach(() => resetMint());

  test('+2 DI bonus applies when Damrod influences the Men of Lamedon faction', () => {
    // Damrod (dúnadan, base DI 0) influences Men of Lamedon (inf# 8, no standard
    // modification implemented) at Vale of Erech.
    // need = influenceNumber(8) - DI(0) - damrodBonus(2) = 6.
    const state = buildSitePhaseState({
      characters: [DAMROD],
      site: VALE_OF_ERECH,
      hand: [MEN_OF_LAMEDON],
    });

    const damrodId = findCharInstanceId(state, RESOURCE_PLAYER, DAMROD);
    const influenceActions = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const damrodAttempt = influenceActions.find(a => a.influencingCharacterId === damrodId);
    expect(damrodAttempt).toBeDefined();
    expect(damrodAttempt!.need).toBe(6);
  });

  test('+2 DI bonus does NOT apply to a different faction (Rangers of the North)', () => {
    // Damrod (dúnadan, base DI 0) influences Rangers of the North (inf# 10) at
    // Bree. The +2 is gated on faction.name === "Men of Lamedon", so it does not
    // apply here. Rangers' own Dúnedain (+1) standard modification DOES apply to
    // dúnadan Damrod, so need = influenceNumber(10) - DI(0) - dunedainMod(1) = 9.
    // (If Damrod's +2 had wrongly applied, need would be 7.)
    const state = buildSitePhaseState({
      characters: [DAMROD],
      site: BREE,
      hand: [RANGERS_OF_THE_NORTH],
    });

    const damrodId = findCharInstanceId(state, RESOURCE_PLAYER, DAMROD);
    const influenceActions = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const damrodAttempt = influenceActions.find(a => a.influencingCharacterId === damrodId);
    expect(damrodAttempt).toBeDefined();
    expect(damrodAttempt!.need).toBe(9);
  });
});
