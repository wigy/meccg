/**
 * @module le-385.test
 *
 * Card test: Lake-town (le-385)
 * Type: minion-site (border-hold) in Northern Rhovanion
 * Effects: 1 (combat-detainment gated on defender.covert)
 *
 * Text:
 *   "Nearest Darkhaven: Dol Guldur
 *    Playable: Information
 *    Automatic-attacks:
 *      Men — each character faces 1 strike with 6 prowess
 *        (detainment against covert company)"
 *
 * Rules interpretation (MELE site guardians, confirmed against the published
 * rulings): an attack marked "(detainment against covert company)" is faced by
 * EVERY company — it is a detainment attack against a covert company and a
 * regular (non-detainment) attack against an overt company. So:
 *   - A covert company faces the Men attack as detainment.
 *   - An overt company faces the Men attack as a regular attack.
 *
 * Data encoding:
 *   - Men attack: `combatRules: ["each-character"]`, prowess 6, no `appliesTo`
 *     (faced by all companies, one strike per character).
 *   - Site effect `combat-detainment` gated on `defender.covert` — makes the
 *     Men attack detainment against a covert company only. Lake-town is a
 *     Border-hold, so the §3.II.2.R1 dark-hold/shadow-hold inherent-detainment
 *     branch does NOT fire; detainment comes solely from this site effect.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                            |
 * |---|-------------------|--------|--------------------------------------------------|
 * | 1 | siteType          | OK     | "border-hold" — valid ({B})                      |
 * | 2 | sitePath          | OK     | [dark, wilderness, wilderness] — matches {d}{w}{w}|
 * | 3 | nearestHaven      | OK     | "Dol Guldur" — valid minion haven (le-367)       |
 * | 4 | region            | OK     | "Northern Rhovanion" — valid region              |
 * | 5 | playableResources | OK     | [information] — matches text                     |
 * | 6 | automaticAttacks  | OK     | Men (each-character, 1 strike, p6)               |
 * | 7 | resourceDraws     | OK     | 2                                                |
 * | 8 | hazardDraws       | OK     | 2                                                |
 *
 * Engine Support:
 * | # | Feature                          | Status      | Notes                                         |
 * |---|----------------------------------|-------------|-----------------------------------------------|
 * | 1 | Site phase flow                  | IMPLEMENTED | select-company, enter-or-skip, play-resources |
 * | 2 | Haven path movement              | IMPLEMENTED | Dol Guldur ↔ Lake-town via starter movement   |
 * | 3 | Auto-attack (each-character)     | IMPLEMENTED | 1 strike per character, prowess 6             |
 * | 4 | Detainment vs covert company     | IMPLEMENTED | combat-detainment site effect + defendingCovert|
 * | 5 | Regular attack vs overt company  | IMPLEMENTED | Men attack not detainment when company overt  |
 *
 * Playable: YES
 * Certified: 2026-07-21
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  LEGOLAS,
  LORIEN, RIVENDELL,
  resetMint, pool,
  buildTestState, runAutoAttackCombatMulti,
} from '../test-helpers.js';
import {
  isSiteCard, buildMovementMap, getReachableSites, Phase, Alignment, SiteType, type Race,
} from '../../index.js';
import { isDetainmentAttack } from '../../engine/detainment.js';
import { reduce } from '../../engine/reducer.js';
import type { SiteCard, CardDefinitionId, GameState, SitePhaseState } from '../../index.js';

const LAKE_TOWN = 'le-385' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId; // minion Darkhaven, Lake-town's nearest haven

// Minion characters. Men do not make a company overt; an Orc does.
const THE_MOUTH = 'le-24' as CardDefinitionId; // Man
const ASTERNAK = 'le-1' as CardDefinitionId; // Man
const ORC_CAPTAIN = 'le-31' as CardDefinitionId; // Orc → makes the company overt

/** Build a Ringwraith site-phase state at Lake-town's automatic-attacks step. */
function siteAutoAttackStep(characters: CardDefinitionId[]): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: LAKE_TOWN, characters }],
        hand: [],
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

  const sitePhaseState: SitePhaseState = {
    phase: Phase.Site,
    step: 'automatic-attacks' as const,
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
  return { ...base, phaseState: sitePhaseState };
}

