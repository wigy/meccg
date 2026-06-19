/**
 * @module le-413.test
 *
 * Card test: The Wind Throne (le-413)
 * Type: minion-site (ruins-and-lairs) in Grey Mountain Narrows
 * Effects: none — a vanilla minion site.
 *
 * Text (authoritative — cardnum MELE "The Wind Throne", alignment Minion):
 *   "Nearest Darkhaven: Dol Guldur
 *    Playable: Information, Items (minor, major)
 *    Automatic-attacks: Orcs — 3 strikes with 7 prowess"
 *
 * (The remaining card text is a flavor quote, not a rule.)
 *
 * Authoritative cost data (data/cards.json, LE-413):
 *   siteType  {R}  → ruins-and-lairs
 *   sitePath  {d}{w}{w}{s} → [dark, wilderness, wilderness, shadow]
 *   haven     Dol Guldur
 *   playable  Information, Items (minor, major)
 *   autoAttack Orcs - 3 strikes with 7 prowess
 *
 * Unlike the asterisked Raider-hold (le-399), the major-item line carries NO
 * restriction — any minor OR major item is playable here, but greater items
 * (which the site does not list) are not. "Information" is the resource
 * category consumed by info-gathering cards (le-226/240/241) whose play
 * gating reads the site's playableResources; The Wind Throne qualifies.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                  |
 * |---|-------------------|--------|--------------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — matches {R}                        |
 * | 2 | sitePath          | OK     | [dark, wilderness, wilderness, shadow] — {d}{w}{w}{s}  |
 * | 3 | nearestHaven      | OK     | "Dol Guldur" — valid minion darkhaven (le-367)         |
 * | 4 | region            | OK     | "Grey Mountain Narrows" — valid region                 |
 * | 5 | playableResources | OK     | [minor, major, information] — matches Playable line    |
 * | 6 | automaticAttacks  | OK     | Orcs — 3 strikes, prowess 7                            |
 * | 7 | resourceDraws     | OK     | 2                                                      |
 * | 8 | hazardDraws       | OK     | 2                                                      |
 *
 * Engine Support:
 * | # | Feature                          | Status      | Notes                                               |
 * |---|----------------------------------|-------------|-----------------------------------------------------|
 * | 1 | Site phase flow                  | IMPLEMENTED | select-company, enter-or-skip, play-resources       |
 * | 2 | Starter movement from haven      | IMPLEMENTED | Dol Guldur ↔ The Wind Throne (nearestHaven)         |
 * | 3 | Region movement                  | IMPLEMENTED | sites reachable within 4 regions                    |
 * | 4 | Minor / major items playable     | IMPLEMENTED | playableResources includes minor + major            |
 * | 5 | Greater items NOT playable       | IMPLEMENTED | "greater" absent from playableResources             |
 * | 6 | Information resources playable   | IMPLEMENTED | site-has-resource:information play-condition matches |
 * | 7 | Automatic attack (Orcs, 3×7)     | IMPLEMENTED | strikesTotal = 3, prowess 7, race orc, not detain.  |
 *
 * Playable: YES
 * Certified: 2026-06-16
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  LEGOLAS, LORIEN, RIVENDELL,
  resetMint, pool,
  buildTestState, viableActions, runAutoAttackCombatMulti,
  attachItemToChar, addCardToHand, RESOURCE_PLAYER,
} from '../test-helpers.js';
import {
  Phase, Alignment,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import { reduce } from '../../engine/reducer.js';
import type {
  CardDefinitionId, SiteCard, SitePhaseState, GameState, PlayShortEventAction,
} from '../../index.js';

const WIND_THRONE = 'le-413' as CardDefinitionId;       // minion ruins-and-lairs under test
const DOL_GULDUR = 'le-367' as CardDefinitionId;        // nearest darkhaven
const MORIA_LE = 'le-392' as CardDefinitionId;          // minion site that DOES allow greater items (control)

// Minion characters
const GORBAG = 'le-11' as CardDefinitionId;   // orc warrior/scout — generic item bearer
const LAGDUF = 'le-18' as CardDefinitionId;   // orc warrior
const SHAGRAT = 'le-39' as CardDefinitionId;  // orc warrior/ranger
const HADOR = 'le-14' as CardDefinitionId;    // dunadan sage — for the information play-condition test

// Minion items
const STRANGE_RATIONS = 'le-345' as CardDefinitionId;   // minor
const SABLE_SHIELD = 'le-341' as CardDefinitionId;      // major (no asterisk restriction at this site)
const SCROLL_OF_ISILDUR = 'le-343' as CardDefinitionId; // greater

// Information-resource card whose play gating reads the site's playableResources
const SECRETS_OF_THEIR_FORGING = 'le-226' as CardDefinitionId;
const LEAST_OF_GOLD_RINGS = 'le-315' as CardDefinitionId;

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

const autoAttackState = (): SitePhaseState => ({
  ...playResourcesState(),
  step: 'automatic-attacks',
  siteEntered: false,
});

/** Build a Ringwraith site-phase fixture at The Wind Throne (or another site). */
function siteState(opts: {
  site?: CardDefinitionId;
  characters: Array<CardDefinitionId | { defId: CardDefinitionId; items?: CardDefinitionId[] }>;
  hand?: CardDefinitionId[];
  phaseState?: SitePhaseState;
}): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: opts.site ?? WIND_THRONE, characters: opts.characters }],
        hand: opts.hand ?? [],
        siteDeck: [DOL_GULDUR],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Wizard,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [],
        siteDeck: [DOL_GULDUR],
      },
    ],
  });
  return { ...base, phaseState: opts.phaseState ?? playResourcesState() };
}

