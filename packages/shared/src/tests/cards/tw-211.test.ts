/**
 * @module tw-211.test
 *
 * Card test: Dunlendings (tw-211)
 * Type: hero-resource-faction
 * Effects: 3
 *
 * "Unique. Playable at Dunnish Clan-hold if the influence check is greater
 *  than 9. Standard Modifications: Men (-1), Dúnedain (-1), Dwarves (-1)."
 *
 * This tests three effects:
 * 1. check-modifier: -1 to influence check when bearer (influencing character) is Man race
 * 2. check-modifier: -1 to influence check when bearer (influencing character) is Dúnadan race
 * 3. check-modifier: -1 to influence check when bearer (influencing character) is Dwarf race
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  FARAMIR, GIMLI, EOWYN, LEGOLAS,
  DUNNISH_CLAN_HOLD,
  DUNLENDINGS,
  buildSitePhaseState, resetMint,
  findCharInstanceId, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { InfluenceAttemptAction } from '../../index.js';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Dunlendings (tw-211)', () => {
  beforeEach(() => resetMint());

  test('Dúnadan character gets -1 check modifier when influencing', () => {
    // Faramir (dunadan, base DI 1) attempts to influence Dunlendings at
    // Dunnish Clan-hold. Dunlendings influence number = 10.
    // Faction card gives Dúnedain -1 check modifier.
    //   modifier = DI 1 - 1 (Dúnadan penalty) = 0
    //   need = 10 - 0 = 10
    const state = buildSitePhaseState({
      characters: [FARAMIR],
      site: DUNNISH_CLAN_HOLD,
      hand: [DUNLENDINGS],
    });

    const faramirId = findCharInstanceId(state, RESOURCE_PLAYER, FARAMIR);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const faramirAttempt = influenceActions.find(
      a => a.influencingCharacterId === faramirId,
    );
    expect(faramirAttempt).toBeDefined();

    // influenceNumber(10) - baseDI(1) - dúnadanCheckPenalty(-1) = 10
    expect(faramirAttempt!.need).toBe(10);
  });

  test('Dwarf character gets -1 check modifier when influencing', () => {
    // Gimli (dwarf, base DI 2) attempts to influence Dunlendings at Dunnish
    // Clan-hold. His DI bonuses (Iron Hill Dwarves, elf-related) do not
    // apply to Dunlendings (man faction), so only the Dwarf penalty applies.
    //   modifier = DI 2 - 1 (Dwarf penalty) = 1
    //   need = 10 - 1 = 9
    const state = buildSitePhaseState({
      characters: [GIMLI],
      site: DUNNISH_CLAN_HOLD,
      hand: [DUNLENDINGS],
    });

    const gimliId = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const gimliAttempt = influenceActions.find(
      a => a.influencingCharacterId === gimliId,
    );
    expect(gimliAttempt).toBeDefined();

    // influenceNumber(10) - baseDI(2) - dwarfCheckPenalty(-1) = 9
    expect(gimliAttempt!.need).toBe(9);
  });

  test('Man character gets -1 check modifier when influencing', () => {
    // Éowyn (man, base DI 0) attempts to influence Dunlendings at Dunnish
    // Clan-hold.
    //   modifier = DI 0 - 1 (Man penalty) = -1
    //   need = 10 - (-1) = 11
    const state = buildSitePhaseState({
      characters: [EOWYN],
      site: DUNNISH_CLAN_HOLD,
      hand: [DUNLENDINGS],
    });

    const eowynId = findCharInstanceId(state, RESOURCE_PLAYER, EOWYN);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const eowynAttempt = influenceActions.find(
      a => a.influencingCharacterId === eowynId,
    );
    expect(eowynAttempt).toBeDefined();

    // influenceNumber(10) - baseDI(0) - manCheckPenalty(-1) = 11
    expect(eowynAttempt!.need).toBe(11);
  });

  test('Elf character gets no check modifier when influencing', () => {
    // Legolas (elf, base DI 2) attempts to influence Dunlendings at Dunnish
    // Clan-hold. None of the Standard Modifications (Men, Dúnedain, Dwarves)
    // apply to an Elf.
    //   modifier = DI 2
    //   need = 10 - 2 = 8
    const state = buildSitePhaseState({
      characters: [LEGOLAS],
      site: DUNNISH_CLAN_HOLD,
      hand: [DUNLENDINGS],
    });

    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const legolasAttempt = influenceActions.find(
      a => a.influencingCharacterId === legolasId,
    );
    expect(legolasAttempt).toBeDefined();

    // influenceNumber(10) - baseDI(2) = 8 (no penalty)
    expect(legolasAttempt!.need).toBe(8);
  });
});
