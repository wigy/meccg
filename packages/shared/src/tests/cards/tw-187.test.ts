/**
 * @module tw-187.test
 *
 * Card test: Wacho (tw-187)
 * Type: hero-character
 * Prowess 1 / Body 8 / Mind 2 / DI 0 / MP 0
 * Race: man / Skills: scout, sage
 * Homesite: Woodmen-town
 * Effects: 1
 *
 * "Unique. +2 direct influence against the Woodmen faction."
 *
 * 1. stat-modifier: +2 DI during faction-influence-check when faction.name is "Woodmen"
 *
 * Woodmen (tw-368): influenceNumber 8, playableAt Woodmen-town (a border-hold),
 * Standard Modifications: Men (+1). The Men (+1) standard modifier belongs to the
 * Woodmen faction card, which has no effects modelled yet, so it does not affect
 * Wacho's influence need here — only Wacho's own +2 DI bonus does.
 *
 * Without Wacho's bonus: need = 8 - DI(0) = 8
 * With Wacho's +2 DI bonus: need = 8 - DI(0) - DI_bonus(2) = 6
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  MEN_OF_ANORIEN,
  Phase,
  buildTestState, resetMint,
  findCharInstanceId, buildSitePhaseState,
  getCharacter, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { CardDefinitionId, InfluenceAttemptAction } from '../../index.js';

const WACHO = 'tw-187' as CardDefinitionId;
const WOODMEN = 'tw-368' as CardDefinitionId;
const WOODMEN_TOWN = 'tw-438' as CardDefinitionId;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Wacho (tw-187)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: +2 DI against the Woodmen faction ─────────────────────────────

  test('base effective DI is 0 (conditional bonus does not inflate base stats)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: WOODMEN_TOWN, characters: [WACHO] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    expect(getCharacter(state, RESOURCE_PLAYER, WACHO).effectiveStats.directInfluence).toBe(0);
  });

  test('+2 DI bonus applies when influencing the Woodmen faction', () => {
    // Wacho (man, base DI 0) vs Woodmen (influenceNumber 8) at Woodmen-town.
    // Wacho's +2, plus the Woodmen card's own "Men (+1)" standard
    // modification, which Wacho qualifies for: need = 8 - 0 - 2 - 1 = 5
    const state = buildSitePhaseState({
      characters: [WACHO],
      site: WOODMEN_TOWN,
      hand: [WOODMEN],
    });

    const wachoId = findCharInstanceId(state, RESOURCE_PLAYER, WACHO);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const wachoAttempt = influenceActions.find(
      a => a.influencingCharacterId === wachoId,
    );
    expect(wachoAttempt).toBeDefined();
    // need = 8 - DI(0) - DI_bonus(2) - Men(1) = 5
    expect(wachoAttempt!.need).toBe(5);
  });

  test('+2 DI bonus does NOT apply to other factions', () => {
    // Men of Anórien (influenceNumber 8) at Minas Tirith. Wacho is a "man"
    // (not "dunadan"), so neither the faction's dunadan +1 standard modifier
    // nor Wacho's Woodmen-only +2 bonus applies.
    // need = 8 - DI(0) = 8
    const state = buildSitePhaseState({
      characters: [WACHO],
      site: MINAS_TIRITH,
      hand: [MEN_OF_ANORIEN],
    });

    const wachoId = findCharInstanceId(state, RESOURCE_PLAYER, WACHO);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const wachoAttempt = influenceActions.find(
      a => a.influencingCharacterId === wachoId,
    );
    expect(wachoAttempt).toBeDefined();
    // need = 8 - DI(0) = 8 (no +2 DI bonus here)
    expect(wachoAttempt!.need).toBe(8);
  });

  test('Woodmen +2 bonus is specific to Wacho, not other characters in the company', () => {
    // Aragorn II (dunadan, DI 3, no Woodmen bonus) shares the company at
    // Woodmen-town. His need reflects only his own DI: 8 - 3 = 5 — he is not
    // a "man", so the Woodmen card's Men (+1) does not reach him either. If
    // Wacho's +2 leaked to him it would drop to 3. Wacho himself still gets
    // both his own +2 and the Men (+1) (need 5).
    const state = buildSitePhaseState({
      characters: [WACHO, ARAGORN],
      site: WOODMEN_TOWN,
      hand: [WOODMEN],
    });

    const wachoId = findCharInstanceId(state, RESOURCE_PLAYER, WACHO);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const wachoAttempt = influenceActions.find(a => a.influencingCharacterId === wachoId);
    const aragornAttempt = influenceActions.find(a => a.influencingCharacterId === aragornId);

    expect(wachoAttempt).toBeDefined();
    expect(aragornAttempt).toBeDefined();
    // Wacho gets +2 and Men(+1) (need 5); Aragorn gets neither (need 8 - DI(3) = 5).
    expect(wachoAttempt!.need).toBe(5);
    expect(aragornAttempt!.need).toBe(5);
  });
});
