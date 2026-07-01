/**
 * @module rule-5.25-fw-covert-overt-hazards
 *
 * CoE Rules — Section 5: Movement/Hazard Phase
 * Rule 5.25: Fallen-Wizard Covert/Overt for Hazards
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [FALLEN-WIZARD] For the purpose of hazards (other than determining whether an attack is detainment), a Fallen-wizard player's covert companies are considered hero companies, and a Fallen-wizard player's overt companies are considered minion companies. When determining whether an attack is detainment, a Fallen-wizard player's companies are considered hero companies.
 */

import { describe, test, expect } from 'vitest';
import { isDetainmentAttack } from '../../../engine/detainment.js';
import { Alignment, Race, RegionType } from '../../../types/common.js';

describe('Rule 5.25 — Fallen-Wizard Covert/Overt for Hazards', () => {
  test('[FALLEN-WIZARD] When determining detainment, a Fallen-wizard player\'s companies are always treated as hero companies', () => {
    // 3.II.2.R1: Ringwraith players treat a Dark-domain-keyed attack as
    // detainment; Balrog players get the identical rule (3.II.2.B1). A
    // Fallen-wizard defender must NOT get this treatment — regardless of
    // covert/overt status, rule 5.25 says detainment always uses "hero".
    const attack = {
      attackRace: Race.Orc,
      attackKeyedTo: [{ regionTypes: [RegionType.Dark] }],
    };

    expect(isDetainmentAttack({ ...attack, defendingAlignment: Alignment.Ringwraith })).toBe(true);
    expect(isDetainmentAttack({ ...attack, defendingAlignment: Alignment.Balrog })).toBe(true);
    expect(isDetainmentAttack({ ...attack, defendingAlignment: Alignment.FallenWizard })).toBe(false);
    // Baseline: a plain Wizard defender is likewise not detainment here.
    expect(isDetainmentAttack({ ...attack, defendingAlignment: Alignment.Wizard })).toBe(false);
  });

  // The engine has no alignment-gating on which hazard cards may target
  // which companies at all (verified: no hero-vs-minion check exists in
  // movement-hazard.ts's play-hazard legal-action generator for ANY
  // alignment — in the base 2-player game this is moot because deck
  // construction already keeps a hazard player's hand alignment-homogeneous
  // with their own deck). Implementing "FW covert companies count as hero
  // targets, overt as minion targets" for hazard purposes would first
  // require building that foundational hero/minion hazard-targeting
  // restriction, which is out of scope here.
  test.todo('[FALLEN-WIZARD] Covert companies are hero-targetable and overt companies are minion-targetable for hazard cards (other than detainment)');
});
