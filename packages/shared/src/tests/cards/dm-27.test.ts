/**
 * @module dm-27.test
 *
 * Card test: Wormtongue (dm-27)
 * Type: minion-character (ringwraith)
 * Effects: 2
 *
 * "Unique. Agent. +4 direct influence against Riders of Rohan and any
 *  character or minion that has Edoras as a home site."
 *
 * Wormtongue has base DI 2 (prowess 1, body 8, mind 5, DI 2). The +4 bonus
 * fires separately for:
 *   1. faction-influence-check when faction.name is "Riders of Rohan"
 *   2. influence-check when target.homesite includes "Edoras"
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  pool, PLAYER_1, PLAYER_2,
  THEODEN, ARAGORN, LEGOLAS,
  EDORAS, LORIEN, MORIA, MINAS_TIRITH, DUNNISH_CLAN_HOLD,
  RIDERS_OF_ROHAN, DUNLENDINGS,
  buildSitePhaseState, buildTestState, resetMint,
  findCharInstanceId, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, InfluenceAttemptAction, CharacterCard } from '../../index.js';
import { computeLegalActions, Phase } from '../../index.js';
import { availableDI } from '../../engine/legal-actions/organization.js';

const WORMTONGUE = 'dm-27' as CardDefinitionId;

describe('Wormtongue (dm-27)', () => {
  beforeEach(() => resetMint());

  test('+4 DI applies when influencing Riders of Rohan faction at Edoras', () => {
    // Wormtongue base DI 2 + 4 bonus = 6 against Riders of Rohan (influenceNumber 10).
    // No check-modifier from the faction card for Wormtongue (he is a man, not dunadan/hobbit).
    // need = influenceNumber(10) - totalDI(6) = 4
    const state = buildSitePhaseState({
      characters: [WORMTONGUE],
      site: EDORAS,
      hand: [RIDERS_OF_ROHAN],
    });

    const wormtongueId = findCharInstanceId(state, RESOURCE_PLAYER, WORMTONGUE);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const wormtongueAttempt = influenceActions.find(
      a => a.influencingCharacterId === wormtongueId,
    );
    expect(wormtongueAttempt).toBeDefined();
    // need = influenceNumber(10) - baseDI(2) - riderBonus(4) = 4
    expect(wormtongueAttempt!.need).toBe(4);
  });

  test('+4 DI does NOT apply when influencing a faction other than Riders of Rohan', () => {
    // Wormtongue at Dunnish Clan-hold influencing Dunlendings (influenceNumber 9).
    // No DI bonus for non-Riders of Rohan factions.
    // Dunlendings applies -1 check modifier for men (Wormtongue is a man), so:
    // need = influenceNumber(9) - baseDI(2) - checkBonus(-1) = 9 - 2 + 1 = 8
    const state = buildSitePhaseState({
      characters: [WORMTONGUE],
      site: DUNNISH_CLAN_HOLD,
      hand: [DUNLENDINGS],
    });

    const wormtongueId = findCharInstanceId(state, RESOURCE_PLAYER, WORMTONGUE);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const wormtongueAttempt = influenceActions.find(
      a => a.influencingCharacterId === wormtongueId,
    );
    expect(wormtongueAttempt).toBeDefined();
    // need = influenceNumber(9) - baseDI(2) - checkBonus(-1) = 8; no Riders of Rohan bonus
    expect(wormtongueAttempt!.need).toBe(8);
  });

  test('+4 DI applies when influencing a character with Edoras as home site', () => {
    // Théoden has homesite "Edoras" and mind 6. Wormtongue's DI 2 + 4 bonus = 6.
    // availableDI should return 6 against Théoden.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: EDORAS, characters: [WORMTONGUE] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const wormtongueId = findCharInstanceId(state, RESOURCE_PLAYER, WORMTONGUE);
    const theodenDef = pool[THEODEN as string] as CharacterCard;

    const diAgainstTheoden = availableDI(state, wormtongueId, state.players[0], theodenDef);
    // baseDI(2) + Edoras-homesite bonus(4) = 6
    expect(diAgainstTheoden).toBe(6);
  });

  test('+4 DI does NOT apply when influencing a character without Edoras home site', () => {
    // Aragorn has homesite "Bree", not Edoras. No bonus applies: DI stays at 2.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: EDORAS, characters: [WORMTONGUE] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const wormtongueId = findCharInstanceId(state, RESOURCE_PLAYER, WORMTONGUE);
    const aragornDef = pool[ARAGORN as string] as CharacterCard;

    const diAgainstAragorn = availableDI(state, wormtongueId, state.players[0], aragornDef);
    // baseDI(2); Aragorn's homesite is Bree, not Edoras, so no bonus
    expect(diAgainstAragorn).toBe(2);
  });
});
