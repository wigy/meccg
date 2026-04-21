/**
 * @module le-392.test
 *
 * Card test: Moria (le-392)
 * Type: minion-site (shadow-hold) in Redhorn Gate
 * Effects: 1 (site-rule attacks-not-detainment filtered to non-Nazgûl)
 *
 * Text:
 *   "Nearest Darkhaven: Dol Guldur.
 *    Playable: Items (minor, major, greater, gold ring).
 *    Automatic-attacks: Orcs — 4 strikes with 7 prowess.
 *    Special: Non-Nazgûl creatures played at this site attack normally,
 *    not as detainment."
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                          |
 * |---|-------------------|--------|----------------------------------------------------------------|
 * | 1 | siteType          | OK     | "shadow-hold" — valid                                          |
 * | 2 | sitePath          | OK     | [dark, shadow, wilderness, wilderness] — matches {d}{s}{w}{w}  |
 * | 3 | nearestHaven      | OK     | "Dol Guldur" — valid minion haven in card pool                 |
 * | 4 | region            | OK     | "Redhorn Gate" — valid region in card pool                     |
 * | 5 | playableResources | OK     | [minor, major, greater, gold-ring] — matches card text         |
 * | 6 | automaticAttacks  | OK     | Orcs — 4 strikes with 7 prowess                                |
 * | 7 | resourceDraws     | OK     | 2                                                              |
 * | 8 | hazardDraws       | OK     | 3                                                              |
 *
 * Engine Support:
 * | # | Feature                         | Status      | Notes                                                 |
 * |---|---------------------------------|-------------|-------------------------------------------------------|
 * | 1 | Site phase flow                 | IMPLEMENTED | select-company, enter-or-skip, play-resources         |
 * | 2 | Item playability                | IMPLEMENTED | minor, major, greater, gold-ring via playableResources|
 * | 3 | Haven path movement             | IMPLEMENTED | Dol Guldur ↔ Moria via starter movement               |
 * | 4 | Region movement                 | IMPLEMENTED | Sites reachable within 4 regions of Redhorn Gate      |
 * | 5 | Card draws                      | IMPLEMENTED | resourceDraws / hazardDraws thread through M/H phase  |
 * | 6 | Automatic attacks (data only)   | IMPLEMENTED | site-phase auto-attack initiates Orc combat (4/7)     |
 * | 7 | Attacks-not-detainment override | IMPLEMENTED | site-rule overrides CoE §3.II.2.R1 for non-Nazgûl     |
 *
 * Playable: YES
 * Certified: 2026-04-21
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MINAS_TIRITH,
  resetMint, pool,
  buildTestState, makeMHState,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import {
  isSiteCard, buildMovementMap, getReachableSites, Phase, Alignment,
  SiteType, RegionType,
} from '../../index.js';
import { isDetainmentAttack } from '../../engine/detainment.js';
import type { SiteCard, CardDefinitionId, GameState } from '../../index.js';
import { Race } from '../../types/common.js';

const MORIA_LE = 'le-392' as CardDefinitionId;
const MORIA_TW = 'tw-413' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const LIEUTENANT_OF_MORGUL = 'le-22' as CardDefinitionId;
const ORC_PATROL = 'tw-074' as CardDefinitionId;

const SHADOW_HOLD_KEYING = { method: 'site-type' as const, value: SiteType.ShadowHold };

describe('Moria (le-392)', () => {
  beforeEach(() => resetMint());

  // ─── Site data structural checks (dynamic, not tautological) ────────────────

  test('site path matches nearestHaven Dol Guldur via starter movement', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const starterMoria = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (MORIA_LE as string),
    );

    expect(starterMoria).toBeDefined();
  });

  test('starter movement from Dol Guldur does NOT reach hero Moria (tw-413)', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const starterMoriaTw = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (MORIA_TW as string),
    );

    expect(starterMoriaTw).toBeUndefined();
  });

  test('starter movement from a hero haven does NOT reach minion Moria (le-392)', () => {
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const starterMoriaLe = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (MORIA_LE as string),
    );

    expect(starterMoriaLe).toBeUndefined();
  });

  // ─── Region movement within 4 regions of Redhorn Gate ───────────────────────

  test('region movement from Moria stays within 4 regions of Redhorn Gate', () => {
    const moriaLe = pool[MORIA_LE as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, moriaLe, allSites);
    for (const r of reachable) {
      if (r.movementType !== 'region') continue;
      expect(r.regionDistance!).toBeLessThanOrEqual(4);
    }
  });

  // ─── attacks-not-detainment: direct detainment helper tests ─────────────────

  test('non-Nazgûl creature keyed to Shadow-hold at Moria: detainment overridden to false', () => {
    // CoE §3.II.2.R1 would normally flag this as detainment (Ringwraith
    // defender, Orc keyed to Shadow-hold). Moria's site rule overrides it.
    const moriaDef = pool[MORIA_LE as string] as SiteCard;
    const detainment = isDetainmentAttack({
      attackRace: Race.Orc,
      attackKeyedTo: [{ siteTypes: [SiteType.ShadowHold] }],
      defendingAlignment: Alignment.Ringwraith,
      defendingSiteEffects: moriaDef.effects,
    });
    expect(detainment).toBe(false);
  });

  test('baseline: same Orc attack WITHOUT Moria effects is detainment (R1 keyed to Shadow-hold)', () => {
    // Regression guard: the override is what flips the value, not the
    // context shape. Same inputs, no site effects → detainment.
    const detainment = isDetainmentAttack({
      attackRace: Race.Orc,
      attackKeyedTo: [{ siteTypes: [SiteType.ShadowHold] }],
      defendingAlignment: Alignment.Ringwraith,
    });
    expect(detainment).toBe(true);
  });

  test('Nazgûl creature at Moria: override filter skips it, detainment preserved', () => {
    // Filter is `{ enemy.race: { $ne: nazgul } }`. A Nazgûl attack does NOT
    // match the filter, so the override does not fire. The attack is still
    // detainment via R1 (keyed to Dark-domain, as Nazgûl tend to be).
    const moriaDef = pool[MORIA_LE as string] as SiteCard;
    const detainment = isDetainmentAttack({
      attackRace: 'nazgul' as Race,
      attackKeyedTo: [{ regionTypes: [RegionType.Dark] }],
      defendingAlignment: Alignment.Ringwraith,
      defendingSiteEffects: moriaDef.effects,
    });
    expect(detainment).toBe(true);
  });

  test('Balrog defender at Moria: non-Nazgûl creature still has override applied', () => {
    // CoE §3.II.2.B1 mirrors R1 for Balrog players — the override must
    // apply to both Ringwraith and Balrog defenders since the rule is
    // keyed on the site, not the defender alignment.
    const moriaDef = pool[MORIA_LE as string] as SiteCard;
    const detainment = isDetainmentAttack({
      attackRace: Race.Troll,
      attackKeyedTo: [{ siteTypes: [SiteType.ShadowHold] }],
      defendingAlignment: Alignment.Balrog,
      defendingSiteEffects: moriaDef.effects,
    });
    expect(detainment).toBe(false);
  });

  test('hero defender at Moria: override is a no-op (default not detainment anyway)', () => {
    // Hero alignment doesn't trigger R1/R2/R3 at all, so the attack was
    // already non-detainment. The site rule doesn't flip it to detainment.
    const moriaDef = pool[MORIA_LE as string] as SiteCard;
    const detainment = isDetainmentAttack({
      attackRace: Race.Orc,
      attackKeyedTo: [{ siteTypes: [SiteType.ShadowHold] }],
      defendingAlignment: Alignment.Wizard,
      defendingSiteEffects: moriaDef.effects,
    });
    expect(detainment).toBe(false);
  });

  test('Moria override wins even when the attack card declares combat-detainment', () => {
    // The card text is explicit: "non-Nazgûl creatures ... attack normally,
    // not as detainment." The site rule is unconditional about the outcome —
    // it overrides both the §3.II.2.R1/R2/R3 defaults and any card-declared
    // `combat-detainment` effect on a non-Nazgûl attacker.
    const moriaDef = pool[MORIA_LE as string] as SiteCard;
    const detainment = isDetainmentAttack({
      attackEffects: [{ type: 'combat-detainment' }],
      attackRace: Race.Orc,
      attackKeyedTo: [{ siteTypes: [SiteType.ShadowHold] }],
      defendingAlignment: Alignment.Ringwraith,
      defendingSiteEffects: moriaDef.effects,
    });
    expect(detainment).toBe(false);
  });

  // ─── attacks-not-detainment: integration via reducer ───────────────────────

  test('minion company at Moria facing Orc-patrol: combat.detainment is false', () => {
    // PLAYER_1 is the Ringwraith/active player with a company at Moria.
    // PLAYER_2 (hero/hazard) plays Orc-patrol keyed to Shadow-hold — this
    // would trigger R1 detainment (Orc keyed to Shadow-hold vs Ringwraith
    // defender) without Moria's override. The override fires because
    // Orc != Nazgûl, forcing detainment: false.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MORIA_LE, characters: [LIEUTENANT_OF_MORGUL] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [ORC_PATROL],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    // Non-moving M/H state: company stays at Moria, so the keying check
    // must pass against the *current* site type (shadow-hold).
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [],
        resolvedSitePathNames: [],
        destinationSiteType: SiteType.ShadowHold,
        destinationSiteName: 'Moria',
      }),
    };
    const orcPatrolId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, orcPatrolId, companyId, SHADOW_HOLD_KEYING,
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.creatureRace).toBe('orc');
    expect(afterChain.combat!.detainment).toBe(false);
  });

  test('baseline: same Orc-patrol vs minion company at a non-Moria shadow-hold is detainment', () => {
    // Swap Moria (le-392) for a shadow-hold without attacks-not-detainment
    // to prove the override is what flips the flag. Use hero Moria (tw-413)
    // — same site type (shadow-hold) and same name but no site-rule on it.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MORIA_TW, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [ORC_PATROL],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [],
        resolvedSitePathNames: [],
        destinationSiteType: SiteType.ShadowHold,
        destinationSiteName: 'Moria',
      }),
    };
    const orcPatrolId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, orcPatrolId, companyId, SHADOW_HOLD_KEYING,
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.detainment).toBe(true);
  });
});
