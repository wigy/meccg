/**
 * @module rule-9.14-fw-stage-event-rules
 *
 * CoE Rules — Section 9: Agents, Events, Items & Rings
 * Rule 9.14: Fallen-Wizard Stage/Event Rules
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [FALLEN-WIZARD] Stage resource permanent-events can only be played during the organization phase.
 * [FALLEN-WIZARD] A hero resource permanent-event cannot be played on a company containing an Orc and/or a Troll.
 * [FALLEN-WIZARD] A hero resource that requires a character with a specific skill cannot use an Orc or Troll character to fulfill that active condition, and Orc and Troll characters cannot be tapped to fulfill an active condition of a hero resource or its effects.
 */

import { describe, test } from 'vitest';

describe('Rule 9.14 — Fallen-Wizard Stage/Event Rules', () => {
  test.todo('[FALLEN-WIZARD] Stage permanents only during org phase; hero permanent cannot be on Orc/Troll company; hero resource skill cannot use Orc/Troll');
});
