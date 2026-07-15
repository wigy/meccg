/**
 * @module le-103.test
 *
 * Card test: Awaken Defenders (le-103)
 * Type: hazard-event (long, permanent)
 * Effects: 3
 *   1. duplication-limit scope: game max: 1 — cannot be duplicated
 *   2. stat-modifier strikes ×2 (op: multiply) to all automatic-attacks
 *      (target: all-automatic-attacks), gated on the defending company's
 *      current site being a Free-hold or Border-hold (`when site.type $in`)
 *   3. auto-attacks-normal siteTypes [free-hold, border-hold] — every detainment
 *      automatic-attack at those site types resolves as a normal attack
 *
 * Card text:
 *   "The number of strikes for each automatic-attack at a Free-hold [{F}] or
 *    Border-hold [{B}] is doubled. Additionally, each detainment
 *    automatic-attack at a Free-hold [{F}] or Border-hold [{B}] becomes a normal
 *    automatic-attack. Cannot be duplicated."
 *
 * Test sites:
 *   - Drúadan Forest (le-368): Border-hold, Men 3 strikes / 6 prowess, no
 *     detainment — clean doubling probe (3 → 6, distinct from a +1 = 4).
 *   - Iron Hill Dwarf-hold (le-383): Free-hold, Dwarves 4 / 10, no detainment —
 *     free-hold doubling probe (4 → 8).
 *   - Gobel Mírlond (as-139): Border-hold, Men 4 / 9, unconditional
 *     combat-detainment — exercises BOTH rules at once (4 → 8 strikes AND
 *     detainment → normal).
 *   - Dead Marshes (tw-384): Shadow-hold, Undead 2 / 8 — negative control; a
 *     non-Free/Border site is untouched (strikes stay 2).
 *
 * | # | Effect                                    | Status      | Notes                                   |
 * |---|-------------------------------------------|-------------|------------------------------------------|
 * | 1 | duplication-limit (game, max 1)           | IMPLEMENTED | reducer.ts duplicate-check               |
 * | 2 | stat-modifier strikes ×2 (F/B auto-atks)  | IMPLEMENTED | site.type gate in resolveAttackStrikes   |
 * | 3 | auto-attacks-normal (F/B)                 | IMPLEMENTED | siteTypeForcesAutoAttacksNormal → detain |
 *
 * Playable: YES
 * Certified: 2026-07-15
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  reduce,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  CardStatus,
  buildTestState, resetMint, buildSitePhaseState, makeMHState,
  addP2CardsInPlay, setupAutoAttackStep,
  Phase,
  viableActions,
} from '../test-helpers.js';
import type { CardInPlay, CardInstanceId, MovementHazardPhaseState, CardDefinitionId } from '../../index.js';

const AWAKEN_DEFENDERS = 'le-103' as CardDefinitionId;
// Drúadan Forest (le-368): Border-hold — Men, 3 strikes / 6 prowess, no detainment.
const DRUADAN_FOREST = 'le-368' as CardDefinitionId;
// Iron Hill Dwarf-hold (le-383): Free-hold — Dwarves, 4 strikes / 10 prowess.
const IRON_HILL_DWARF_HOLD = 'le-383' as CardDefinitionId;
// Gobel Mírlond (as-139): Border-hold — Men, 4 strikes / 9 prowess, unconditional detainment.
const GOBEL_MIRLOND = 'as-139' as CardDefinitionId;
// Dead Marshes (tw-384): Shadow-hold — Undead, 2 strikes / 8 prowess.
const DEAD_MARSHES = 'tw-384' as CardDefinitionId;

describe('Awaken Defenders (le-103)', () => {
  beforeEach(() => resetMint());

  const awakenInPlay: CardInPlay = {
    instanceId: 'awaken-1' as CardInstanceId,
    definitionId: AWAKEN_DEFENDERS,
    status: CardStatus.Untapped,
  };

  test('Border-hold auto-attack strikes doubled (3 → 6), prowess unchanged', () => {
    // Drúadan Forest: Men 3 strikes / 6 prowess. With Awaken Defenders the
    // strikes double to 6 (a +1 would give 4), while prowess stays 6 — the card
    // touches only strikes.
    const state = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: DRUADAN_FOREST }), [awakenInPlay]),
    );

    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeDefined();
    expect(result.state.combat!.strikesTotal).toBe(6);
    expect(result.state.combat!.strikeProwess).toBe(6);
  });

  test('Free-hold auto-attack strikes doubled (4 → 8), prowess unchanged', () => {
    // Iron Hill Dwarf-hold: Dwarves 4 strikes / 10 prowess → 8 strikes.
    const state = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: IRON_HILL_DWARF_HOLD }), [awakenInPlay]),
    );

    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeDefined();
    expect(result.state.combat!.strikesTotal).toBe(8);
    expect(result.state.combat!.strikeProwess).toBe(10);
  });

  test('Border-hold detainment auto-attack: strikes doubled AND becomes normal', () => {
    // Gobel Mírlond: Men 4 strikes / 9 prowess, unconditional combat-detainment.
    // Awaken Defenders both doubles strikes (4 → 8) and converts the detainment
    // attack into a normal attack (detainment false).
    const state = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: GOBEL_MIRLOND }), [awakenInPlay]),
    );

    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeDefined();
    expect(result.state.combat!.strikesTotal).toBe(8);
    expect(result.state.combat!.strikeProwess).toBe(9);
    expect(result.state.combat!.detainment).toBe(false);
  });

  test('baseline: Gobel Mírlond detainment attack unchanged without Awaken Defenders', () => {
    // Without the card in play the attack is 4 strikes and remains detainment —
    // proving both changes above are caused by Awaken Defenders.
    const state = setupAutoAttackStep(buildSitePhaseState({ site: GOBEL_MIRLOND }));

    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeDefined();
    expect(result.state.combat!.strikesTotal).toBe(4);
    expect(result.state.combat!.detainment).toBe(true);
  });

  test('non-Free/Border site (Shadow-hold) is unaffected — strikes not doubled', () => {
    // Dead Marshes: Shadow-hold, Undead 2 strikes. The doubling is gated on
    // Free-hold / Border-hold, so a Shadow-hold auto-attack stays at 2 strikes
    // even with Awaken Defenders in play.
    const state = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: DEAD_MARSHES }), [awakenInPlay]),
    );

    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeDefined();
    expect(result.state.combat!.strikesTotal).toBe(2);
    expect(result.state.combat!.strikeProwess).toBe(8);
  });

  test('baseline: without Awaken Defenders, Border-hold auto-attack unchanged (stays 3)', () => {
    const state = setupAutoAttackStep(buildSitePhaseState({ site: DRUADAN_FOREST }));

    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeDefined();
    expect(result.state.combat!.strikesTotal).toBe(3);
    expect(result.state.combat!.strikeProwess).toBe(6);
  });

  test('cannot be duplicated (duplication-limit scope game max 1)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [AWAKEN_DEFENDERS], siteDeck: [MINAS_TIRITH], cardsInPlay: [awakenInPlay] },
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
