/**
 * @module rule-10.36-attribute-modification-passives
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.36: Attribute Modification as Passive Conditions
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Card effects that modify the attributes of entities in play without targeting the entity affect the board state and thus are implemented as passive conditions, meaning that they initiate a chain of effects when an appropriate entity becomes available to be modified.
 */

import { describe, test } from 'vitest';

// Untargeted attribute modifiers (company-stat-modifier constraints,
// `all-characters`/`all-attacks`-scoped stat/check modifiers) are
// implemented as continuously-recomputed passive state — `recompute-derived`
// re-derives every character's effective stats from all currently-active
// modifiers on every state change, rather than opening a discrete chain of
// effects "when an appropriate entity becomes available." The engine's
// design achieves the same net effect (a newly-arriving character
// immediately picks up an existing untargeted modifier) but not via the
// chain-of-effects mechanism the rule specifically describes, so there's no
// scenario that would prove the CRF-literal "initiates a chain" behavior
// rather than just the observable outcome.
describe('Rule 10.36 — Attribute Modification as Passive Conditions', () => {
  test.todo('Untargeted attribute modifications are implemented as passive conditions when appropriate entity becomes available');
});
