/**
 * @module tw-126.test
 *
 * Card test: Beorn (tw-126)
 * Type: hero-character
 * Prowess 7 / Body 9 / Mind 7 / DI 2 / MP 2
 * Race: man
 * Skills: warrior, ranger
 * Homesite: Beorn's House
 * Effects: 1 — stat-modifier direct-influence +2 vs Beornings faction
 *
 * "Unique. +2 direct influence against the Beornings faction."
 *
 * Engine Support:
 * | # | Feature                          | Status      | Notes                                         |
 * |---|----------------------------------|-------------|-----------------------------------------------|
 * | 1 | +2 DI vs Beornings (faction)     | IMPLEMENTED | stat-modifier, reason=faction-influence-check |
 *
 * Playable: YES
 * Certified: 2026-05-18
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  pool, PLAYER_1, PLAYER_2,
  LEGOLAS,
  LORIEN, MORIA, MINAS_TIRITH, EDORAS, RIDERS_OF_ROHAN,
  buildTestState, resetMint,
  findCharInstanceId, buildSitePhaseState,
  getCharacter, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, Phase } from '../../index.js';
import type { CardDefinitionId, CharacterCard, InfluenceAttemptAction } from '../../index.js';

const BEORN = 'tw-126' as CardDefinitionId;
const BEORNINGS = 'tw-197' as CardDefinitionId;
const BEORNS_HOUSE = 'tw-376' as CardDefinitionId;

describe('Beorn (tw-126)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: +2 DI against Beornings faction ──

  test('base effective DI is 2 (conditional bonus does not inflate base stats)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: BEORNS_HOUSE, characters: [BEORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const baseDef = pool[BEORN] as CharacterCard;
    expect(baseDef.directInfluence).toBe(2);
    expect(getCharacter(state, RESOURCE_PLAYER, BEORN).effectiveStats.directInfluence).toBe(baseDef.directInfluence);
  });

  test('+2 DI bonus applies when influencing Beornings', () => {
    // Beorn (man, base DI 2) at Beorn's House with Beornings (influenceNumber 8) in hand.
    // Beornings Men +1 check modifier applies since Beorn is race "man".
    // With Beorn's +2 DI bonus: modifier = DI(2) + DIbonus(2) + MenCheckMod(1) = 5
    // need = 8 - 5 = 3
    const state = buildSitePhaseState({
      characters: [BEORN],
      site: BEORNS_HOUSE,
      hand: [BEORNINGS],
    });

    const beornId = findCharInstanceId(state, RESOURCE_PLAYER, BEORN);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const beornAttempt = influenceActions.find(
      a => a.influencingCharacterId === beornId,
    );
    expect(beornAttempt).toBeDefined();

    // influenceNumber(8) - baseDI(2) - DIbonus(2) - MenCheckMod(1) = 3
    expect(beornAttempt!.need).toBe(3);
  });

  test('+2 DI bonus does NOT apply when influencing a different faction', () => {
    // Beorn (man, base DI 2) at Edoras with Riders of Rohan (influenceNumber 10) in hand.
    // Riders of Rohan check modifier is +1 for hobbits only; Beorn (man) gets none.
    // No Beorn DI bonus vs Riders of Rohan: need = 10 - 2 = 8
    const state = buildSitePhaseState({
      characters: [BEORN],
      site: EDORAS,
      hand: [RIDERS_OF_ROHAN],
    });

    const beornId = findCharInstanceId(state, RESOURCE_PLAYER, BEORN);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const beornAttempt = influenceActions.find(
      a => a.influencingCharacterId === beornId,
    );
    expect(beornAttempt).toBeDefined();

    // No DI bonus: influenceNumber(10) - baseDI(2) = 8
    expect(beornAttempt!.need).toBe(8);
  });

  test('non-Beorn character does not benefit from the DI bonus vs Beornings', () => {
    // Legolas (elf, base DI 2) at Beorn's House with Beornings (influenceNumber 8) in hand.
    // Beornings Men +1 check modifier does NOT apply (Legolas is elf, not man).
    // No Beorn DI bonus: need = 8 - 2 = 6
    const state = buildSitePhaseState({
      characters: [LEGOLAS],
      site: BEORNS_HOUSE,
      hand: [BEORNINGS],
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

    // influenceNumber(8) - baseDI(2) = 6
    expect(legolasAttempt!.need).toBe(6);
  });
});
