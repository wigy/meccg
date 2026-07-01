/**
 * @module rule-5.04-illegal-movement
 *
 * CoE Rules — Section 5: Movement/Hazard Phase
 * Rule 5.04: Illegal Movement Negated
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * If a company's movement is illegal when the new site is revealed during the company's movement/hazard phase, the movement is negated, the new site is returned to its player's location deck, and the company must remain at its current site but still conducts a movement/hazard phase.
 */

import { describe, test } from 'vitest';

describe('Rule 5.04 — Illegal Movement Negated', () => {
  // Only Under-deeps movement (rule 5.03) has this "negate on reveal, return
  // site to deck, company stays" safety net — and there it is driven by a
  // dedicated dice roll, not a legality recheck. `handleRevealNewSite`
  // (mh-steps.ts) never re-validates a declared starter/region/special path
  // against current game state at reveal time — it trusts whatever the
  // `declare-path` action supplied, consistent with this engine's general
  // "reducer trusts pre-vetted actions" pattern (legality is enforced by the
  // legal-action generator that offered `declare-path`, at declare time).
  // Nothing in the current card pool can change movement legality between a
  // company's organization-phase movement declaration and its M/H-phase
  // reveal (no intervening state mutation opportunity for that one
  // company), so there is no reachable scenario to exercise this rule
  // against without inventing one.
  test.todo('If movement is illegal when revealed, movement negated, company stays at current site but still conducts M/H phase');
});
