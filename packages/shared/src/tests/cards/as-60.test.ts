/**
 * @module as-60.test
 *
 * Card test: Wain-easterlings (as-60)
 * Type: hero-resource-faction
 * Effects: 2
 *
 * "Unique. Manifestation of minion Wain-easterlings. Playable at Easterling Camp
 *  if the influence check is greater than 8. Standard Modifications: Wizards (-5),
 *  Dúnedain (-2)."
 *
 * Rules tested:
 * 1. influenceNumber = 9 (check > 8 means minimum roll of 9)
 * 2. Wizards receive a -5 check modifier when influencing this faction
 * 3. Dúnedain receive a -2 check modifier when influencing this faction
 * 4. Other races receive no check modifier
 * 5. Manifestation uniqueness: cannot play if the minion version is already in play
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  ARAGORN, LEGOLAS, GANDALF,
  buildSitePhaseState, resetMint,
  findCharInstanceId, RESOURCE_PLAYER,
  addCardInPlay,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { CardDefinitionId, InfluenceAttemptAction } from '../../index.js';

const EASTERLING_CAMP = 'tw-392' as CardDefinitionId;
const WAIN_EASTERLINGS_HERO = 'as-60' as CardDefinitionId;
const WAIN_EASTERLINGS_MINION = 'as-66' as CardDefinitionId;

describe('Wain-easterlings (as-60)', () => {
  beforeEach(() => resetMint());

  test('Wizard character gets -5 check modifier when influencing', () => {
    // Gandalf (wizard, base DI 10) attempts to influence Wain-easterlings at Easterling Camp.
    // Influence number = 9.
    // Faction gives Wizards -5 check modifier.
    //   modifier = DI 10 + checkMod(-5) = 5
    //   need = 9 - 5 = 4
    const state = buildSitePhaseState({
      characters: [GANDALF],
      site: EASTERLING_CAMP,
      hand: [WAIN_EASTERLINGS_HERO],
    });

    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const gandalfAttempt = influenceActions.find(
      a => a.influencingCharacterId === gandalfId,
    );
    expect(gandalfAttempt).toBeDefined();

    // influenceNumber(9) - DI(10) - checkMod(-5) = 9 - 5 = 4
    expect(gandalfAttempt!.need).toBe(4);
  });

  test('Dúnadan character gets -2 check modifier when influencing', () => {
    // Aragorn (dunadan, base DI 3) attempts to influence Wain-easterlings at Easterling Camp.
    // Influence number = 9.
    // Faction gives Dúnedain -2 check modifier.
    //   modifier = DI 3 + checkMod(-2) = 1
    //   need = 9 - 1 = 8
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: EASTERLING_CAMP,
      hand: [WAIN_EASTERLINGS_HERO],
    });

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const aragornAttempt = influenceActions.find(
      a => a.influencingCharacterId === aragornId,
    );
    expect(aragornAttempt).toBeDefined();

    // influenceNumber(9) - DI(3) - checkMod(-2) = 9 - 1 = 8
    expect(aragornAttempt!.need).toBe(8);
  });

  test('non-Wizard non-Dúnadan character gets no check modifier', () => {
    // Legolas (elf, base DI 2) attempts to influence Wain-easterlings at Easterling Camp.
    // Influence number = 9.
    // Legolas is neither wizard nor dunadan — no check modifier applies.
    //   modifier = DI 2
    //   need = 9 - 2 = 7
    const state = buildSitePhaseState({
      characters: [LEGOLAS],
      site: EASTERLING_CAMP,
      hand: [WAIN_EASTERLINGS_HERO],
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

    // influenceNumber(9) - DI(2) = 7 (no bonus)
    expect(legolasAttempt!.need).toBe(7);
  });

  test('manifestation uniqueness: hero version cannot be played if minion version is in play', () => {
    // The engine's name-based faction uniqueness check prevents playing as-60 when
    // as-66 (same name "Wain-easterlings") is already in any player's cardsInPlay.
    const base = buildSitePhaseState({
      characters: [GANDALF],
      site: EASTERLING_CAMP,
      hand: [WAIN_EASTERLINGS_HERO],
    });
    // Minion version already in play (opponent side)
    const state = addCardInPlay(base, 1, WAIN_EASTERLINGS_MINION);

    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions.filter(
      a => a.viable && a.action.type === 'influence-attempt',
    );
    expect(influenceActions).toHaveLength(0);

    const notPlayable = actions.find(
      a => !a.viable && a.action.type === 'not-playable',
    );
    expect(notPlayable).toBeDefined();
  });
});
