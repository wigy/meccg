/**
 * @module le-366.test
 *
 * Card test: Dol Amroth (le-366)
 * Type: minion-site (free-hold) in Belfalas
 * Effects: 1 (combat-detainment gated on defender.covert)
 *
 * Text:
 *   "Nearest Darkhaven: Minas Morgul
 *    Playable: Information, Items (minor, major, gold ring)
 *    Automatic-attacks (2):
 *      (1st) Men — each character faces 1 strike with 8 prowess
 *        (detainment against covert company)
 *      (2nd) Dúnedain — 3 strikes with 10 prowess
 *        (against overt company only)"
 *
 * Dol Amroth is the exact structural mirror of Minas Tirith (le-391) — the same
 * MELE free-hold guardian shape — with lower numbers (Men prowess 8 not 9;
 * Dúnedain 3 strikes not 4).
 *
 * Rules interpretation (MELE site guardians, confirmed against the published
 * rulings): an attack marked "(detainment against covert company)" is faced by
 * EVERY company — it is a detainment attack against a covert company and a
 * regular (non-detainment) attack against an overt company. An attack marked
 * "(against overt company only)" is faced ONLY by an overt company. So:
 *   - A covert company faces only the Men attack, as detainment.
 *   - An overt company faces the Men attack (regular) AND the Dúnedain attack.
 *
 * Data encoding:
 *   - Men attack: `combatRules: ["each-character"]`, prowess 8, no `appliesTo`
 *     (faced by all companies).
 *   - Dúnedain attack: 3 strikes, prowess 10, `appliesTo: "overt"`.
 *   - Site effect `combat-detainment` gated on `defender.covert` — makes the
 *     Men attack detainment against a covert company (the Dúnedain attack is
 *     never faced by a covert company, so it is never flagged detainment).
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                  |
 * |---|-------------------|--------|--------------------------------------------------------|
 * | 1 | siteType          | OK     | "free-hold" — valid                                    |
 * | 2 | sitePath          | OK     | [shadow, wilderness, free, free, free] — {s}{w}{f}{f}{f}|
 * | 3 | nearestHaven      | OK     | "Minas Morgul" — valid minion haven (le-390)           |
 * | 4 | region            | OK     | "Belfalas" — valid region                              |
 * | 5 | playableResources | OK     | [minor, major, gold-ring, information] — matches text  |
 * | 6 | automaticAttacks  | OK     | Men (each-character, p8) + Dúnedain (3×p10, overt-only)|
 * | 7 | resourceDraws     | OK     | 2                                                      |
 * | 8 | hazardDraws       | OK     | 4                                                      |
 *
 * Engine Support:
 * | # | Feature                          | Status      | Notes                                                |
 * |---|----------------------------------|-------------|------------------------------------------------------|
 * | 1 | Site phase flow                  | IMPLEMENTED | select-company, enter-or-skip, play-resources        |
 * | 2 | Haven path movement              | IMPLEMENTED | Minas Morgul → Dol Amroth via starter movement       |
 * | 3 | Auto-attack (each-character)     | IMPLEMENTED | strikesTotal = company size, 1 strike per character  |
 * | 4 | Auto-attack (multi-strike)       | IMPLEMENTED | Dúnedain: 3 strikes total, prowess 10                |
 * | 5 | appliesTo: 'overt' filtering     | IMPLEMENTED | Dúnedain skipped vs covert company (reducer-site)    |
 * | 6 | Detainment vs covert company     | IMPLEMENTED | combat-detainment site effect + defendingCovert wire |
 * | 7 | Regular attack vs overt company  | IMPLEMENTED | Men attack not detainment when company is overt      |
 *
 * Playable: YES
 * Certified: 2026-07-17
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
  isSiteCard, buildMovementMap, getReachableSites, Phase, Alignment, SiteType, type Race,
} from '../../index.js';
import { isDetainmentAttack } from '../../engine/detainment.js';
import { reduce } from '../../engine/reducer.js';
import type { SiteCard, CardDefinitionId, GameState, SitePhaseState } from '../../index.js';

const DOL_AMROTH = 'le-366' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;

// Minion characters. Men/Dúnedain do not make a company overt; an Orc does.
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
        companies: [{ site: DOL_AMROTH, characters }],
        hand: [],
        siteDeck: [MINAS_MORGUL],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Wizard,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [],
        siteDeck: [MINAS_MORGUL],
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

describe('Dol Amroth (le-366)', () => {
  beforeEach(() => resetMint());

  // ─── Movement: Minas Morgul → Dol Amroth ────────────────────────────────────

  test('starter movement from Minas Morgul reaches Dol Amroth (le-366)', () => {
    const minasMorgul = pool[MINAS_MORGUL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, minasMorgul, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (DOL_AMROTH as string),
    );

    expect(starter).toBeDefined();
  });

  // ─── Detainment helper: covert vs overt at a free-hold ──────────────────────
  // Dol Amroth is a free-hold, so the §3.II.2.R1 dark-hold/shadow-hold branch
  // does NOT fire. Detainment comes solely from the site's combat-detainment
  // effect gated on defender.covert.

  test('covert Ringwraith company: Men auto-attack is detainment (site effect)', () => {
    const siteDef = pool[DOL_AMROTH as string] as SiteCard;
    const detainment = isDetainmentAttack({
      attackRace: 'man' as Race,
      attackKeyedTo: [{ siteTypes: [SiteType.FreeHold] }],
      defendingAlignment: Alignment.Ringwraith,
      defendingCovert: true,
      attackEffects: siteDef.effects,
      defendingSiteEffects: siteDef.effects,
    });
    expect(detainment).toBe(true);
  });

  test('overt Ringwraith company: Men auto-attack is NOT detainment', () => {
    const siteDef = pool[DOL_AMROTH as string] as SiteCard;
    const detainment = isDetainmentAttack({
      attackRace: 'man' as Race,
      attackKeyedTo: [{ siteTypes: [SiteType.FreeHold] }],
      defendingAlignment: Alignment.Ringwraith,
      defendingCovert: false,
      attackEffects: siteDef.effects,
      defendingSiteEffects: siteDef.effects,
    });
    expect(detainment).toBe(false);
  });

  test('baseline: without the site effect, covert company vs Men at free-hold is NOT detainment', () => {
    const detainment = isDetainmentAttack({
      attackRace: 'man' as Race,
      attackKeyedTo: [{ siteTypes: [SiteType.FreeHold] }],
      defendingAlignment: Alignment.Ringwraith,
      defendingCovert: true,
    });
    expect(detainment).toBe(false);
  });

  // ─── Covert company: faces Men (detainment), skips Dúnedain ─────────────────

  test('covert company: Men attack is each-character detainment with prowess 8', () => {
    const state = siteAutoAttackStep([THE_MOUTH, ASTERNAK]);

    const { state: afterAttack, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(afterAttack.combat).not.toBeNull();
    expect(afterAttack.combat!.creatureRace).toBe('man');
    expect(afterAttack.combat!.strikeProwess).toBe(8);
    // each-character: one strike pre-assigned per character (company size 2)
    expect(afterAttack.combat!.strikesTotal).toBe(2);
    expect(afterAttack.combat!.strikeAssignments).toHaveLength(2);
    expect(afterAttack.combat!.eachCharacterFacesOneStrike).toBe(true);
    // Covert company → Men attack is detainment.
    expect(afterAttack.combat!.detainment).toBe(true);
  });

  test('covert company: Dúnedain attack is skipped (advances to declare-agent-attack)', () => {
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

    // Next pass: the overt-only Dúnedain attack is skipped for a covert
    // company → no second combat, advance to declare-agent-attack.
    const { state: afterSkip, error } = reduce(afterMen.state, { type: 'pass', player: PLAYER_1 });
    expect(error).toBeUndefined();
    expect(afterSkip.combat).toBeNull();
    expect((afterSkip.phaseState as SitePhaseState).step).toBe('declare-agent-attack');
  });

  // ─── Overt company: faces Men (regular) then Dúnedain ──────────────────────

  test('overt company: Men attack is each-character but NOT detainment', () => {
    const state = siteAutoAttackStep([ORC_CAPTAIN, THE_MOUTH]);

    const { state: afterAttack, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(afterAttack.combat).not.toBeNull();
    expect(afterAttack.combat!.creatureRace).toBe('man');
    expect(afterAttack.combat!.strikeProwess).toBe(8);
    expect(afterAttack.combat!.strikesTotal).toBe(2);
    // Overt company → Men attack is a regular (non-detainment) attack.
    expect(afterAttack.combat!.detainment).toBe(false);
  });

  test('overt company: after Men, faces the Dúnedain attack (3 strikes, prowess 10, not detainment)', () => {
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

    // Next pass: the overt company faces the Dúnedain attack.
    const { state: afterDun, error } = reduce(afterMen.state, { type: 'pass', player: PLAYER_1 });
    expect(error).toBeUndefined();
    expect(afterDun.combat).not.toBeNull();
    expect(afterDun.combat!.creatureRace).toBe('dunadan');
    expect(afterDun.combat!.strikeProwess).toBe(10);
    expect(afterDun.combat!.strikesTotal).toBe(3);
    // 3 strikes total (not each-character).
    expect(afterDun.combat!.eachCharacterFacesOneStrike).toBeUndefined();
    expect(afterDun.combat!.detainment).toBe(false);
  });
});
