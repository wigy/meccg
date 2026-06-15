/**
 * @module le-371.test
 *
 * Card test: Easterling Camp (le-371)
 * Type: minion-site (border-hold) in Horse Plains
 * Effects: 1 (combat-detainment gated on defender.covert)
 *
 * Text:
 *   "Nearest Darkhaven: Dol Guldur
 *    Automatic-attacks:
 *      Men — each character faces 1 strike with 5 prowess
 *        (detainment against covert company)"
 *
 * Rules interpretation (MELE site guardians, confirmed against the published
 * rulings, same shape as Minas Tirith le-391's first attack): the single Men
 * automatic-attack is faced by EVERY company entering the site — it is a
 * detainment attack against a covert company and a regular (wounding) attack
 * against an overt company. Easterling Camp is a border-hold, so the
 * §3.II.2.R1 dark-hold/shadow-hold auto-detainment branch does NOT fire and
 * a Man keyed to a border-hold does not satisfy the §3.II.2.R2 Shadow-land
 * branch either; detainment comes solely from the site's `combat-detainment`
 * effect gated on `defender.covert`.
 *
 * Data encoding:
 *   - Men attack: `combatRules: ["each-character"]`, 1 strike, prowess 5,
 *     no `appliesTo` (faced by all companies).
 *   - Site effect `combat-detainment` gated on `defender.covert` — makes the
 *     Men attack detainment against a covert company only.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                          |
 * |---|-------------------|--------|------------------------------------------------|
 * | 1 | siteType          | OK     | "border-hold" — valid ({B})                    |
 * | 2 | sitePath          | OK     | [dark, wilderness, shadow] — matches {d}{w}{s} |
 * | 3 | nearestHaven      | OK     | "Dol Guldur" — valid minion haven (le-367)     |
 * | 4 | region            | OK     | "Horse Plains" — valid region                  |
 * | 5 | playableResources | OK     | [] — text lists no Playable: line              |
 * | 6 | automaticAttacks  | OK     | Men (each-character, 1 strike, prowess 5)      |
 * | 7 | resourceDraws     | OK     | 2                                              |
 * | 8 | hazardDraws       | OK     | 2                                              |
 *
 * Engine Support:
 * | # | Feature                          | Status      | Notes                                                |
 * |---|----------------------------------|-------------|------------------------------------------------------|
 * | 1 | Site phase flow                  | IMPLEMENTED | select-company, enter-or-skip, play-resources        |
 * | 2 | Starter movement from haven      | IMPLEMENTED | Dol Guldur → Easterling Camp (nearestHaven)          |
 * | 3 | Auto-attack (each-character)     | IMPLEMENTED | strikesTotal = company size, 1 strike per character  |
 * | 4 | Detainment vs covert company     | IMPLEMENTED | combat-detainment site effect + defendingCovert wire |
 * | 5 | Regular attack vs overt company  | IMPLEMENTED | Men attack not detainment when company is overt      |
 * | 6 | Single attack → declare-agent    | IMPLEMENTED | after the one attack, advance past automatic-attacks |
 *
 * Playable: YES
 * Certified: 2026-06-15
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  LEGOLAS,
  LORIEN,
  resetMint, pool,
  buildTestState, runAutoAttackCombatMulti,
} from '../test-helpers.js';
import {
  Phase, Alignment, SiteType, type Race,
} from '../../index.js';
import { isDetainmentAttack } from '../../engine/detainment.js';
import { reduce } from '../../engine/reducer.js';
import type { SiteCard, CardDefinitionId, GameState, SitePhaseState } from '../../index.js';

const EASTERLING_CAMP = 'le-371' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;

// Minion characters. Men do not make a company overt; an Orc does.
const THE_MOUTH = 'le-24' as CardDefinitionId; // Man
const ASTERNAK = 'le-1' as CardDefinitionId; // Man
const ORC_CAPTAIN = 'le-31' as CardDefinitionId; // Orc → makes the company overt

/** Build a Ringwraith site-phase state at the automatic-attacks step. */
function siteAutoAttackStep(characters: CardDefinitionId[]): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: EASTERLING_CAMP, characters }],
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

describe('Easterling Camp (le-371)', () => {
  beforeEach(() => resetMint());

  // ─── Detainment helper: covert vs overt at a border-hold ────────────────────
  // Easterling Camp is a border-hold, so the §3.II.2.R1 dark-hold/shadow-hold
  // branch does NOT fire, and a Man keyed to a border-hold does not satisfy the
  // §3.II.2.R2 Shadow-land branch. Detainment comes solely from the site's
  // combat-detainment effect gated on defender.covert.

  test('covert Ringwraith company: Men auto-attack is detainment (site effect)', () => {
    const siteDef = pool[EASTERLING_CAMP as string] as SiteCard;
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
    const siteDef = pool[EASTERLING_CAMP as string] as SiteCard;
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

  // ─── Covert company: faces the Men attack as detainment ─────────────────────

  test('covert company: Men attack is each-character detainment with prowess 5', () => {
    const state = siteAutoAttackStep([THE_MOUTH, ASTERNAK]);

    const { state: afterAttack, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(afterAttack.combat).not.toBeNull();
    expect(afterAttack.combat!.creatureRace).toBe('man');
    expect(afterAttack.combat!.strikeProwess).toBe(5);
    // each-character: one strike pre-assigned per character (company size 2)
    expect(afterAttack.combat!.strikesTotal).toBe(2);
    expect(afterAttack.combat!.strikeAssignments).toHaveLength(2);
    expect(afterAttack.combat!.eachCharacterFacesOneStrike).toBe(true);
    // Covert company → Men attack is detainment.
    expect(afterAttack.combat!.detainment).toBe(true);
  });

  test('covert company: after the single Men attack, advance to declare-agent-attack', () => {
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

    // Next pass: there is no second attack → advance to declare-agent-attack.
    const { state: afterSkip, error } = reduce(afterMen.state, { type: 'pass', player: PLAYER_1 });
    expect(error).toBeUndefined();
    expect(afterSkip.combat).toBeNull();
    expect((afterSkip.phaseState as SitePhaseState).step).toBe('declare-agent-attack');
  });

  // ─── Overt company: faces the Men attack as a regular (wounding) attack ─────

  test('overt company: Men attack is each-character but NOT detainment', () => {
    const state = siteAutoAttackStep([ORC_CAPTAIN, THE_MOUTH]);

    const { state: afterAttack, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(afterAttack.combat).not.toBeNull();
    expect(afterAttack.combat!.creatureRace).toBe('man');
    expect(afterAttack.combat!.strikeProwess).toBe(5);
    expect(afterAttack.combat!.strikesTotal).toBe(2);
    // Overt company → Men attack is a regular (non-detainment) attack.
    expect(afterAttack.combat!.detainment).toBe(false);
  });

  test('overt company: after the regular Men attack, advance to declare-agent-attack', () => {
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

    // Next pass: no second attack → advance to declare-agent-attack.
    const { state: afterNext, error } = reduce(afterMen.state, { type: 'pass', player: PLAYER_1 });
    expect(error).toBeUndefined();
    expect(afterNext.combat).toBeNull();
    expect((afterNext.phaseState as SitePhaseState).step).toBe('declare-agent-attack');
  });
});
