/**
 * @module le-104.test
 *
 * Card test: Awaken Denizens (le-104)
 * Type: hazard-event (long, permanent)
 * Effects: 2
 *   1. duplication-limit scope: game max: 1 — cannot be duplicated
 *   2. stat-modifier strikes ×2 (op: multiply) to all automatic-attacks
 *      (target: all-automatic-attacks), gated on the defending company's
 *      current site being a Ruins & Lairs (`when site.siteType $in`)
 *
 * Card text:
 *   "The number of strikes for each automatic-attack at a Ruins & Lairs [{R}]
 *    site is doubled. Cannot be duplicated."
 *
 * Test sites:
 *   - Ettenmoors (tw-395): Ruins & Lairs, Trolls 1 strikes / 9 prowess — clean
 *     doubling probe (1 → 2, distinct from a +1 = 2 collision is avoided by
 *     also checking prowess stays untouched).
 *   - Barrow-downs (tw-375): Ruins & Lairs, Undead 1 strikes / 8 prowess —
 *     second doubling probe (1 → 2).
 *   - Dead Marshes (tw-384): Shadow-hold, Undead 2 strikes / 8 prowess —
 *     negative control; a non-Ruins-&-Lairs site is untouched (strikes stay 2).
 */

import { describe, test, expect } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  reduce,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  CardStatus,
  resetMint, buildSitePhaseState, makeMHState,
  addP2CardsInPlay, setupAutoAttackStep,
  buildTestState,
  Phase,
  viableActions,
} from '../test-helpers.js';
import type { CardInPlay, CardInstanceId, MovementHazardPhaseState, CardDefinitionId } from '../../index.js';

const AWAKEN_DENIZENS = 'le-104' as CardDefinitionId;
// Ettenmoors (tw-395): Ruins & Lairs — Trolls, 1 strikes / 9 prowess.
const ETTENMOORS = 'tw-395' as CardDefinitionId;
// Barrow-downs (tw-375): Ruins & Lairs — Undead, 1 strikes / 8 prowess.
const BARROW_DOWNS = 'tw-375' as CardDefinitionId;
// Dead Marshes (tw-384): Shadow-hold — Undead, 2 strikes / 8 prowess.
const DEAD_MARSHES = 'tw-384' as CardDefinitionId;

describe('Awaken Denizens (le-104)', () => {
  const awakenInPlay: CardInPlay = {
    instanceId: 'awaken-denizens-1' as CardInstanceId,
    definitionId: AWAKEN_DENIZENS,
    status: CardStatus.Untapped,
  };

  test('Ruins & Lairs auto-attack strikes doubled (1 → 2), prowess unchanged', () => {
    resetMint();
    const state = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: ETTENMOORS }), [awakenInPlay]),
    );

    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeDefined();
    expect(result.state.combat!.strikesTotal).toBe(2);
    expect(result.state.combat!.strikeProwess).toBe(9);
  });

  test('second Ruins & Lairs auto-attack strikes doubled (1 → 2)', () => {
    resetMint();
    const state = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: BARROW_DOWNS }), [awakenInPlay]),
    );

    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeDefined();
    expect(result.state.combat!.strikesTotal).toBe(2);
    expect(result.state.combat!.strikeProwess).toBe(8);
  });

  test('baseline: without Awaken Denizens, Ruins & Lairs auto-attack unchanged (stays 1)', () => {
    resetMint();
    const state = setupAutoAttackStep(buildSitePhaseState({ site: ETTENMOORS }));

    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeDefined();
    expect(result.state.combat!.strikesTotal).toBe(1);
    expect(result.state.combat!.strikeProwess).toBe(9);
  });

  test('non-Ruins-&-Lairs site (Shadow-hold) is unaffected — strikes not doubled', () => {
    resetMint();
    const state = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: DEAD_MARSHES }), [awakenInPlay]),
    );

    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeDefined();
    expect(result.state.combat!.strikesTotal).toBe(2);
    expect(result.state.combat!.strikeProwess).toBe(8);
  });

  test('cannot be duplicated (duplication-limit scope game max 1)', () => {
    resetMint();
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [AWAKEN_DENIZENS], siteDeck: [MINAS_TIRITH], cardsInPlay: [awakenInPlay] },
      ],
    });
    const mhState: MovementHazardPhaseState = makeMHState({
      hazardsPlayedThisCompany: 0,
      hazardLimitAtReveal: 4,
    });
    const readyState = { ...state, phaseState: mhState };

    const actions = viableActions(readyState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });
});
