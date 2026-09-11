/**
 * @module td-112.test
 *
 * Card test: Emerald of Doriath (td-112)
 * Type: hero-resource-item (minor), alignment wizard, unique.
 * Marshalling Points: 0. Corruption Points: 1.
 *
 * Text: "Unique. Hoard item. +1 to direct influence against Elves and Elf
 *  factions. If bearer is a Wizard, your general influence is increased by
 *  two."
 *
 * | # | Rule                                              | Mechanism                                                    |
 * |---|-----------------------------------------------------|---------------------------------------------------------------|
 * | 1 | Hoard item — playable only at a hoard site           | item-play-site filter site.keywords $includes hoard            |
 * | 2 | +1 direct influence against Elf characters           | stat-modifier direct-influence, reason influence-check, target.race elf |
 * | 3 | +1 direct influence against Elf factions             | stat-modifier direct-influence, reason faction-influence-check, faction.race elf |
 * | 4 | +2 general influence if bearer is a Wizard           | stat-modifier general-influence, when bearer.race wizard        |
 * | 5 | Item is a source of 1 corruption point               | corruptionPoints: 1 (base data field)                          |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GANDALF,
  THRANDUILS_HALLS, RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  WOOD_ELVES,
  buildSitePhaseState, buildTestState, resetMint,
  findCharInstanceId, viablePlayCharacterActions, RESOURCE_PLAYER,
  attachItemToChar, charIdAt, viableActions,
} from '../test-helpers.js';
import { computeLegalActions, Phase } from '../../index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import type { CardDefinitionId, InfluenceAttemptAction } from '../../index.js';

const EMERALD_OF_DORIATH = 'td-112' as CardDefinitionId;
// Elladan: elf, mind 4, DI 0 — a local constant since it's only used here
const ELLADAN = 'tw-143' as CardDefinitionId;
// Irerock: hero ruins-and-lairs, hoard keyword (a Dragon's lair)
const IREROCK = 'tw-402' as CardDefinitionId;

describe('Emerald of Doriath (td-112)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: item-play-site (hoard sites only) ──

  test('playable at a hoard site (Irerock)', () => {
    const state = buildSitePhaseState({ site: IREROCK, hand: [EMERALD_OF_DORIATH] });

    expect(viableActions(state, PLAYER_1, 'play-hero-resource').length).toBe(1);
  });

  test('NOT playable at a non-hoard site (Rivendell)', () => {
    const state = buildSitePhaseState({ site: RIVENDELL, hand: [EMERALD_OF_DORIATH] });

    expect(viableActions(state, PLAYER_1, 'play-hero-resource').length).toBe(0);
  });

  // ── Effect 3: +1 DI vs Elf faction (faction-influence-check) ──

  test('+1 DI bonus applies during faction influence check against an Elf faction', () => {
    // Aragorn (dunadan, base DI 3) with the Emerald at Thranduil's Halls.
    // Wood-elves: race "elf", influenceNumber 9, no check-modifier for Dúnadan.
    // With the Emerald: need = 9 - (3 + 1) = 5.
    const state = buildSitePhaseState({
      characters: [{ defId: ARAGORN, items: [EMERALD_OF_DORIATH] }],
      site: THRANDUILS_HALLS,
      hand: [WOOD_ELVES],
    });

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const attempt = influenceActions.find(a => a.influencingCharacterId === aragornId);
    expect(attempt).toBeDefined();
    // influenceNumber(9) - baseDI(3) - emeraldDIBonus(1) = 5
    expect(attempt!.need).toBe(5);
  });

  test('no DI bonus vs Elf faction without the Emerald', () => {
    // Without the Emerald: need = 9 - 3 = 6.
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: THRANDUILS_HALLS,
      hand: [WOOD_ELVES],
    });

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const attempt = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction)
      .find(a => a.influencingCharacterId === aragornId);

    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(6);
  });

  // ── Effect 2: +1 DI vs Elf character (influence-check) ──

  test('+1 DI bonus enables controlling Elf character Elladan (elf, mind 4)', () => {
    // Aragorn (DI 3) with the Emerald: effective DI vs Elf = 4 >= Elladan mind 4.
    // Elladan should be playable as follower under Aragorn.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [EMERALD_OF_DORIATH] }] }],
          hand: [ELLADAN],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const actions = viablePlayCharacterActions(state, PLAYER_1);
    const elladanUnderAragorn = actions.filter(a => a.controlledBy === aragornId);
    expect(elladanUnderAragorn.length).toBeGreaterThanOrEqual(1);
  });

  test('without the Emerald Aragorn (DI 3) cannot control Elladan (elf, mind 4)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [ELLADAN],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const actions = viablePlayCharacterActions(state, PLAYER_1);
    expect(actions.filter(a => a.controlledBy === aragornId)).toHaveLength(0);
  });

  // ── Effect 4: +2 general influence if bearer is a Wizard ──

  test('bearer Gandalf (wizard) grants +2 general influence', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    expect(base.players[RESOURCE_PLAYER].generalInfluenceBonus).toBe(0);

    const withItem = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, GANDALF, EMERALD_OF_DORIATH));
    expect(withItem.players[RESOURCE_PLAYER].generalInfluenceBonus).toBe(2);
  });

  test('non-Wizard bearer Aragorn grants no general-influence bonus', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withItem = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, EMERALD_OF_DORIATH));
    expect(withItem.players[RESOURCE_PLAYER].generalInfluenceBonus).toBe(0);
  });

  // ── Printed corruption points (1, per the card database) ──

  test('bearer gains 1 corruption point from carrying the Emerald', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const aragornId = charIdAt(base, RESOURCE_PLAYER);
    expect(base.players[RESOURCE_PLAYER].characters[aragornId].effectiveStats.corruptionPoints).toBe(0);

    const withItem = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, EMERALD_OF_DORIATH));
    expect(withItem.players[RESOURCE_PLAYER].characters[aragornId].effectiveStats.corruptionPoints).toBe(1);
  });
});
