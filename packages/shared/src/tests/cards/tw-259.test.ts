/**
 * @module tw-259.test
 *
 * Card test: Horn of Anor (tw-259)
 * Type: hero-resource-item (minor)
 * Effects: 2
 *
 * "+2 to direct influence against factions. Cannot be duplicated on a given character."
 *
 * This tests:
 * 1. stat-modifier: +2 DI during faction-influence-check
 * 2. duplication-limit: max 1 per character (scope "character")
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  ARAGORN, LEGOLAS,
  HORN_OF_ANOR,
  PELARGIR, MORIA,
  MEN_OF_LEBENNIN,
  buildSitePhaseState, resetMint,
  findCharInstanceId,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { InfluenceAttemptAction } from '../../index.js';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Horn of Anor (tw-259)', () => {
  beforeEach(() => resetMint());

  test('+2 DI bonus applies during faction influence check', () => {
    // Aragorn (dunadan, base DI 3) with Horn of Anor influences Men of Lebennin at Pelargir.
    // Men of Lebennin influence number = 8, Dúnadan get +1 check modifier.
    // With Horn of Anor's +2 DI bonus:
    //   modifier = DI 3 + Horn DI bonus 2 + check bonus 1 = 6
    //   need = 8 - 6 = 2
    const state = buildSitePhaseState({
      characters: [{ defId: ARAGORN, items: [HORN_OF_ANOR] }],
      site: PELARGIR,
      hand: [MEN_OF_LEBENNIN],
    });

    const aragornId = findCharInstanceId(state, 0, ARAGORN);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const aragornAttempt = influenceActions.find(
      a => a.influencingCharacterId === aragornId,
    );
    expect(aragornAttempt).toBeDefined();

    // influenceNumber(8) - baseDI(3) - hornDIBonus(2) - dúnadanCheckMod(1) = 2
    expect(aragornAttempt!.need).toBe(2);
  });

  test('+2 DI bonus compared to same character without Horn', () => {
    // Without Horn of Anor: Aragorn (DI 3) + dunadan check mod (1) = 4
    //   need = 8 - 3 - 1 = 4
    const stateWithout = buildSitePhaseState({
      characters: [ARAGORN],
      site: PELARGIR,
      hand: [MEN_OF_LEBENNIN],
    });

    const aragornIdWithout = findCharInstanceId(stateWithout, 0, ARAGORN);
    const actionsWithout = computeLegalActions(stateWithout, PLAYER_1);

    const withoutHorn = actionsWithout
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction)
      .find(a => a.influencingCharacterId === aragornIdWithout);

    expect(withoutHorn).toBeDefined();
    expect(withoutHorn!.need).toBe(4);
  });

  test('duplication limit: second Horn of Anor cannot be played on same character', () => {
    // Aragorn already carries one Horn of Anor. A second Horn in hand should
    // not be playable on Aragorn (duplication-limit scope:character max:1).
    // But it should be playable on Legolas (different character).
    const state = buildSitePhaseState({
      characters: [
        { defId: ARAGORN, items: [HORN_OF_ANOR] },
        LEGOLAS,
      ],
      site: MORIA,
      hand: [HORN_OF_ANOR],
    });

    const aragornId = findCharInstanceId(state, 0, ARAGORN);
    const legolasId = findCharInstanceId(state, 0, LEGOLAS);
    const actions = computeLegalActions(state, PLAYER_1);

    // Should NOT be playable on Aragorn (already has one)
    const onAragorn = actions.find(
      a => a.viable
        && a.action.type === 'play-hero-resource'
        && a.action.attachToCharacterId === aragornId,
    );
    expect(onAragorn).toBeUndefined();

    // SHOULD be playable on Legolas (no Horn yet)
    const onLegolas = actions.find(
      a => a.viable
        && a.action.type === 'play-hero-resource'
        && a.action.attachToCharacterId === legolasId,
    );
    expect(onLegolas).toBeDefined();
  });

  test('first Horn of Anor can be played on a character with no Horns', () => {
    // Aragorn has no items. Horn of Anor should be playable on him.
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: MORIA,
      hand: [HORN_OF_ANOR],
    });

    const aragornId = findCharInstanceId(state, 0, ARAGORN);
    const actions = computeLegalActions(state, PLAYER_1);

    const onAragorn = actions.find(
      a => a.viable
        && a.action.type === 'play-hero-resource'
        && a.action.attachToCharacterId === aragornId,
    );
    expect(onAragorn).toBeDefined();
  });
});
