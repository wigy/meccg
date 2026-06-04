/**
 * @module le-399.test
 *
 * Card test: Raider-hold (le-399)
 * Type: minion-site (border-hold) in Horse Plains
 *
 * Text:
 *   "Nearest Darkhaven: Dol Guldur
 *    Playable: Items (minor, major*) *—weapon, armor, shield, or helmet only
 *    Automatic-attacks: Men — each character faces 1 strike with 7 prowess
 *      (detainment against covert company)"
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                            |
 * |---|-------------------|--------|------------------------------------------------------------------|
 * | 1 | siteType          | OK     | "border-hold" — valid                                            |
 * | 2 | sitePath          | OK     | [dark, wilderness, shadow] — matches {d}{w}{s}                   |
 * | 3 | nearestHaven      | OK     | "Dol Guldur" — valid minion haven in card pool (le-367)          |
 * | 4 | region            | OK     | "Horse Plains" — valid region in card pool                       |
 * | 5 | playableResources | OK     | [minor, major] — matches card text                               |
 * | 6 | automaticAttacks  | OK     | Men, prowess 7, each-char/detainment-vs-covert — data only       |
 * | 7 | resourceDraws     | OK     | 2                                                                |
 * | 8 | hazardDraws       | OK     | 2                                                                |
 *
 * Engine Support:
 * | # | Feature                         | Status      | Notes                                                 |
 * |---|---------------------------------|-------------|-------------------------------------------------------|
 * | 1 | Site phase flow                 | IMPLEMENTED | select-company, enter-or-skip, play-resources         |
 * | 2 | Haven path movement             | IMPLEMENTED | movement-map.ts resolves the Dol Guldur link          |
 * | 3 | Region movement                 | IMPLEMENTED | Sites reachable within 4 regions of Horse Plains      |
 * | 4 | Card draws                      | IMPLEMENTED | resourceDraws / hazardDraws thread through M/H phase  |
 * | 5 | Minor items playable            | IMPLEMENTED | playableResources includes "minor"                    |
 * | 6 | Major item restriction          | IMPLEMENTED | site-rule deny-item blocks non-weapon/armor/shield/   |
 * |   |                                 |             | helmet major items                                    |
 * | 7 | Automatic attack combat         | STUBBED     | pass-through (engine-wide limitation)                 |
 *
 * Keyword data fixes applied:
 *   tw-212 (Durin's Axe): added "weapon" keyword
 *   tw-250 (Great-shield of Rohan): added "shield" keyword
 *   le-341 (Sable Shield): added "shield" keyword
 *   as-136 (Usriev of Treachery): added "weapon" keyword
 *   td-120 (Habergeon of Silver): added "armor" keyword
 *
 * Playable: YES
 * Certified: 2026-06-04
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  resetMint, pool,
  buildTestState, viableActions,
  GLAMDRING, SAPLING_OF_THE_WHITE_TREE, HAUBERK_OF_BRIGHT_MAIL,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import {
  Alignment, Phase,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { CardDefinitionId, SiteCard, SitePhaseState } from '../../index.js';

const RAIDER_HOLD = 'le-399' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;

// Minion characters for the Ringwraith-player fixture
const GORBAG = 'le-11' as CardDefinitionId;
const LAGDUF = 'le-18' as CardDefinitionId;

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
        companies: [{ site: RAIDER_HOLD, characters: [GORBAG] }],
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

describe('Raider-hold (le-399)', () => {
  beforeEach(() => resetMint());

  // ─── Movement: starter from/to Dol Guldur ───────────────────────────────────

  test('starter movement from Dol Guldur reaches Raider-hold', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Raider-hold');
  });

  test('starter movement from Raider-hold returns to Dol Guldur', () => {
    const raiderHold = pool[RAIDER_HOLD as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, raiderHold, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Dol Guldur');
  });

  test('starter movement from Minas Morgul does NOT reach Raider-hold', () => {
    // Raider-hold's nearestHaven is Dol Guldur, not Minas Morgul.
    const minasMorgul = pool[MINAS_MORGUL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, minasMorgul, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).not.toContain('Raider-hold');
  });

  // ─── Region movement ────────────────────────────────────────────────────────

  test('region movement from Raider-hold stays within 4 regions of Horse Plains', () => {
    const raiderHold = pool[RAIDER_HOLD as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, raiderHold, allSites);
    for (const r of reachable) {
      if (r.movementType !== 'region') continue;
      expect(r.regionDistance!).toBeLessThanOrEqual(4);
    }
  });

  // ─── Item playability: minor items ──────────────────────────────────────────

  test('minor minion item (Saw-toothed Blade) IS viable at Raider-hold', () => {
    // The deny-item rule only restricts major items to weapon/armor/shield/helmet.
    // Minor items are always playable when the site lists "minor" in playableResources.
    const state = setupAt([SAW_TOOTHED_BLADE]);
    const viable = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(viable.length).toBeGreaterThan(0);
  });

  // ─── Item playability: major items ──────────────────────────────────────────

  test('weapon major item (Glamdring) IS viable at Raider-hold', () => {
    // Glamdring has the "weapon" keyword — the deny-item rule allows it.
    const state = setupAt([GLAMDRING]);
    const viable = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(viable.length).toBeGreaterThan(0);
  });

  test('armor major item (Hauberk of Bright Mail) IS viable at Raider-hold', () => {
    // Hauberk of Bright Mail has the "armor" keyword — the deny-item rule allows it.
    const state = setupAt([HAUBERK_OF_BRIGHT_MAIL]);
    const viable = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(viable.length).toBeGreaterThan(0);
  });

  test('shield major item (Sable Shield) IS viable at Raider-hold', () => {
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

  // ─── Site data: deny-item effect is present ──────────────────────────────────

  test('Raider-hold card definition declares the deny-item site rule', () => {
    const raiderHold = pool[RAIDER_HOLD as string] as SiteCard;
    expect(raiderHold.effects).toBeDefined();

    const denyRule = raiderHold.effects!.find(
      e => e.type === 'site-rule' && 'rule' in e && (e as { rule: string }).rule === 'deny-item',
    );
    expect(denyRule).toBeDefined();
  });

  // ─── Site data: automaticAttacks present ────────────────────────────────────

  test('Raider-hold has one automatic attack defined', () => {
    const raiderHold = pool[RAIDER_HOLD as string] as SiteCard;
    expect(raiderHold.automaticAttacks).toHaveLength(1);
    const attack = raiderHold.automaticAttacks[0];
    expect(attack.creatureType).toBe('Men');
    expect(attack.prowess).toBe(7);
    // strikes: -1 is the sentinel meaning "each character faces 1 strike"
    expect(attack.strikes).toBe(-1);
    expect((attack as { detainmentAgainstCovert?: boolean }).detainmentAgainstCovert).toBe(true);
  });
});
