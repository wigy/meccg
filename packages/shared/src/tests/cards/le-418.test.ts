/**
 * @module le-418.test
 *
 * Card test: The Arkenstone (le-418)
 * Type: minion-resource-item (greater, hoard, unique, ringwraith)
 * Corruption: 3 · MP: 3
 *
 * Text: "Unique. +5 to bearer's direct influence against Dwarves and Dwarf
 * factions. Each Dwarf in play has +1 mind. If the bearer of this item is
 * at the same site as a Dwarf character, you may discard this item to force
 * the discard of the Dwarf (and all non-follower cards he controls)."
 *
 * Effects:
 * | # | Effect Type               | Status | Notes                                                              |
 * |---|---------------------------|--------|--------------------------------------------------------------------|
 * | 1 | item-play-site (hoard)    | OK     | playable only at hoard-keyword sites                               |
 * | 2 | stat-modifier +5 DI       | OK     | fires on influence-check when target.race=dwarf or faction.race=dwarf |
 * | 3 | stat-modifier +1 mind     | OK     | target all-characters, when bearer.race=dwarf; global from items   |
 * | 4 | grant-action discard-dwarf| OK     | force-discard-dwarf-at-site; org-phase; one action per Dwarf at site |
 *
 * Playable: YES
 *
 * Fixture alignment: minion-resource-item (ringwraith). Tests use minion
 * characters (LE) as bearers per project convention. Hero Dwarves (TW) are
 * used as targets because The Arkenstone's powers specifically act on Dwarves.
 * For the faction-influence-check test a hero character at a hero site is
 * used to verify the DI modifier mechanics (same resolver path).
 * The +5 DI against Dwarf characters is verified via availableDI() directly
 * since Gimli is a hero character and cannot be a follower of a minion.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  pool, buildTestState, buildSitePhaseState, buildMinionSitePhaseState, resetMint,
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LORIEN, MINAS_TIRITH,
  viableActions, dispatch,
  findCharInstanceId, getCharacter, findHandCardId,
  expectCharItemCount, expectInDiscardPile,
  attachItemToChar, recomputeDerived,
} from '../test-helpers.js';
import { Alignment, Phase, computeLegalActions } from '../../index.js';
import type {
  ActivateGrantedAction, CardDefinitionId, CharacterCard, InfluenceAttemptAction, PlayHeroResourceAction,
} from '../../index.js';
import { availableDI } from '../../engine/legal-actions/organization.js';

const THE_ARKENSTONE = 'le-418' as CardDefinitionId;

// Minion (ringwraith) characters for bearer
const THE_MOUTH = 'le-24' as CardDefinitionId;    // man, mind 9, DI 4

// Hero Dwarf characters as targets (TW set)
const GIMLI = 'tw-159' as CardDefinitionId;         // dwarf, mind 6, DI 2
const BALIN = 'tw-123' as CardDefinitionId;          // dwarf, mind 5, DI 2
const KILI = 'tw-167' as CardDefinitionId;           // dwarf, mind 3, DI 0

// Non-Dwarf hero character for contrast
const LEGOLAS = 'tw-180' as CardDefinitionId;        // elf

// Dwarf faction for faction-influence test
const BLUE_MOUNTAIN_DWARVES = 'tw-200' as CardDefinitionId; // dwarf, influenceNumber 10

// Sites
const LONELY_MOUNTAIN_MINION = 'le-387' as CardDefinitionId; // "The Lonely Mountain" (minion)
const LONELY_MOUNTAIN_HERO = 'tw-428' as CardDefinitionId;   // "The Lonely Mountain" (hero, hoard)
const BLUE_MOUNTAIN_DWARF_HOLD = 'tw-377' as CardDefinitionId; // hero site for Dwarf faction

// Other minion sites for non-co-location tests
const MORIA_MINION = 'le-392' as CardDefinitionId;

// A minion Ruins & Lairs with no Dragon's lair (no hoard).
const THE_PUKEL_DEEPS = 'as-158' as CardDefinitionId;

describe('The Arkenstone (le-418)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: item-play-site (hoard) ──────────────────────────────────────

  test('playable at a minion Dragon-lair site (le-387), a hoard site', () => {
    // Regression test: le-387 "The Lonely Mountain" (minion/ringwraith side)
    // has a permanent Dragon automatic-attack and must carry the `hoard`
    // keyword, same as every other Dragon's-lair Ruins & Lairs, so The
    // Arkenstone (a greater hoard item) is playable there.
    const state = buildMinionSitePhaseState({
      site: LONELY_MOUNTAIN_MINION,
      characters: [THE_MOUTH],
      hand: [THE_ARKENSTONE],
    });
    const handInst = findHandCardId(state, RESOURCE_PLAYER, THE_ARKENSTONE);
    const mouthId = findCharInstanceId(state, RESOURCE_PLAYER, THE_MOUTH);

    const plays = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-hero-resource')
      .map(ea => ea.action as PlayHeroResourceAction);

    expect(plays.some(a => a.cardInstanceId === handInst && a.attachToCharacterId === mouthId)).toBe(true);
  });

  test('NOT playable at a minion Ruins & Lairs without a hoard', () => {
    const state = buildMinionSitePhaseState({
      site: THE_PUKEL_DEEPS,
      characters: [THE_MOUTH],
      hand: [THE_ARKENSTONE],
    });

    const plays = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-hero-resource')
      .map(ea => ea.action as PlayHeroResourceAction);

    expect(plays).toHaveLength(0);
  });

  // ── Effect 2: +5 DI against Dwarf characters (influence-check) ───────────

  test('+5 DI bonus: availableDI returns 9 (base 4 + 5) when targeting Gimli (dwarf)', () => {
    // Gimli is a hero character and cannot be a follower of a minion, so the
    // DI modifier is verified via availableDI() directly (same pattern as dm-11).
    // The Mouth base DI 4 + Arkenstone +5 vs dwarves = 9.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: LONELY_MOUNTAIN_MINION, characters: [THE_MOUTH] }],
          hand: [],
          siteDeck: [MORIA_MINION],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LONELY_MOUNTAIN_HERO, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const state = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, THE_MOUTH, THE_ARKENSTONE));
    const mouthId = findCharInstanceId(state, RESOURCE_PLAYER, THE_MOUTH);
    const gimliDef = pool[GIMLI as string] as CharacterCard;

    expect(availableDI(state, mouthId, state.players[RESOURCE_PLAYER], gimliDef)).toBe(9);
  });

  test('+5 DI NOT applied without Arkenstone: availableDI returns 4 (base only) vs Gimli', () => {
    // Without the Arkenstone no conditional DI bonus fires → base DI 4 only.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: LONELY_MOUNTAIN_MINION, characters: [THE_MOUTH] }],
          hand: [],
          siteDeck: [MORIA_MINION],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LONELY_MOUNTAIN_HERO, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const mouthId = findCharInstanceId(state, RESOURCE_PLAYER, THE_MOUTH);
    const gimliDef = pool[GIMLI as string] as CharacterCard;

    expect(availableDI(state, mouthId, state.players[RESOURCE_PLAYER], gimliDef)).toBe(4);
  });

  // ── Effect 2: +5 DI against Dwarf factions (faction-influence-check) ─────

  test('+5 DI reduces need against Dwarf faction Blue Mountain Dwarves (influenceNumber 10)', () => {
    // Aragorn (dunadan, DI 3) with Arkenstone at Blue Mountain Dwarf-hold.
    // Blue Mountain Dwarves: influenceNumber 10, +2 for dwarves (Aragorn is not dwarf).
    // Without Arkenstone: need = 10 - 3 = 7. With Arkenstone: need = 10 - (3+5) = 2.
    const base = buildSitePhaseState({
      characters: [ARAGORN],
      site: BLUE_MOUNTAIN_DWARF_HOLD,
      hand: [BLUE_MOUNTAIN_DWARVES],
    });
    const state = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, THE_ARKENSTONE);

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const influenceAttempts = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const attempt = influenceAttempts.find(a => a.influencingCharacterId === aragornId);
    expect(attempt).toBeDefined();
    // influenceNumber(10) - baseDI(3) - arkenstone(+5) = 2
    expect(attempt!.need).toBe(2);
  });

  test('+5 DI NOT applied against non-Dwarf factions', () => {
    // Goblins of Goblin-gate (le-265, race orc). Arkenstone fires only on dwarf factions.
    const GOBLIN_GATE = 'le-378' as CardDefinitionId;
    const GOBLINS = 'le-265' as CardDefinitionId;

    const base = buildSitePhaseState({
      characters: [ARAGORN],
      site: GOBLIN_GATE,
      hand: [GOBLINS],
    });
    const state = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, THE_ARKENSTONE);

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const attempts = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const attempt = attempts.find(a => a.influencingCharacterId === aragornId);
    expect(attempt).toBeDefined();
    // influenceNumber(9) - baseDI(3) = 6, no Arkenstone bonus for orc factions
    expect(attempt!.need).toBe(6);
  });

  // ── Effect 3: each Dwarf in play has +1 mind ─────────────────────────────

  test('Gimli (mind 6) has effectiveStats.mind = 7 while Arkenstone is in play', () => {
    // The Mouth bears The Arkenstone; Gimli is in the opponent's company.
    // The +1 mind modifier is a global all-characters effect on the item,
    // picked up by collectGlobalEffects scanning items on characters.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: LONELY_MOUNTAIN_MINION, characters: [THE_MOUTH] }],
          hand: [],
          siteDeck: [MORIA_MINION],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LONELY_MOUNTAIN_HERO, characters: [GIMLI] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const state = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, THE_MOUTH, THE_ARKENSTONE));

    // Gimli's effective mind should be 7 (base 6 + 1 from Arkenstone).
    expect(getCharacter(state, HAZARD_PLAYER, GIMLI).effectiveStats.mind).toBe(7);
  });

  test('+1 mind applies to EVERY Dwarf in play (multiple Dwarves)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: LONELY_MOUNTAIN_MINION, characters: [THE_MOUTH] }],
          hand: [],
          siteDeck: [MORIA_MINION],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LONELY_MOUNTAIN_HERO, characters: [GIMLI, BALIN, KILI] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const state = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, THE_MOUTH, THE_ARKENSTONE));

    expect(getCharacter(state, HAZARD_PLAYER, GIMLI).effectiveStats.mind).toBe(7); // base 6 + 1
    expect(getCharacter(state, HAZARD_PLAYER, BALIN).effectiveStats.mind).toBe(6); // base 5 + 1
    expect(getCharacter(state, HAZARD_PLAYER, KILI).effectiveStats.mind).toBe(4);  // base 3 + 1
  });

  test('+1 mind does NOT affect non-Dwarf characters', () => {
    // Legolas (elf) should not have effectiveStats.mind set (no modifier applies).
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: LONELY_MOUNTAIN_MINION, characters: [THE_MOUTH] }],
          hand: [],
          siteDeck: [MORIA_MINION],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LONELY_MOUNTAIN_HERO, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const state = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, THE_MOUTH, THE_ARKENSTONE));

    // Legolas is elf — no mind modifier fires, effectiveStats.mind is undefined.
    expect(getCharacter(state, HAZARD_PLAYER, LEGOLAS).effectiveStats.mind).toBeUndefined();
  });

  test('+1 mind is NOT applied when Arkenstone is not in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: LONELY_MOUNTAIN_MINION, characters: [THE_MOUTH] }],
          hand: [],
          siteDeck: [MORIA_MINION],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LONELY_MOUNTAIN_HERO, characters: [GIMLI] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    // No Arkenstone in play → no mind modifier → effectiveStats.mind is undefined.
    expect(getCharacter(state, HAZARD_PLAYER, GIMLI).effectiveStats.mind).toBeUndefined();
  });

  test('+1 mind on follower Kíli is reflected in DI cost accounting', () => {
    // Directly constructs a state with Kíli as follower to verify that
    // effectiveStats.mind (raised from 3 to 4 by Arkenstone) is used in DI cost
    // accounting. The Mouth (DI 4) with Kíli (effective mind 4) as follower
    // has 0 remaining DI.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: LONELY_MOUNTAIN_MINION, characters: [
            { defId: THE_MOUTH },
            { defId: KILI, followerOf: 0 }, // Kíli as follower to test DI cost logic
          ] }],
          hand: [],
          siteDeck: [MORIA_MINION],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LONELY_MOUNTAIN_HERO, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const state = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, THE_MOUTH, THE_ARKENSTONE));
    const mouthId = findCharInstanceId(state, RESOURCE_PLAYER, THE_MOUTH);

    // Kíli effective mind = 4 (base 3 + 1 from Arkenstone) consumes all 4 DI.
    expect(availableDI(state, mouthId, state.players[RESOURCE_PLAYER])).toBe(0);
  });

  // ── Effect 4: force-discard-dwarf-at-site ────────────────────────────────

  test('force-discard-dwarf-at-site offered when a Dwarf is at the same site', () => {
    // PLAYER_1 (ringwraith): The Mouth + Arkenstone at The Lonely Mountain (le-387).
    // PLAYER_2 (wizard):     Gimli at The Lonely Mountain (tw-428, same site name).
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{
            site: LONELY_MOUNTAIN_MINION,
            characters: [{ defId: THE_MOUTH, items: [THE_ARKENSTONE] }],
          }],
          hand: [],
          siteDeck: [MORIA_MINION],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LONELY_MOUNTAIN_HERO, characters: [GIMLI] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const gimliId = findCharInstanceId(state, HAZARD_PLAYER, GIMLI);
    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'force-discard-dwarf-at-site');

    expect(actions.length).toBe(1);
    expect((actions[0].action as ActivateGrantedAction).targetCardId).toBe(gimliId);
  });

  test('one action per Dwarf when multiple Dwarves are at the same site', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{
            site: LONELY_MOUNTAIN_MINION,
            characters: [{ defId: THE_MOUTH, items: [THE_ARKENSTONE] }],
          }],
          hand: [],
          siteDeck: [MORIA_MINION],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LONELY_MOUNTAIN_HERO, characters: [GIMLI, BALIN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'force-discard-dwarf-at-site');

    expect(actions.length).toBe(2);
    const gimliId = findCharInstanceId(state, HAZARD_PLAYER, GIMLI);
    const balinId = findCharInstanceId(state, HAZARD_PLAYER, BALIN);
    const targets = actions.map(ea => (ea.action as ActivateGrantedAction).targetCardId);
    expect(targets).toContain(gimliId);
    expect(targets).toContain(balinId);
  });

  test('force-discard NOT offered when no Dwarf is at the same site', () => {
    // Legolas (elf) is at The Lonely Mountain — not a Dwarf.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{
            site: LONELY_MOUNTAIN_MINION,
            characters: [{ defId: THE_MOUTH, items: [THE_ARKENSTONE] }],
          }],
          hand: [],
          siteDeck: [MORIA_MINION],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LONELY_MOUNTAIN_HERO, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'force-discard-dwarf-at-site');

    expect(actions.length).toBe(0);
  });

  test('force-discard NOT offered when Dwarf is at a different site', () => {
    // Gimli is at LORIEN, not The Lonely Mountain.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{
            site: LONELY_MOUNTAIN_MINION,
            characters: [{ defId: THE_MOUTH, items: [THE_ARKENSTONE] }],
          }],
          hand: [],
          siteDeck: [MORIA_MINION],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'force-discard-dwarf-at-site');

    expect(actions.length).toBe(0);
  });

  test('activating force-discard removes Gimli from play and discards The Arkenstone', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{
            site: LONELY_MOUNTAIN_MINION,
            characters: [{ defId: THE_MOUTH, items: [THE_ARKENSTONE] }],
          }],
          hand: [],
          siteDeck: [MORIA_MINION],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LONELY_MOUNTAIN_HERO, characters: [GIMLI] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const gimliId = findCharInstanceId(state, HAZARD_PLAYER, GIMLI);
    const action = viableActions(state, PLAYER_1, 'activate-granted-action')
      .find(ea => (ea.action as ActivateGrantedAction).actionId === 'force-discard-dwarf-at-site')!.action;

    const next = dispatch(state, action);

    // Gimli is gone from PLAYER_2's characters.
    expect(next.players[HAZARD_PLAYER].characters[gimliId]).toBeUndefined();
    // Gimli's definition ID is in PLAYER_2's discard pile.
    expectInDiscardPile(next, HAZARD_PLAYER, GIMLI);

    // The Arkenstone is gone from The Mouth's items and in PLAYER_1's discard.
    expectCharItemCount(next, RESOURCE_PLAYER, THE_MOUTH, 0);
    expectInDiscardPile(next, RESOURCE_PLAYER, THE_ARKENSTONE);
  });

  test("activating force-discard also discards the Dwarf's items", () => {
    // Gimli carries a Minor Item. It must be discarded alongside Gimli.
    const MINOR_ITEM = 'tw-305' as CardDefinitionId; // Ring of Barahir (minor hero item)

    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{
            site: LONELY_MOUNTAIN_MINION,
            characters: [{ defId: THE_MOUTH, items: [THE_ARKENSTONE] }],
          }],
          hand: [],
          siteDeck: [MORIA_MINION],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LONELY_MOUNTAIN_HERO, characters: [GIMLI] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const state = recomputeDerived(attachItemToChar(base, HAZARD_PLAYER, GIMLI, MINOR_ITEM));

    const action = viableActions(state, PLAYER_1, 'activate-granted-action')
      .find(ea => (ea.action as ActivateGrantedAction).actionId === 'force-discard-dwarf-at-site')!.action;

    const next = dispatch(state, action);

    // Both Gimli and his item land in PLAYER_2's discard pile.
    expectInDiscardPile(next, HAZARD_PLAYER, GIMLI);
    expectInDiscardPile(next, HAZARD_PLAYER, MINOR_ITEM);
  });

  test("Dwarf's followers revert to general influence and are NOT discarded", () => {
    // Gimli (DI 2) controls Kíli (mind 3) as a follower.
    // After force-discard: Kíli stays in PLAYER_2's characters under GI.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{
            site: LONELY_MOUNTAIN_MINION,
            characters: [{ defId: THE_MOUTH, items: [THE_ARKENSTONE] }],
          }],
          hand: [],
          siteDeck: [MORIA_MINION],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LONELY_MOUNTAIN_HERO, characters: [
            { defId: GIMLI },
            { defId: KILI, followerOf: 0 }, // Kíli is follower of Gimli (index 0)
          ] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const gimliId = findCharInstanceId(state, HAZARD_PLAYER, GIMLI);
    const kiliId = findCharInstanceId(state, HAZARD_PLAYER, KILI);

    const action = viableActions(state, PLAYER_1, 'activate-granted-action')
      .find(ea => {
        const a = ea.action as ActivateGrantedAction;
        return a.actionId === 'force-discard-dwarf-at-site' && a.targetCardId === gimliId;
      })!.action;

    const next = dispatch(state, action);

    // Kíli must NOT be in the discard pile — followers are not discarded.
    const kiliInDiscard = next.players[HAZARD_PLAYER].discardPile
      .some(c => c.definitionId === KILI);
    expect(kiliInDiscard).toBe(false);

    // Kíli should still be in PLAYER_2's characters (now under general influence).
    const kiliChar = next.players[HAZARD_PLAYER].characters[kiliId];
    expect(kiliChar).toBeDefined();
    expect(kiliChar.controlledBy).toBe('general');
  });
});
