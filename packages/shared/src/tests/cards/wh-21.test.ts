/**
 * @module wh-21.test
 *
 * Card test: Heart Grown Cold (wh-21)
 * Type: hazard-event (permanent)
 *
 * Card text:
 *   "Fallen-wizard players must use minion site cards for hero Havens [{H}].
 *    If a Fallen-wizard has more than 4 stage points, his player must also use
 *    minion site cards for Free-holds [{F}]. If a Fallen-wizard has more than 7
 *    stage points, his player must also use minion site cards for Border-holds
 *    [{B}]."
 *
 * Effects:
 *   1. fw-site-alignment-restriction require:minion siteTypes:[haven]
 *   2. fw-site-alignment-restriction require:minion siteTypes:[free-hold],
 *      when player.stagePoints > 4
 *   3. fw-site-alignment-restriction require:minion siteTypes:[border-hold],
 *      when player.stagePoints > 7
 *
 * | # | Effect                                    | Status | Notes                                  |
 * |---|-------------------------------------------|--------|----------------------------------------|
 * | 1 | fw-site-alignment-restriction (haven)     | OK     | fwSiteVersionForbidden, always active  |
 * | 2 | fw-site-alignment-restriction (free-hold) | OK     | gated on player.stagePoints > 4        |
 * | 3 | fw-site-alignment-restriction (border)    | OK     | gated on player.stagePoints > 7        |
 *
 * A Fallen-wizard's location deck mixes hero, minion, and Fallen-wizard site
 * cards (CoE rule 1.28), so the same location can appear twice — hero Rivendell
 * (tw-421) is a Haven, minion Rivendell (as-160) a plain Free-hold. While this
 * card is in play the Fallen-wizard loses that choice: the hero card of a locked
 * site type may not be used, and if his deck holds no minion counterpart the
 * location becomes unreachable altogether. A Wizardhaven (a fallen-wizard-site,
 * both hero and minion per MEWH §10) is never locked.
 *
 * Geography — all destinations are within region movement (max 4) of the
 * Fallen-wizard's origin, Ettenmoors (le-373, Rhudaur): Rivendell (Rhudaur) 1,
 * Bree / The White Towers (Arthedain) 2, Bag End (The Shire) 3. A Fallen-wizard
 * may only use region movement (MEWH §7).
 *
 * Playable: YES
 * CERTIFIED
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS, RIVENDELL, BREE, LORIEN,
  buildTestState, resetMint,
  addCardInPlay,
  movementDestinationDefIds,
  viableActions,
  makeMHState,
  Phase,
} from '../test-helpers.js';
import { Alignment } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

const HEART_GROWN_COLD = 'wh-21' as CardDefinitionId;

const ETTENMOORS = 'le-373' as CardDefinitionId;          // minion R&L, Rhudaur — the FW origin
const MINION_RIVENDELL = 'as-160' as CardDefinitionId;    // minion free-hold (hero tw-421 is a Haven)
const BAG_END = 'tw-372' as CardDefinitionId;             // hero free-hold, The Shire
const MINION_BAG_END = 'le-350' as CardDefinitionId;      // minion free-hold
const MINION_BREE = 'le-356' as CardDefinitionId;         // minion border-hold (hero tw-378)
const WHITE_TOWERS = 'wh-58' as CardDefinitionId;         // fallen-wizard Wizardhaven (haven)

describe('Heart Grown Cold (wh-21)', () => {
  beforeEach(() => resetMint());

  // ---- Baseline: without the hazard the Fallen-wizard uses whatever he holds ----

  test('without the hazard, a Fallen-wizard may use the hero Haven card', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ETTENMOORS, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });

    expect(movementDestinationDefIds(state, PLAYER_1, RESOURCE_PLAYER)).toContain(RIVENDELL);
  });

  // ---- Rule 1: hero Havens always require the minion card ----

  test('with the hazard in play, the hero Haven card is unusable', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ETTENMOORS, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const state = addCardInPlay(base, HAZARD_PLAYER, HEART_GROWN_COLD);

    // No minion Rivendell in the location deck — the site becomes unreachable.
    expect(movementDestinationDefIds(state, PLAYER_1, RESOURCE_PLAYER)).not.toContain(RIVENDELL);
  });

  test('when the deck holds both versions of a Haven, the minion card is the one used', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ETTENMOORS, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINION_RIVENDELL, RIVENDELL],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const state = addCardInPlay(base, HAZARD_PLAYER, HEART_GROWN_COLD);

    const destinations = movementDestinationDefIds(state, PLAYER_1, RESOURCE_PLAYER);
    expect(destinations).toContain(MINION_RIVENDELL);
    expect(destinations).not.toContain(RIVENDELL);
  });

  test('the Haven lock does not reach Free-holds or Border-holds at low stage points', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          stagePoints: 4,
          companies: [{ site: ETTENMOORS, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [RIVENDELL, BAG_END, BREE],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const state = addCardInPlay(base, HAZARD_PLAYER, HEART_GROWN_COLD);

    const destinations = movementDestinationDefIds(state, PLAYER_1, RESOURCE_PLAYER);
    expect(destinations).not.toContain(RIVENDELL);  // haven — locked from the start
    expect(destinations).toContain(BAG_END);        // free-hold — needs more than 4 stage points
    expect(destinations).toContain(BREE);           // border-hold — needs more than 7
  });

  test('a Wizardhaven is both a hero and a minion site — never locked', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          stagePoints: 9,
          companies: [{ site: ETTENMOORS, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [WHITE_TOWERS],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const state = addCardInPlay(base, HAZARD_PLAYER, HEART_GROWN_COLD);

    // The White Towers is a fallen-wizard Haven, so even at 9 stage points
    // (every clause active) it stays usable.
    expect(movementDestinationDefIds(state, PLAYER_1, RESOURCE_PLAYER)).toContain(WHITE_TOWERS);
  });

  test('a non-Fallen-wizard player is unaffected — a Wizard still uses hero Havens', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: BREE, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const state = addCardInPlay(base, HAZARD_PLAYER, HEART_GROWN_COLD);

    expect(movementDestinationDefIds(state, PLAYER_1, RESOURCE_PLAYER)).toContain(RIVENDELL);
  });

  // ---- Rule 2: more than 4 stage points also locks Free-holds ----

  test('at 4 stage points a hero Free-hold is still usable; at 5 the minion card takes over', () => {
    const atFour = addCardInPlay(buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          stagePoints: 4,
          companies: [{ site: ETTENMOORS, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINION_BAG_END, BAG_END],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    }), HAZARD_PLAYER, HEART_GROWN_COLD);

    expect(movementDestinationDefIds(atFour, PLAYER_1, RESOURCE_PLAYER)).toContain(BAG_END);

    const atFive = addCardInPlay(buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          stagePoints: 5,
          companies: [{ site: ETTENMOORS, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINION_BAG_END, BAG_END],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    }), HAZARD_PLAYER, HEART_GROWN_COLD);

    const destinations = movementDestinationDefIds(atFive, PLAYER_1, RESOURCE_PLAYER);
    expect(destinations).toContain(MINION_BAG_END);
    expect(destinations).not.toContain(BAG_END);
  });

  // ---- Rule 3: more than 7 stage points also locks Border-holds ----

  test('at 7 stage points a hero Border-hold is still usable; at 8 the minion card takes over', () => {
    const atSeven = addCardInPlay(buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          stagePoints: 7,
          companies: [{ site: ETTENMOORS, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINION_BREE, BREE],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    }), HAZARD_PLAYER, HEART_GROWN_COLD);

    expect(movementDestinationDefIds(atSeven, PLAYER_1, RESOURCE_PLAYER)).toContain(BREE);

    const atEight = addCardInPlay(buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          stagePoints: 8,
          companies: [{ site: ETTENMOORS, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINION_BREE, BREE],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    }), HAZARD_PLAYER, HEART_GROWN_COLD);

    const destinations = movementDestinationDefIds(atEight, PLAYER_1, RESOURCE_PLAYER);
    expect(destinations).toContain(MINION_BREE);
    expect(destinations).not.toContain(BREE);
  });

  // ---- The card itself reaches play as an ordinary permanent hazard ----

  test('is playable as a hazard during the movement/hazard phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ETTENMOORS, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [HEART_GROWN_COLD],
          siteDeck: [BREE],
        },
      ],
    });
    const ready = { ...state, phaseState: makeMHState({ hazardsPlayedThisCompany: 0, hazardLimitAtReveal: 4 }) };

    expect(viableActions(ready, PLAYER_2, 'play-hazard').length).toBeGreaterThan(0);
  });
});
