/**
 * @module rule-3.42-fw-site-usage
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.42: Fallen-Wizard Site Usage
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [FALLEN-WIZARD] A Fallen-wizard player's companies may use either the hero or minion version of a Ruins & Lairs site (including Isengard and The White Towers); otherwise a Fallen-Wizard player's covert companies can only use hero sites, whereas a Fallen-wizard player's overt companies can only use minion sites for Border-holds, Free-holds, and/or sites that are normally Havens for Wizard players AND can only use hero sites for Shadow-holds, Dark-holds, and/or sites that are normally Darkhavens for Ringwraith players.
 * [FALLEN-WIZARD] If a Fallen-wizard player has a site card in play or in their discard pile, that player cannot use a different alignment of that site from their location deck.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { CardDefinitionId, GameState } from '../../../index.js';
import {
  buildTestState, resetMint, addCardInPlay, movementDestinationDefIds,
  Phase, Alignment,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS, LORIEN,
} from '../../test-helpers.js';

// The Fallen-wizard's origin: minion Ettenmoors, a Ruins & Lairs in Rhudaur.
// Every destination below is within region movement of it (a Fallen-wizard may
// only use region movement, MEWH §7): Rivendell (Rhudaur), Bree / The White
// Towers (Arthedain), Carn Dûm / Mount Gram (Angmar), Bag End (The Shire).
const ETTENMOORS = 'le-373' as CardDefinitionId;

// Each location below is printed once per alignment; the pair is what the rule
// makes the player choose between.
const HERO_RIVENDELL = 'tw-421' as CardDefinitionId;      // haven — a Wizard Haven
const MINION_RIVENDELL = 'as-160' as CardDefinitionId;    // free-hold
const HERO_BAG_END = 'tw-372' as CardDefinitionId;        // free-hold
const MINION_BAG_END = 'le-350' as CardDefinitionId;      // free-hold
const HERO_BREE = 'tw-378' as CardDefinitionId;           // border-hold
const MINION_BREE = 'le-356' as CardDefinitionId;         // border-hold
const HERO_CARN_DUM = 'tw-380' as CardDefinitionId;       // dark-hold
const MINION_CARN_DUM = 'le-359' as CardDefinitionId;     // haven — a Ringwraith Darkhaven
const HERO_MOUNT_GRAM = 'tw-415' as CardDefinitionId;     // shadow-hold
const MINION_MOUNT_GRAM = 'le-394' as CardDefinitionId;   // shadow-hold
const HERO_WHITE_TOWERS = 'tw-430' as CardDefinitionId;   // ruins-and-lairs
const MINION_WHITE_TOWERS = 'le-412' as CardDefinitionId; // ruins-and-lairs
const FW_WHITE_TOWERS = 'wh-58' as CardDefinitionId;      // fallen-wizard Wizardhaven

// Orc Captain (le-31): an Orc, so any company holding him is overt (MELE §2).
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;
// Heart Grown Cold (wh-21): "Fallen-wizard players must use minion site cards
// for hero Havens" — a card that dictates the version of a location directly.
const HEART_GROWN_COLD = 'wh-21' as CardDefinitionId;

/**
 * A Fallen-wizard at the minion Ettenmoors whose single company is covert (led
 * by the Man Aragorn) or overt (holding an Orc), with `siteDeck` as the
 * locations he may travel to. `siteDiscardPile` seeds locations he has already
 * used, for rule 2.II.7.F2.
 */
function fwState(
  overt: boolean,
  siteDeck: CardDefinitionId[],
  siteDiscardPile: CardDefinitionId[] = [],
): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.FallenWizard,
        companies: [{ site: ETTENMOORS, characters: overt ? [ARAGORN, ORC_CAPTAIN] : [ARAGORN] }],
        hand: [],
        siteDeck,
        siteDiscardPile,
      },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
    ],
  });
}

