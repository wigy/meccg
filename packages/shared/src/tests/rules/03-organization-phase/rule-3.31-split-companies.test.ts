/**
 * @module rule-3.31-split-companies
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.31: Split Companies
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * The resource player may split a company into multiple companies at the same site while organizing during the organization phase, but the resulting companies cannot be rejoined during the same organization phase and all but one of the companies must declare movement to a new site during that organization phase.
 * Whenever a company splits, the resource player chooses which characters are considered the original company and which characters are considered the new company. Any resource permanent-events or ongoing effects that were targeting the original company (as an entity) stay with the original company, whereas any effects that are targeting a specific "character's company" stay with that character. The hazard player chooses which hazard permanent-events played on the original company go with which subsequent company. Both companies are considered to have faced any attacks that the original company faced before splitting.
 * When a company splits at a haven, its player may place an additional untapped copy of the haven with the new company.
 */

import { describe, test } from 'vitest';

describe('Rule 3.31 — Split Companies', () => {
  test.todo('May split company; cannot rejoin same phase; all but one must declare movement; resource player chooses original');
});
