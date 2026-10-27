/**
 * @module td-68.test
 *
 * Card test: Shadow of Mordor (td-68)
 * Type: hazard-event (permanent), keyword `environment`
 *
 * Text:
 *   "Environment. The hazard limit for each company is increased by one for
 *    every card over one drawn by that company during its movement/hazard
 *    phase. Additionally, if Doors of Night is in play, during each company's
 *    movement/hazard phase, the hazard player may draw one additional card for
 *    every card in excess of one drawn by his opponent. Cannot be duplicated."
 *
 * Effects:
 * | # | Effect Type                 | Status | Notes                                                |
 * |---|-----------------------------|--------|------------------------------------------------------|
 * | 1 | duplication-limit           | OK     | scope game, max 1 — "Cannot be duplicated"           |
 * | 2 | hazard-limit-per-extra-draw | OK     | +1 live hazard limit per resource card drawn beyond  |
 * |   |                             |        | the first (`resourceCardsDrawn`, survives a pass)    |
 * | 3 | hazard-draw-per-extra-draw  | OK     | when Doors of Night in play: each resource draw      |
 * |   |                             |        | beyond the first raises `hazardDrawMax` by one       |
 *
 * Playable: YES
 * Certified: 2026-10-27
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  DOORS_OF_NIGHT,
  buildTestState, resetMint, makeMHState, dispatch,
  addCardInPlay, companyIdAt, buildMHDrawCardsStepState,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { currentHazardLimit } from '../../engine/hazard-limit.js';
import { Phase } from '../../index.js';
import type { CardDefinitionId, MovementHazardPhaseState } from '../../index.js';

const SHADOW_OF_MORDOR = 'td-68' as CardDefinitionId;

// Moria's printed draw boxes: resource 2, hazard 3.
const MORIA_HAZARD_DRAWS = 3;
const DRAW_RESOURCE = { type: 'draw-cards', player: PLAYER_1, count: 1 } as const;
const DRAW_HAZARD = { type: 'draw-cards', player: PLAYER_2, count: 1 } as const;

describe('Shadow of Mordor (td-68)', () => {
  beforeEach(() => resetMint());

  // ─── hazard limit +1 per card over one drawn ───────────────────────────────

  test('the first card drawn does not raise the hazard limit; each further card adds one', () => {
    let state = buildMHDrawCardsStepState({ hazardCardsInPlay: [SHADOW_OF_MORDOR] });
    const base = currentHazardLimit(state, state.phaseState as MovementHazardPhaseState, companyIdAt(state, RESOURCE_PLAYER));

    state = dispatch(state, DRAW_RESOURCE);
    expect(currentHazardLimit(state, state.phaseState as MovementHazardPhaseState, companyIdAt(state, RESOURCE_PLAYER))).toBe(base);

    state = dispatch(state, DRAW_RESOURCE);
    expect((state.phaseState as MovementHazardPhaseState).resourceCardsDrawn).toBe(2);
    expect(currentHazardLimit(state, state.phaseState as MovementHazardPhaseState, companyIdAt(state, RESOURCE_PLAYER))).toBe(base + 1);
  });

  test('the raised limit persists into the play-hazards step', () => {
    let state = buildMHDrawCardsStepState({ hazardCardsInPlay: [SHADOW_OF_MORDOR] });
    const base = currentHazardLimit(state, state.phaseState as MovementHazardPhaseState, companyIdAt(state, RESOURCE_PLAYER));
    state = dispatch(dispatch(state, DRAW_RESOURCE), DRAW_RESOURCE);
    for (let i = 0; i < MORIA_HAZARD_DRAWS; i++) state = dispatch(state, DRAW_HAZARD);
    expect((state.phaseState as MovementHazardPhaseState).step).toBe('play-hazards');
    expect(currentHazardLimit(state, state.phaseState as MovementHazardPhaseState, companyIdAt(state, RESOURCE_PLAYER))).toBe(base + 1);
  });

  test('passing after one draw gives no bonus (only cards actually drawn count)', () => {
    let state = buildMHDrawCardsStepState({ hazardCardsInPlay: [SHADOW_OF_MORDOR] });
    const base = currentHazardLimit(state, state.phaseState as MovementHazardPhaseState, companyIdAt(state, RESOURCE_PLAYER));
    state = dispatch(state, DRAW_RESOURCE);
    state = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(currentHazardLimit(state, state.phaseState as MovementHazardPhaseState, companyIdAt(state, RESOURCE_PLAYER))).toBe(base);
  });

  test('without Shadow of Mordor in play, extra draws do not raise the hazard limit', () => {
    let state = buildMHDrawCardsStepState({ hazardCardsInPlay: [] });
    const base = currentHazardLimit(state, state.phaseState as MovementHazardPhaseState, companyIdAt(state, RESOURCE_PLAYER));
    state = dispatch(dispatch(state, DRAW_RESOURCE), DRAW_RESOURCE);
    expect(currentHazardLimit(state, state.phaseState as MovementHazardPhaseState, companyIdAt(state, RESOURCE_PLAYER))).toBe(base);
  });

  test('the hazard player drawing extra cards does not raise the limit', () => {
    let state = buildMHDrawCardsStepState({ hazardCardsInPlay: [SHADOW_OF_MORDOR] });
    const base = currentHazardLimit(state, state.phaseState as MovementHazardPhaseState, companyIdAt(state, RESOURCE_PLAYER));
    state = dispatch(dispatch(dispatch(state, DRAW_HAZARD), DRAW_HAZARD), DRAW_HAZARD);
    expect(currentHazardLimit(state, state.phaseState as MovementHazardPhaseState, companyIdAt(state, RESOURCE_PLAYER))).toBe(base);
  });

  // ─── Doors of Night: extra hazard draws ────────────────────────────────────

  test('with Doors of Night, each resource card over one grants the hazard player one more draw', () => {
    let state = buildMHDrawCardsStepState({ hazardCardsInPlay: [SHADOW_OF_MORDOR, DOORS_OF_NIGHT] });
    expect((state.phaseState as MovementHazardPhaseState).hazardDrawMax).toBe(MORIA_HAZARD_DRAWS);

    state = dispatch(state, DRAW_RESOURCE);
    expect((state.phaseState as MovementHazardPhaseState).hazardDrawMax).toBe(MORIA_HAZARD_DRAWS);

    state = dispatch(state, DRAW_RESOURCE);
    expect((state.phaseState as MovementHazardPhaseState).hazardDrawMax).toBe(MORIA_HAZARD_DRAWS + 1);

    // The hazard player can actually draw all four cards.
    const handBefore = state.players[HAZARD_PLAYER].hand.length;
    for (let i = 0; i < MORIA_HAZARD_DRAWS + 1; i++) state = dispatch(state, DRAW_HAZARD);
    expect(state.players[HAZARD_PLAYER].hand.length).toBe(handBefore + MORIA_HAZARD_DRAWS + 1);
    expect((state.phaseState as MovementHazardPhaseState).step).toBe('play-hazards');
  });

  test('the extra draw is optional and re-opens drawing for a hazard player who already finished', () => {
    let state = buildMHDrawCardsStepState({ hazardCardsInPlay: [SHADOW_OF_MORDOR, DOORS_OF_NIGHT] });
    for (let i = 0; i < MORIA_HAZARD_DRAWS; i++) state = dispatch(state, DRAW_HAZARD);
    expect(computeLegalActions(state, PLAYER_2).filter(ea => ea.viable).map(ea => ea.action.type)).not.toContain('draw-cards');

    state = dispatch(dispatch(state, DRAW_RESOURCE), DRAW_RESOURCE);
    expect((state.phaseState as MovementHazardPhaseState).step).toBe('draw-cards');
    const types = computeLegalActions(state, PLAYER_2).filter(ea => ea.viable).map(ea => ea.action.type);
    expect(types).toContain('draw-cards');
    expect(types).toContain('pass');

    // Declining the extra draw ends the step.
    state = dispatch(state, { type: 'pass', player: PLAYER_2 });
    expect((state.phaseState as MovementHazardPhaseState).step).toBe('play-hazards');
  });

  test('without Doors of Night, the hazard player gets no extra draws', () => {
    let state = buildMHDrawCardsStepState({ hazardCardsInPlay: [SHADOW_OF_MORDOR] });
    state = dispatch(dispatch(state, DRAW_RESOURCE), DRAW_RESOURCE);
    expect((state.phaseState as MovementHazardPhaseState).hazardDrawMax).toBe(MORIA_HAZARD_DRAWS);
  });

  test('Doors of Night alone grants no extra draws', () => {
    let state = buildMHDrawCardsStepState({ hazardCardsInPlay: [DOORS_OF_NIGHT] });
    state = dispatch(dispatch(state, DRAW_RESOURCE), DRAW_RESOURCE);
    expect((state.phaseState as MovementHazardPhaseState).hazardDrawMax).toBe(MORIA_HAZARD_DRAWS);
  });

  // ─── cannot be duplicated ──────────────────────────────────────────────────

  test('is playable from hand when no copy is in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [SHADOW_OF_MORDOR], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const plays = computeLegalActions({ ...state, phaseState: makeMHState({ activeCompanyIndex: 0 }) }, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard');
    expect(plays.length).toBeGreaterThan(0);
  });

  test('cannot be played while another Shadow of Mordor is in play', () => {
    const state = addCardInPlay(buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [SHADOW_OF_MORDOR], siteDeck: [MINAS_TIRITH] },
      ],
    }), HAZARD_PLAYER, SHADOW_OF_MORDOR);
    const plays = computeLegalActions({ ...state, phaseState: makeMHState({ activeCompanyIndex: 0 }) }, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard');
    expect(plays).toHaveLength(0);
  });
});
