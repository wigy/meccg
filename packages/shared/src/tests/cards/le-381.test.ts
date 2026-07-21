/**
 * @module le-381.test
 *
 * Card test: Henneth Annûn (le-381)
 * Type: minion-site (border-hold) in Ithilien
 * Effects: 1 (combat-detainment gated on defender.covert)
 *
 * Text:
 *   "Nearest Darkhaven: Minas Morgul
 *    Automatic-attacks: Dúnedain — each character faces 1 strike with 7 prowess
 *      (detainment against covert company)"
 *
 * Rules interpretation:
 *   - The single Dúnedain automatic-attack is an each-character attack (prowess
 *     7). Marked "(detainment against covert company)": it is detainment against
 *     a covert company and a regular attack against an overt company (MELE site
 *     guardians, same encoding as Bree le-356 / Minas Tirith le-391).
 *   - No "Playable:" line → no resources are playable at this site
 *     (playableResources is empty).
 *   - Henneth Annûn has NO special agent-play rule (unlike Bree le-356) — a plain
 *     border-hold guardian site.
 *
 * Data encoding:
 *   - Dúnedain attack: `combatRules: ["each-character"]`, prowess 7, no
 *     `appliesTo` (faced by all companies).
 *   - Site effect `combat-detainment` gated on `defender.covert`.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                              |
 * |---|-------------------|--------|----------------------------------------------------|
 * | 1 | siteType          | OK     | "border-hold" — valid                              |
 * | 2 | sitePath          | OK     | [shadow, wilderness] — matches {s}{w}              |
 * | 3 | nearestHaven      | OK     | "Minas Morgul" — valid minion Darkhaven (le-392)   |
 * | 4 | region            | OK     | "Ithilien" — valid region                          |
 * | 5 | playableResources | OK     | [] — text has no "Playable:" line                  |
 * | 6 | automaticAttacks  | OK     | Dúnedain (each-character, prowess 7)               |
 * | 7 | resourceDraws     | OK     | 1                                                  |
 * | 8 | hazardDraws       | OK     | 1                                                  |
 *
 * Engine Support:
 * | # | Feature                          | Status      | Notes                                              |
 * |---|----------------------------------|-------------|----------------------------------------------------|
 * | 1 | Auto-attack (each-character)     | IMPLEMENTED | Dúnedain: 1 strike per character, prowess 7        |
 * | 2 | Detainment vs covert company     | IMPLEMENTED | combat-detainment site effect + defendingCovert    |
 * | 3 | Regular attack vs overt company  | IMPLEMENTED | Dúnedain not detainment when company is overt      |
 *
 * Playable: YES
 * Certified: 2026-07-21
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  LEGOLAS, LORIEN,
  resetMint, pool,
  buildTestState, runAutoAttackCombatMulti,
} from '../test-helpers.js';
import {
  Phase, Alignment, SiteType, type Race,
} from '../../index.js';
import { isDetainmentAttack } from '../../engine/detainment.js';
import { reduce } from '../../engine/reducer.js';
import type { SiteCard, CardDefinitionId, GameState, SitePhaseState } from '../../index.js';

const HENNETH_ANNUN = 'le-381' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;   // minion Darkhaven (Henneth Annûn's nearest haven)

// Minion characters. Men do not make a company overt; an Orc does.
const THE_MOUTH = 'le-24' as CardDefinitionId;   // Man, direct influence 4
const ASTERNAK = 'le-1' as CardDefinitionId;     // Man
const ORC_CAPTAIN = 'le-31' as CardDefinitionId; // Orc → makes the company overt

/** Build a Ringwraith site-phase state at the automatic-attacks step with a company at Henneth Annûn. */
function siteAutoAttackStep(characters: CardDefinitionId[]): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: HENNETH_ANNUN, characters }],
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

