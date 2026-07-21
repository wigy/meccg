/**
 * @module le-370.test
 *
 * Card test: Dunnish Clan-hold (le-370)
 * Type: minion-site (border-hold) in Dunland
 *
 * Text:
 *   "Nearest Darkhaven: Carn Dûm
 *    Playable: Items (minor, major*) *—weapon, armor, shield, or helmet only
 *    Automatic-attacks: Men — each character faces 1 strike with 7 prowess
 *      (detainment against covert company)"
 *
 * Minion twin of le-399 (Raider-hold): structurally identical — same item
 * restriction (minor freely; major only weapon/armor/shield/helmet) and the
 * same Men each-character auto-attack at prowess 7 with detainment-vs-covert.
 * The only differences are the nearest darkhaven (Carn Dûm le-359 instead of
 * Dol Guldur) and the region (Dunland).
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                            |
 * |---|-------------------|--------|------------------------------------------------------------------|
 * | 1 | siteType          | OK     | "border-hold" — valid                                            |
 * | 2 | sitePath          | OK     | [shadow, wilderness, wilderness, wilderness]                    |
 * | 3 | nearestHaven      | OK     | "Carn Dûm" — valid minion haven in card pool (le-359)            |
 * | 4 | region            | OK     | "Dunland" — valid region in card pool                            |
 * | 5 | playableResources | OK     | [minor, major] — matches card text                               |
 * | 6 | automaticAttacks  | OK     | Men, prowess 7, each-character / detainment-vs-covert           |
 * | 7 | resourceDraws     | OK     | 2                                                                |
 * | 8 | hazardDraws       | OK     | 2                                                                |
 *
 * Engine Support:
 * | # | Feature                         | Status      | Notes                                                 |
 * |---|---------------------------------|-------------|-------------------------------------------------------|
 * | 1 | Site phase flow                 | IMPLEMENTED | select-company, enter-or-skip, play-resources         |
 * | 2 | Haven path movement             | IMPLEMENTED | movement-map.ts resolves the Carn Dûm link            |
 * | 3 | Region movement                 | IMPLEMENTED | Sites reachable within 4 regions of Dunland           |
 * | 4 | Card draws                      | IMPLEMENTED | resourceDraws / hazardDraws thread through M/H phase  |
 * | 5 | Minor items playable            | IMPLEMENTED | playableResources includes "minor"                    |
 * | 6 | Major item restriction          | IMPLEMENTED | site-rule deny-item blocks non-weapon/armor/shield/   |
 * |   |                                 |             | helmet major items                                    |
 * | 7 | Automatic attack combat         | IMPLEMENTED | each-character: one strike per character; detainment  |
 * |   |                                 |             | gated on defender.covert (combat-detainment effect)   |
 *
 * Playable: YES
 * Certified: 2026-07-21
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  resetMint, pool,
  buildTestState, viableActions, setupRingwraithAutoAttack,
  GLAMDRING, SAPLING_OF_THE_WHITE_TREE, HAUBERK_OF_BRIGHT_MAIL,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import {
  Alignment, Phase,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import { reduce } from '../../engine/reducer.js';
import type { CardDefinitionId, SiteCard, SitePhaseState } from '../../index.js';

const DUNNISH_CLAN_HOLD = 'le-370' as CardDefinitionId;
const CARN_DUM = 'le-359' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;

// Minion characters for the Ringwraith-player fixture
const GORBAG = 'le-11' as CardDefinitionId;
const LAGDUF = 'le-18' as CardDefinitionId;

// Each-character auto-attack fixture: Men keep a Ringwraith company covert; an
// Orc makes it overt (toggling the detainment-vs-covert effect).
const THE_MOUTH = 'le-24' as CardDefinitionId;             // Man
const ASTERNAK = 'le-1' as CardDefinitionId;               // Man
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;           // Orc → makes the company overt

// Minion items for restriction tests
const SAW_TOOTHED_BLADE = 'le-342' as CardDefinitionId;   // minor, weapon
const SABLE_SHIELD = 'le-341' as CardDefinitionId;        // major, shield (after keyword fix)

const playResourcesState = (): SitePhaseState => ({
  phase: Phase.Site,
  step: 'play-resources',
  activeCompanyIndex: 0,
  handledCompanyIds: [],
  siteEntered: true,
  resourcePlayed: false,
  minorItemAvailable: false,
  hoardBountyAvailable: false,
  thoroughSearchAvailable: false,
  declaredAgentAttack: null,
  automaticAttacksResolved: 0,
  awaitingOnGuardReveal: false,
  pendingResourceAction: null,
  opponentInteractionThisTurn: null,
  pendingOpponentInfluence: null,
});

function setupAt(hand: CardDefinitionId[]) {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: DUNNISH_CLAN_HOLD, characters: [GORBAG] }],
        hand,
        siteDeck: [MINAS_MORGUL],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Ringwraith,
        companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }],
        hand: [],
        siteDeck: [CARN_DUM],
      },
    ],
  });
  return { ...base, phaseState: playResourcesState() };
}

describe('Dunnish Clan-hold (le-370)', () => {
  beforeEach(() => resetMint());

  // ─── Movement: starter from/to Carn Dûm ─────────────────────────────────────

  test('starter movement from Carn Dûm reaches Dunnish Clan-hold', () => {
    const carnDum = pool[CARN_DUM as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, carnDum, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Dunnish Clan-hold');
  });

  test('starter movement from Dunnish Clan-hold returns to Carn Dûm', () => {
    const dunnish = pool[DUNNISH_CLAN_HOLD as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dunnish, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Carn Dûm');
  });

  test('starter movement from Minas Morgul does NOT reach Dunnish Clan-hold', () => {
    // Dunnish Clan-hold's nearestHaven is Carn Dûm, not Minas Morgul.
    const minasMorgul = pool[MINAS_MORGUL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, minasMorgul, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).not.toContain('Dunnish Clan-hold');
  });

  // ─── Region movement ────────────────────────────────────────────────────────

  test('region movement from Dunnish Clan-hold stays within 4 regions of Dunland', () => {
    const dunnish = pool[DUNNISH_CLAN_HOLD as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dunnish, allSites);
    for (const r of reachable) {
      if (r.movementType !== 'region') continue;
      expect(r.regionDistance!).toBeLessThanOrEqual(4);
    }
  });

  // ─── Item playability: minor items ──────────────────────────────────────────

  test('minor minion item (Saw-toothed Blade) IS viable at Dunnish Clan-hold', () => {
    // The deny-item rule only restricts major items to weapon/armor/shield/helmet.
    // Minor items are always playable when the site lists "minor" in playableResources.
    const state = setupAt([SAW_TOOTHED_BLADE]);
    const viable = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(viable.length).toBeGreaterThan(0);
  });

  // ─── Item playability: major items ──────────────────────────────────────────

  test('weapon major item (Glamdring) IS viable at Dunnish Clan-hold', () => {
    // Glamdring has the "weapon" keyword — the deny-item rule allows it.
    const state = setupAt([GLAMDRING]);
    const viable = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(viable.length).toBeGreaterThan(0);
  });

  test('armor major item (Hauberk of Bright Mail) IS viable at Dunnish Clan-hold', () => {
    // Hauberk of Bright Mail has the "armor" keyword — the deny-item rule allows it.
    const state = setupAt([HAUBERK_OF_BRIGHT_MAIL]);
    const viable = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(viable.length).toBeGreaterThan(0);
  });

  test('shield major item (Sable Shield) IS viable at Dunnish Clan-hold', () => {
    // Sable Shield has the "shield" keyword — not denied.
    const state = setupAt([SABLE_SHIELD]);
    const viable = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(viable.length).toBeGreaterThan(0);
  });

  test('non-weapon/armor/shield/helmet major item (Sapling of White Tree) is NOT viable', () => {
    // Sapling of White Tree has no weapon/armor/shield/helmet keyword.
    // The deny-item rule marks it not-playable at this site.
    const state = setupAt([SAPLING_OF_THE_WHITE_TREE]);
    const viable = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(viable.length).toBe(0);
  });

  test('deny-item rule does not apply to minor items', () => {
    // With both a minor weapon and a non-weapon major in hand, only the
    // minor item is viable (major is denied). Confirms the rule is scoped
    // to subtype === "major" only.
    const state = setupAt([SAW_TOOTHED_BLADE, SAPLING_OF_THE_WHITE_TREE]);
    const viable = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(viable.length).toBe(1);
    const action = viable[0].action;
    if (action.type !== 'play-hero-resource') throw new Error('unreachable');
    // The viable action targets SAW_TOOTHED_BLADE (minor), not the Sapling (denied major).
    const viableDef = state.players[RESOURCE_PLAYER].hand.find(
      h => h.instanceId === action.cardInstanceId,
    );
    expect(viableDef?.definitionId).toBe(SAW_TOOTHED_BLADE);
  });

  // ─── Automatic attack: Men, each character faces 1 strike ───────────────────

  test('each-character: Men attack pre-assigns one strike per character (strikesTotal = company size)', () => {
    const state = setupRingwraithAutoAttack(DUNNISH_CLAN_HOLD, [THE_MOUTH, ASTERNAK, ORC_CAPTAIN]);

    const { state: after, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(after.combat).not.toBeNull();
    expect(after.combat!.creatureRace).toBe('man');
    expect(after.combat!.strikeProwess).toBe(7);
    expect(after.combat!.strikesTotal).toBe(3);
    expect(after.combat!.eachCharacterFacesOneStrike).toBe(true);
    // Assignment is automatic — combat does not stall in `assign-strikes`.
    expect(after.combat!.phase).not.toBe('assign-strikes');
    expect(after.combat!.assignmentPhase).toBe('done');
  });

  test('covert company: the Men each-character attack is detainment', () => {
    // An all-Men Ringwraith company is covert; the combat-detainment effect
    // (gated on defender.covert) makes the attack detainment.
    const state = setupRingwraithAutoAttack(DUNNISH_CLAN_HOLD, [THE_MOUTH, ASTERNAK]);

    const { state: after, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(after.combat!.strikesTotal).toBe(2);
    expect(after.combat!.detainment).toBe(true);
  });

  test('overt company: the Men each-character attack is NOT detainment', () => {
    // An Orc makes the company overt; the detainment guard no longer fires.
    const state = setupRingwraithAutoAttack(DUNNISH_CLAN_HOLD, [ORC_CAPTAIN, THE_MOUTH]);

    const { state: after, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(after.combat!.strikesTotal).toBe(2);
    expect(after.combat!.detainment).toBe(false);
  });
});
