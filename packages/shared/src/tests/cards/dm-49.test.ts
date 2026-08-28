/**
 * @module dm-49.test
 *
 * Card test: Chance of Being Lost (dm-49)
 * Type: hazard-event (short), not unique
 *
 * Card text: "Playable on a moving company using region movement if opponent
 * is using the same type of location deck (minion/hero) as yourself. Make a
 * roll modified by -2 for each ranger in the company. If the result is
 * greater than 6, you must replace company's new site card with a different
 * site from your location deck that is located in the same region or an
 * adjacent region as the company's new site."
 *
 * Effects:
 *   1. play-condition, requires "region-movement".
 *   2. play-condition, requires "player-state",
 *      condition `{ "player.sameLocationDeckTypeAsOpponent": true }`.
 *   3. roll-then-swap-new-site, threshold 6, rangerModifier -2.
 *
 * | # | Effect                                              | Status | Notes                                          |
 * |---|------------------------------------------------------|--------|-------------------------------------------------|
 * | 1 | play-condition region-movement                       | OK     | checkRegionMovement (movementType === 'region') |
 * | 2 | play-condition player-state (same deck type)          | OK     | player.sameLocationDeckTypeAsOpponent           |
 * | 3 | roll-then-swap-new-site (roll, -2/ranger, threshold 6)| OK     | handleRollThenSwapNewSite + dice-check pending  |
 * | 4 | forced replacement, same/adjacent region, different   | OK     | offer-swap-new-site + swap-new-site-choice      |
 *
 * Sites used (hero side): Bree (tw-378, border-hold, Arthedain — destination),
 * The White Towers (tw-430, ruins-and-lairs, Arthedain — same region), Carn
 * Dûm (tw-380, dark-hold, Angmar — region adjacent to Arthedain), Edhellond
 * (tw-393, haven, Anfalas — neither same nor adjacent).
 *
 * Playable: YES
 * Certified: 2026-08-27
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, CardStatus,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS, GIMLI, RIVENDELL, LORIEN, MORIA, BREE, EDHELLOND,
  makeMHState, executeAction,
  viableActions, dispatch, reduce, expectInDiscardPile,
} from '../test-helpers.js';
import { Alignment } from '../../index.js';
import { MovementType } from '../../types/common.js';
import type { CardDefinitionId, GameState, PlayHazardAction } from '../../index.js';
import type { SwapNewSiteChoiceAction } from '../../types/actions-movement-hazard.js';

const CHANCE_OF_BEING_LOST = 'dm-49' as CardDefinitionId;
const WHITE_TOWERS = 'tw-430' as CardDefinitionId;  // ruins-and-lairs, Arthedain (same region as Bree)
const CARN_DUM = 'tw-380' as CardDefinitionId;       // dark-hold, Angmar (adjacent to Arthedain)

/**
 * Movement/hazard-phase play-hazards state: P1 (resource) moving `companyChars`
 * to `destination` (Bree by default) using region movement, P2 (hazard) holding
 * Chance of Being Lost with `hazardSiteDeck` as their own location deck.
 * Alignments default to Wizard/Wizard (same location-deck type).
 */
function lostState(opts: {
  destination: CardDefinitionId | null;
  companyChars: CardDefinitionId[];
  hazardSiteDeck: CardDefinitionId[];
  movementType?: MovementType | null;
  resourceAlignment?: Alignment;
  hazardAlignment?: Alignment;
}): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: opts.resourceAlignment ?? Alignment.Wizard,
        companies: [{
          site: RIVENDELL,
          characters: opts.companyChars,
          ...(opts.destination ? { destinationSite: opts.destination } : {}),
        }],
        hand: [],
        siteDeck: [MORIA],
      },
      {
        id: PLAYER_2,
        alignment: opts.hazardAlignment ?? Alignment.Wizard,
        companies: [{ site: LORIEN, characters: [GIMLI] }],
        hand: [CHANCE_OF_BEING_LOST],
        siteDeck: opts.hazardSiteDeck,
      },
    ],
  });
  return {
    ...base,
    phaseState: makeMHState({
      movementType: opts.movementType === undefined ? MovementType.Region : opts.movementType,
    }),
  };
}

/** The `play-hazard` actions offering Chance of Being Lost, in candidate order. */
function lostActions(state: GameState): PlayHazardAction[] {
  return viableActions(state, PLAYER_2, 'play-hazard')
    .map(a => a.action as PlayHazardAction)
    .filter(a => a.cardInstanceId === state.players[HAZARD_PLAYER].hand.find(c => c.definitionId === CHANCE_OF_BEING_LOST)!.instanceId);
}

