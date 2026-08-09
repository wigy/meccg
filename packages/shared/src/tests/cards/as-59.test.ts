/**
 * @module as-59.test
 *
 * Card test: Haradrim (as-59)
 * Type: hero-resource-faction
 * Effects: 4
 *
 * "Unique. Manifestation of minion Haradrim. Playable at Southron Oasis if the
 *  influence check is greater than 9. Standard Modifications: Wizards (-5),
 *  Dúnedain (-2), Elves (-2), Dwarves (-2)."
 *
 * Rules tested:
 * 1. influenceNumber = 10 (check > 9 means minimum roll of 10)
 * 2. Wizards receive a -5 check modifier when influencing this faction
 * 3. Dúnedain receive a -2 check modifier when influencing this faction
 * 4. Elves receive a -2 check modifier when influencing this faction
 * 5. Dwarves receive a -2 check modifier when influencing this faction
 * 6. Other races receive no check modifier
 * 7. Manifestation uniqueness: cannot play if the minion version is already in play
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  ARAGORN, LEGOLAS, GANDALF, GIMLI, BILBO,
  buildSitePhaseState, resetMint,
  findCharInstanceId, RESOURCE_PLAYER,
  addCardInPlay,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { CardDefinitionId, InfluenceAttemptAction } from '../../index.js';

const SOUTHRON_OASIS = 'tw-426' as CardDefinitionId;
const HARADRIM_HERO = 'as-59' as CardDefinitionId;
const HARADRIM_MINION = 'as-63' as CardDefinitionId;

describe('Haradrim (as-59)', () => {
  beforeEach(() => resetMint());

  test('Wizard character gets -5 check modifier when influencing', () => {
    // Gandalf (wizard, base DI 10) attempts to influence Haradrim at Southron Oasis.
    // Influence number = 10.
    //   modifier = DI 10 + checkMod(-5) = 5
    //   need = 10 - 5 = 5
    const state = buildSitePhaseState({
      characters: [GANDALF],
      site: SOUTHRON_OASIS,
      hand: [HARADRIM_HERO],
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
    expect(gandalfAttempt!.need).toBe(5);
  });

  test('Dúnadan character gets -2 check modifier when influencing', () => {
    // Aragorn (dunadan, base DI 3) attempts to influence Haradrim at Southron Oasis.
    // Influence number = 10.
    //   modifier = DI 3 + checkMod(-2) = 1
    //   need = 10 - 1 = 9
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: SOUTHRON_OASIS,
      hand: [HARADRIM_HERO],
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
    expect(aragornAttempt!.need).toBe(9);
  });

  test('Elf character gets -2 check modifier when influencing', () => {
    // Legolas (elf, base DI 2) attempts to influence Haradrim at Southron Oasis.
    // Influence number = 10.
    //   modifier = DI 2 + checkMod(-2) = 0
    //   need = 10 - 0 = 10
    const state = buildSitePhaseState({
      characters: [LEGOLAS],
      site: SOUTHRON_OASIS,
      hand: [HARADRIM_HERO],
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
    expect(legolasAttempt!.need).toBe(10);
  });

  test('Dwarf character gets -2 check modifier when influencing', () => {
    // Gimli (dwarf, base DI 2) attempts to influence Haradrim at Southron Oasis.
    // Influence number = 10.
    //   modifier = DI 2 + checkMod(-2) = 0
    //   need = 10 - 0 = 10
    const state = buildSitePhaseState({
      characters: [GIMLI],
      site: SOUTHRON_OASIS,
      hand: [HARADRIM_HERO],
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
    expect(gimliAttempt!.need).toBe(10);
  });

  test('non-Wizard/Dúnadan/Elf/Dwarf character gets no check modifier', () => {
    // Bilbo (hobbit, base DI 1) attempts to influence Haradrim at Southron Oasis.
    // Influence number = 10.
    //   modifier = DI 1 (no bonus)
    //   need = 10 - 1 = 9
    const state = buildSitePhaseState({
      characters: [BILBO],
      site: SOUTHRON_OASIS,
      hand: [HARADRIM_HERO],
    });

    const bilboId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const bilboAttempt = influenceActions.find(
      a => a.influencingCharacterId === bilboId,
    );
    expect(bilboAttempt).toBeDefined();
    expect(bilboAttempt!.need).toBe(9);
  });

  test('manifestation uniqueness: hero version cannot be played if minion version is in play', () => {
    // The engine's name-based faction uniqueness check prevents playing as-59 when
    // as-63 (same name "Haradrim") is already in any player's cardsInPlay.
    const base = buildSitePhaseState({
      characters: [GANDALF],
      site: SOUTHRON_OASIS,
      hand: [HARADRIM_HERO],
    });
    // Minion version already in play (opponent side)
    const state = addCardInPlay(base, 1, HARADRIM_MINION);

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
