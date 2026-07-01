/**
 * @module rule-5.21-multi-attack-creature-key
 *
 * CoE Rules — Section 5: Movement/Hazard Phase
 * Rule 5.21: Multi-Attack Creature Key Validity
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * The declared key of a creature with multiple attacks remains an active condition for resolving each of those attacks into combat; if the key is no longer valid at the start of any of the creature's attacks, the creature is immediately discarded without effect (but still counts against the hazard limit).
 */

import { describe, test } from 'vitest';

describe('Rule 5.21 — Multi-Attack Creature Key Validity', () => {
  // `PlayHazardAction.keyedBy` records which keying rule matched at play
  // time, but nothing re-checks it before each of a multi-strike creature's
  // attacks — `checkCreatureKeying` is only ever called once, at play time
  // (grep confirms no call site in combat-actions.ts/combat-strike.ts/
  // combat-finalize.ts). A company's site path also never changes mid-combat
  // in the current engine, so there is no scenario with existing cards where
  // a previously-valid key would become invalid between strikes to exercise
  // the "immediately discarded without effect" behavior against.
  test.todo('Declared key remains active condition for each attack; if key invalid, creature discarded without effect');
});
