/**
 * @module le-402.test
 *
 * Card test: Shelob's Lair (le-402)
 * Type: minion-site (shadow-hold) in Imlad Morgul
 *
 * Text:
 *   "Nearest Darkhaven: Minas Morgul
 *    Playable: Items (minor, major)
 *    Automatic-attacks (2):
 *      (1st) Orcs — 2 strikes with 8 prowess
 *      (2nd) Spider (cannot be canceled) — 1 strike with 16 prowess;
 *            any character wounded is immediately eliminated
 *    Special: Contains a hoard. Non-Nazgûl creatures played at this site
 *    attack normally, not as detainment."
 *
 * Site Structural Checks (documented; verified behaviourally below):
 * | # | Property          | Notes                                                          |
 * |---|-------------------|----------------------------------------------------------------|
 * | 1 | siteType          | "shadow-hold"                                                  |
 * | 2 | sitePath          | [shadow] — matches {s}                                         |
 * | 3 | nearestHaven      | "Minas Morgul" (le-390)                                        |
 * | 4 | region            | "Imlad Morgul"                                                 |
 * | 5 | playableResources | [minor, major]                                                |
 * | 6 | keywords          | [hoard] — "Contains a hoard"                                   |
 * | 7 | automaticAttacks  | Orcs 2×8; Spider 1×16 (cannot-be-canceled, wound-eliminates)  |
 *
 * Engine Support:
 * | # | Feature                         | Status      | Notes                                                |
 * |---|---------------------------------|-------------|------------------------------------------------------|
 * | 1 | Site phase flow                 | IMPLEMENTED | select-company, enter-or-skip, play-resources        |
 * | 2 | Item playability                | IMPLEMENTED | minor/major via playableResources                    |
 * | 3 | Hoard item playability          | IMPLEMENTED | keywords:[hoard] satisfies item-play-site filter     |
 * | 4 | Haven path movement             | IMPLEMENTED | Minas Morgul ↔ Shelob's Lair via starter movement    |
 * | 5 | Two sequential auto-attacks     | IMPLEMENTED | Orcs (2×8) then Spider (1×16)                         |
 * | 6 | Spider cannot-be-canceled       | IMPLEMENTED | uncancelable suppresses cancel-attack actions        |
 * | 7 | Spider wound-eliminates         | IMPLEMENTED | wound → immediate elimination, no body check         |
 * | 8 | Attacks-not-detainment override | IMPLEMENTED | site-rule overrides §3.II.2 for non-Nazgûl attackers |
 *
 * Playable: YES
 * Certified: 2026-06-09
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  resetMint, pool,
  buildTestState, viableActions, dispatch, findCharInstanceId,
  runAutoAttackCombat, runAutoAttackCombatMulti,
} from '../test-helpers.js';
import type { CharacterEntry } from '../test-helpers.js';
import {
  Alignment, Phase, SiteType, RegionType, CardStatus,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import { isDetainmentAttack } from '../../engine/detainment.js';
import { Race } from '../../types/common.js';
import type {
  SiteCard, CardDefinitionId, GameState, SitePhaseState,
} from '../../index.js';

const SHELOBS_LAIR = 'le-402' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;   // nearest Darkhaven (haven)
const GOBLIN_GATE = 'le-378' as CardDefinitionId;     // non-hoard minion shadow-hold (baseline)
const GORBAG = 'le-11' as CardDefinitionId;           // orc, prowess 6, body 9
const LAGDUF = 'le-18' as CardDefinitionId;           // orc, prowess 5, body 8
const LIEUTENANT_OF_MORGUL = 'le-22' as CardDefinitionId;
const OLD_TREASURE = 'as-129' as CardDefinitionId;    // minor hoard item (ringwraith)
const DIVERSION = 'le-180' as CardDefinitionId;       // minion event: cancel any attack

// SitePhaseState skeleton at the automatic-attacks step.
const autoAttackBase: SitePhaseState = {
  phase: Phase.Site,
  step: 'automatic-attacks',
  activeCompanyIndex: 0,
  handledCompanyIds: [],
  siteEntered: false,
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
};

// Build a Ringwraith company at Shelob's Lair sitting at the automatic-attacks
// step. `resolved` selects which attack fires next: 0 → Orcs, 1 → Spider.
const atAutoAttack = (
  resolved: number,
  characters: CharacterEntry[],
  hand: CardDefinitionId[] = [],
): GameState => {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: SHELOBS_LAIR, characters }],
        hand,
        siteDeck: [MINAS_MORGUL],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Ringwraith,
        companies: [{ site: MINAS_MORGUL, characters: [LIEUTENANT_OF_MORGUL] }],
        hand: [],
        siteDeck: [GOBLIN_GATE],
      },
    ],
  });
  return { ...base, phaseState: { ...autoAttackBase, automaticAttacksResolved: resolved } };
};

// Build a Ringwraith company at a site sitting at the play-resources step.
const atPlayResources = (site: CardDefinitionId, hand: CardDefinitionId[]): GameState => {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site, characters: [GORBAG] }],
        hand,
        siteDeck: [MINAS_MORGUL],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Ringwraith,
        companies: [{ site: MINAS_MORGUL, characters: [LIEUTENANT_OF_MORGUL] }],
        hand: [],
        siteDeck: [GOBLIN_GATE],
      },
    ],
  });
  return { ...base, phaseState: { ...autoAttackBase, step: 'play-resources', siteEntered: true } };
};

const SHADOW_HOLD_KEYING = { siteTypes: [SiteType.ShadowHold] };

describe("Shelob's Lair (le-402)", () => {
  beforeEach(() => resetMint());

  // ─── Movement: Minas Morgul ↔ Shelob's Lair ─────────────────────────────────

  test("starter movement from Minas Morgul reaches Shelob's Lair", () => {
    const minasMorgul = pool[MINAS_MORGUL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, minasMorgul, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (SHELOBS_LAIR as string),
    );
    expect(starter).toBeDefined();
  });

  test("starter movement from Shelob's Lair returns to Minas Morgul", () => {
    const shelob = pool[SHELOBS_LAIR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, shelob, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (MINAS_MORGUL as string),
    );
    expect(starter).toBeDefined();
  });

  test("region movement from Shelob's Lair stays within 4 regions of Imlad Morgul", () => {
    const shelob = pool[SHELOBS_LAIR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, shelob, allSites);
    for (const r of reachable) {
      if (r.movementType !== 'region') continue;
      expect(r.regionDistance!).toBeLessThanOrEqual(4);
    }
  });

  // ─── Automatic attack 1: Orcs — 2 strikes with 8 prowess ────────────────────

  test('first automatic attack is Orcs — 2 strikes with 8 prowess, normal (cancelable) attack', () => {
    const triggered = dispatch(atAutoAttack(0, [GORBAG, LAGDUF]), { type: 'pass', player: PLAYER_1 });
    expect(triggered.combat).not.toBeNull();
    expect(triggered.combat!.attackSource.type).toBe('automatic-attack');
    expect(triggered.combat!.creatureRace).toBe('orc');
    expect(triggered.combat!.strikesTotal).toBe(2);
    expect(triggered.combat!.strikeProwess).toBe(8);
    // Orcs carry neither special spider rule.
    expect(triggered.combat!.uncancelable ?? false).toBe(false);
    expect(triggered.combat!.woundEliminates ?? false).toBe(false);
    // Override: non-Nazgûl auto-attack at this shadow-hold is NOT detainment.
    expect(triggered.combat!.detainment).toBe(false);
  });

  // ─── Automatic attack 2: Spider — 1 strike with 16 prowess ──────────────────

  test('second automatic attack is the Spider — 1 strike with 16 prowess, uncancelable, wound-eliminates', () => {
    const triggered = dispatch(atAutoAttack(1, [GORBAG, LAGDUF]), { type: 'pass', player: PLAYER_1 });
    expect(triggered.combat).not.toBeNull();
    expect(triggered.combat!.attackSource.type).toBe('automatic-attack');
    expect(triggered.combat!.creatureRace).toBe('spider');
    expect(triggered.combat!.strikesTotal).toBe(1);
    expect(triggered.combat!.strikeProwess).toBe(16);
    expect(triggered.combat!.uncancelable).toBe(true);
    expect(triggered.combat!.woundEliminates).toBe(true);
    expect(triggered.combat!.detainment).toBe(false);
  });

  // ─── Spider: "any character wounded is immediately eliminated" ───────────────

  test('Spider wounds a character → immediately eliminated, no body check', () => {
    // Gorbag (prowess 6) taps to fight; roll 2 → 8 < 16 → wounded. With
    // wound-eliminates the character is eliminated outright (no body check).
    const state = atAutoAttack(1, [GORBAG]);
    const gorbagId = findCharInstanceId(state, 0, GORBAG);

    const result = runAutoAttackCombat(state, GORBAG, 2, null, true);

    // Combat finalized without ever entering a body-check phase.
    expect(result.state.combat).toBeNull();
    const p0 = result.state.players[0];
    expect(p0.outOfPlayPile.some(c => c.definitionId === (GORBAG as string))).toBe(true);
    expect(p0.characters[gorbagId]).toBeUndefined();
  });

  test('Spider strike that is defeated does NOT eliminate the character', () => {
    // Gorbag (prowess 6) taps; roll 12 → 18 > 16 → defeats the strike. The
    // Spider has no body, so the character simply taps and survives.
    const state = atAutoAttack(1, [GORBAG]);
    const gorbagId = findCharInstanceId(state, 0, GORBAG);

    const result = runAutoAttackCombat(state, GORBAG, 12, null, true);

    expect(result.state.combat).toBeNull();
    const p0 = result.state.players[0];
    expect(p0.outOfPlayPile.some(c => c.definitionId === (GORBAG as string))).toBe(false);
    expect(p0.characters[gorbagId]).toBeDefined();
    expect(p0.characters[gorbagId].status).toBe(CardStatus.Tapped);
  });

  // ─── Contrast: a normal (Orc) wound goes through a body check ────────────────

  test('Orc wound goes through a body check (not immediate elimination)', () => {
    // Gorbag stays untapped (-3 → prowess 3); roll 2 → 5 < 8 → wounded.
    // A low body roll (2 ≤ body 9) means he survives the body check, wounded.
    const state = atAutoAttack(0, [GORBAG, LAGDUF]);
    const gorbagId = findCharInstanceId(state, 0, GORBAG);

    const result = runAutoAttackCombatMulti(state, [
      { characterDefId: GORBAG, roll: 2, tapToFight: false, bodyRoll: 2 },
      { characterDefId: LAGDUF, roll: 12, tapToFight: true },
    ]);

    const p0 = result.state.players[0];
    // Survived the body check: still in play and wounded (inverted), not eliminated.
    expect(p0.outOfPlayPile.some(c => c.definitionId === (GORBAG as string))).toBe(false);
    expect(p0.characters[gorbagId]).toBeDefined();
    expect(p0.characters[gorbagId].status).toBe(CardStatus.Inverted);
  });

  // ─── Spider: "cannot be canceled" ───────────────────────────────────────────

  test('a cancel-attack card can cancel the Orc attack but NOT the Spider', () => {
    // Diversion (le-180) cancels any attack on an unwounded character.
    const orcTriggered = dispatch(atAutoAttack(0, [GORBAG, LAGDUF], [DIVERSION]), { type: 'pass', player: PLAYER_1 });
    expect(orcTriggered.combat).not.toBeNull();
    const orcCancels = viableActions(orcTriggered, PLAYER_1, 'cancel-attack');
    expect(orcCancels.length).toBeGreaterThan(0);

    const spiderTriggered = dispatch(atAutoAttack(1, [GORBAG, LAGDUF], [DIVERSION]), { type: 'pass', player: PLAYER_1 });
    expect(spiderTriggered.combat).not.toBeNull();
    const spiderCancels = viableActions(spiderTriggered, PLAYER_1, 'cancel-attack');
    expect(spiderCancels.length).toBe(0);
  });

  // ─── "Contains a hoard": hoard-item playability ─────────────────────────────

  test('hoard item (Old Treasure) is playable at Shelob\'s Lair', () => {
    const state = atPlayResources(SHELOBS_LAIR, [OLD_TREASURE]);
    const playable = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playable.length).toBeGreaterThan(0);
  });

  test('the same hoard item is NOT playable at a non-hoard shadow-hold (Goblin-gate)', () => {
    // Goblin-gate (le-378) is a minion shadow-hold without the hoard keyword.
    // Old Treasure's item-play-site filter (site.keywords includes hoard) fails.
    const state = atPlayResources(GOBLIN_GATE, [OLD_TREASURE]);
    const playable = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playable.length).toBe(0);
  });

  // ─── "Non-Nazgûl creatures attack normally, not as detainment" ──────────────

  test('non-Nazgûl creature keyed to this shadow-hold: detainment overridden to false', () => {
    const shelobDef = pool[SHELOBS_LAIR as string] as SiteCard;
    const detainment = isDetainmentAttack({
      attackRace: Race.Orc,
      attackKeyedTo: [SHADOW_HOLD_KEYING],
      defendingAlignment: Alignment.Ringwraith,
      defendingSiteEffects: shelobDef.effects,
    });
    expect(detainment).toBe(false);
  });

  test('Spider race is also non-Nazgûl: override applies', () => {
    const shelobDef = pool[SHELOBS_LAIR as string] as SiteCard;
    const detainment = isDetainmentAttack({
      attackRace: Race.Spider,
      attackKeyedTo: [SHADOW_HOLD_KEYING],
      defendingAlignment: Alignment.Ringwraith,
      defendingSiteEffects: shelobDef.effects,
    });
    expect(detainment).toBe(false);
  });

  test('baseline: the same Orc attack WITHOUT the site override is detainment', () => {
    const detainment = isDetainmentAttack({
      attackRace: Race.Orc,
      attackKeyedTo: [SHADOW_HOLD_KEYING],
      defendingAlignment: Alignment.Ringwraith,
    });
    expect(detainment).toBe(true);
  });

  test('Nazgûl attacker: override filter skips it, detainment preserved', () => {
    const shelobDef = pool[SHELOBS_LAIR as string] as SiteCard;
    const detainment = isDetainmentAttack({
      attackRace: 'ringwraith' as Race,
      attackKeyedTo: [{ regionTypes: [RegionType.Dark] }],
      defendingAlignment: Alignment.Ringwraith,
      defendingSiteEffects: shelobDef.effects,
    });
    expect(detainment).toBe(true);
  });
});
