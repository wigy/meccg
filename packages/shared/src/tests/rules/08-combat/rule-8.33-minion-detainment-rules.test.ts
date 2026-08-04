/**
 * @module rule-8.33-minion-detainment-rules
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.33: Minion/Balrog Detainment Rules
 *
 * Source: docs/coe-rules.md
 */

/*
 * RULING:
 *
 * 3.II.2.R1 [MINION] A Ringwraith player treats any attack keyed to a
 *   Dark-domain, Dark-hold, Shadow-hold, or Darkhaven against their
 *   companies as detainment.
 * 3.II.2.R2 [MINION] A Ringwraith player treats any Orc, Troll, Undead, or
 *   Man attack keyed to a Shadow-land against their companies as
 *   detainment.
 * 3.II.2.R3 [MINION] A Ringwraith player treats agent hazard attacks
 *   against their companies as detainment.
 * 3.II.2.B1 / B2 / B3 [BALROG] Identical rules for Balrog players.
 */

import { describe, test, expect } from 'vitest';
import { isDetainmentAttack } from '../../../engine/detainment.js';
import { Alignment, Race, RegionType, SiteType } from '../../../types/common.js';
import type { CombatDetainmentEffect } from '../../../types/effects.js';

describe('Rule 8.33 — Minion/Balrog Detainment Rules', () => {
  test('3.II.2.R1 [MINION] — creature keyed to Dark-domain region → detainment', () => {
    expect(isDetainmentAttack({
      attackRace: Race.Orc,
      attackKeyedTo: [{ regionTypes: [RegionType.Dark] }],
      defendingAlignment: Alignment.Ringwraith,
    })).toBe(true);
  });

  test('3.II.2.R1 [MINION] — creature keyed to Dark-hold site → detainment', () => {
    expect(isDetainmentAttack({
      attackRace: Race.Orc,
      attackKeyedTo: [{ siteTypes: [SiteType.DarkHold] }],
      defendingAlignment: Alignment.Ringwraith,
    })).toBe(true);
  });

  test('3.II.2.R1 [MINION] — creature keyed to Shadow-hold site → detainment', () => {
    expect(isDetainmentAttack({
      attackRace: Race.Troll,
      attackKeyedTo: [{ siteTypes: [SiteType.ShadowHold] }],
      defendingAlignment: Alignment.Ringwraith,
    })).toBe(true);
  });

  test('3.II.2.R2 [MINION] — Orc keyed to Shadow-land → detainment', () => {
    expect(isDetainmentAttack({
      attackRace: Race.Orc,
      attackKeyedTo: [{ regionTypes: [RegionType.Shadow] }],
      defendingAlignment: Alignment.Ringwraith,
    })).toBe(true);
  });

  test('3.II.2.R2 [MINION] — Troll / Undead / Man keyed to Shadow-land → detainment', () => {
    for (const race of [Race.Troll, Race.Undead, Race.Man]) {
      expect(isDetainmentAttack({
        attackRace: race,
        attackKeyedTo: [{ regionTypes: [RegionType.Shadow] }],
        defendingAlignment: Alignment.Ringwraith,
      })).toBe(true);
    }
  });

  test('3.II.2.R3 [MINION] — agent hazard → detainment', () => {
    expect(isDetainmentAttack({
      attackRace: Race.Man,
      isAgentHazard: true,
      defendingAlignment: Alignment.Ringwraith,
    })).toBe(true);
  });

  test('3.II.2.B1 [BALROG] — creature keyed to Dark-domain / Dark-hold / Shadow-hold → detainment', () => {
    expect(isDetainmentAttack({
      attackRace: Race.Orc,
      attackKeyedTo: [{ regionTypes: [RegionType.Dark] }],
      defendingAlignment: Alignment.Balrog,
    })).toBe(true);
    expect(isDetainmentAttack({
      attackRace: Race.Orc,
      attackKeyedTo: [{ siteTypes: [SiteType.DarkHold, SiteType.ShadowHold] }],
      defendingAlignment: Alignment.Balrog,
    })).toBe(true);
  });

  test('3.II.2.B2 [BALROG] — Orc / Troll / Undead / Man keyed to Shadow-land → detainment', () => {
    for (const race of [Race.Orc, Race.Troll, Race.Undead, Race.Man]) {
      expect(isDetainmentAttack({
        attackRace: race,
        attackKeyedTo: [{ regionTypes: [RegionType.Shadow] }],
        defendingAlignment: Alignment.Balrog,
      })).toBe(true);
    }
  });

  test('3.II.2.B3 [BALROG] — agent hazard → detainment', () => {
    expect(isDetainmentAttack({
      attackRace: Race.Man,
      isAgentHazard: true,
      defendingAlignment: Alignment.Balrog,
    })).toBe(true);
  });

  test('3.II.2 negative — Ringwraith hit by non-matching race in Shadow-land → NOT detainment', () => {
    // Dragon in a Shadow-land region: race not in {Orc, Troll, Undead, Man}
    // and no Dark-domain/Dark-hold/Shadow-hold keying → not detainment.
    expect(isDetainmentAttack({
      attackRace: Race.Dragon,
      attackKeyedTo: [{ regionTypes: [RegionType.Shadow] }],
      defendingAlignment: Alignment.Ringwraith,
    })).toBe(false);
  });

  test('3.II.2 negative — Wizard/hero company faces Dark-domain-keyed creature → NOT auto-detained', () => {
    // The R/B conditionals only apply to Ringwraith and Balrog companies.
    expect(isDetainmentAttack({
      attackRace: Race.Orc,
      attackKeyedTo: [{ regionTypes: [RegionType.Dark] }],
      defendingAlignment: Alignment.Wizard,
    })).toBe(false);
    expect(isDetainmentAttack({
      attackRace: Race.Orc,
      attackKeyedTo: [{ regionTypes: [RegionType.Dark] }],
      defendingAlignment: Alignment.FallenWizard,
    })).toBe(false);
  });

  test('3.II.2.R1 negative — creature keyed to Ruins&Lairs (declared) does NOT detain, even though its keyedTo also lists Shadow-hold/Dark-hold as alternatives', () => {
    // Regression: Orc-lieutenant (tw-073) is keyed to region types
    // Wilderness/Shadow/Dark *or* site types Ruins&Lairs/Shadow-hold/Dark-hold
    // — all in one keyedTo entry. Played at a Ruins&Lairs site (The Worthy
    // Hills), the declared keying match is site-type Ruins&Lairs only. The
    // engine must not detain the attack just because the card's keyedTo
    // entry also happens to list Dark-hold/Shadow-hold as an alternative it
    // could have used elsewhere — only the alternative actually declared for
    // this play counts (bug report: msf2d55o-4npqlf, seq 1191).
    expect(isDetainmentAttack({
      attackRace: Race.Orc,
      attackKeyedTo: [{
        regionTypes: [RegionType.Wilderness, RegionType.Shadow, RegionType.Dark],
        siteTypes: [SiteType.RuinsAndLairs, SiteType.ShadowHold, SiteType.DarkHold],
      }],
      attackDeclaredSiteTypes: [SiteType.RuinsAndLairs],
      attackDeclaredRegionTypes: [],
      defendingAlignment: Alignment.Ringwraith,
    })).toBe(false);
  });

  test('3.II.2 — combat-detainment effect on the attack itself → detainment regardless of defender alignment', () => {
    const detainEffect: CombatDetainmentEffect = { type: 'combat-detainment' };
    // Hero company, Wilderness keying, no Ringwraith/Balrog conditions —
    // still detainment because the attack card declares the effect.
    expect(isDetainmentAttack({
      attackEffects: [detainEffect],
      attackRace: Race.Orc,
      attackKeyedTo: [{ regionTypes: [RegionType.Wilderness] }],
      defendingAlignment: Alignment.Wizard,
    })).toBe(true);
  });
});