describe('Chance of Being Lost (dm-49)', () => {
  beforeEach(() => resetMint());

  // ─── Play-condition gating ─────────────────────────────────────────────

  test('NOT playable for starter (non-region) movement', () => {
    const state = lostState({
      destination: BREE,
      companyChars: [ARAGORN],
      hazardSiteDeck: [WHITE_TOWERS],
      movementType: MovementType.Starter,
    });
    expect(lostActions(state)).toHaveLength(0);
  });

  test('NOT playable when the opponent uses a different type of location deck', () => {
    const state = lostState({
      destination: BREE,
      companyChars: [ARAGORN],
      hazardSiteDeck: [WHITE_TOWERS],
      resourceAlignment: Alignment.Wizard,
      hazardAlignment: Alignment.Ringwraith,
    });
    expect(lostActions(state)).toHaveLength(0);
  });

  test('NOT playable when the moving company is not actually moving', () => {
    const state = lostState({
      destination: null,
      companyChars: [ARAGORN],
      hazardSiteDeck: [WHITE_TOWERS],
    });
    expect(lostActions(state)).toHaveLength(0);
  });

  test('playable on region movement with matching location-deck types (both hero)', () => {
    const state = lostState({
      destination: BREE,
      companyChars: [ARAGORN],
      hazardSiteDeck: [WHITE_TOWERS],
    });
    expect(lostActions(state)).toHaveLength(1);
  });

  // ─── Playing enqueues a roll (discarding the card immediately) ─────────

  test('playing discards the card immediately and queues a roll for the hazard player', () => {
    const state = lostState({
      destination: BREE,
      companyChars: [ARAGORN],
      hazardSiteDeck: [WHITE_TOWERS],
    });
    const action = lostActions(state)[0];
    const after = dispatch(state, action);

    expectInDiscardPile(after, HAZARD_PLAYER, CHANCE_OF_BEING_LOST);
    expect(after.players[HAZARD_PLAYER].hand.some(c => c.definitionId === CHANCE_OF_BEING_LOST)).toBe(false);
    expect((after.phaseState as ReturnType<typeof makeMHState>).hazardsPlayedThisCompany).toBe(1);

    const rolls = viableActions(after, PLAYER_2, 'resolve-dice-check');
    expect(rolls).toHaveLength(1);
  });

  // ─── Ranger modifier ─────────────────────────────────────────────────────

  test('a single ranger (Aragorn) applies a -2 roll modifier: 8 fails, 9 passes', () => {
    const base = lostState({
      destination: BREE,
      companyChars: [ARAGORN],
      hazardSiteDeck: [WHITE_TOWERS],
    });
    const played = dispatch(base, lostActions(base)[0]);

    // Roll 8 - 2 = 6, not > 6 → fails: no swap-new-site-choice, destination unchanged.
    const failed = executeAction(played, PLAYER_2, 'resolve-dice-check', 8);
    expect(viableActions(failed, PLAYER_2, 'swap-new-site-choice')).toHaveLength(0);
    expect(failed.players[RESOURCE_PLAYER].companies[0].destinationSite?.definitionId).toBe(BREE);

    // Roll 9 - 2 = 7, > 6 → passes: swap-new-site-choice is queued.
    const passed = executeAction(played, PLAYER_2, 'resolve-dice-check', 9);
    expect(viableActions(passed, PLAYER_2, 'swap-new-site-choice').length).toBeGreaterThan(0);
  });

  test('no rangers: no modifier — 6 fails, 7 passes', () => {
    const base = lostState({
      destination: BREE,
      companyChars: [LEGOLAS, GIMLI],
      hazardSiteDeck: [WHITE_TOWERS],
    });
    const played = dispatch(base, lostActions(base)[0]);

    const failed = executeAction(played, PLAYER_2, 'resolve-dice-check', 6);
    expect(viableActions(failed, PLAYER_2, 'swap-new-site-choice')).toHaveLength(0);

    const passed = executeAction(played, PLAYER_2, 'resolve-dice-check', 7);
    expect(viableActions(passed, PLAYER_2, 'swap-new-site-choice').length).toBeGreaterThan(0);
  });

  // ─── Eligible replacement sites: same region, adjacent region, neither ────

  test('offers both a same-region and an adjacent-region site, but not a non-adjacent one', () => {
    const base = lostState({
      destination: BREE,
      companyChars: [LEGOLAS, GIMLI],
      hazardSiteDeck: [WHITE_TOWERS, CARN_DUM, EDHELLOND],
    });
    const played = dispatch(base, lostActions(base)[0]);
    const passed = executeAction(played, PLAYER_2, 'resolve-dice-check', 7);

    const choices = viableActions(passed, PLAYER_2, 'swap-new-site-choice')
      .map(a => (a.action as SwapNewSiteChoiceAction).replacementSiteInstanceId);
    const offeredDefs = choices.map(id => passed.players[HAZARD_PLAYER].siteDeck.find(s => s.instanceId === id)?.definitionId);

    expect(new Set(offeredDefs)).toEqual(new Set([WHITE_TOWERS, CARN_DUM]));
  });

  test('a passed roll with no eligible replacement has no further effect', () => {
    const base = lostState({
      destination: BREE,
      companyChars: [LEGOLAS, GIMLI],
      hazardSiteDeck: [EDHELLOND],
    });
    const played = dispatch(base, lostActions(base)[0]);
    const passed = executeAction(played, PLAYER_2, 'resolve-dice-check', 7);

    expect(viableActions(passed, PLAYER_2, 'swap-new-site-choice')).toHaveLength(0);
    expect(passed.players[RESOURCE_PLAYER].companies[0].destinationSite?.definitionId).toBe(BREE);
    // Edhellond never leaves the hazard player's own location deck.
    expect(passed.players[HAZARD_PLAYER].siteDeck.some(s => s.definitionId === EDHELLOND)).toBe(true);
  });

  // ─── Taking the swap ────────────────────────────────────────────────────

  test('taking the swap replaces the destination site, updates the phase state', () => {
    const base = lostState({
      destination: BREE,
      companyChars: [LEGOLAS, GIMLI],
      hazardSiteDeck: [WHITE_TOWERS],
    });
    const played = dispatch(base, lostActions(base)[0]);
    const passed = executeAction(played, PLAYER_2, 'resolve-dice-check', 7);

    const choiceAction = viableActions(passed, PLAYER_2, 'swap-new-site-choice')[0].action as SwapNewSiteChoiceAction;
    const after = dispatch(passed, choiceAction);

    // The company now moves to The White Towers, untapped.
    const destinationSite = after.players[RESOURCE_PLAYER].companies[0].destinationSite;
    expect(destinationSite?.definitionId).toBe(WHITE_TOWERS);
    expect(destinationSite?.status).toBe(CardStatus.Untapped);

    // The phase state's cached destination name/type follow the replacement.
    const mhState = after.phaseState as ReturnType<typeof makeMHState>;
    expect(mhState.destinationSiteName).toBe('The White Towers');

    // Bree (the original, never-entered destination) returns untapped to
    // its own owner's (the mover's) location deck.
    const resourceDeck = after.players[RESOURCE_PLAYER].siteDeck;
    expect(resourceDeck.some(s => s.definitionId === BREE)).toBe(true);

    // The White Towers left the hazard player's own location deck.
    expect(after.players[HAZARD_PLAYER].siteDeck.some(s => s.definitionId === WHITE_TOWERS)).toBe(false);

    // No pending resolution remains.
    expect(after.pendingResolutions).toHaveLength(0);
  });

  test('the reducer rejects a forged replacement outside the same/adjacent region', () => {
    const base = lostState({
      destination: BREE,
      companyChars: [LEGOLAS, GIMLI],
      hazardSiteDeck: [WHITE_TOWERS, EDHELLOND],
    });
    const played = dispatch(base, lostActions(base)[0]);
    const passed = executeAction(played, PLAYER_2, 'resolve-dice-check', 7);

    const validChoice = viableActions(passed, PLAYER_2, 'swap-new-site-choice')[0].action as SwapNewSiteChoiceAction;
    const edhellondInstance = passed.players[HAZARD_PLAYER].siteDeck.find(s => s.definitionId === EDHELLOND)!.instanceId;
    const forged: SwapNewSiteChoiceAction = { ...validChoice, replacementSiteInstanceId: edhellondInstance };

    const result = reduce(passed, forged);

    expect(result.error).toBeTruthy();
    expect(result.state.players[RESOURCE_PLAYER].companies[0].destinationSite?.definitionId).toBe(BREE);
  });
});
