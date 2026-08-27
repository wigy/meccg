/**
 * @module tw-69.test
 *
 * Card test: Night (tw-69)
 * Type: hazard-event (long, environment)
 * Effects: 4
 *   1. duplication-limit scope: game max: 1 — "Cannot be duplicated"
 *   2. stat-modifier prowess -1, target all-characters, gated on
 *      `target.race: dunadan` + NOT `target.skills $includes ranger`
 *   3. stat-modifier prowess +1, target all-attacks, gated on
 *      `inPlay: "Doors of Night"`
 *   4. stat-modifier prowess -1, target all-characters, gated on
 *      `target.race $in [man, dunadan]` + `inPlay: "Doors of Night"`
 *
 * Card text:
 *   "Environment. The prowess of each non-ranger Dúnadan is modified by -1.
 *    Additionally, if Doors of Night is in play, the prowesses of all attacks
 *    are modified by +1 and the prowess of each Man and Dúnadan is modified
 *    by -1. Cannot be duplicated."
 *
 * The base clause (effect 2) only touches non-ranger Dúnedain. The DoN clause
 * (effect 4) is unconditional on race skill and stacks with effect 2, so a
 * non-ranger Dúnadan is -2 total with Doors of Night in play while a ranger
 * Dúnadan is only -1 (from effect 4 alone) — the ba-25/le-106 additive-clause
 * idiom.
 *
 * | # | Effect                                    | Status      | Notes                                    |
 * |---|--------------------------------------------|-------------|-------------------------------------------|
 * | 1 | duplication-limit (game, max 1)             | IMPLEMENTED | reducer.ts duplicate-check                 |
 * | 2 | stat-modifier prowess -1 (non-ranger Dúnadan) | IMPLEMENTED | target: all-characters, target.race/target.skills |
 * | 3 | stat-modifier prowess +1 (all attacks, DoN) | IMPLEMENTED | target: all-attacks, inPlay condition      |
 * | 4 | stat-modifier prowess -1 (Man/Dúnadan, DoN)  | IMPLEMENTED | target: all-characters, inPlay condition   |
 *
 * Playable: YES
 * Certified: 2026-08-27
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  Phase, CardStatus,
  buildTestState, resetMint, getCharacter, baseProwess,
  BEREGOND, FARAMIR, ARAGORN, THEODEN, GALADRIEL, DOORS_OF_NIGHT,
  RIVENDELL, LORIEN, MORIA,
  buildSitePhaseState, addP2CardsInPlay, setupAutoAttackStep, dispatch, addCardInPlay,
  makeMHState, viableActions,
} from '../test-helpers.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import type { CardInPlay, CardInstanceId, CardDefinitionId } from '../../index.js';

const NIGHT = 'tw-69' as CardDefinitionId;
const IRON_HILL_DWARF_HOLD = 'le-383' as CardDefinitionId; // Free-hold automatic-attack — Dwarves 4 strikes / 10 prowess

const nightInPlay: CardInPlay = {
  instanceId: 'night-1' as CardInstanceId,
  definitionId: NIGHT,
  status: CardStatus.Untapped,
};

const doorsInPlay: CardInPlay = {
  instanceId: 'doors-1' as CardInstanceId,
  definitionId: DOORS_OF_NIGHT,
  status: CardStatus.Untapped,
};

describe('Night (tw-69)', () => {
  beforeEach(() => resetMint());

  // ─── Base clause: -1 prowess to each non-ranger Dúnadan ───────────────────

  test('non-ranger Dúnadan (Beregond, warrior only): -1 prowess', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [BEREGOND] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [],
          cardsInPlay: [nightInPlay] },
      ],
    });

    expect(getCharacter(state, RESOURCE_PLAYER, BEREGOND).effectiveStats.prowess).toBe(baseProwess(BEREGOND) - 1);
  });

  test('ranger Dúnadan (Faramir, warrior + ranger): unaffected by the base clause', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [FARAMIR] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [],
          cardsInPlay: [nightInPlay] },
      ],
    });

    expect(getCharacter(state, RESOURCE_PLAYER, FARAMIR).effectiveStats.prowess).toBe(baseProwess(FARAMIR));
  });

  test('Man (Théoden): unaffected by the base clause', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [THEODEN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [],
          cardsInPlay: [nightInPlay] },
      ],
    });

    expect(getCharacter(state, RESOURCE_PLAYER, THEODEN).effectiveStats.prowess).toBe(baseProwess(THEODEN));
  });

  test('non-Dúnadan, non-Man (Galadriel, Elf): unaffected', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GALADRIEL] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [],
          cardsInPlay: [nightInPlay] },
      ],
    });

    expect(getCharacter(state, RESOURCE_PLAYER, GALADRIEL).effectiveStats.prowess).toBe(baseProwess(GALADRIEL));
  });

  // ─── Doors of Night clause: +1 to all attacks ──────────────────────────────

  test('with Doors of Night: a site automatic-attack gets +1 prowess (4/10 → 4/11)', () => {
    const state = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: IRON_HILL_DWARF_HOLD }), [nightInPlay, doorsInPlay]),
    );

    const after = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(after.combat).toBeDefined();
    expect(after.combat!.strikesTotal).toBe(4);
    expect(after.combat!.strikeProwess).toBe(11);
  });

  test('without Doors of Night: the automatic-attack is unchanged (4/10)', () => {
    const state = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: IRON_HILL_DWARF_HOLD }), [nightInPlay]),
    );

    const after = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(after.combat).toBeDefined();
    expect(after.combat!.strikesTotal).toBe(4);
    expect(after.combat!.strikeProwess).toBe(10);
  });

  test('Doors of Night alone (no Night) leaves the attack at 4/10', () => {
    const state = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: IRON_HILL_DWARF_HOLD }), [doorsInPlay]),
    );

    const after = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(after.combat).toBeDefined();
    expect(after.combat!.strikesTotal).toBe(4);
    expect(after.combat!.strikeProwess).toBe(10);
  });

  // ─── Doors of Night clause: -1 to each Man and Dúnadan (stacks with base) ──

  test('with Doors of Night: non-ranger Dúnadan (Beregond) is -2 total (base -1 + DoN -1)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [BEREGOND] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [],
          cardsInPlay: [nightInPlay, doorsInPlay] },
      ],
    });

    expect(getCharacter(state, RESOURCE_PLAYER, BEREGOND).effectiveStats.prowess).toBe(baseProwess(BEREGOND) - 2);
  });

  test('with Doors of Night: ranger Dúnadan (Aragorn) is -1 (DoN clause only)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [],
          cardsInPlay: [nightInPlay, doorsInPlay] },
      ],
    });

    expect(getCharacter(state, RESOURCE_PLAYER, ARAGORN).effectiveStats.prowess).toBe(baseProwess(ARAGORN) - 1);
  });

  test('with Doors of Night: Man (Théoden) is -1 (DoN clause)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [THEODEN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [],
          cardsInPlay: [nightInPlay, doorsInPlay] },
      ],
    });

    expect(getCharacter(state, RESOURCE_PLAYER, THEODEN).effectiveStats.prowess).toBe(baseProwess(THEODEN) - 1);
  });

  test('with Doors of Night: Elf (Galadriel) remains unaffected', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GALADRIEL] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [],
          cardsInPlay: [nightInPlay, doorsInPlay] },
      ],
    });

    expect(getCharacter(state, RESOURCE_PLAYER, GALADRIEL).effectiveStats.prowess).toBe(baseProwess(GALADRIEL));
  });

  // ─── Environment affects both players' characters ──────────────────────────

  test('affects the opponent of the environment controller', () => {
    // Night sits in P1's cardsInPlay; it still penalises P2's Dúnadan.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [BEREGOND] }], hand: [], siteDeck: [] },
      ],
    });
    const withEnv = recomputeDerived(addCardInPlay(base, RESOURCE_PLAYER, NIGHT));

    expect(getCharacter(withEnv, HAZARD_PLAYER, BEREGOND).effectiveStats.prowess).toBe(baseProwess(BEREGOND) - 1);
  });

  // ─── Cannot be duplicated (duplication-limit scope game) ───────────────────

  test('cannot be duplicated — not playable while a copy is already in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [NIGHT], siteDeck: [],
          cardsInPlay: [nightInPlay] },
      ],
    });
    const ready = { ...state, phaseState: makeMHState({ hazardsPlayedThisCompany: 0, hazardLimitAtReveal: 4 }) };

    const actions = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });

  test('is playable when no copy is in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [NIGHT], siteDeck: [] },
      ],
    });
    const ready = { ...state, phaseState: makeMHState({ hazardsPlayedThisCompany: 0, hazardLimitAtReveal: 4 }) };

    const actions = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(actions.length).toBeGreaterThan(0);
  });
});
