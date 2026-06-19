/**
 * @module le-384.test
 *
 * Card test: Isengard (le-384)
 * Type: minion-site (ruins-and-lairs) in Gap of Isen
 * Effects: none — a vanilla minion site.
 *
 * Text (authoritative — cardnum MELE "Isengard", alignment Minion):
 *   "Nearest Darkhaven: Geann a-Lisch
 *    Playable: Information, Items (minor, major, gold ring)
 *    Automatic-attacks: Wolves — 3 strikes with 7 prowess"
 *
 * (The remaining card text is a flavor quote, not a rule.)
 *
 * Authoritative cost data (data/cards.json, LE-384):
 *   siteType   {R}  → ruins-and-lairs
 *   sitePath   {w}{s} → [wilderness, shadow]
 *   haven      Geann a-Lisch
 *   playable   Information, Items (minor, major, gold ring)
 *   autoAttack Wolves - 3 strikes with 7 prowess
 *   draw 1 (resource), drawOpponent 2 (hazard)
 *
 * Isengard's nearest darkhaven is Geann a-Lisch (LE-374). That darkhaven was
 * missing from the implemented pool until this change (Carn Dûm le-359 already
 * listed it in its havenPaths); it is added here so Isengard's starter-movement
 * connectivity resolves. Geann a-Lisch itself carries special rules ("no
 * resource storage", "counts as Ruins & Lairs for hazards") the engine does not
 * yet model, so Geann a-Lisch is NOT certified — but none of those rules affect
 * Isengard, whose own text is fully supported.
 *
 * Unlike Geann a-Lisch the darkhaven, Isengard's "Items (minor, major, gold
 * ring)" line lets minor, major, AND gold-ring items be played here, but not
 * greater items (which the site does not list). "Information" is the resource
 * category consumed by info-gathering cards (le-226) whose play gating reads the
 * site's playableResources.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                  |
 * |---|-------------------|--------|--------------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — matches {R}                        |
 * | 2 | sitePath          | OK     | [wilderness, shadow] — {w}{s}                          |
 * | 3 | nearestHaven      | OK     | "Geann a-Lisch" — darkhaven le-374 (added here)        |
 * | 4 | region            | OK     | "Gap of Isen" — valid region                           |
 * | 5 | playableResources | OK     | [information, minor, major, gold-ring]                 |
 * | 6 | automaticAttacks  | OK     | Wolves — 3 strikes, prowess 7                          |
 * | 7 | resourceDraws     | OK     | 1                                                      |
 * | 8 | hazardDraws       | OK     | 2                                                      |
 *
 * Engine Support:
 * | # | Feature                          | Status      | Notes                                               |
 * |---|----------------------------------|-------------|-----------------------------------------------------|
 * | 1 | Site phase flow                  | IMPLEMENTED | select-company, enter-or-skip, play-resources       |
 * | 2 | Starter movement from haven      | IMPLEMENTED | Geann a-Lisch ↔ Isengard (nearestHaven)             |
 * | 3 | Region movement                  | IMPLEMENTED | sites reachable within 4 regions                    |
 * | 4 | Minor / major / gold-ring items  | IMPLEMENTED | playableResources includes minor, major, gold-ring  |
 * | 5 | Greater items NOT playable       | IMPLEMENTED | "greater" absent from playableResources             |
 * | 6 | Information resources playable   | IMPLEMENTED | site-has-resource:information play-condition matches |
 * | 7 | Automatic attack (Wolves, 3×7)   | IMPLEMENTED | strikesTotal = 3, prowess 7, race wolf, not detain. |
 *
 * Playable: YES
 * Certified: 2026-06-19
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

const ISENGARD = 'le-384' as CardDefinitionId;        // minion ruins-and-lairs under test
const GEANN_A_LISCH = 'le-374' as CardDefinitionId;   // nearest darkhaven (added with this change)
const WIND_THRONE = 'le-413' as CardDefinitionId;     // minion site that does NOT allow gold-ring (control)
const MORIA_LE = 'le-392' as CardDefinitionId;        // minion site without Information (control)

// Minion characters
const GORBAG = 'le-11' as CardDefinitionId;   // orc warrior/scout — generic item bearer
const LAGDUF = 'le-18' as CardDefinitionId;   // orc warrior
const SHAGRAT = 'le-39' as CardDefinitionId;  // orc warrior/ranger
const HADOR = 'le-14' as CardDefinitionId;    // dunadan sage — for the information play-condition test

// Minion items
const STRANGE_RATIONS = 'le-345' as CardDefinitionId;   // minor
const SABLE_SHIELD = 'le-341' as CardDefinitionId;      // major
const SCROLL_OF_ISILDUR = 'le-343' as CardDefinitionId; // greater (NOT playable at Isengard)
const LEAST_OF_GOLD_RINGS = 'le-315' as CardDefinitionId; // gold-ring item

// Information-resource card whose play gating reads the site's playableResources
const SECRETS_OF_THEIR_FORGING = 'le-226' as CardDefinitionId;

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

/** Build a Ringwraith site-phase fixture at Isengard (or another site). */
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
        companies: [{ site: opts.site ?? ISENGARD, characters: opts.characters }],
        hand: opts.hand ?? [],
        siteDeck: [GEANN_A_LISCH],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Wizard,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [],
        siteDeck: [GEANN_A_LISCH],
      },
    ],
  });
  return { ...base, phaseState: opts.phaseState ?? playResourcesState() };
}

