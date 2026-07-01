/**
 * @module rule-8.08-strike-assignment-precedence
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.08: Strike Assignment Precedence
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Effects that change strike assignments and are written as "always" or "in all cases" take precedence over strike-assignment effects that are written as "regardless of [certain factors]". If two of these effects would still conflict, the resource takes precedence over the hazard.
 */

import { describe, test } from 'vitest';

// This rule requires a genuine precedence system for competing
// strike-assignment effects (an "always/in all cases" textual tier ranked
// above "regardless of X", with a resource-over-hazard tiebreaker below
// that) — the engine has no such tiering; strike-assignment effects are
// evaluated card-by-card with no notion of one effect's text overriding
// another's. Implementing this would mean adding a precedence tag to the
// strike-assignment DSL and a resolver pass, which no currently-certified
// card pair actually needs (no two cards in the pool have conflicting
// strike-assignment effects), so there's no reachable scenario to drive it.
describe('Rule 8.08 — Strike Assignment Precedence', () => {
  test.todo('"Always/in all cases" effects take precedence over "regardless of" effects; resource over hazard if still conflict');
});
