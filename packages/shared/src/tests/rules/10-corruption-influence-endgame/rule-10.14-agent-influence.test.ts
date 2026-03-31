/**
 * @module rule-10.14-agent-influence
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.14: Influencing with an Agent
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Influencing with an Agent - If an effect allows an agent hazard to make an influence attempt (which does not count as an agent action), a hazard player can have that agent make the influence attempt against an opponent's card during an opponent's movement/hazard phase. The agent must be at the company's new site for a target in a moving company OR at the company's current site for a target in a company that isn't moving OR at a site where the faction is playable if influencing a faction. When the influence attempt is declared, the agent is revealed and is treated as the character making the influence attempt in the normal procedure for influence attempts, except that the hazard player cannot reveal an identical card from their hand (and thus cannot influence an item), and the attempt is additionally modified as follows:
 * • If the agent is at one of its home sites, its direct influence is modified by +2.
 * • If the influence attempt is against an ally or character that shares a home site with the agent, the target's mind is treated as zero and the hazard player's roll is modified by an additional +2.
 * • If the influence attempt is against a faction that is playable at one of the agent's home sites, the value required to bring the faction into play is treated as zero and the hazard player's roll is modified by an additional +2.
 */

import { describe, test } from 'vitest';

describe('Rule 10.14 — Influencing with an Agent', () => {
  test.todo('Agent hazard may make influence attempt during opponent M/H phase; special bonuses at home site and shared home site');
});
