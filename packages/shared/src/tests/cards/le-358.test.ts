/**
 * @module le-358.test
 *
 * Card test: Cameth Brin (le-358)
 * Type: minion-site (border-hold) in Rhudaur
 *
 * Text:
 *   "Nearest Darkhaven: Carn Dûm
 *    Playable: Items (minor, major*) *—weapon, armor, shield, or helmet only
 *    Automatic-attacks: Men — each character faces 1 strike with 7 prowess
 *      (detainment against covert company)"
 *
 * Data-twin of Raider-hold (le-399): identical Playable clause and Men
 * each-character detainment auto-attack; only the haven (Carn Dûm), region
 * (Rhudaur), site path ({s}{w}) and draws (1/1) differ.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                   |
 * |---|-------------------|--------|---------------------------------------------------------|
 * | 1 | siteType          | OK     | "border-hold" — valid                                   |
 * | 2 | sitePath          | OK     | [shadow, wilderness] — matches {s}{w}                   |
 * | 3 | nearestHaven      | OK     | "Carn Dûm" — minion haven in the card pool (le-359)     |
 * | 4 | region            | OK     | "Rhudaur" — valid region in card pool                   |
 * | 5 | playableResources | OK     | [minor, major] — matches card text                      |
 * | 6 | automaticAttacks  | OK     | Men, prowess 7, each-character / detainment-vs-covert   |
 * | 7 | resourceDraws     | OK     | 1                                                        |
 * | 8 | hazardDraws       | OK     | 1                                                        |
 *
 * Engine Support (all pre-existing; certified with le-399):
 * | # | Feature                         | Status      | Notes                                          |
 * |---|---------------------------------|-------------|------------------------------------------------|
 * | 1 | Site phase flow                 | IMPLEMENTED | select-company, enter-or-skip, play-resources  |
 * | 2 | Haven path movement             | IMPLEMENTED | movement-map.ts resolves the Carn Dûm link     |
 * | 3 | Region movement                 | IMPLEMENTED | Sites reachable within 4 regions of Rhudaur    |
 * | 4 | Minor items playable            | IMPLEMENTED | playableResources includes "minor"             |
 * | 5 | Major item restriction          | IMPLEMENTED | site-rule deny-item blocks non-weapon/armor/   |
 * |   |                                 |             | shield/helmet major items                      |
 * | 6 | Automatic attack combat         | IMPLEMENTED | each-character: one strike per character;      |
 * |   |                                 |             | detainment gated on defender.covert            |
 *
 * Playable: YES
 * Certified: 2026-07-16
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  resetMint, pool, buildTestState, viableActions, setupRingwraithAutoAttack,
  GLAMDRING, SAPLING_OF_THE_WHITE_TREE, HAUBERK_OF_BRIGHT_MAIL,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import {
  Alignment, Phase,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import { reduce } from '../../engine/reducer.js';
import type { CardDefinitionId, SiteCard, SitePhaseState } from '../../index.js';

const CAMETH_BRIN = 'le-358' as CardDefinitionId;
const CARN_DUM = 'le-359' as CardDefinitionId;       // Cameth Brin's nearest darkhaven
const DOL_GULDUR = 'le-367' as CardDefinitionId;      // an unrelated minion haven

// Minion characters for the Ringwraith-player fixture
const GORBAG = 'le-11' as CardDefinitionId;

// Each-character auto-attack fixture: Men keep a Ringwraith company covert; an
// Orc makes it overt (toggling the detainment-vs-covert effect).
const THE_MOUTH = 'le-24' as CardDefinitionId;        // Man
const ASTERNAK = 'le-1' as CardDefinitionId;          // Man
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;      // Orc → makes the company overt

// Minion items for restriction tests
const SAW_TOOTHED_BLADE = 'le-342' as CardDefinitionId;   // minor, weapon
const SABLE_SHIELD = 'le-341' as CardDefinitionId;        // major, shield

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
        companies: [{ site: CAMETH_BRIN, characters: [GORBAG] }],
        hand,
        siteDeck: [CARN_DUM],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Ringwraith,
        companies: [{ site: CARN_DUM, characters: [] }],
        hand: [],
        siteDeck: [DOL_GULDUR],
      },
    ],
  });
  return { ...base, phaseState: playResourcesState() };
}

describe('Cameth Brin (le-358)', () => {
  beforeEach(() => resetMint());

  // ─── Movement: starter to/from Carn Dûm ─────────────────────────────────────

  test('starter movement from Carn Dûm reaches Cameth Brin', () => {
    const carnDum = pool[CARN_DUM as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, carnDum, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Cameth Brin');
  });

  test('starter movement from Cameth Brin returns to Carn Dûm', () => {
    const camethBrin = pool[CAMETH_BRIN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, camethBrin, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Carn Dûm');
  });

  // ─── Region movement ────────────────────────────────────────────────────────

  test('region movement from Cameth Brin stays within 4 regions of Rhudaur', () => {
    const camethBrin = pool[CAMETH_BRIN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, camethBrin, allSites);
    for (const r of reachable) {
      if (r.movementType !== 'region') continue;
      expect(r.regionDistance!).toBeLessThanOrEqual(4);
    }
  });

  // ─── Item playability: minor items ──────────────────────────────────────────

  test('minor minion item (Saw-toothed Blade) IS viable at Cameth Brin', () => {
    // The deny-item rule only restricts major items; minor items are always
    // playable when the site lists "minor" in playableResources.
    const state = setupAt([SAW_TOOTHED_BLADE]);
    const viable = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(viable.length).toBeGreaterThan(0);
  });

  // ─── Item playability: major items ──────────────────────────────────────────

  test('weapon major item (Glamdring) IS viable at Cameth Brin', () => {
    const state = setupAt([GLAMDRING]);
    const viable = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(viable.length).toBeGreaterThan(0);
  });

  test('armor major item (Hauberk of Bright Mail) IS viable at Cameth Brin', () => {
    const state = setupAt([HAUBERK_OF_BRIGHT_MAIL]);
    const viable = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(viable.length).toBeGreaterThan(0);
  });

  test('shield major item (Sable Shield) IS viable at Cameth Brin', () => {
    const state = setupAt([SABLE_SHIELD]);
    const viable = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(viable.length).toBeGreaterThan(0);
  });

  test('non-weapon/armor/shield/helmet major item (Sapling of White Tree) is NOT viable', () => {
    // Sapling of White Tree has no weapon/armor/shield/helmet keyword;
    // the deny-item rule marks it not-playable at this site.
    const state = setupAt([SAPLING_OF_THE_WHITE_TREE]);
    const viable = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(viable.length).toBe(0);
  });

  test('deny-item rule is scoped to major items only', () => {
    // With both a minor weapon and a non-weapon major in hand, only the
    // minor item is viable (the major is denied).
    const state = setupAt([SAW_TOOTHED_BLADE, SAPLING_OF_THE_WHITE_TREE]);
    const viable = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(viable.length).toBe(1);
    const action = viable[0].action;
    if (action.type !== 'play-hero-resource') throw new Error('unreachable');
    const viableDef = state.players[RESOURCE_PLAYER].hand.find(
      h => h.instanceId === action.cardInstanceId,
    );
    expect(viableDef?.definitionId).toBe(SAW_TOOTHED_BLADE);
  });

  // ─── Automatic attack: Men, each character faces 1 strike ───────────────────

  test('each-character: Men attack pre-assigns one strike per character', () => {
    const state = setupRingwraithAutoAttack(CAMETH_BRIN, [THE_MOUTH, ASTERNAK, ORC_CAPTAIN]);

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
    const state = setupRingwraithAutoAttack(CAMETH_BRIN, [THE_MOUTH, ASTERNAK]);

    const { state: after, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(after.combat!.strikesTotal).toBe(2);
    expect(after.combat!.detainment).toBe(true);
  });

  test('overt company: the Men each-character attack is NOT detainment', () => {
    // An Orc makes the company overt; the detainment guard no longer fires.
    const state = setupRingwraithAutoAttack(CAMETH_BRIN, [ORC_CAPTAIN, THE_MOUTH]);

    const { state: after, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(after.combat!.strikesTotal).toBe(2);
    expect(after.combat!.detainment).toBe(false);
  });
});