describe('Isengard (le-384)', () => {
  beforeEach(() => resetMint());

  // ─── Movement: starter via the Geann a-Lisch darkhaven ──────────────────────

  test('starter movement from Geann a-Lisch reaches Isengard', () => {
    const geann = pool[GEANN_A_LISCH as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, geann, allSites);
    const starterIds = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.id);

    expect(starterIds).toContain(ISENGARD);
  });

  test('starter movement from Isengard returns to Geann a-Lisch', () => {
    const isengard = pool[ISENGARD as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, isengard, allSites);
    const starterHavenNames = reachable
      .filter(r => r.movementType === 'starter' && r.site.siteType === 'haven')
      .map(r => r.site.name);

    expect(starterHavenNames).toContain('Geann a-Lisch');
  });

  test('starter movement from a hero haven does NOT reach minion Isengard', () => {
    // Isengard's nearest darkhaven is Geann a-Lisch; a hero haven cannot
    // starter to it.
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const starterIds = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.id);

    expect(starterIds).not.toContain(ISENGARD);
  });

  test('region movement from Isengard stays within 4 regions', () => {
    const isengard = pool[ISENGARD as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, isengard, allSites);
    let regionCount = 0;
    for (const r of reachable) {
      if (r.movementType !== 'region') continue;
      regionCount++;
      expect(r.regionDistance!).toBeLessThanOrEqual(4);
    }
    expect(regionCount).toBeGreaterThan(0);
  });

  // ─── Item playability: minor + major + gold-ring allowed, greater denied ────

  test('a minor minion item (Strange Rations) IS playable at Isengard', () => {
    const state = siteState({ characters: [GORBAG], hand: [STRANGE_RATIONS] });
    const viable = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(viable.length).toBeGreaterThan(0);
  });

  test('a major minion item (Sable Shield) IS playable at Isengard', () => {
    const state = siteState({ characters: [GORBAG], hand: [SABLE_SHIELD] });
    const viable = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(viable.length).toBeGreaterThan(0);
  });

  test('a gold-ring minion item (The Least of Gold Rings) IS playable at Isengard', () => {
    // Isengard's Playable line includes "gold ring"; the item plays as a normal
    // resource onto an untapped character.
    const state = siteState({ characters: [GORBAG], hand: [LEAST_OF_GOLD_RINGS] });
    const viable = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(viable.length).toBeGreaterThan(0);
  });

  test('control: the same gold ring is NOT playable at The Wind Throne (no gold-ring)', () => {
    // Regression guard: the gold ring itself is playable — it is Isengard's
    // playableResources (which lists "gold-ring") that allows it above; The Wind
    // Throne lists only minor + major + information.
    const state = siteState({ site: WIND_THRONE, characters: [GORBAG], hand: [LEAST_OF_GOLD_RINGS] });
    const viable = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(viable).toHaveLength(0);
  });

  test('a greater minion item (Scroll of Isildur) is NOT playable at Isengard', () => {
    // Isengard lists minor + major + gold-ring items, not greater.
    const state = siteState({ characters: [GORBAG], hand: [SCROLL_OF_ISILDUR] });
    const viable = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(viable).toHaveLength(0);
  });

  test('control: the same greater item IS playable at Moria (which allows greater)', () => {
    // Regression guard: the greater item itself is playable — it is Isengard's
    // playableResources (no "greater") that blocks it above.
    const state = siteState({ site: MORIA_LE, characters: [GORBAG], hand: [SCROLL_OF_ISILDUR] });
    const viable = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(viable.length).toBeGreaterThan(0);
  });

  // ─── Information playability ─────────────────────────────────────────────────

  test('an Information resource (Secrets of Their Forging) IS playable at Isengard', () => {
    // Secrets of Their Forging is gated on `site-has-resource: information`; it
    // is offered only at a site that lists Information as playable. With a sage
    // (Hador) and a gold ring borne in the company, Isengard qualifies.
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

  // ─── Automatic attack: Wolves — 3 strikes with 7 prowess ────────────────────

  test('entering Isengard triggers the Wolf auto-attack (3 strikes, prowess 7)', () => {
    const state = siteState({
      characters: [GORBAG, LAGDUF, SHAGRAT],
      phaseState: autoAttackState(),
    });

    const { state: afterAttack, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(afterAttack.combat).not.toBeNull();
    expect(afterAttack.combat!.creatureRace).toBe('wolf');
    expect(afterAttack.combat!.strikeProwess).toBe(7);
    expect(afterAttack.combat!.strikesTotal).toBe(3);
    // A standard multi-strike attack (not each-character): no pre-assignment.
    expect(afterAttack.combat!.strikeAssignments).toHaveLength(0);
    // ruins-and-lairs is neither dark-hold nor shadow-hold, so the §3.II.2.R1
    // auto-detainment branch does not fire — this is a regular wounding attack.
    expect(afterAttack.combat!.detainment).toBe(false);
  });

  test('after the Wolf attack resolves, the company advances to declare-agent-attack', () => {
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
