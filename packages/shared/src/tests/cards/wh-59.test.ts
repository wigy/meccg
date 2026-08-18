/**
 * @module wh-59.test
 *
 * Card test: A Merrier World (wh-59)
 * Type: minion-resource-event (Fallen-wizard stage resource permanent-event)
 *
 * Printed text:
 *   "Playable if you have more than 7 stage points. Hazards your companies
 *    defeat (for which you otherwise get 1 MP) are each worth full kill
 *    marshalling points. Cannot be duplicated by a given player."
 *
 * Card shape (data):
 *   - Stage resource permanent-event (`alignment: 'stage'`, `eventType:
 *     'permanent'`); contributes 2 stage points (`stage-points`).
 *   - effects:
 *     1. stage-points (2) — its own stage-point contribution.
 *     2. play-condition player-state — "Playable if you have more than 7
 *        stage points" (`player.stagePoints > 7`), gating the
 *        play-permanent-event legal action in the organization phase.
 *     3. fw-kill-mp-full — hazards the player's companies defeat score full
 *        printed kill MP instead of the MEWH §4 flat-1 clamp, and a defeated
 *        detainment creature is routed to the kill pile and scores too. This
 *        is the same exemption Alatar (wh-1) carries as a character, but here
 *        sourced from a bare `cardsInPlay` permanent-event instead.
 *     4. duplication-limit (scope player, max 1) — "Cannot be duplicated by a
 *        given player".
 *
 * These tests drive the recompute / legal-action / combat pipeline; the card
 * shape is documented above rather than asserted against the JSON.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, GANDALF,
  MORIA, RIVENDELL, ISENGARD, LORIEN,
  resetMint, mint,
  buildTestState, makeMHState, recomputeDerived,
  addCardInPlay,
  playCreatureHazardAndResolve, runCreatureCombat,
  viableActions,
  companyIdAt, handCardId,
} from '../test-helpers.js';
import type { CardDefinitionId, GameState } from '../../index.js';
import { Phase, Alignment, RegionType, SiteType } from '../../index.js';

const A_MERRIER_WORLD = 'wh-59' as CardDefinitionId;
const HORSE_LORDS = 'le-78' as CardDefinitionId; // hazard-creature, detainment vs hero/FW, kill MP 2

describe('A Merrier World (wh-59)', () => {
  beforeEach(() => resetMint());

  // ─── Rule: playable only with more than 7 stage points ───────────────────

  test('play-permanent-event offered when the FW has more than 7 stage points', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          stagePoints: 8,
          companies: [{ site: ISENGARD, characters: [] }],
          hand: [A_MERRIER_WORLD],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    const plays = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(plays).toHaveLength(1);
  });

  test('play-permanent-event NOT offered at exactly 7 stage points (needs MORE than 7)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          stagePoints: 7,
          companies: [{ site: ISENGARD, characters: [] }],
          hand: [A_MERRIER_WORLD],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    const plays = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(plays).toHaveLength(0);
  });

  // ─── Rule: cannot be duplicated by a given player ────────────────────────

  test('a second copy is not playable while one is already in play (player duplication limit)', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          stagePoints: 8,
          companies: [{ site: ISENGARD, characters: [] }],
          hand: [A_MERRIER_WORLD],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    // One copy already in play for this player.
    state = addCardInPlay(state, RESOURCE_PLAYER, A_MERRIER_WORLD);

    const plays = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(plays).toHaveLength(0);
  });

  // ─── Rule: own stage-point contribution ───────────────────────────────────

  test('contributes 2 stage points to the controller while in play', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    state = addCardInPlay(state, RESOURCE_PLAYER, A_MERRIER_WORLD);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(2);
  });

  // ─── Rule: fw-kill-mp-full — full kill MP (MEWH §4 exemption) ────────────

  test('a Fallen-wizard with A Merrier World in play (bare cardsInPlay, not a character) scores full printed kill MP', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [GANDALF] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });
    state = addCardInPlay(state, RESOURCE_PLAYER, A_MERRIER_WORLD);
    // Inject a defeated Horse-lords (kill MP 2) into the FW's kill pile.
    const killed: GameState = {
      ...state,
      players: [
        { ...state.players[0], killPile: [{ instanceId: mint(), definitionId: HORSE_LORDS }] },
        state.players[1],
      ] as typeof state.players,
    };
    const derived = recomputeDerived(killed);
    // Full printed kill MP (2), not the §4 flat-1 clamp.
    expect(derived.players[RESOURCE_PLAYER].marshallingPoints.kill).toBe(2);
  });

  test('control: without A Merrier World the same defeated creature is clamped to 1 kill MP (MEWH §4)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [GANDALF] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });
    const killed: GameState = {
      ...state,
      players: [
        { ...state.players[0], killPile: [{ instanceId: mint(), definitionId: HORSE_LORDS }] },
        state.players[1],
      ] as typeof state.players,
    };
    const derived = recomputeDerived(killed);
    expect(derived.players[RESOURCE_PLAYER].marshallingPoints.kill).toBe(1);
  });

  // ─── Rule: fw-kill-mp-full (cont.) — detainment defeat routing ───────────

  test('with A Merrier World in play, a defeated DETAINMENT creature is routed to the kill pile and scores full MP', () => {
    // Horse-lords is detainment against a Fallen-wizard company; defeating it
    // normally awards 0 kill MP (§3.II.3 discard), but the fw-kill-mp-full
    // exemption (sourced here from the bare cardsInPlay card) routes it to
    // the kill pile instead — the "even with *" clause.
    let base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [GANDALF] }],
          hand: [HORSE_LORDS],
          siteDeck: [],
        },
      ],
    });
    base = addCardInPlay(base, RESOURCE_PLAYER, A_MERRIER_WORLD);
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Rohan'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    const creatureId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const inCombat = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, creatureId, targetCompanyId,
      { method: 'region-name', value: 'Rohan' },
    );
    expect(inCombat.combat).not.toBeNull();
    expect(inCombat.combat!.detainment).toBe(true);

    // Defeat the (single) strike with Aragorn: 12 + prowess 7 > Horse-lords 10.
    const finished = runCreatureCombat(inCombat, ARAGORN, 12, 12);
    expect(finished.combat).toBeNull();

    // Routed to the FW's kill pile (not the attacker's discard) and scores full MP.
    const fw = finished.players[RESOURCE_PLAYER];
    expect(fw.killPile.some(c => c.definitionId === HORSE_LORDS)).toBe(true);
    expect(finished.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === HORSE_LORDS)).toBe(false);
    expect(fw.marshallingPoints.kill).toBe(2);
  });

  test('control: without A Merrier World, a defeated DETAINMENT creature awards no kill MP (§3.II.3 discard to attacker)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [GANDALF] }],
          hand: [HORSE_LORDS],
          siteDeck: [],
        },
      ],
    });
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Rohan'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    const creatureId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const inCombat = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, creatureId, targetCompanyId,
      { method: 'region-name', value: 'Rohan' },
    );
    expect(inCombat.combat!.detainment).toBe(true);

    const finished = runCreatureCombat(inCombat, ARAGORN, 12, 12);
    expect(finished.combat).toBeNull();

    const fw = finished.players[RESOURCE_PLAYER];
    expect(fw.killPile.some(c => c.definitionId === HORSE_LORDS)).toBe(false);
    expect(finished.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === HORSE_LORDS)).toBe(true);
    expect(fw.marshallingPoints.kill).toBe(0);
  });
});
