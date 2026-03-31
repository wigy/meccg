/**
 * @module rule-5.18-playing-creature
 *
 * CoE Rules — Section 5: Movement/Hazard Phase
 * Rule 5.18: Playing a Creature
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Playing a Creature - As an action during a movement/hazard phase, the hazard player may play a creature targeting the current company. Playing a creature counts as one against the hazard limit, and can only be declared if doing so initiates a new chain of effects (i.e. it cannot be played in response). The creature must be "keyed" as an active condition, meaning that one of the following conditions must be specified by the hazard player when the creature is declared:
 * • The creature is being keyed to a specific region type on the creature's card OR a specific region name where the creature is playable as indicated in the creature's text, which in either case must match a type or name of one of the regions that the company is moving through. If multiple of the same region type appear on the creature card, the company must be moving through at least that many corresponding regions (but which need not be consecutive).
 * • The creature is being keyed to a specific site type on the creature's card OR a specific site name where the creature is playable as indicated in the creature's text, which in either case must match the type or name of the company's new site (i.e. the company's current site if the company is not moving).
 */

import { describe, test } from 'vitest';

describe('Rule 5.18 — Playing a Creature', () => {
  test.todo('Creature targets current company; counts against hazard limit; must initiate new chain; must be keyed to region or site');
});
