/**
 * @module rule-5.15-mh-step6-passive-conditions
 *
 * CoE Rules — Section 5: Movement/Hazard Phase
 * Rule 5.15: Step 6: Resolve Passive Conditions
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Movement/Hazard Phase, Step 6 (Resolve Passive Conditions) - Passive conditions that must be declared at the "beginning" of the movement/hazard phase or due to some other condition having come into effect are now declared in an order chosen by the resource player. Players may respond to any initiated chain of effects during this step with their own actions, including actions that the hazard player could otherwise legally take during the next step of the movement/hazard phase.
 */

import { describe, test } from 'vitest';

describe('Rule 5.15 — Step 6: Resolve Passive Conditions', () => {
  // The engine's M/H step sequence (select-company, reveal-new-site,
  // under-deeps-roll, set-hazard-limit, order-effects, draw-cards,
  // play-hazards, reset-hand) has no distinct step between draw-cards and
  // play-hazards for a resource-player-ordered declaration of passive
  // conditions — see rule 5.05, which documents the same gap for the
  // "beginning of phase" half of this rule. No card in the current pool
  // needs an interactive step here (see also the `region.type` gap noted
  // in rule 5.09 — a real card exercising "some other condition having come
  // into effect" would likely route through the same missing mechanism).
  test.todo('Passive conditions declared at beginning of M/H phase or due to conditions; resource player chooses order');
});
