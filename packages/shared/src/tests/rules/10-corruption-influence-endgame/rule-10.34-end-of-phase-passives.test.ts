/**
 * @module rule-10.34-end-of-phase-passives
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.34: End-of-Phase Passive Conditions
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Any passive condition effects that would be initiated at the end of a phase/turn must be immediately declared in a single chain of effects (in an order chosen by the resource player) once both players declare that they have finished taking normal actions during the phase. Players may then respond to this chain of effects with their own "at the end of [this phase/turn]" actions, actions that target dice-rolls, and actions that target declared cards or cards with declared passive conditions; no other actions can be declared in response. Players may also declare additional "at the end of [this phase/turn]" actions after any initial passive conditions have resolved, and may respond the same way. If a phase ends "immediately," no further actions may be declared by players during that phase, but passive condition effects are still initiated without an option to respond.
 */

import { describe, test } from 'vitest';

// Mirrors rule 10.33 at the other end of a phase: specific "end of phase"
// discards/checks (e.g. the End-of-Turn phase's own discard/reset-hand
// steps) are hardcoded phase-transition logic, not a generic "collect all
// end-of-phase passives into a chain with a restricted response window"
// mechanism. There's no reachable scenario with competing end-of-phase
// passives to prove the specific response-action restrictions this rule
// describes.
describe('Rule 10.34 — End-of-Phase Passive Conditions', () => {
  test.todo('Passive conditions at end of phase/turn declared after both players done; limited response actions allowed');
});
