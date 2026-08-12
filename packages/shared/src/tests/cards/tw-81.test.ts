/**
 * @module tw-81.test
 *
 * Card test: Plague of Wights (tw-81)
 * Type: hazard-event (long, permanent)
 * Effects: 3
 *   1. duplication-limit scope: game max: 1 — cannot be duplicated
 *   2. stat-modifier prowess +1 to all Undead attacks (target: all-attacks)
 *   3. stat-modifier strikes ×2 (op: multiply) to all Undead attacks, gated on
 *      Doors of Night being in play (target: all-attacks)
 *
 * Card text:
 *   "The prowess of all Undead attacks is increased by one. Additionally, if
 *    Doors of Night is in play, the number of strikes for each Undead attack
 *    is doubled. Cannot be duplicated."
 *
 * This is the same card as le-130 (reprinted in the TW set). Duplication is
 * counted by card name (see reducer-utils.ts countCopiesInPlay), so a
 * tw-81/le-130 pair still share the "cannot be duplicated" limit even though
 * they are distinct definition ids — covered here by playing tw-81 while a
 * le-130 copy is already in play.
 *
 * Test site: Dead Marshes (tw-384) — Undead auto-attack: 2 strikes, 8 prowess.
 *   The base of 2 strikes makes the doubling (→4) clearly distinct from a
 *   would-be additive +1 (→3).
 *   - Plague of Wights only:                 2 strikes, 9 prowess.
 *   - Plague of Wights + Doors of Night:      4 strikes, 9 prowess.
 *
 * | # | Effect                                | Status      | Notes                              |
 * |---|---------------------------------------|-------------|-------------------------------------|
 * | 1 | duplication-limit (game, max 1)       | IMPLEMENTED | reducer.ts duplicate-check          |
 * | 2 | stat-modifier prowess +1 (Undead)     | IMPLEMENTED | target: all-attacks, collectGlobal  |
 * | 3 | stat-modifier strikes ×2 (Undead+DoN) | IMPLEMENTED | op: multiply in resolveStatModifiers |
 *
 * Playable: YES
 * Certified: 2026-08-12
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
import { ISENGARD, DOORS_OF_NIGHT } from '../../index.js';

const PLAGUE_OF_WIGHTS_TW = 'tw-81' as CardDefinitionId;
const PLAGUE_OF_WIGHTS_LE = 'le-130' as CardDefinitionId;
// Dead Marshes (tw-384): Undead auto-attack — 2 strikes, 8 prowess.
const DEAD_MARSHES = 'tw-384' as CardDefinitionId;

describe('Plague of Wights (tw-81)', () => {
  beforeEach(() => resetMint());

  const plagueInPlay: CardInPlay = {
    instanceId: 'plague-tw-1' as CardInstanceId,
    definitionId: PLAGUE_OF_WIGHTS_TW,
    status: CardStatus.Untapped,
  };
  const donInPlay: CardInPlay = {
    instanceId: 'don-1' as CardInstanceId,
    definitionId: DOORS_OF_NIGHT,
    status: CardStatus.Untapped,
  };

  test('Undead auto-attack prowess increased by +1 (8 → 9)', () => {
    // Dead Marshes: Undead — 2 strikes, 8 prowess. With Plague: 9 prowess.
    const state = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: DEAD_MARSHES }), [plagueInPlay]),
    );

    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeDefined();
    expect(result.state.combat!.strikeProwess).toBe(9);
  });

  test('Undead auto-attack strikes unchanged without Doors of Night (stays 2)', () => {
    // The doubling clause is gated on Doors of Night; absent it, strikes are
    // unmodified even though prowess still gets +1.
    const state = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: DEAD_MARSHES }), [plagueInPlay]),
    );

    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeDefined();
    expect(result.state.combat!.strikesTotal).toBe(2);
    expect(result.state.combat!.strikeProwess).toBe(9);
  });

  test('Undead auto-attack strikes doubled with Doors of Night (2 → 4)', () => {
    // Dead Marshes: 2 strikes. With Plague + Doors of Night: 2 × 2 = 4 strikes,
    // prowess still 8 + 1 = 9. The result of 4 (not 3) proves the modifier is
    // multiplicative, not a fixed +1.
    const state = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: DEAD_MARSHES }), [plagueInPlay, donInPlay]),
    );

    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeDefined();
    expect(result.state.combat!.strikesTotal).toBe(4);
    expect(result.state.combat!.strikeProwess).toBe(9);
  });

  test('non-Undead (Wolf) auto-attack is unaffected even with Doors of Night', () => {
    // Isengard: Wolves — 3 strikes, 7 prowess. Plague only touches Undead, so
    // neither prowess nor strikes change, even with Doors of Night in play.
    const state = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: ISENGARD }), [plagueInPlay, donInPlay]),
    );

    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeDefined();
    expect(result.state.combat!.strikeProwess).toBe(7);
    expect(result.state.combat!.strikesTotal).toBe(3);
  });

  test('baseline: without Plague of Wights, Undead auto-attack unchanged', () => {
    // Dead Marshes: 2 strikes, 8 prowess — no boost without the card in play.
    const state = setupAutoAttackStep(buildSitePhaseState({ site: DEAD_MARSHES }));

    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeDefined();
    expect(result.state.combat!.strikeProwess).toBe(8);
    expect(result.state.combat!.strikesTotal).toBe(2);
  });

  test('cannot be duplicated (duplication-limit scope game max 1)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [PLAGUE_OF_WIGHTS_TW], siteDeck: [MINAS_TIRITH], cardsInPlay: [plagueInPlay] },
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

  test('cannot be duplicated across printings: tw-81 blocked while le-130 is in play', () => {
    const leInPlay: CardInPlay = {
      instanceId: 'plague-le-1' as CardInstanceId,
      definitionId: PLAGUE_OF_WIGHTS_LE,
      status: CardStatus.Untapped,
    };
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [PLAGUE_OF_WIGHTS_TW], siteDeck: [MINAS_TIRITH], cardsInPlay: [leInPlay] },
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
