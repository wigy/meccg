/**
 * @module le-395.test
 *
 * Card test: Mount Gundabad (le-395)
 * Type: minion-site (shadow-hold) in Gundabad
 * Effects: 0 (the "detainment against overt company" qualifier is expressed
 *   directly on the automatic-attack via `detainmentAgainstOvert: true` — a
 *   site's own automatic-attack is not a hazard creature card, so per the CoE
 *   glossary it is never implicitly "keyed to" the site's type, and §3.II.2.R1/
 *   B1 (which require keying) do not apply to it on their own)
 *
 * Text:
 *   "Nearest Darkhaven: Carn Dûm
 *    Playable: Items (minor, major)
 *    Automatic-attacks: Orcs — each character faces 1 strike with 7 prowess
 *      (detainment against overt company)"
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                          |
 * |---|-------------------|--------|----------------------------------------------------------------|
 * | 1 | siteType          | OK     | "shadow-hold" — valid                                          |
 * | 2 | sitePath          | OK     | [shadow, dark] — matches {s}{d}                                |
 * | 3 | nearestHaven      | OK     | "Carn Dûm" — valid minion haven in card pool (le-359)          |
 * | 4 | region            | OK     | "Gundabad" — valid region                                      |
 * | 5 | playableResources | OK     | [minor, major] — matches card text                             |
 * | 6 | automaticAttacks  | OK     | Orcs — 1 strike per character (each-character), prowess 7      |
 * | 7 | resourceDraws     | OK     | 2                                                              |
 * | 8 | hazardDraws       | OK     | 1                                                              |
 *
 * Engine Support:
 * | # | Feature                         | Status      | Notes                                                        |
 * |---|---------------------------------|-------------|--------------------------------------------------------------|
 * | 1 | Site phase flow                 | IMPLEMENTED | select-company, enter-or-skip, play-resources                |
 * | 2 | Item playability                | IMPLEMENTED | minor, major via playableResources                           |
 * | 3 | Haven path movement             | IMPLEMENTED | Carn Dûm ↔ Mount Gundabad via starter movement               |
 * | 4 | Auto-attack (each-character)    | IMPLEMENTED | strikesTotal = company.characters.length, pre-assigned       |
 * | 5 | Detainment vs overt company     | IMPLEMENTED | `detainmentAgainstOvert: true` on the attack, per §3.II.2      |
 * | 6 | Not detainment vs covert company| IMPLEMENTED | default — `detainmentAgainstOvert` requires an overt company  |
 *
 * Playable: YES
 * Certified: 2026-06-04
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  LEGOLAS,
  RIVENDELL, LORIEN, MINAS_TIRITH,
  resetMint, pool,
  buildTestState, runAutoAttackCombatMulti,
} from '../test-helpers.js';
import {
  isSiteCard, buildMovementMap, getReachableSites, Phase, Alignment, SiteType, type Race,
} from '../../index.js';
import { isDetainmentAttack } from '../../engine/detainment.js';
import { reduce } from '../../engine/reducer.js';
import type { SiteCard, CardDefinitionId, GameState, SitePhaseState } from '../../index.js';

const MOUNT_GUNDABAD = 'le-395' as CardDefinitionId;
const CARN_DUM = 'le-359' as CardDefinitionId;
const LIEUTENANT_OF_MORGUL = 'le-22' as CardDefinitionId;
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;
const HORSEMAN_IN_THE_NIGHT = 'le-16' as CardDefinitionId;

describe('Mount Gundabad (le-395)', () => {
  beforeEach(() => resetMint());

  // ─── Movement: Carn Dûm → Mount Gundabad ───────────────────────────────────

  test('starter movement from Carn Dûm reaches Mount Gundabad (le-395)', () => {
    const carnDum = pool[CARN_DUM as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, carnDum, allSites);
    const starterGundabad = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (MOUNT_GUNDABAD as string),
    );

    expect(starterGundabad).toBeDefined();
  });

  test('starter movement from Rivendell does NOT reach Mount Gundabad', () => {
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const notReachable = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (MOUNT_GUNDABAD as string),
    );

    expect(notReachable).toBeUndefined();
  });

  // ─── Detainment: general isDetainmentAttack §3.II.2.R1/B1 behavior ─────────
  // These tests exercise the general isDetainmentAttack helper with a
  // creature actually keyed to a shadow-hold (e.g. a hazard creature played
  // by hand) — NOT Mount Gundabad's own automatic-attack, which is not a
  // hazard creature card and so is never implicitly "keyed" per the CoE
  // glossary. The automatic-attack's real "detainment against overt company"
  // behavior is covered by the `detainmentAgainstOvert` integration tests
  // below, which run the actual reducer.

  test('Ringwraith defender at Mount Gundabad: Orc auto-attack is detainment (§3.II.2.R1 shadow-hold)', () => {
    // Shadow-hold keying triggers R1 for Ringwraith players.
    const siteDef = pool[MOUNT_GUNDABAD as string] as SiteCard;
    const detainment = isDetainmentAttack({
      attackRace: 'orc' as Race,
      attackKeyedTo: [{ siteTypes: [SiteType.ShadowHold] }],
      defendingAlignment: Alignment.Ringwraith,
      attackEffects: siteDef.effects,
      defendingSiteEffects: siteDef.effects,
    });
    expect(detainment).toBe(true);
  });

  test('Balrog defender at Mount Gundabad: Orc auto-attack is detainment (§3.II.2.B1 shadow-hold)', () => {
    const siteDef = pool[MOUNT_GUNDABAD as string] as SiteCard;
    const detainment = isDetainmentAttack({
      attackRace: 'orc' as Race,
      attackKeyedTo: [{ siteTypes: [SiteType.ShadowHold] }],
      defendingAlignment: Alignment.Balrog,
      attackEffects: siteDef.effects,
      defendingSiteEffects: siteDef.effects,
    });
    expect(detainment).toBe(true);
  });

  test('fallen-wizard defender at Mount Gundabad: Orc auto-attack is NOT detainment (FW is hero for detainment, rule 2.IV.vii.F1)', () => {
    // The card text says "detainment against overt company". Per rule
    // 2.IV.vii.F1 (2026-02-07 clarification), a Fallen-wizard player's
    // companies are considered HERO companies when determining detainment,
    // and their covert/overt status does not apply. A hero company is not
    // overt, so the "overt company" qualifier does not detain a FW company —
    // the Orcs fight normally and may wound/kill. (Minion companies are still
    // detained here via §3.II.2.R1/B1 since Mount Gundabad is a shadow-hold.)
    const siteDef = pool[MOUNT_GUNDABAD as string] as SiteCard;
    const detainment = isDetainmentAttack({
      attackRace: 'orc' as Race,
      attackKeyedTo: [{ siteTypes: [SiteType.ShadowHold] }],
      defendingAlignment: Alignment.FallenWizard,
      attackEffects: siteDef.effects,
      defendingSiteEffects: siteDef.effects,
    });
    expect(detainment).toBe(false);
  });

  test('hero defender at Mount Gundabad: Orc auto-attack is NOT detainment', () => {
    // Standard rules don't apply (R1/B1 require minion/balrog alignment) and a
    // hero company is not overt, so the "overt company" qualifier never fires.
    const siteDef = pool[MOUNT_GUNDABAD as string] as SiteCard;
    const detainment = isDetainmentAttack({
      attackRace: 'orc' as Race,
      attackKeyedTo: [{ siteTypes: [SiteType.ShadowHold] }],
      defendingAlignment: Alignment.Wizard,
      attackEffects: siteDef.effects,
      defendingSiteEffects: siteDef.effects,
    });
    expect(detainment).toBe(false);
  });

  test('baseline: without site effects, fallen-wizard vs Orc is NOT detainment', () => {
    // A FW company is a hero company for detainment (rule 2.IV.vii.F1), so an
    // Orc shadow-hold attack is not detainment via the R1/B1 minion rules.
    const detainment = isDetainmentAttack({
      attackRace: 'orc' as Race,
      attackKeyedTo: [{ siteTypes: [SiteType.ShadowHold] }],
      defendingAlignment: Alignment.FallenWizard,
    });
    expect(detainment).toBe(false);
  });

  // ─── Each-character auto-attack: integration via reducer ───────────────────

  test('2-character company at Mount Gundabad: each-character attack assigns 1 strike per character', () => {
    // PLAYER_1 is Ringwraith with a 2-character company (containing an Orc,
    // so the company is overt) at Mount Gundabad. When the auto-attack
    // triggers, each character gets exactly 1 strike (strikesTotal = 2, both
    // pre-assigned, no defender assignment needed).
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MOUNT_GUNDABAD, characters: [LIEUTENANT_OF_MORGUL, ORC_CAPTAIN] }],
          hand: [],
          siteDeck: [CARN_DUM],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
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
    const state: GameState = { ...base, phaseState: sitePhaseState };

    // Pass to trigger the auto-attack (each-character mode pre-assigns strikes).
    const { state: afterAttack, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(afterAttack.combat).not.toBeNull();
    expect(afterAttack.combat!.strikesTotal).toBe(2);
    expect(afterAttack.combat!.strikeAssignments).toHaveLength(2);
    expect(afterAttack.combat!.strikeProwess).toBe(7);
    expect(afterAttack.combat!.creatureRace).toBe('orc');
    // Overt company (contains an Orc) → detainmentAgainstOvert fires
    expect(afterAttack.combat!.detainment).toBe(true);
  });

  test('covert company at Mount Gundabad: auto-attack is NOT detainment', () => {
    // A Ringwraith company with no Orc/Troll/Balrog-avatar is covert, so the
    // "(detainment against overt company)" qualifier does not apply — the
    // attack wounds normally. Regression guard: the site's own
    // automatic-attack must not fall back to unconditional §3.II.2.R1
    // shadow-hold detainment now that the implicit site-type keying has been
    // removed from reducer-site.ts (bug report: msotr1yy-z2yrcq, seq 95 —
    // Sarn Goriwing wrongly detained a non-overt company the same way).
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MOUNT_GUNDABAD, characters: [HORSEMAN_IN_THE_NIGHT] }],
          hand: [],
          siteDeck: [CARN_DUM],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
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
    const state: GameState = { ...base, phaseState: sitePhaseState };

    const { state: afterAttack, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(afterAttack.combat).not.toBeNull();
    expect(afterAttack.combat!.creatureRace).toBe('orc');
    expect(afterAttack.combat!.detainment).toBe(false);
  });

  test('2-character company: each character resolves their own strike independently', () => {
    // Full combat flow: trigger → choose-strike-order → resolve each strike.
    // Both characters use roll 12 to succeed (prowess 8+ beats strike prowess 7).
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MOUNT_GUNDABAD, characters: [LIEUTENANT_OF_MORGUL, ORC_CAPTAIN] }],
          hand: [],
          siteDeck: [CARN_DUM],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
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
    const state: GameState = { ...base, phaseState: sitePhaseState };

    // Run the full auto-attack. Both characters succeed (detainment → tap not wound).
    const result = runAutoAttackCombatMulti(
      state,
      [
        { characterDefId: LIEUTENANT_OF_MORGUL, roll: 12, tapToFight: true },
        { characterDefId: ORC_CAPTAIN, roll: 12, tapToFight: true },
      ],
      PLAYER_1,
      PLAYER_2,
    );

    // Combat finalized: each character faced their strike and succeeded.
    expect(result.state.combat).toBeNull();
  });

  test('1-character company: single strike auto-assigned, resolves directly', () => {
    // With a single character, combat goes straight to resolve-strike.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MOUNT_GUNDABAD, characters: [LIEUTENANT_OF_MORGUL] }],
          hand: [],
          siteDeck: [CARN_DUM],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
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
    const state: GameState = { ...base, phaseState: sitePhaseState };

    const { state: afterAttack, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(afterAttack.combat).not.toBeNull();
    // Single character → 1 strike total, pre-assigned, directly in resolve-strike
    expect(afterAttack.combat!.strikesTotal).toBe(1);
    expect(afterAttack.combat!.strikeAssignments).toHaveLength(1);
    expect(afterAttack.combat!.phase).toBe('resolve-strike');
  });
});
