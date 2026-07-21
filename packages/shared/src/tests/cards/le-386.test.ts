/**
 * @module le-386.test
 *
 * Card test: Lond Galen (le-386)
 * Type: minion-site (border-hold) in Anfalas
 * Effects: 1 (combat-detainment gated on defender.covert)
 *
 * Text:
 *   "Nearest Darkhaven: Geann a-Lisch
 *    Playable: Items (gold ring)
 *    Automatic-attacks: Men — each character faces 1 strike with 6 prowess
 *      (detainment against covert company)"
 *
 * Rules interpretation (MELE site guardians, per the Minas Tirith le-391
 * precedent): an attack marked "(detainment against covert company)" is faced
 * by EVERY company — it is a detainment attack against a covert company and a
 * regular (non-detainment) attack against an overt company.
 *
 * Data encoding (pure reuse of the le-391 / Bree le-356 pattern; no new engine
 * support required):
 *   - Men attack: `combatRules: ["each-character"]`, 1 strike, prowess 6, no
 *     `appliesTo` (faced by all companies).
 *   - Site effect `combat-detainment` gated on `defender.covert` — makes the
 *     Men attack detainment against a covert company, a regular attack against
 *     an overt company.
 *   - `playableResources: ["gold-ring"]` — gold-ring items only (no minor /
 *     major / greater / information).
 *   - `unique: true` (the site is a named unique location; matches the hero
 *     twin tw-407).
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                  |
 * |---|-------------------|--------|--------------------------------------------------------|
 * | 1 | siteType          | OK     | "border-hold" — valid                                  |
 * | 2 | sitePath          | OK     | [wilderness, wilderness, wilderness] — matches {w}{w}{w}|
 * | 3 | nearestHaven      | OK     | "Geann a-Lisch" — valid minion haven (le-374)          |
 * | 4 | region            | OK     | "Anfalas" — valid region                               |
 * | 5 | playableResources | FIXED  | [gold-ring] — was empty; text says Items (gold ring)   |
 * | 6 | automaticAttacks  | FIXED  | Men (each-character, 1 strike, p6) — was empty         |
 * | 7 | effects           | FIXED  | combat-detainment on defender.covert — was absent      |
 * | 8 | resourceDraws     | OK     | 2                                                      |
 * | 9 | hazardDraws       | OK     | 2                                                      |
 *
 * Engine Support (all pre-existing — no new engine work for this card):
 * | # | Feature                          | Status      | Notes                                                |
 * |---|----------------------------------|-------------|------------------------------------------------------|
 * | 1 | Site phase flow                  | IMPLEMENTED | select-company, enter-or-skip, play-resources        |
 * | 2 | Haven path movement              | IMPLEMENTED | Geann a-Lisch → Lond Galen via starter movement      |
 * | 3 | gold-ring-only playability       | IMPLEMENTED | playableResources gate (rejects minor/greater)       |
 * | 4 | Auto-attack (each-character)     | IMPLEMENTED | strikesTotal = company size, 1 strike per character  |
 * | 5 | Detainment vs covert company     | IMPLEMENTED | combat-detainment site effect + defendingCovert wire |
 * | 6 | Regular attack vs overt company  | IMPLEMENTED | Men attack not detainment when company is overt      |
 *
 * Playable: YES
 * Certified: 2026-07-21
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  LEGOLAS, LORIEN, MINAS_TIRITH, PRECIOUS_GOLD_RING, SCROLL_OF_ISILDUR,
  resetMint, pool,
  buildTestState, makeSitePhase, setupAutoAttackStep,
  viableActions, runAutoAttackCombatMulti,
} from '../test-helpers.js';
import {
  isSiteCard, buildMovementMap, getReachableSites, Phase, Alignment, SiteType, type Race,
} from '../../index.js';
import { isDetainmentAttack } from '../../engine/detainment.js';
import { reduce } from '../../engine/reducer.js';
import type { SiteCard, CardDefinitionId, GameState, SitePhaseState } from '../../index.js';

const LOND_GALEN_LE = 'le-386' as CardDefinitionId;
const GEANN_A_LISCH = 'le-374' as CardDefinitionId;        // minion haven, nearest darkhaven
const THE_MOUTH = 'le-24' as CardDefinitionId;             // Man → keeps company covert
const ASTERNAK = 'le-1' as CardDefinitionId;               // Man → keeps company covert
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;           // Orc → makes the company overt
const STRANGE_RATIONS = 'le-345' as CardDefinitionId;      // minor minion item (NOT playable here)

/** A Ringwraith company at Lond Galen, site phase, at the play-resources step. */
function minionAtLondGalen(hand: CardDefinitionId[], characters: CardDefinitionId[] = [THE_MOUTH]): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: LOND_GALEN_LE, characters }], hand, siteDeck: [GEANN_A_LISCH] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...state, phaseState: makeSitePhase() };
}

