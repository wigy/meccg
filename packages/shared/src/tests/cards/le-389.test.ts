/**
 * @module le-389.test
 *
 * Card test: Lossadan Camp (le-389)
 * Type: minion-site (border-hold) in Forochel
 * Effects: 1 (combat-detainment gated on defender.covert)
 *
 * Text:
 *   "Nearest Darkhaven: Carn Dûm
 *    Playable: Items (gold ring)
 *    Automatic-attacks: Men — each character faces 1 strike with 5 prowess
 *      (detainment against covert company)"
 *
 * Rules interpretation:
 *   - The single Men automatic-attack is an each-character attack (prowess 5).
 *     Marked "(detainment against covert company)": it is detainment against a
 *     covert company and a regular attack against an overt company (MELE site
 *     guardians, same encoding as Minas Tirith le-391 / Bree le-356).
 *   - The only playable resource category is gold-ring items — no information,
 *     no minor/major items.
 *
 * Data encoding:
 *   - Men attack: `combatRules: ["each-character"]`, prowess 5, no `appliesTo`
 *     (faced by all companies).
 *   - Site effect `combat-detainment` gated on `defender.covert` — makes the Men
 *     attack detainment against a covert company and a regular attack against an
 *     overt company.
 *   - `playableResources: ["gold-ring"]`.
 *
 * The imported data was missing `playableResources`, `automaticAttacks`,
 * `effects`, and `unique`; all four were filled in from the authoritative
 * `data/cards.json` attributes (playable "Items (gold ring)", autoAttack "Men —
 * each character faces 1 strike with 5 prowess (detainment against covert
 * company)", unique true). No new engine work — pure reuse of the Bree/Minas
 * Tirith detainment-vs-covert machinery.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                              |
 * |---|-------------------|--------|----------------------------------------------------|
 * | 1 | siteType          | OK     | "border-hold" — valid ({B})                        |
 * | 2 | sitePath          | OK     | [shadow, wilderness] — matches {s}{w}              |
 * | 3 | nearestHaven      | OK     | "Carn Dûm" — valid minion Darkhaven (le-359)       |
 * | 4 | region            | OK     | "Forochel" — valid region                          |
 * | 5 | playableResources | OK     | [gold-ring] — matches "Items (gold ring)"          |
 * | 6 | automaticAttacks  | OK     | Men (each-character, prowess 5)                    |
 * | 7 | resourceDraws     | OK     | 1                                                  |
 * | 8 | hazardDraws       | OK     | 1                                                  |
 *
 * Engine Support:
 * | # | Feature                          | Status      | Notes                                              |
 * |---|----------------------------------|-------------|----------------------------------------------------|
 * | 1 | Haven path movement              | IMPLEMENTED | Carn Dûm ↔ Lossadan Camp via starter movement      |
 * | 2 | Auto-attack (each-character)     | IMPLEMENTED | Men: 1 strike per character, prowess 5             |
 * | 3 | Detainment vs covert company     | IMPLEMENTED | combat-detainment site effect + defendingCovert    |
 * | 4 | Regular attack vs overt company  | IMPLEMENTED | Men not detainment when company is overt           |
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
  isSiteCard, buildMovementMap, getReachableSites, Phase, Alignment, SiteType, type Race,
} from '../../index.js';
import { isDetainmentAttack } from '../../engine/detainment.js';
import { reduce } from '../../engine/reducer.js';
import type { SiteCard, CardDefinitionId, GameState, SitePhaseState } from '../../index.js';

const LOSSADAN_CAMP = 'le-389' as CardDefinitionId;
const CARN_DUM = 'le-359' as CardDefinitionId;   // minion Darkhaven (Lossadan Camp's nearest haven)

// Minion characters. Men do not make a company overt; an Orc does.
const THE_MOUTH = 'le-24' as CardDefinitionId;   // Man
const ASTERNAK = 'le-1' as CardDefinitionId;     // Man
const ORC_CAPTAIN = 'le-31' as CardDefinitionId; // Orc → makes the company overt

/** Build a Ringwraith site-phase state at the automatic-attacks step with a company at Lossadan Camp. */
function siteAutoAttackStep(characters: CardDefinitionId[]): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: LOSSADAN_CAMP, characters }],
        hand: [],
        siteDeck: [CARN_DUM],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Wizard,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [],
        siteDeck: [CARN_DUM],
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

describe('Lossadan Camp (le-389)', () => {
  beforeEach(() => resetMint());

  // ─── Movement: Carn Dûm ↔ Lossadan Camp ────────────────────────────────────

  test('starter movement from Carn Dûm reaches Lossadan Camp (le-389)', () => {
    const carnDum = pool[CARN_DUM as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, carnDum, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (LOSSADAN_CAMP as string),
    );

    expect(starter).toBeDefined();
  });

  // ─── Playable resources encode the printed "Items (gold ring)" ─────────────
  // Lossadan Camp allows ONLY gold-ring items — no information, no minor/major.

  test('playableResources contain gold-ring only (no information, minor, or major)', () => {
    const camp = pool[LOSSADAN_CAMP as string] as SiteCard;
    expect(camp.playableResources).toContain('gold-ring');
    expect(camp.playableResources).not.toContain('information');
    expect(camp.playableResources).not.toContain('minor');
    expect(camp.playableResources).not.toContain('major');
  });

  // ─── Detainment helper: covert vs overt at a border-hold ───────────────────
  // Lossadan Camp is a border-hold, so the §3.II.2.R1 dark-hold/shadow-hold
  // branch does NOT fire. Detainment comes solely from the combat-detainment
  // site effect gated on defender.covert.

  test('covert Ringwraith company: Men auto-attack is detainment (site effect)', () => {
    const siteDef = pool[LOSSADAN_CAMP as string] as SiteCard;
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
    const siteDef = pool[LOSSADAN_CAMP as string] as SiteCard;
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

  // ─── Auto-attack combat resolution ─────────────────────────────────────────

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

  test('overt company: Men attack is each-character but NOT detainment', () => {
    const state = siteAutoAttackStep([ORC_CAPTAIN, THE_MOUTH]);

    const { state: afterAttack, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(afterAttack.combat).not.toBeNull();
    expect(afterAttack.combat!.creatureRace).toBe('man');
    expect(afterAttack.combat!.strikeProwess).toBe(5);
    expect(afterAttack.combat!.strikesTotal).toBe(2);
    // Overt company → regular (non-detainment) attack.
    expect(afterAttack.combat!.detainment).toBe(false);
  });

  test('covert company: after resolving the Men detainment attack, advances past automatic-attacks', () => {
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

    // Lossadan Camp has only one automatic-attack → next pass leaves automatic-attacks.
    const { state: afterSkip, error } = reduce(afterAttack.state, { type: 'pass', player: PLAYER_1 });
    expect(error).toBeUndefined();
    expect(afterSkip.combat).toBeNull();
    expect((afterSkip.phaseState as SitePhaseState).step).toBe('declare-agent-attack');
  });
});
