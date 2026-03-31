/**
 * @module rule-9.03-agent-reveal
 *
 * CoE Rules — Section 9: Agents, Events, Items & Rings
 * Rule 9.03: Agent Reveal
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * The hazard player may reveal an agent hazard during a resource player's movement/hazard phase (which isn't an agent action and doesn't count against the hazard limit). An agent is revealed by turning it face-up, along with its current site which must remain face-up while the agent is face-up and is then returned to its player's location deck when the agent leaves play or moves while face-up.
 * When an agent hazard is revealed, its previous sites are revealed to check for legal movement and then are returned to the agent player's location deck without having been in play (and thus are not affected by environment effects). If the agent's movement was or has become illegal when the agent is revealed, whether the movement was from one of the agent's home sites or from a site that was left face-up when the agent was previously turned face-down, the agent is immediately discarded and its current site is similarly returned to the agent player's location deck.
 */

import { describe, test } from 'vitest';

describe('Rule 9.03 — Agent Reveal', () => {
  test.todo('Agent may be revealed during M/H phase (not an agent action, no hazard limit cost); previous sites checked for legal movement');
});
