/**
 * @module td-65.test
 *
 * Card test: Scorba at Home (td-65)
 * Type: hazard-event (permanent), keyword `dragon-manifestation`, manifestId td-63
 *
 * Text:
 *   "Unique. Unless Scorba Ahunt is in play, Zarak Dûm has an additional
 *    automatic-attack: Dragon — 3 strikes at 13/8. In addition, each major
 *    item gives an additional corruption point."
 *
 * Effects:
 * | # | Effect Type             | Status | Notes                                                        |
 * |---|-------------------------|--------|--------------------------------------------------------------|
 * | 1 | dragon-at-home          | OK     | +Dragon (3 strikes, 13 prow) on Zarak Dûm (hero td-181 and   |
 * |   |                         |        | minion le-417, both lairOf td-63); suppressed by Scorba Ahunt |
 * | 2 | in-play-item-modifier   | OK     | +1 corruption point to every major item (both players);      |
 * |   |                         |        | itemFilter { item.subtype: "major" }, no MP delta            |
 *
 * The augment attack's printed "/8" body follows the codebase convention for
 * Dragon lair auto-attacks: every printed Dragon-lair automatic-attack
 * (including Zarak Dûm's own) is modeled with strikes+prowess only, so the
 * augment is likewise modeled as {Dragon, 3 strikes, 13 prowess}.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  LORIEN, RIVENDELL, MINAS_TIRITH,
  buildTestState, resetMint,
  addCardInPlay, attachItemToChar, charIdAt,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { getActiveAutoAttacks } from '../../engine/manifestations.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import { Phase, Alignment } from '../../index.js';
import type { CardDefinitionId, SiteCard } from '../../index.js';

const SCORBA_AT_HOME = 'td-65' as CardDefinitionId;
const SCORBA_AHUNT = 'td-64' as CardDefinitionId;
const ZARAK_DUM_HERO = 'td-181' as CardDefinitionId;   // Scorba's lair (lairOf td-63), hero version
const ZARAK_DUM_MINION = 'le-417' as CardDefinitionId; // Scorba's lair (lairOf td-63), minion version
const LONELY_MOUNTAIN = 'tw-428' as CardDefinitionId;  // a different Dragon's lair
const GLAMDRING = 'tw-244' as CardDefinitionId;        // hero major item, cp 1 / 2 MP
const HAUBERK = 'tw-254' as CardDefinitionId;          // hero major item, cp 1 / 2 MP
const STING = 'tw-333' as CardDefinitionId;            // hero minor item, cp 1

describe('Scorba at Home (td-65)', () => {
  beforeEach(() => resetMint());

  // ─── dragon-at-home augmentation ──────────────────────────────────────────

  test('Zarak Dûm has only its printed Dragon attack when no At-Home is in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const zarakDum = state.cardPool[ZARAK_DUM_HERO] as SiteCard;
    const attacks = getActiveAutoAttacks(state, zarakDum);
    expect(attacks).toHaveLength(1);
    expect(attacks[0]).toMatchObject({ creatureType: 'Dragon', strikes: 1, prowess: 11 });
  });

  test('At-Home in play appends the extra Dragon (3 strikes, 13 prowess) to hero Zarak Dûm', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = addCardInPlay(base, HAZARD_PLAYER, SCORBA_AT_HOME);
    const zarakDum = state.cardPool[ZARAK_DUM_HERO] as SiteCard;
    const attacks = getActiveAutoAttacks(state, zarakDum);
    expect(attacks).toHaveLength(2);
    expect(attacks[0]).toMatchObject({ creatureType: 'Dragon', strikes: 1, prowess: 11 });
    expect(attacks[1]).toMatchObject({ creatureType: 'Dragon', strikes: 3, prowess: 13 });
  });

  test('At-Home also augments the minion version of Zarak Dûm (le-417)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = addCardInPlay(base, HAZARD_PLAYER, SCORBA_AT_HOME);
    const zarakDumMinion = state.cardPool[ZARAK_DUM_MINION] as SiteCard;
    const attacks = getActiveAutoAttacks(state, zarakDumMinion);
    expect(attacks).toHaveLength(2);
    expect(attacks[1]).toMatchObject({ creatureType: 'Dragon', strikes: 3, prowess: 13 });
  });

  test('Scorba Ahunt in play suppresses the At-Home augmentation', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = addCardInPlay(addCardInPlay(base, HAZARD_PLAYER, SCORBA_AT_HOME), HAZARD_PLAYER, SCORBA_AHUNT);
    const zarakDum = state.cardPool[ZARAK_DUM_HERO] as SiteCard;
    expect(getActiveAutoAttacks(state, zarakDum)).toHaveLength(1);
    const zarakDumMinion = state.cardPool[ZARAK_DUM_MINION] as SiteCard;
    expect(getActiveAutoAttacks(state, zarakDumMinion)).toHaveLength(1);
  });

  test("At-Home augments only Scorba's lair, not a different Dragon's lair", () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = addCardInPlay(base, HAZARD_PLAYER, SCORBA_AT_HOME);
    const lonely = state.cardPool[LONELY_MOUNTAIN] as SiteCard;
    // The Lonely Mountain belongs to a different Dragon → unaffected by Scorba at Home.
    expect(getActiveAutoAttacks(state, lonely)).toHaveLength(1);
  });

  // ─── in-play-item-modifier: +1 corruption to major items ──────────────────

  test('major item bearer gains +1 corruption point while At-Home is in play', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const aragornId = charIdAt(base, RESOURCE_PLAYER);

    // Glamdring (major, cp 1) on Aragorn, no At-Home: printed corruption 1.
    const withItem = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, GLAMDRING));
    expect(withItem.players[RESOURCE_PLAYER].characters[aragornId].effectiveStats.corruptionPoints).toBe(1);

    // Add Scorba at Home: the major item now gives 2 corruption points.
    const withAtHome = recomputeDerived(addCardInPlay(withItem, HAZARD_PLAYER, SCORBA_AT_HOME));
    expect(withAtHome.players[RESOURCE_PLAYER].characters[aragornId].effectiveStats.corruptionPoints).toBe(2);
  });

  test('minor item is unaffected (filter matches only major items)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const aragornId = charIdAt(base, RESOURCE_PLAYER);

    // Sting (minor, cp 1) on Aragorn: corruption 1 with or without At-Home.
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, STING);
    const withAtHome = recomputeDerived(addCardInPlay(withItem, HAZARD_PLAYER, SCORBA_AT_HOME));
    expect(withAtHome.players[RESOURCE_PLAYER].characters[aragornId].effectiveStats.corruptionPoints).toBe(1);
  });

  test('the extra corruption reaches major items of both players ("each major item")', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const legolasId = charIdAt(base, HAZARD_PLAYER);

    // Hauberk of Bright Mail (major, cp 1) on the hazard player's own Legolas:
    // the At-Home the hazard player controls also raises their item's corruption.
    const withItem = recomputeDerived(attachItemToChar(base, HAZARD_PLAYER, LEGOLAS, HAUBERK));
    expect(withItem.players[HAZARD_PLAYER].characters[legolasId].effectiveStats.corruptionPoints).toBe(1);

    const withAtHome = recomputeDerived(addCardInPlay(withItem, HAZARD_PLAYER, SCORBA_AT_HOME));
    expect(withAtHome.players[HAZARD_PLAYER].characters[legolasId].effectiveStats.corruptionPoints).toBe(2);
  });

  test('major item marshalling points are unchanged (corruption only, no MP delta)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Glamdring: 2 item MP printed — Scorba at Home must not change the tally.
    const withItem = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, GLAMDRING));
    expect(withItem.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(2);

    const withAtHome = recomputeDerived(addCardInPlay(withItem, HAZARD_PLAYER, SCORBA_AT_HOME));
    expect(withAtHome.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(2);
  });
});
