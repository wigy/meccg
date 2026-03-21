/**
 * @module 09-agents.test
 *
 * Tests for CoE Rules Section 4: Agents.
 *
 * Rule references from docs/coe-rules.txt lines 524-547.
 */

import { describe, test } from 'vitest';

describe('4 Agent actions', () => {
  test.todo('[4] agent action costs 1 against hazard limit');
  test.todo('[4] agent must have been in play at start of turn to take action');
  test.todo('[4] each agent can only take one agent action per turn');
  test.todo('[4] agent may move to non-under-deeps site in same/adjacent region');
  test.todo('[4] agent taps when moving');
  test.todo('[4] agent may return to home site');
  test.todo('[4] agent may heal wounded to tapped');
  test.todo('[4] agent may untap');
  test.todo('[4] agent may turn face-down (untapped only)');
  test.todo('[4] agent may tap to key creatures to its current site');
});

describe('4 Agent reveal', () => {
  test.todo('[4] revealing agent is not an agent action, no hazard limit cost');
  test.todo('[4] revealed agent: previous sites checked for legal movement then returned');
  test.todo('[4] illegal movement when revealed: agent discarded');
  test.todo('[4] only face-up agents are considered for uniqueness');
  test.todo('[4] agent cannot move to haven sites for wizard players');
});
