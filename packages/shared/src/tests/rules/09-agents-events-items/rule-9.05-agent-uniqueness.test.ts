/**
 * @module rule-9.05-agent-uniqueness
 *
 * CoE Rules — Section 9: Agents, Events, Items & Rings
 * Rule 9.05: Agent Uniqueness
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Only face-up agent hazards are considered for uniqueness. If an agent hazard is revealed to be an identical manifestation of a unique character or hazard already in play, the more recently revealed agent is immediately discarded.
 * The current site for an agent hazard is considered in play while the site is face-up.
 */

import { describe, test } from 'vitest';

describe('Rule 9.05 — Agent Uniqueness', () => {
  test.todo('Only face-up agents count for uniqueness; if identical to unique entity in play, more recent is discarded');
});
