/**
 * @module le-403.test
 *
 * Card test: Shrel-Kain (le-403)
 * Type: minion-site (border-hold) in Dorwinion
 *
 * Text:
 *   "Nearest Darkhaven: Dol Guldur
 *    Playable: Items (minor, major*) *—weapon, armor, shield, or helmet only
 *    Automatic-attacks: Men — each character faces 1 strike with 8 prowess
 *      (detainment against covert company)"
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                            |
 * |---|-------------------|--------|------------------------------------------------------------------|
 * | 1 | siteType          | OK     | "border-hold" — valid                                           |
 * | 2 | sitePath          | OK     | [dark, wilderness, shadow] — matches {d}{w}{s}                  |
 * | 3 | nearestHaven      | OK     | "Dol Guldur" — valid minion haven in card pool (le-367)         |
 * | 4 | region            | OK     | "Dorwinion" — valid region in card pool                         |
 * | 5 | playableResources | OK     | [minor, major] — matches card text                             |
 * | 6 | automaticAttacks  | OK     | Men, prowess 8, each-character / detainment-vs-covert          |
 * | 7 | resourceDraws     | OK     | 1                                                               |
 * | 8 | hazardDraws       | OK     | 2                                                               |
 *
 * Engine Support (identical mechanics to Raider-hold le-399, prowess differs):
 * | # | Feature                         | Status      | Notes                                                 |
 * |---|---------------------------------|-------------|-------------------------------------------------------|
 * | 1 | Site phase flow                 | IMPLEMENTED | select-company, enter-or-skip, play-resources         |
 * | 2 | Haven path movement             | IMPLEMENTED | movement-map.ts resolves the Dol Guldur link          |
 * | 3 | Region movement                 | IMPLEMENTED | Sites reachable within 4 regions of Dorwinion         |
 * | 4 | Minor items playable            | IMPLEMENTED | playableResources includes "minor"                    |
 * | 5 | Major item restriction          | IMPLEMENTED | site-rule deny-item blocks non-weapon/armor/shield/   |
 * |   |                                 |             | helmet major items                                    |
 * | 6 | Automatic attack combat         | IMPLEMENTED | each-character: one strike per character; detainment  |
 * |   |                                 |             | gated on defender.covert (combat-detainment effect)   |
 *
 * Note: "Shrel-Kain" is a duplicate site name shared with the hero site tw-425
 * (nearestHaven Lórien). Movement assertions therefore key on the site's
 * definition id (le-403), not its name.
 *
 * Playable: YES
 * Certified: 2026-07-09
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

const SHREL_KAIN = 'le-403' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;
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
        companies: [{ site: SHREL_KAIN, characters: [GORBAG] }],
        hand,
        siteDeck: [MINAS_MORGUL],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Ringwraith,
        companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }],
        hand: [],
        siteDeck: [DOL_GULDUR],
      },
    ],
  });
  return { ...base, phaseState: playResourcesState() };
}

describe('Shrel-Kain (le-403)', () => {
  beforeEach(() => resetMint());

  // ─── Movement: starter from/to Dol Guldur ───────────────────────────────────

  test('starter movement from Dol Guldur reaches Shrel-Kain (le-403)', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const starterIds = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.id);

    expect(starterIds).toContain(SHREL_KAIN);
  });

  test('starter movement from Shrel-Kain returns to Dol Guldur', () => {
    const shrelKain = pool[SHREL_KAIN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, shrelKain, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Dol Guldur');
  });

  test('starter movement from Minas Morgul does NOT reach Shrel-Kain (le-403)', () => {
    // Shrel-Kain's nearestHaven is Dol Guldur, not Minas Morgul.
    const minasMorgul = pool[MINAS_MORGUL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, minasMorgul, allSites);
    const starterIds = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.id);

    expect(starterIds).not.toContain(SHREL_KAIN);
  });

  // ─── Region movement ────────────────────────────────────────────────────────

  test('region movement from Shrel-Kain stays within 4 regions of Dorwinion', () => {
    const shrelKain = pool[SHREL_KAIN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, shrelKain, allSites);
    for (const r of reachable) {
      if (r.movementType !== 'region') continue;
      expect(r.regionDistance!).toBeLessThanOrEqual(4);
    }
  });

  // ─── Item playability: minor items ──────────────────────────────────────────

  test('minor minion item (Saw-toothed Blade) IS viable at Shrel-Kain', () => {
    // The deny-item rule only restricts major items to weapon/armor/shield/helmet.
    // Minor items are always playable when the site lists "minor" in playableResources.
    const state = setupAt([SAW_TOOTHED_BLADE]);
    const viable = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(viable.length).toBeGreaterThan(0);
  });

  // ─── Item playability: major items ──────────────────────────────────────────

  test('weapon major item (Glamdring) IS viable at Shrel-Kain', () => {
    // Glamdring has the "weapon" keyword — the deny-item rule allows it.
    const state = setupAt([GLAMDRING]);
    const viable = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(viable.length).toBeGreaterThan(0);
  });

  test('armor major item (Hauberk of Bright Mail) IS viable at Shrel-Kain', () => {
    // Hauberk of Bright Mail has the "armor" keyword — the deny-item rule allows it.
    const state = setupAt([HAUBERK_OF_BRIGHT_MAIL]);
    const viable = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(viable.length).toBeGreaterThan(0);
  });

  test('shield major item (Sable Shield) IS viable at Shrel-Kain', () => {
    // Sable Shield has the "shield" keyword (added in data fix) — not denied.
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

  // ─── Automatic attack: Men, each character faces 1 strike with 8 prowess ─────

  test('each-character: Men attack pre-assigns one strike per character (strikesTotal = company size)', () => {
    const state = setupRingwraithAutoAttack(SHREL_KAIN, [THE_MOUTH, ASTERNAK, ORC_CAPTAIN]);

    const { state: after, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(after.combat).not.toBeNull();
    expect(after.combat!.creatureRace).toBe('man');
    expect(after.combat!.strikeProwess).toBe(8);
    expect(after.combat!.strikesTotal).toBe(3);
    expect(after.combat!.eachCharacterFacesOneStrike).toBe(true);
    // Assignment is automatic — combat does not stall in `assign-strikes`.
    expect(after.combat!.phase).not.toBe('assign-strikes');
    expect(after.combat!.assignmentPhase).toBe('done');
  });

  test('covert company: the Men each-character attack is detainment', () => {
    // An all-Men Ringwraith company is covert; the combat-detainment effect
    // (gated on defender.covert) makes the attack detainment.
    const state = setupRingwraithAutoAttack(SHREL_KAIN, [THE_MOUTH, ASTERNAK]);

    const { state: after, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(after.combat!.strikesTotal).toBe(2);
    expect(after.combat!.detainment).toBe(true);
  });

  test('overt company: the Men each-character attack is NOT detainment', () => {
    // An Orc makes the company overt; the detainment guard no longer fires.
    const state = setupRingwraithAutoAttack(SHREL_KAIN, [ORC_CAPTAIN, THE_MOUTH]);

    const { state: after, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(after.combat!.strikesTotal).toBe(2);
    expect(after.combat!.detainment).toBe(false);
  });
});
