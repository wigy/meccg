/**
 * @module rule-9.07-agent-haven-restriction
 *
 * CoE Rules — Section 9: Agents, Events, Items & Rings
 * Rule 9.07: Agent Haven Movement Restriction
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * An agent hazard cannot move to any version of a site that corresponds to a Haven for Wizard players (including Edhellond, Grey Havens, Lórien, and Rivendell), and cannot move to a site that corresponds to a Wizardhaven in play unless it is an Elf agent. If a non-Elf agent hazard is revealed and any of the sites through which it moved are currently a Haven or Wizardhaven in play, the agent is discarded even if the movement was legal when the agent originally moved face-down.
 */

import { describe, test } from 'vitest';

describe('Rule 9.07 — Agent Haven Movement Restriction', () => {
  test.todo('Agent cannot move to Haven sites; cannot move to Wizardhaven unless Elf agent; discarded if moved through Haven/Wizardhaven');
});