describe('Rule 3.42 — Fallen-Wizard Site Usage', () => {
  beforeEach(() => resetMint());

  // ---- Covert companies: hero sites only ----

  test('[FALLEN-WIZARD] a covert company may use the hero card of a Free-hold', () => {
    expect(movementDestinationDefIds(fwState(false, [HERO_BAG_END]), PLAYER_1, RESOURCE_PLAYER))
      .toContain(HERO_BAG_END);
  });

  test('[FALLEN-WIZARD] a covert company may not use the minion card of a Free-hold', () => {
    expect(movementDestinationDefIds(fwState(false, [MINION_BAG_END]), PLAYER_1, RESOURCE_PLAYER))
      .not.toContain(MINION_BAG_END);
  });

  test('[FALLEN-WIZARD] a covert company may use the hero card of a Wizard Haven', () => {
    expect(movementDestinationDefIds(fwState(false, [HERO_RIVENDELL]), PLAYER_1, RESOURCE_PLAYER))
      .toContain(HERO_RIVENDELL);
  });

  test('[FALLEN-WIZARD] a covert company may use the hero card of a Shadow-hold, not the minion card', () => {
    expect(movementDestinationDefIds(fwState(false, [HERO_MOUNT_GRAM]), PLAYER_1, RESOURCE_PLAYER))
      .toContain(HERO_MOUNT_GRAM);
    expect(movementDestinationDefIds(fwState(false, [MINION_MOUNT_GRAM]), PLAYER_1, RESOURCE_PLAYER))
      .not.toContain(MINION_MOUNT_GRAM);
  });

  // ---- Overt companies: minion for Border-holds / Free-holds / Wizard Havens ----

  test('[FALLEN-WIZARD] an overt company must use the minion card of a Free-hold', () => {
    expect(movementDestinationDefIds(fwState(true, [MINION_BAG_END]), PLAYER_1, RESOURCE_PLAYER))
      .toContain(MINION_BAG_END);
    expect(movementDestinationDefIds(fwState(true, [HERO_BAG_END]), PLAYER_1, RESOURCE_PLAYER))
      .not.toContain(HERO_BAG_END);
  });

  test('[FALLEN-WIZARD] an overt company must use the minion card of a Border-hold', () => {
    expect(movementDestinationDefIds(fwState(true, [MINION_BREE]), PLAYER_1, RESOURCE_PLAYER))
      .toContain(MINION_BREE);
    expect(movementDestinationDefIds(fwState(true, [HERO_BREE]), PLAYER_1, RESOURCE_PLAYER))
      .not.toContain(HERO_BREE);
  });

  test('[FALLEN-WIZARD] an overt company uses the minion card of a Wizard Haven — a Free-hold, never the Haven', () => {
    // Rivendell is a Haven for a Wizard; the minion card of the same place is
    // an ordinary Free-hold, and that is the one an overt company travels to.
    expect(movementDestinationDefIds(fwState(true, [MINION_RIVENDELL]), PLAYER_1, RESOURCE_PLAYER))
      .toContain(MINION_RIVENDELL);
    expect(movementDestinationDefIds(fwState(true, [HERO_RIVENDELL]), PLAYER_1, RESOURCE_PLAYER))
      .not.toContain(HERO_RIVENDELL);
  });

  // ---- Overt companies: hero for Shadow-holds / Dark-holds / Darkhavens ----

  test('[FALLEN-WIZARD] an overt company must use the hero card of a Shadow-hold', () => {
    expect(movementDestinationDefIds(fwState(true, [HERO_MOUNT_GRAM]), PLAYER_1, RESOURCE_PLAYER))
      .toContain(HERO_MOUNT_GRAM);
    expect(movementDestinationDefIds(fwState(true, [MINION_MOUNT_GRAM]), PLAYER_1, RESOURCE_PLAYER))
      .not.toContain(MINION_MOUNT_GRAM);
  });

  test('[FALLEN-WIZARD] an overt company uses the hero card of a Ringwraith Darkhaven — a Dark-hold, never the Darkhaven', () => {
    // Carn Dûm is a Darkhaven for a Ringwraith; the hero card of the same place
    // is a Dark-hold, and that is the one an overt company travels to.
    expect(movementDestinationDefIds(fwState(true, [HERO_CARN_DUM]), PLAYER_1, RESOURCE_PLAYER))
      .toContain(HERO_CARN_DUM);
    expect(movementDestinationDefIds(fwState(true, [MINION_CARN_DUM]), PLAYER_1, RESOURCE_PLAYER))
      .not.toContain(MINION_CARN_DUM);
  });

  test('[FALLEN-WIZARD] a covert company may not use a Ringwraith Darkhaven either', () => {
    expect(movementDestinationDefIds(fwState(false, [MINION_CARN_DUM]), PLAYER_1, RESOURCE_PLAYER))
      .not.toContain(MINION_CARN_DUM);
  });

  // ---- Ruins & Lairs: either version, either company ----

  test('[FALLEN-WIZARD] either version of a Ruins & Lairs is usable by a covert company', () => {
    expect(movementDestinationDefIds(fwState(false, [HERO_WHITE_TOWERS]), PLAYER_1, RESOURCE_PLAYER))
      .toContain(HERO_WHITE_TOWERS);
    expect(movementDestinationDefIds(fwState(false, [MINION_WHITE_TOWERS]), PLAYER_1, RESOURCE_PLAYER))
      .toContain(MINION_WHITE_TOWERS);
  });

  test('[FALLEN-WIZARD] either version of a Ruins & Lairs is usable by an overt company', () => {
    expect(movementDestinationDefIds(fwState(true, [HERO_WHITE_TOWERS]), PLAYER_1, RESOURCE_PLAYER))
      .toContain(HERO_WHITE_TOWERS);
    expect(movementDestinationDefIds(fwState(true, [MINION_WHITE_TOWERS]), PLAYER_1, RESOURCE_PLAYER))
      .toContain(MINION_WHITE_TOWERS);
  });

  test('[FALLEN-WIZARD] a Wizardhaven counts as both alignments and stays usable by an overt company', () => {
    // The White Towers as a Wizardhaven is a `haven`, which no hero or minion
    // card of that type would be for an overt company — but MEWH §10 makes a
    // Fallen-wizard site both alignments at once, so the rule never bites.
    expect(movementDestinationDefIds(fwState(true, [FW_WHITE_TOWERS]), PLAYER_1, RESOURCE_PLAYER))
      .toContain(FW_WHITE_TOWERS);
  });

  // ---- 2.II.7.F2: committed to the version already used ----

  test('[FALLEN-WIZARD] a location already used in the other alignment is unusable, even as a Ruins & Lairs', () => {
    // Ruins & Lairs is exempt from the covert/overt rule, so the only thing
    // that can bar the minion card here is the hero card in the discard pile.
    expect(movementDestinationDefIds(fwState(false, [MINION_WHITE_TOWERS]), PLAYER_1, RESOURCE_PLAYER))
      .toContain(MINION_WHITE_TOWERS);
    expect(movementDestinationDefIds(fwState(false, [MINION_WHITE_TOWERS], [HERO_WHITE_TOWERS]), PLAYER_1, RESOURCE_PLAYER))
      .not.toContain(MINION_WHITE_TOWERS);
  });

  test('[FALLEN-WIZARD] the version already in the discard pile stays usable from the location deck', () => {
    expect(movementDestinationDefIds(fwState(false, [HERO_WHITE_TOWERS], [HERO_WHITE_TOWERS]), PLAYER_1, RESOURCE_PLAYER))
      .toContain(HERO_WHITE_TOWERS);
  });

  test('[FALLEN-WIZARD] a location another company stands on commits the player to that version', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [
            { site: ETTENMOORS, characters: [ARAGORN] },
            { site: HERO_WHITE_TOWERS, characters: [LEGOLAS] },
          ],
          hand: [],
          siteDeck: [MINION_WHITE_TOWERS],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [] },
      ],
    });

    expect(movementDestinationDefIds(state, PLAYER_1, RESOURCE_PLAYER))
      .not.toContain(MINION_WHITE_TOWERS);
  });

  // ---- Scope ----

  test('a non-Fallen-wizard player is unaffected by the covert/overt site rule', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: ETTENMOORS, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINION_BAG_END],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });

    expect(movementDestinationDefIds(state, PLAYER_1, RESOURCE_PLAYER)).toContain(MINION_BAG_END);
  });

  test('[FALLEN-WIZARD] a card dictating the version of a location overrides the covert/overt rule', () => {
    // Heart Grown Cold forces the minion card for hero Havens. A covert company
    // could not otherwise use minion Rivendell (a Free-hold) at all; the card
    // effect wins over the rule it contradicts (CoE 10.28).
    const state = addCardInPlay(fwState(false, [MINION_RIVENDELL]), HAZARD_PLAYER, HEART_GROWN_COLD);

    expect(movementDestinationDefIds(state, PLAYER_1, RESOURCE_PLAYER)).toContain(MINION_RIVENDELL);
  });
});