describe('Henneth Annûn (le-381)', () => {
  beforeEach(() => resetMint());

  // ─── No resources playable — the site has no "Playable:" line ──────────────

  test('playableResources is empty (no printed Playable list)', () => {
    const site = pool[HENNETH_ANNUN as string] as SiteCard;
    expect(site.playableResources).toEqual([]);
  });

  // ─── Detainment helper: covert vs overt at a border-hold ───────────────────
  // Henneth Annûn is a border-hold, so the §3.II.2.R1 dark-hold/shadow-hold
  // branch does NOT fire. Detainment comes solely from the combat-detainment
  // site effect gated on defender.covert.

  test('covert Ringwraith company: Dúnedain auto-attack is detainment (site effect)', () => {
    const siteDef = pool[HENNETH_ANNUN as string] as SiteCard;
    const detainment = isDetainmentAttack({
      attackRace: 'dunadan' as Race,
      attackKeyedTo: [{ siteTypes: [SiteType.BorderHold] }],
      defendingAlignment: Alignment.Ringwraith,
      defendingCovert: true,
      attackEffects: siteDef.effects,
      defendingSiteEffects: siteDef.effects,
    });
    expect(detainment).toBe(true);
  });

  test('overt Ringwraith company: Dúnedain auto-attack is NOT detainment', () => {
    const siteDef = pool[HENNETH_ANNUN as string] as SiteCard;
    const detainment = isDetainmentAttack({
      attackRace: 'dunadan' as Race,
      attackKeyedTo: [{ siteTypes: [SiteType.BorderHold] }],
      defendingAlignment: Alignment.Ringwraith,
      defendingCovert: false,
      attackEffects: siteDef.effects,
      defendingSiteEffects: siteDef.effects,
    });
    expect(detainment).toBe(false);
  });

  test('baseline: without the site effect, covert company vs Dúnedain at border-hold is NOT detainment', () => {
    const detainment = isDetainmentAttack({
      attackRace: 'dunadan' as Race,
      attackKeyedTo: [{ siteTypes: [SiteType.BorderHold] }],
      defendingAlignment: Alignment.Ringwraith,
      defendingCovert: true,
    });
    expect(detainment).toBe(false);
  });

  // ─── Auto-attack combat resolution ─────────────────────────────────────────

  test('covert company: Dúnedain attack is each-character detainment with prowess 7', () => {
    const state = siteAutoAttackStep([THE_MOUTH, ASTERNAK]);

    const { state: afterAttack, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(afterAttack.combat).not.toBeNull();
    expect(afterAttack.combat!.creatureRace).toBe('dunadan');
    expect(afterAttack.combat!.strikeProwess).toBe(7);
    // each-character: one strike pre-assigned per character (company size 2)
    expect(afterAttack.combat!.strikesTotal).toBe(2);
    expect(afterAttack.combat!.strikeAssignments).toHaveLength(2);
    expect(afterAttack.combat!.eachCharacterFacesOneStrike).toBe(true);
    // Covert company → Dúnedain attack is detainment.
    expect(afterAttack.combat!.detainment).toBe(true);
  });

  test('overt company: Dúnedain attack is each-character but NOT detainment', () => {
    const state = siteAutoAttackStep([ORC_CAPTAIN, THE_MOUTH]);

    const { state: afterAttack, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(afterAttack.combat).not.toBeNull();
    expect(afterAttack.combat!.creatureRace).toBe('dunadan');
    expect(afterAttack.combat!.strikeProwess).toBe(7);
    expect(afterAttack.combat!.strikesTotal).toBe(2);
    // Overt company → regular (non-detainment) attack.
    expect(afterAttack.combat!.detainment).toBe(false);
  });

  test('covert company: after resolving the Dúnedain detainment attack, advances past automatic-attacks', () => {
    const state = siteAutoAttackStep([THE_MOUTH, ASTERNAK]);

    const afterAttack = runAutoAttackCombatMulti(
      state,
      [
        { characterDefId: THE_MOUTH, roll: 12, tapToFight: true },
        { characterDefId: ASTERNAK, roll: 12, tapToFight: true },
      ],
      PLAYER_1,
      PLAYER_2,
    );
    expect(afterAttack.state.combat).toBeNull();
    const sps = afterAttack.state.phaseState as SitePhaseState;
    expect(sps.automaticAttacksResolved).toBe(1);

    // Henneth Annûn has only one automatic-attack → next pass leaves automatic-attacks.
    const { state: afterSkip, error } = reduce(afterAttack.state, { type: 'pass', player: PLAYER_1 });
    expect(error).toBeUndefined();
    expect(afterSkip.combat).toBeNull();
    expect((afterSkip.phaseState as SitePhaseState).step).toBe('declare-agent-attack');
  });
});