describe('The Wind Throne (le-413)', () => {
  beforeEach(() => resetMint());

  // ─── Movement: starter via the Dol Guldur darkhaven ─────────────────────────

  test('starter movement from Dol Guldur reaches The Wind Throne', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const starterIds = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.id);

    expect(starterIds).toContain(WIND_THRONE);
  });

  test('starter movement from The Wind Throne returns to Dol Guldur', () => {
    const windThrone = pool[WIND_THRONE as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, windThrone, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Dol Guldur');
  });

  test('starter movement from a hero haven does NOT reach minion The Wind Throne', () => {
    // The Wind Throne's nearest darkhaven is Dol Guldur; a hero haven cannot
    // starter to it.
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const starterIds = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.id);

    expect(starterIds).not.toContain(WIND_THRONE);
  });

  test('region movement from The Wind Throne stays within 4 regions', () => {
    const windThrone = pool[WIND_THRONE as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, windThrone, allSites);
    let regionCount = 0;
    for (const r of reachable) {
      if (r.movementType !== 'region') continue;
      regionCount++;
      expect(r.regionDistance!).toBeLessThanOrEqual(4);
    }
    expect(regionCount).toBeGreaterThan(0);
  });

  // ─── Item playability: minor + major allowed, greater denied ────────────────

  test('a minor minion item (Strange Rations) IS playable at The Wind Throne', () => {
    const state = siteState({ characters: [GORBAG], hand: [STRANGE_RATIONS] });
    const viable = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(viable.length).toBeGreaterThan(0);
  });

  test('a major minion item (Sable Shield) IS playable at The Wind Throne', () => {
    // No asterisk restriction here (unlike Raider-hold): any major item plays.
    const state = siteState({ characters: [GORBAG], hand: [SABLE_SHIELD] });
    const viable = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(viable.length).toBeGreaterThan(0);
  });

  test('a greater minion item (Scroll of Isildur) is NOT playable at The Wind Throne', () => {
    // The Wind Throne lists only minor + major items, not greater.
    const state = siteState({ characters: [GORBAG], hand: [SCROLL_OF_ISILDUR] });
    const viable = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(viable).toHaveLength(0);
  });

  test('control: the same greater item IS playable at Moria (which allows greater)', () => {
    // Regression guard: the greater item itself is playable — it is The Wind
    // Throne's playableResources (no "greater") that blocks it above.
    const state = siteState({ site: MORIA_LE, characters: [GORBAG], hand: [SCROLL_OF_ISILDUR] });
    const viable = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(viable.length).toBeGreaterThan(0);
  });

  // ─── Information playability ─────────────────────────────────────────────────

  test('an Information resource (Secrets of Their Forging) IS playable at The Wind Throne', () => {
    // Secrets of Their Forging is gated on `site-has-resource: information`; it
    // is offered only at a site that lists Information as playable. With a sage
    // (Hador) and a gold ring borne in the company, The Wind Throne qualifies.
    const base = siteState({ characters: [HADOR] });
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, HADOR, LEAST_OF_GOLD_RINGS);
    const withCard = addCardToHand(withRing, RESOURCE_PLAYER, SECRETS_OF_THEIR_FORGING);

    const plays = viableActions(withCard, PLAYER_1, 'play-short-event');
    expect(plays.length).toBeGreaterThanOrEqual(1);
    const action = plays[0].action as PlayShortEventAction;
    expect(action.targetScoutInstanceId).toBeTruthy();
    expect(action.targetGoldRingInstanceId).toBeTruthy();
  });

  test('control: the same Information resource is NOT playable at Moria (no Information)', () => {
    // Regression guard: Moria allows items but NOT Information, so the same
    // sage + gold ring setup does not offer Secrets of Their Forging there.
    const base = siteState({ site: MORIA_LE, characters: [HADOR] });
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, HADOR, LEAST_OF_GOLD_RINGS);
    const withCard = addCardToHand(withRing, RESOURCE_PLAYER, SECRETS_OF_THEIR_FORGING);

    const plays = viableActions(withCard, PLAYER_1, 'play-short-event');
    expect(plays).toHaveLength(0);
  });

  // ─── Automatic attack: Orcs — 3 strikes with 7 prowess ──────────────────────

  test('entering The Wind Throne triggers the Orc auto-attack (3 strikes, prowess 7)', () => {
    const state = siteState({
      characters: [GORBAG, LAGDUF, SHAGRAT],
      phaseState: autoAttackState(),
    });

    const { state: afterAttack, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(afterAttack.combat).not.toBeNull();
    expect(afterAttack.combat!.creatureRace).toBe('orc');
    expect(afterAttack.combat!.strikeProwess).toBe(7);
    expect(afterAttack.combat!.strikesTotal).toBe(3);
    // A standard multi-strike attack (not each-character): no pre-assignment.
    expect(afterAttack.combat!.strikeAssignments).toHaveLength(0);
    // ruins-and-lairs is neither dark-hold nor shadow-hold, so the §3.II.2.R1
    // auto-detainment branch does not fire — this is a regular wounding attack.
    expect(afterAttack.combat!.detainment).toBe(false);
  });

  test('after the Orc attack resolves, the company advances to declare-agent-attack', () => {
    const state = siteState({
      characters: [GORBAG, LAGDUF, SHAGRAT],
      phaseState: autoAttackState(),
    });

    // Resolve all three strikes; every defender taps and survives.
    const afterAttack = runAutoAttackCombatMulti(
      state,
      [
        { characterDefId: GORBAG, roll: 12, tapToFight: true, bodyRoll: 12 },
        { characterDefId: LAGDUF, roll: 12, tapToFight: true, bodyRoll: 12 },
        { characterDefId: SHAGRAT, roll: 12, tapToFight: true, bodyRoll: 12 },
      ],
      PLAYER_1,
      PLAYER_2,
    );
    expect(afterAttack.state.combat).toBeNull();
    const sps = afterAttack.state.phaseState as SitePhaseState;
    expect(sps.step).toBe('automatic-attacks');
    expect(sps.automaticAttacksResolved).toBe(1);

    // Next pass: no second attack → advance to declare-agent-attack.
    const { state: afterSkip, error } = reduce(afterAttack.state, { type: 'pass', player: PLAYER_1 });
    expect(error).toBeUndefined();
    expect(afterSkip.combat).toBeNull();
    expect((afterSkip.phaseState as SitePhaseState).step).toBe('declare-agent-attack');
  });
});
