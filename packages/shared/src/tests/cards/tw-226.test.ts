/**
 * @module tw-226.test
 *
 * Card test: Elves of Lindon (tw-226)
 * Type: hero-resource-faction
 * Effects: 2
 *
 * "Unique. Playable at Grey Havens if the influence check is greater than 9.
 *  Standard Modifications: Dúnedain (+1), Elves (+2)."
 *
 * The "greater than 9" threshold is encoded as influenceNumber 10 (a 2d6 +
 * modifiers roll must reach 10 to succeed). The two Standard Modifications are
 * check-modifier effects applied to the influencing character's roll:
 *   1. check-modifier: +1 when the influencing character is Dúnadan
 *   2. check-modifier: +2 when the influencing character is an Elf
 * Any other race gets no bonus.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  ARAGORN, LEGOLAS, FRODO,
  buildSitePhaseState, resetMint,
  findCharInstanceId, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, GREY_HAVENS } from '../../index.js';
import type { CardDefinitionId, InfluenceAttemptAction } from '../../index.js';

const ELVES_OF_LINDON = 'tw-226' as CardDefinitionId;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Elves of Lindon (tw-226)', () => {
  beforeEach(() => resetMint());

  test('Elf character gets +2 check modifier when influencing', () => {
    // Legolas (elf, base DI 2) attempts to influence Elves of Lindon at Grey
    // Havens. Elves of Lindon influence number = 10 ("greater than 9").
    // The faction gives Elves +2 to the influence check.
    //   modifier = DI 2 + check bonus 2 (Elf) = 4
    //   need = 10 - 4 = 6
    const state = buildSitePhaseState({
      characters: [LEGOLAS],
      site: GREY_HAVENS,
      hand: [ELVES_OF_LINDON],
    });

    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const legolasAttempt = influenceActions.find(
      a => a.influencingCharacterId === legolasId,
    );
    expect(legolasAttempt).toBeDefined();

    // influenceNumber(10) - baseDI(2) - elfCheckMod(2) = 6
    expect(legolasAttempt!.need).toBe(6);
  });

  test('Dúnadan character gets +1 check modifier when influencing', () => {
    // Aragorn (dunadan, base DI 3) attempts to influence Elves of Lindon at
    // Grey Havens. The faction gives Dúnedain +1 to the influence check.
    //   modifier = DI 3 + check bonus 1 (Dúnadan) = 4
    //   need = 10 - 4 = 6
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: GREY_HAVENS,
      hand: [ELVES_OF_LINDON],
    });

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const aragornAttempt = influenceActions.find(
      a => a.influencingCharacterId === aragornId,
    );
    expect(aragornAttempt).toBeDefined();

    // influenceNumber(10) - baseDI(3) - dúnadanCheckMod(1) = 6
    expect(aragornAttempt!.need).toBe(6);
  });

  test('a character of another race gets no Standard Modification bonus', () => {
    // Frodo (hobbit, base DI 1) attempts to influence Elves of Lindon at Grey
    // Havens. Neither the Dúnedain nor the Elves modification applies to a
    // hobbit, so no check bonus is granted.
    //   modifier = DI 1
    //   need = 10 - 1 = 9
    const state = buildSitePhaseState({
      characters: [FRODO],
      site: GREY_HAVENS,
      hand: [ELVES_OF_LINDON],
    });

    const frodoId = findCharInstanceId(state, RESOURCE_PLAYER, FRODO);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const frodoAttempt = influenceActions.find(
      a => a.influencingCharacterId === frodoId,
    );
    expect(frodoAttempt).toBeDefined();

    // influenceNumber(10) - baseDI(1) = 9 (no Standard Modification bonus)
    expect(frodoAttempt!.need).toBe(9);
  });
});