describe('Lake-town (le-385)', () => {
  beforeEach(() => resetMint());

  // ─── Movement: Dol Guldur ↔ Lake-town ──────────────────────────────────────

  test('starter movement from Dol Guldur reaches Lake-town (le-385)', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (LAKE_TOWN as string),
    );

    expect(starter).toBeDefined();
  });

  test('starter movement from the hero haven does NOT reach minion Lake-town (le-385)', () => {
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (LAKE_TOWN as string),
    );

    expect(starter).toBeUndefined();
  });

  // ─── Detainment helper: covert vs overt at a border-hold ────────────────────
  // Lake-town is a border-hold, so the §3.II.2.R1 dark-hold/shadow-hold branch
  // does NOT fire. Detainment comes solely from the site's combat-detainment
  // effect gated on defender.covert.

  test('covert Ringwraith company: Men auto-attack is detainment (site effect)', () => {
    const siteDef = pool[LAKE_TOWN as string] as SiteCard;
    const detainment = isDetainmentAttack({
      attackRace: 'man' as Race,
      attackKeyedTo: [{ siteTypes: [SiteType.BorderHold] }],
      defendingAlignment: Alignment.Ringwraith,
      defendingCovert: true,
      attackEffects: siteDef.effects,
      defendingSiteEffects: siteDef.effects,
    });
    expect(detainment).toBe(true);
  });

  test('overt Ringwraith company: Men auto-attack is NOT detainment', () => {
    const siteDef = pool[LAKE_TOWN as string] as SiteCard;
    const detainment = isDetainmentAttack({
      attackRace: 'man' as Race,
      attackKeyedTo: [{ siteTypes: [SiteType.BorderHold] }],
      defendingAlignment: Alignment.Ringwraith,
      defendingCovert: false,
      attackEffects: siteDef.effects,
      defendingSiteEffects: siteDef.effects,
    });
    expect(detainment).toBe(false);
  });

  test('baseline: without the site effect, covert company vs Men at border-hold is NOT detainment', () => {
    const detainment = isDetainmentAttack({
      attackRace: 'man' as Race,
      attackKeyedTo: [{ siteTypes: [SiteType.BorderHold] }],
      defendingAlignment: Alignment.Ringwraith,
      defendingCovert: true,
    });
    expect(detainment).toBe(false);
  });

  // ─── Covert company: faces Men as each-character detainment ─────────────────

  test('covert company: Men attack is each-character detainment with prowess 6', () => {
    const state = siteAutoAttackStep([THE_MOUTH, ASTERNAK]);

    const { state: afterAttack, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(afterAttack.combat).not.toBeNull();
    expect(afterAttack.combat!.creatureRace).toBe('man');
    expect(afterAttack.combat!.strikeProwess).toBe(6);
    // each-character: one strike pre-assigned per character (company size 2)
    expect(afterAttack.combat!.strikesTotal).toBe(2);
    expect(afterAttack.combat!.strikeAssignments).toHaveLength(2);
    expect(afterAttack.combat!.eachCharacterFacesOneStrike).toBe(true);
    // Covert company → Men attack is detainment.
    expect(afterAttack.combat!.detainment).toBe(true);
  });

  test('covert company: after the single Men attack, advances to declare-agent-attack', () => {
    const state = siteAutoAttackStep([THE_MOUTH, ASTERNAK]);

    // Resolve the Men detainment attack fully (both characters succeed).
    const afterMen = runAutoAttackCombatMulti(
      state,
      [
        { characterDefId: THE_MOUTH, roll: 12, tapToFight: true },
        { characterDefId: ASTERNAK, roll: 12, tapToFight: true },
      ],
      PLAYER_1,
      PLAYER_2,
    );
    expect(afterMen.state.combat).toBeNull();
    const sps = afterMen.state.phaseState as SitePhaseState;
    expect(sps.step).toBe('automatic-attacks');
    expect(sps.automaticAttacksResolved).toBe(1);

    // Lake-town has only one automatic-attack → next pass advances past attacks.
    const { state: afterPass, error } = reduce(afterMen.state, { type: 'pass', player: PLAYER_1 });
    expect(error).toBeUndefined();
    expect(afterPass.combat).toBeNull();
    expect((afterPass.phaseState as SitePhaseState).step).toBe('declare-agent-attack');
  });

  // ─── Overt company: faces Men as a regular (non-detainment) attack ──────────

  test('overt company: Men attack is each-character but NOT detainment', () => {
    const state = siteAutoAttackStep([ORC_CAPTAIN, THE_MOUTH]);

    const { state: afterAttack, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(afterAttack.combat).not.toBeNull();
    expect(afterAttack.combat!.creatureRace).toBe('man');
    expect(afterAttack.combat!.strikeProwess).toBe(6);
    expect(afterAttack.combat!.strikesTotal).toBe(2);
    // Overt company → Men attack is a regular (non-detainment) attack.
    expect(afterAttack.combat!.detainment).toBe(false);
  });

  test('overt company: after the single Men attack, advances to declare-agent-attack', () => {
    const state = siteAutoAttackStep([ORC_CAPTAIN, THE_MOUTH]);

    // Resolve the (regular) Men each-character attack; both characters survive.
    const afterMen = runAutoAttackCombatMulti(
      state,
      [
        { characterDefId: ORC_CAPTAIN, roll: 12, tapToFight: true, bodyRoll: 12 },
        { characterDefId: THE_MOUTH, roll: 12, tapToFight: true, bodyRoll: 12 },
      ],
      PLAYER_1,
      PLAYER_2,
    );
    expect(afterMen.state.combat).toBeNull();
    expect((afterMen.state.phaseState as SitePhaseState).automaticAttacksResolved).toBe(1);

    // Only one automatic-attack → the overt company faces no further combat.
    const { state: afterPass, error } = reduce(afterMen.state, { type: 'pass', player: PLAYER_1 });
    expect(error).toBeUndefined();
    expect(afterPass.combat).toBeNull();
    expect((afterPass.phaseState as SitePhaseState).step).toBe('declare-agent-attack');
  });
});