describe('Lond Galen (le-386)', () => {
  beforeEach(() => resetMint());

  // ─── Movement: Geann a-Lisch → Lond Galen ──────────────────────────────────

  test('starter movement from Geann a-Lisch reaches Lond Galen (le-386)', () => {
    const geann = pool[GEANN_A_LISCH as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, geann, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (LOND_GALEN_LE as string),
    );

    expect(starter).toBeDefined();
  });

  // ─── Item playability: gold-ring ONLY ──────────────────────────────────────

  test('gold-ring item (Precious Gold Ring) is playable at Lond Galen', () => {
    expect(viableActions(minionAtLondGalen([PRECIOUS_GOLD_RING]), PLAYER_1, 'play-hero-resource')).toHaveLength(1);
  });

  test('minor item (Strange Rations) is NOT playable at Lond Galen', () => {
    // playableResources is gold-ring only — a minor item is rejected.
    expect(viableActions(minionAtLondGalen([STRANGE_RATIONS]), PLAYER_1, 'play-hero-resource')).toHaveLength(0);
  });

  test('greater item (Scroll of Isildur) is NOT playable at Lond Galen', () => {
    expect(viableActions(minionAtLondGalen([SCROLL_OF_ISILDUR]), PLAYER_1, 'play-hero-resource')).toHaveLength(0);
  });

  // ─── Detainment helper: covert vs overt at a border-hold ────────────────────
  // Lond Galen is a border-hold, so the §3.II.2.R1 dark-hold/shadow-hold branch
  // does NOT fire. Detainment comes solely from the combat-detainment effect
  // gated on defender.covert.

  test('covert Ringwraith company: Men auto-attack is detainment (site effect)', () => {
    const siteDef = pool[LOND_GALEN_LE as string] as SiteCard;
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
    const siteDef = pool[LOND_GALEN_LE as string] as SiteCard;
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

  // ─── Covert company: Men attack is each-character detainment, prowess 6 ──────

  test('covert company: Men attack is each-character detainment with prowess 6', () => {
    const state = setupAutoAttackStep(minionAtLondGalen([], [THE_MOUTH, ASTERNAK]));

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

  test('covert company: after the single Men attack, no further auto-attack (advances to declare-agent-attack)', () => {
    const state = setupAutoAttackStep(minionAtLondGalen([], [THE_MOUTH, ASTERNAK]));

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

    // Lond Galen has exactly one automatic-attack → next pass advances the step.
    const { state: afterPass, error } = reduce(afterMen.state, { type: 'pass', player: PLAYER_1 });
    expect(error).toBeUndefined();
    expect(afterPass.combat).toBeNull();
    expect((afterPass.phaseState as SitePhaseState).step).toBe('declare-agent-attack');
  });

  // ─── Overt company: Men attack is regular (non-detainment) ──────────────────

  test('overt company: Men attack is each-character but NOT detainment', () => {
    const state = setupAutoAttackStep(minionAtLondGalen([], [ORC_CAPTAIN, THE_MOUTH]));

    const { state: afterAttack, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(afterAttack.combat).not.toBeNull();
    expect(afterAttack.combat!.creatureRace).toBe('man');
    expect(afterAttack.combat!.strikeProwess).toBe(6);
    expect(afterAttack.combat!.strikesTotal).toBe(2);
    // Overt company → Men attack is a regular (non-detainment) attack.
    expect(afterAttack.combat!.detainment).toBe(false);
  });

  // ─── The TW (hero) and LE (minion) Lond Galen are distinct sites ────────────

  test('starter movement from Geann a-Lisch does NOT reach the hero Lond Galen (tw-407)', () => {
    const geann = pool[GEANN_A_LISCH as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);
    const reachable = getReachableSites(movementMap, geann, allSites);
    const reachesHero = reachable.find(
      r => r.movementType === 'starter' && r.site.id === 'tw-407',
    );
    expect(reachesHero).toBeUndefined();
  });
});
