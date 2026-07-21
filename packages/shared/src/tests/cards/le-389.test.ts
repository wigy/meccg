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
 * Rules interpretation (MELE site guardians, per the Minas Tirith le-391 /
 * Lond Galen le-386 precedent): an attack marked "(detainment against covert
 * company)" is faced by EVERY company — it is a detainment attack against a
 * covert company and a regular (non-detainment) attack against an overt one.
 *
 * Data encoding (pure reuse of the le-386 / le-391 pattern; no new engine
 * support required):
 *   - Men attack: `combatRules: ["each-character"]`, 1 strike, prowess 5, no
 *     `appliesTo` (faced by all companies).
 *   - Site effect `combat-detainment` gated on `defender.covert` — makes the
 *     Men attack detainment against a covert company, a regular attack against
 *     an overt company.
 *   - `playableResources: ["gold-ring"]` — gold-ring items only (no minor /
 *     major / greater / information).
 *   - `unique: true` (named unique location; matches the hero twin tw-410).
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                              |
 * |---|-------------------|--------|----------------------------------------------------|
 * | 1 | siteType          | OK     | "border-hold" — valid                              |
 * | 2 | sitePath          | OK     | [shadow, wilderness] — matches {s}{w}              |
 * | 3 | nearestHaven      | OK     | "Carn Dûm" — valid minion haven (le-359)           |
 * | 4 | region            | OK     | "Forochel" — valid region                          |
 * | 5 | playableResources | FIXED  | [gold-ring] — was empty; text says Items (gold ring)|
 * | 6 | automaticAttacks  | FIXED  | Men (each-character, 1 strike, p5) — was empty     |
 * | 7 | effects           | FIXED  | combat-detainment on defender.covert — was absent  |
 * | 8 | resourceDraws     | OK     | 1                                                  |
 * | 9 | hazardDraws       | OK     | 1                                                  |
 *
 * Engine Support (all pre-existing — no new engine work for this card):
 * | # | Feature                          | Status      | Notes                                                |
 * |---|----------------------------------|-------------|------------------------------------------------------|
 * | 1 | Site phase flow                  | IMPLEMENTED | select-company, enter-or-skip, play-resources        |
 * | 2 | Haven path movement              | IMPLEMENTED | Carn Dûm → Lossadan Camp via starter movement        |
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

const LOSSADAN_CAMP_LE = 'le-389' as CardDefinitionId;
const CARN_DUM = 'le-359' as CardDefinitionId;             // minion haven, nearest darkhaven
const THE_MOUTH = 'le-24' as CardDefinitionId;             // Man → keeps company covert
const ASTERNAK = 'le-1' as CardDefinitionId;               // Man → keeps company covert
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;           // Orc → makes the company overt
const STRANGE_RATIONS = 'le-345' as CardDefinitionId;      // minor minion item (NOT playable here)

/** A Ringwraith company at Lossadan Camp, site phase, at the play-resources step. */
function minionAtLossadanCamp(hand: CardDefinitionId[], characters: CardDefinitionId[] = [THE_MOUTH]): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: LOSSADAN_CAMP_LE, characters }], hand, siteDeck: [CARN_DUM] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...state, phaseState: makeSitePhase() };
}

describe('Lossadan Camp (le-389)', () => {
  beforeEach(() => resetMint());

  // ─── Movement: Carn Dûm → Lossadan Camp ─────────────────────────────────────

  test('starter movement from Carn Dûm reaches Lossadan Camp (le-389)', () => {
    const carnDum = pool[CARN_DUM as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, carnDum, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (LOSSADAN_CAMP_LE as string),
    );

    expect(starter).toBeDefined();
  });

  // ─── Item playability: gold-ring ONLY ───────────────────────────────────────

  test('gold-ring item (Precious Gold Ring) is playable at Lossadan Camp', () => {
    expect(viableActions(minionAtLossadanCamp([PRECIOUS_GOLD_RING]), PLAYER_1, 'play-hero-resource')).toHaveLength(1);
  });

  test('minor item (Strange Rations) is NOT playable at Lossadan Camp', () => {
    // playableResources is gold-ring only — a minor item is rejected.
    expect(viableActions(minionAtLossadanCamp([STRANGE_RATIONS]), PLAYER_1, 'play-hero-resource')).toHaveLength(0);
  });

  test('greater item (Scroll of Isildur) is NOT playable at Lossadan Camp', () => {
    expect(viableActions(minionAtLossadanCamp([SCROLL_OF_ISILDUR]), PLAYER_1, 'play-hero-resource')).toHaveLength(0);
  });

  // ─── Detainment helper: covert vs overt at a border-hold ────────────────────
  // Lossadan Camp is a border-hold, so the §3.II.2.R1 dark-hold/shadow-hold
  // branch does NOT fire. Detainment comes solely from the combat-detainment
  // effect gated on defender.covert.

  test('covert Ringwraith company: Men auto-attack is detainment (site effect)', () => {
    const siteDef = pool[LOSSADAN_CAMP_LE as string] as SiteCard;
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
    const siteDef = pool[LOSSADAN_CAMP_LE as string] as SiteCard;
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

  // ─── Covert company: Men attack is each-character detainment, prowess 5 ──────

  test('covert company: Men attack is each-character detainment with prowess 5', () => {
    const state = setupAutoAttackStep(minionAtLossadanCamp([], [THE_MOUTH, ASTERNAK]));

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

  test('covert company: after the single Men attack, no further auto-attack (advances to declare-agent-attack)', () => {
    const state = setupAutoAttackStep(minionAtLossadanCamp([], [THE_MOUTH, ASTERNAK]));

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

    // Lossadan Camp has exactly one automatic-attack → next pass advances the step.
    const { state: afterPass, error } = reduce(afterMen.state, { type: 'pass', player: PLAYER_1 });
    expect(error).toBeUndefined();
    expect(afterPass.combat).toBeNull();
    expect((afterPass.phaseState as SitePhaseState).step).toBe('declare-agent-attack');
  });

  // ─── Overt company: Men attack is regular (non-detainment) ──────────────────

  test('overt company: Men attack is each-character but NOT detainment', () => {
    const state = setupAutoAttackStep(minionAtLossadanCamp([], [ORC_CAPTAIN, THE_MOUTH]));

    const { state: afterAttack, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(afterAttack.combat).not.toBeNull();
    expect(afterAttack.combat!.creatureRace).toBe('man');
    expect(afterAttack.combat!.strikeProwess).toBe(5);
    expect(afterAttack.combat!.strikesTotal).toBe(2);
    // Overt company → Men attack is a regular (non-detainment) attack.
    expect(afterAttack.combat!.detainment).toBe(false);
  });

  // ─── The TW (hero) and LE (minion) Lossadan Camp are distinct sites ──────────

  test('starter movement from Carn Dûm does NOT reach the hero Lossadan Camp (tw-410)', () => {
    const carnDum = pool[CARN_DUM as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);
    const reachable = getReachableSites(movementMap, carnDum, allSites);
    const reachesHero = reachable.find(
      r => r.movementType === 'starter' && r.site.id === 'tw-410',
    );
    expect(reachesHero).toBeUndefined();
  });
});
